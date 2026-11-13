# Document preview

Word, Excel and PowerPoint documents (`.docx`, `.doc`, `.xlsx`, `.xls`, `.pptx`, `.ppt`) and OpenDocument
files (`.odt`, `.ods`, `.odp`, plus `.rtf` in attachments) open in the chat side panel just like PDF:
chat attachments and project files in the **Files** panel. This requires [OpenClaw from the fork](../openclaw-fork.md), whose Control UI
sends the document for conversion, and LibreOffice on the Gateway machine: the `aiwb-office` plugin turns
the document into a PDF locally (`soffice --headless`), so the file never leaves the machine. LibreOffice is looked up in `PATH`
and the usual install locations; a different path goes in `plugins.entries.aiwb-office.config.soffice`. Finished PDFs
are cached by content in `~/.openclaw/workbench/office-preview/` (limit `cacheMb`, 512 MB by
default), so reopening is instant. LibreOffice: [System programs](../install/system-programs.md). Without LibreOffice or without the fork the document is offered for
download, as before. The limit is 16 MB per PDF (what the Control UI viewer can open). A long spreadsheet prints to
hundreds of pages; when its PDF is over the limit, the preview shows the first 1000 rows of each sheet as a plain table,
with a note saying how many rows there are (open the file itself for all of them).

## Text for the model

The same plugin gives the model the text of an Office attachment, as Claude Desktop does: instead of the
"Unsupported document format" note, the model reads the document content right in the message. This
requires OpenClaw from the fork, which lets an installed plugin register a document extractor
(`api.registerDocumentExtractor`), and LibreOffice. Everything runs locally, through the same one-at-a-time
LibreOffice queue as the preview:

- Word, OpenDocument text and RTF (`.docx`, `.doc`, `.odt`, `.rtf`): plain text (`soffice --convert-to txt`).
- Excel and OpenDocument spreadsheets (`.xlsx`, `.xls`, `.ods`): every sheet as CSV under a `## Sheet <name>`
  heading (LibreOffice 7.2 or newer).
- PowerPoint and OpenDocument presentations (`.pptx`, `.odp`): the text of each slide under `## Slide N`, with
  speaker notes, read from the file itself; `.ppt` is first converted to `.pptx` by LibreOffice.

The text is cached by content next to the PDFs (same `cacheMb` limit). OpenClaw applies its usual attachment
limits (size, timeout, `maxChars`; a cut text is marked as partial). If LibreOffice is missing, the plugin
does not register the extractor; if extraction fails, the attachment falls back to the previous note with the
file path, and the agent reads the file with its own tools.
