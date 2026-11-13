// System programs that ai-workbench features use but neither OpenClaw nor the installer brings: Python, LibreOffice,
// poppler, OCR, Vulkan tools. None is required for the install itself; without one, its feature is off and says so. The plan
// lists the missing ones with the feature they serve and one install command for the machine's package manager;
// an interactive install offers to run it (sudo asks for the password itself), `--yes` only prints it.
//
// Package names: Debian/Ubuntu (apt), Fedora (dnf), Arch (pacman; `aur` for packages only the AUR has), macOS (brew).

/** Programs by feature. when(ctx) says whether the feature is in use on this install. */
export const SYSTEM_TOOLS = [
  { cmd: "python3", feature: "the judge (judge.py of the aiwb judge skill)",
    when: () => true,
    packages: { apt: ["python3"], dnf: ["python3"], pacman: ["python"], brew: ["python"] } },
  { cmd: "soffice", feature: "Office document preview in chat and Office text in the knowledge base (aiwb-office)",
    when: (c) => c.office,
    packages: { apt: ["libreoffice"], dnf: ["libreoffice"], pacman: ["libreoffice-fresh"], brew: ["--cask", "libreoffice"] } },
  { cmd: "pdftotext", feature: "PDF text in the knowledge base",
    when: (c) => c.office && c.knowledge,
    packages: { apt: ["poppler-utils"], dnf: ["poppler-utils"], pacman: ["poppler"], brew: ["poppler"] } },
  { cmd: "tesseract", feature: "OCR of scanned PDF pages and images in the knowledge base",
    when: (c) => c.office && c.knowledge,
    packages: { apt: ["tesseract-ocr"], dnf: ["tesseract"], pacman: ["tesseract", "tesseract-data-eng"], brew: ["tesseract"] } },
  { cmd: "ocrmypdf", feature: "OCR of scanned PDF pages in the knowledge base",
    when: (c) => c.office && c.knowledge,
    packages: { apt: ["ocrmypdf"], dnf: ["ocrmypdf"], aur: ["ocrmypdf"], brew: ["ocrmypdf"] } },
  { cmd: "vulkaninfo", feature: "picking the GPU for local memory-search embeddings (WORKBENCH_LOCAL_EMBEDDINGS=vulkan)",
    when: (c) => c.vulkanEmbeddings,
    packages: { apt: ["vulkan-tools"], dnf: ["vulkan-tools"], pacman: ["vulkan-tools"] } },
];

/** Tesseract language data per package manager; eng comes with the base package except on Arch. */
const OCR_LANG_PACKAGE = { apt: (l) => `tesseract-ocr-${l}`, dnf: (l) => `tesseract-langpack-${l}`, pacman: (l) => `tesseract-data-${l}` };

/** Locale language (ISO 639-1) → Tesseract language code, for the common ones. */
const TESSERACT_LANG = { ru: "rus", uk: "ukr", be: "bel", kk: "kaz", de: "deu", fr: "fra", es: "spa", it: "ita", pt: "por",
  pl: "pol", cs: "ces", nl: "nld", sv: "swe", fi: "fin", tr: "tur", zh: "chi_sim", ja: "jpn", ko: "kor", ar: "ara", he: "heb" };

/** The OCR language the user's locale asks for besides English, or null. */
export function localeOcrLanguage(env = {}) {
  const lang = String(env.LC_ALL || env.LC_MESSAGES || env.LANG || "").toLowerCase().slice(0, 2);
  return TESSERACT_LANG[lang] ?? null;
}

/** The machine's package manager: apt, dnf, pacman or brew; null if none is known. */
export function packageManager(which) {
  return ["apt-get", "dnf", "pacman", "brew"].find((c) => which(c))?.replace("apt-get", "apt") ?? null;
}

const INSTALL = { apt: "sudo apt-get install -y", dnf: "sudo dnf install -y", pacman: "sudo pacman -S --needed", brew: "brew install" };

/**
 * Missing programs and how to install them. ctx: { office, knowledge, vulkanEmbeddings }; which(cmd) → bool;
 * ocrLanguages: installed Tesseract languages (null when tesseract is missing); env for the locale.
 * Returns { missing: [{ cmd, feature }], commands: [shell lines], manual: [cmd without a package here], pm }.
 */
export function systemToolsPlan({ ctx, which, ocrLanguages = null, env = {} }) {
  const pm = packageManager(which);
  const missing = SYSTEM_TOOLS.filter((t) => t.when(ctx) && !which(t.cmd)).map((t) => ({ cmd: t.cmd, feature: t.feature, packages: t.packages }));
  // The OCR language of the locale: missing when tesseract is to be installed, or is installed without it.
  const lang = localeOcrLanguage(env);
  const ocrInUse = SYSTEM_TOOLS.find((t) => t.cmd === "tesseract").when(ctx);
  const langMissing = ocrInUse && lang && (ocrLanguages ? !ocrLanguages.includes(lang) : missing.some((m) => m.cmd === "tesseract"));
  if (langMissing && ocrLanguages) missing.push({ cmd: `tesseract (${lang})`, feature: `OCR in your locale's language (${lang})`, packages: {} });
  const repo = [], aur = [], manual = [];
  for (const m of missing) {
    if (m.cmd.startsWith("tesseract (")) continue;
    const pkgs = pm && m.packages[pm];
    if (pkgs) repo.push(...pkgs);
    else if (pm === "pacman" && m.packages.aur) aur.push(...m.packages.aur);
    else manual.push(m.cmd);
  }
  if (langMissing && OCR_LANG_PACKAGE[pm]) repo.push(OCR_LANG_PACKAGE[pm](lang));
  else if (langMissing && pm === "brew") repo.push("tesseract-lang");
  const commands = [];
  if (repo.length) commands.push(`${INSTALL[pm]} ${[...new Set(repo)].join(" ")}`);
  // AUR packages are built as the user, never with sudo; the helper asks before it builds.
  const aurHelper = ["yay", "paru"].find((h) => which(h));
  if (aur.length && aurHelper) commands.push(`${aurHelper} -S --needed ${aur.join(" ")}`);
  else if (aur.length) manual.push(...aur.map((p) => `${p} (from the AUR)`));
  return { missing: missing.map(({ cmd, feature }) => ({ cmd, feature })), commands, manual, pm };
}

/** Plan lines for the missing programs; empty when nothing is missing. */
export function formatSystemTools(plan) {
  if (!plan.missing.length) return "";
  const width = Math.max(...plan.missing.map((m) => m.cmd.length));
  const lines = ["System programs (optional; without one, its feature is off):",
    ...plan.missing.map((m) => `  ${m.cmd.padEnd(width)}  ${m.feature}`)];
  if (plan.commands.length) lines.push("  install with:", ...plan.commands.map((c) => `    ${c}`));
  if (plan.manual.length) lines.push(`  no package known for this system: ${plan.manual.join(", ")} — see docs/install/system-programs.md`);
  return lines.join("\n");
}
