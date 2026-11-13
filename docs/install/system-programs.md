# System programs

OpenClaw and the installer bring Node and everything ai-workbench needs to start. A few features also use programs
from your system's package manager. None is required for the install: without one, its feature is off and says so.

The install plan (`installer/install.sh --dry-run`) lists the programs that are missing for the features you use,
with one install command for your package manager (apt, dnf, pacman, brew). An interactive install asks at the end
whether to run it; `sudo` asks for your password itself. With `--yes` the command is only printed.

| Program | Feature | Debian, Ubuntu | Fedora | Arch | macOS |
|---|---|---|---|---|---|
| `python3` | The judge (`judge.py`) | `python3` | `python3` | `python` | `python` |
| `soffice` | Office document [preview](../features/document-preview.md) in chat, Office text in the [knowledge base](../features/knowledge.md) | `libreoffice` | `libreoffice` | `libreoffice-fresh` | `--cask libreoffice` |
| `pdftotext` | PDF text in the knowledge base | `poppler-utils` | `poppler-utils` | `poppler` | `poppler` |
| `tesseract` | OCR of scans and images in the knowledge base | `tesseract-ocr` | `tesseract` | `tesseract tesseract-data-eng` | `tesseract` |
| `ocrmypdf` | OCR of scanned PDF pages in the knowledge base | `ocrmypdf` | `ocrmypdf` | AUR: `yay -S ocrmypdf` | `ocrmypdf` |
| `vulkaninfo` | Picking the GPU for local memory-search embeddings (`WORKBENCH_LOCAL_EMBEDDINGS=vulkan`) | `vulkan-tools` | `vulkan-tools` | `vulkan-tools` | — |

The knowledge base programs are checked only when knowledge folders are set (`WORKBENCH_KNOWLEDGE` or `knowledge`
in a project); `vulkaninfo` only with `WORKBENCH_LOCAL_EMBEDDINGS=vulkan`.

**OCR languages.** Tesseract recognizes the languages whose data is installed; English comes with it (on Arch,
`tesseract-data-eng`). The plan adds the language of your locale (`LANG`, for example `ru_RU` → `rus`):
`tesseract-ocr-rus` (apt), `tesseract-langpack-rus` (dnf), `tesseract-data-rus` (pacman), `tesseract-lang` (brew, all
languages). Other languages: the same package names with another code (`deu`, `fra`, …).

**Timers find programs in `/usr/local/bin`, `/usr/bin` and `/bin` only.** Install them with the package manager,
not into your home folder (`pip install --user`, `uv tool install`): the knowledge text timer would not see them.

Also outside the installer: the Claude CLI (`claude`) for Claude chats on a subscription, and
Chrome for the [Chrome integration](../integrations/chrome.md). Linux timers (chat archive, knowledge text copies)
need systemd; without it, run their commands by hand as their pages say.
