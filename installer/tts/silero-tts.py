#!/usr/bin/env python3
"""Speech for OpenClaw's tts-local-cli provider with a local Silero model (Russian and other Silero languages).

Reads the text on standard input and writes a WAV file:
  silero-tts.py --model <file.pt> --out <file.wav> [--speaker xenia] [--sample-rate 48000]
Silero takes a limited text per call, so long text is spoken sentence by sentence and joined. Silero skips digits
and Latin letters, so numbers become words (num2words) and Latin is read in Russian letters first.
"""
import argparse
import re
import sys
import wave

import torch
from num2words import num2words

MAX_CHARS = 800
# Letter names for acronyms (HX → эйч икс) and sounds for Latin words (heater → хеатер).
LETTER_NAMES = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "эй би си ди и эф джи эйч ай джей кей эл эм эн оу пи кью ар эс ти ю ви дабл-ю икс уай зед".split()))
SOUNDS = [("sh", "ш"), ("ch", "ч"), ("th", "т"), ("ph", "ф"), ("oo", "у"), ("ee", "и"), ("ck", "к"), ("qu", "кв")] + list(
    zip("abcdefghijklmnopqrstuvwxyz", "а б к д е ф г х и дж к л м н о п к р с т у в в кс й з".split()))


def latin(word):
    if word.isupper() or len(word) == 1:
        return " ".join(LETTER_NAMES[c] for c in word.upper())
    word = word.lower()
    for src, dst in SOUNDS:
        word = word.replace(src, dst)
    return word


def number(match, lang):
    text = match.group(0).replace(",", ".")
    try:
        return f" {num2words(float(text) if '.' in text else int(text), lang=lang)} "
    except (ValueError, NotImplementedError, OverflowError):
        return " ".join(match.group(0))


def speakable(text, lang="ru"):
    text = re.sub(r"\b(\d{1,2}):00\b", r"\1", text)  # 9:00 → 9
    text = re.sub(r"(?<=\d):(?=\d)", " ", text)  # 9:30 → 9 30
    text = re.sub(r"\d+(?:[.,]\d+)?", lambda m: number(m, lang), text)
    text = re.sub(r"[A-Za-z]+", lambda m: latin(m.group(0)), text)
    return re.sub(r"\s+", " ", text).strip()


def chunks(text):
    """Sentences packed up to MAX_CHARS; a sentence longer than that is cut at spaces."""
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?…])\s+", text):
        while len(sentence) > MAX_CHARS:
            cut = sentence.rfind(" ", 0, MAX_CHARS)
            cut = cut if cut > 0 else MAX_CHARS
            parts.append(sentence[:cut])
            sentence = sentence[cut:].lstrip()
        if current and len(current) + 1 + len(sentence) > MAX_CHARS:
            parts.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        parts.append(current)
    # Silero refuses text without any letter it can speak.
    return [p for p in parts if re.search(r"\w", p)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--speaker", default="xenia")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--lang", default="ru", help="num2words language for numbers")
    args = parser.parse_args()
    text = speakable(sys.stdin.read(), args.lang)
    if not text:
        sys.exit("no text on standard input")
    torch.set_num_threads(4)
    model = torch.package.PackageImporter(args.model).load_pickle("tts_models", "model")
    model.to("cpu")
    pause = torch.zeros(int(args.sample_rate * 0.25))
    audio = []
    for part in chunks(text):
        audio += [model.apply_tts(text=part, speaker=args.speaker, sample_rate=args.sample_rate,
                                  put_accent=True, put_yo=True), pause]
    if not audio:
        sys.exit("nothing to speak")
    samples = (torch.cat(audio).clamp(-1, 1) * 32767).to(torch.int16).numpy().tobytes()
    with wave.open(args.out, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(args.sample_rate)
        out.writeframes(samples)


if __name__ == "__main__":
    main()
