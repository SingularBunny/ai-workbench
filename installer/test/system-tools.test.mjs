import { test } from "node:test";
import assert from "node:assert/strict";

import { formatSystemTools, localeOcrLanguage, systemToolsPlan } from "../system-tools.mjs";

const whichOf = (...present) => (cmd) => cmd === "python3" || present.includes(cmd);
const all = { office: true, knowledge: true, vulkanEmbeddings: false };

test("system tools: Arch takes the repo packages with pacman and ocrmypdf from the AUR, with the locale's OCR language", () => {
  const plan = systemToolsPlan({ ctx: all, which: whichOf("pacman", "yay"), env: { LANG: "ru_RU.UTF-8" } });
  assert.deepEqual(plan.missing.map((m) => m.cmd), ["soffice", "pdftotext", "tesseract", "ocrmypdf"]);
  assert.deepEqual(plan.commands, [
    "sudo pacman -S --needed libreoffice-fresh poppler tesseract tesseract-data-eng tesseract-data-rus",
    "yay -S --needed ocrmypdf",
  ]);
  assert.match(formatSystemTools(plan), /ocrmypdf\s+OCR of scanned PDF pages/);
});

test("system tools: Debian installs everything with apt; nothing missing prints nothing", () => {
  const plan = systemToolsPlan({ ctx: all, which: whichOf("apt-get"), env: { LANG: "de_DE.UTF-8" } });
  assert.deepEqual(plan.commands, ["sudo apt-get install -y libreoffice poppler-utils tesseract-ocr ocrmypdf tesseract-ocr-deu"]);
  const done = systemToolsPlan({ ctx: all, which: whichOf("apt-get", "soffice", "pdftotext", "tesseract", "ocrmypdf"),
    ocrLanguages: ["eng", "deu"], env: { LANG: "de_DE.UTF-8" } });
  assert.equal(formatSystemTools(done), "");
});

test("system tools: an installed tesseract without the locale's language asks for its data only", () => {
  const plan = systemToolsPlan({ ctx: all, which: whichOf("pacman", "soffice", "pdftotext", "tesseract", "ocrmypdf"),
    ocrLanguages: ["eng", "osd"], env: { LANG: "ru_RU.UTF-8" } });
  assert.deepEqual(plan.missing.map((m) => m.cmd), ["tesseract (rus)"]);
  assert.deepEqual(plan.commands, ["sudo pacman -S --needed tesseract-data-rus"]);
});

test("system tools: features not in use need nothing; no AUR helper or package manager leaves a manual note", () => {
  assert.deepEqual(systemToolsPlan({ ctx: { office: true, knowledge: false }, which: whichOf("pacman", "soffice") }).missing, []);
  const arch = systemToolsPlan({ ctx: all, which: whichOf("pacman", "soffice", "pdftotext", "tesseract"), ocrLanguages: ["eng"] });
  assert.deepEqual([arch.commands, arch.manual], [[], ["ocrmypdf (from the AUR)"]]);
  assert.deepEqual(systemToolsPlan({ ctx: { vulkanEmbeddings: true }, which: whichOf() }).manual, ["vulkaninfo"]);
  assert.equal(localeOcrLanguage({ LANG: "en_US.UTF-8" }), null);
});
