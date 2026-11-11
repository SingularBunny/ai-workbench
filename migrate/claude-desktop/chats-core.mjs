// Claude Desktop (Cowork) chats → Markdown for the data repository git.
// Pure functions: Claude Code transcript (JSONL) → text, secret redaction, file name.
// The stock OpenClaw catalog does not see Cowork chats: it reads a single ~/.claude/projects, while
// every Cowork chat has its own <session>/.claude/projects folder (extensions/anthropic/session-catalog-scan.ts).
//
// The text gets user and assistant messages in full, tool calls as a line with collapsed arguments,
// and results clipped. Model thinking and images are left out.

import { agentId } from "./projects-core.mjs";

export const LIMITS = { toolInput: 1000, toolResult: 1000, summary: 160 };
export const REDACTED = "‹secret›";

/** Clip with a note on how much was dropped. */
export function clip(s, max) {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("") + `\n… (${chars.length - max} more chars)`;
}

/** A code block that does not break on ``` inside. */
export function fence(s, lang = "") {
  const run = Math.max(2, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(run + 1);
  return `${f}${lang}\n${s}\n${f}`;
}

// Not secrets, although in a value position: placeholders, substitutions, the Atlassian anti-XSRF header
// (`X-Atlassian-Token: no-check`), and the redaction token itself (the older Russian one included).
const keepName = (m, k, v) => (/^(no-check|null|undefined|\*+|‹secret›|‹секрет›|<[^>]*>?)$/i.test(v) || /^[$%{]/.test(v) ? m : k + REDACTED);

const SECRET_PATTERNS = [
  // The key body runs to END or to the end of the base64 lines (clipped output has no END).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\s*[A-Za-z0-9+\/=:,-]+)*(?:\s*-----END [A-Z ]*PRIVATE KEY-----)?/g, () => REDACTED],
  [/\b(sk-ant-[A-Za-z0-9_-]{16,}|sk-or-v1-[a-f0-9]{16,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})/g, () => REDACTED],
  // A quoted value may start with any character (a password like '}x…'): take the whole quoted string.
  // No whitespace inside, so shell code like grep "X_PASSWORD=" .env | cut … is left alone.
  [/(\b[A-Z0-9_]*(?:PASS|SECRET|TOKEN|API_?KEY)[A-Z0-9_]*\s*[:=]\s*)(['"])([^'"\s]{6,})\2/g, (m, k, q, v) => (keepName(m, k, v) === m ? m : k + q + REDACTED + q)],
  // The name stays, the value goes: DB_PASS='…' (environment variables) and "password": "…".
  [/(\b[A-Z0-9_]*(?:PASS|SECRET|TOKEN|API_?KEY)[A-Z0-9_]*["']?\s*[:=]\s*["']?)([^\s"'`,;}<>]{6,})/g, keepName],
  [/((?:^|[\s{,"'])(?:password|passwd|пароль|secret|client_secret|token|access_token|refresh_token|api_?key)["']?\s*[:=]\s*["']?)([^\s"'`,;}<>]{6,})/gim, keepName],
  [/(\bAuthorization:\s*(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+\/=-]{8,})/gi, (m, k) => k + REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@]+:)([^\s@\/]{3,})(@)/gi, (m, a, v, b) => a + REDACTED + b],
];

/** Secrets → ‹secret›: exact values first (from local .env files), then patterns. */
export function redact(text, values = []) {
  let count = 0;
  let out = text;
  for (const v of [...new Set(values)].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length)) {
    const parts = out.split(v);
    count += parts.length - 1;
    out = parts.join(REDACTED);
  }
  for (const [re, fn] of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => { const r = fn(...m); if (r !== m[0]) count++; return r; });
  }
  return { text: out, count };
}

/** Values of secret keys from .env text: *PASS*, *TOKEN*, *SECRET*, *KEY*. */
export function secretValues(envText) {
  const out = [];
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m || !/PASS|TOKEN|SECRET|KEY/i.test(m[1])) continue;
    const v = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (v.length >= 6) out.push(v);
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
/** Local time in zone tz: "YYYY-MM-DD HH:MM". */
export function localTime(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Chat file path: <agent>/<YYYY-MM>/<YYYY-MM-DD_HHMM>_<title>_<id8>.md. */
export function chatPath(meta, agent, tz) {
  const t = localTime(meta.createdAt, tz);
  let slug;
  try { slug = agentId(meta.title || "").slice(0, 60).replace(/-+$/, ""); } catch { slug = "chat"; }
  const id8 = String(meta.sessionId).replace(/^local_/, "").slice(0, 8);
  return `${agent}/${t.slice(0, 7)}/${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}_${slug}_${id8}.md`;
}

/** Chat attachments folder in the file store: the same layout as chatPath, without .md. */
export const filesPath = (meta, agent, tz) => chatPath(meta, agent, tz).replace(/\.md$/, "/");

function toolSummary(name, input = {}) {
  const v = input.command ?? input.pattern ?? input.query ?? input.url ?? input.file_path ?? input.path
    ?? input.skill ?? input.description ?? input.action ?? input.text;
  return typeof v === "string" ? clip(v.replace(/\s+/g, " ").trim(), LIMITS.summary) : "";
}

function resultText(content) {
  if (typeof content === "string") return content;
  return (content || []).map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image]" : `[${b.type}]`)).join("\n");
}

const details = (summary, body) => `<details><summary>${summary}</summary>\n\n${body}\n</details>\n`;
const esc = (s) => s.replace(/</g, "&lt;");

/** JSONL records (deduplicated, in order) → Markdown body. */
export function renderRecords(records, tz) {
  const out = [];
  let role = null;
  const head = (r, title) => { out.push(`## ${title} · ${localTime(Date.parse(r.timestamp), tz)}\n`); };
  for (const r of records) {
    const c = r.message?.content;
    if (r.type === "system" && r.subtype === "compact_boundary") { out.push("---\n_context compacted_\n"); role = null; continue; }
    if (r.type === "assistant") {
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type === "thinking" || b.type === "redacted_thinking") continue;
        if (role !== "assistant") { head(r, "🤖 Assistant"); role = "assistant"; }
        if (b.type === "text" && b.text.trim()) out.push(b.text.trim() + "\n");
        if (b.type === "tool_use") {
          const s = toolSummary(b.name, b.input);
          out.push(details(`🔧 ${b.name}${s ? ` — ${esc(s)}` : ""}`, fence(clip(JSON.stringify(b.input ?? {}, null, 1), LIMITS.toolInput), "json")));
        }
      }
      continue;
    }
    if (r.type !== "user" || r.isMeta) continue;
    const blocks = typeof c === "string" ? [{ type: "text", text: c }] : (c || []);
    for (const b of blocks) {
      if (b.type === "tool_result") {
        const text = clip(resultText(b.content), LIMITS.toolResult);
        out.push(details(`↩ result${b.is_error ? " (error)" : ""}`, fence(text)));
        continue;
      }
      if (b.type === "image") { out.push("_🖼 image_\n"); continue; }
      if (b.type === "document") { out.push("_📄 document_\n"); continue; }
      if (b.type !== "text") continue;
      const t = b.text.trim();
      if (!t) continue;
      if (t.startsWith("Base directory for this skill:")) {
        out.push(`_📘 loaded skill \`${t.split("\n")[0].replace("Base directory for this skill:", "").trim().split("/").pop()}\`_\n`);
        continue;
      }
      if (t === "[Request interrupted by user]" || t === "[Request interrupted by user for tool use]") { out.push("_⏹ interrupted by user_\n"); continue; }
      const task = t.match(/^<scheduled-task name="([^"]+)"/);
      if (task) { head(r, `⏰ Scheduled task \`${task[1]}\``); out.push(details("task prompt", fence(clip(t, LIMITS.toolInput)))); role = "user"; continue; }
      if (t.startsWith("This session is being continued from a previous conversation")) {
        head(r, "📎 Continued after compaction"); out.push(details("summary of the previous part", esc(t))); role = "user"; continue;
      }
      head(r, "👤 User"); out.push(t + "\n"); role = "user";
    }
  }
  return out.join("\n");
}

/**
 * Merges the transcript files of one session: deduplicated, by time. The key is uuid; for service
 * records without a uuid (queue-operation and the like) it is the whole record: the chat copy in
 * Claude Code repeats them, and without this they were doubled.
 */
export function mergeTranscripts(files) {
  const seen = new Set();
  const all = [];
  for (const recs of files) {
    for (const r of recs) {
      const key = r.uuid || JSON.stringify(r);
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.timestamp) all.push(r);
    }
  }
  return all.map((r, i) => [r, i]).sort((a, b) => Date.parse(a[0].timestamp) - Date.parse(b[0].timestamp) || a[1] - b[1]).map(([r]) => r);
}

/** The whole chat file: front matter, heading, body; secrets redacted. */
export function chatMarkdown(meta, records, { agent, project, tz, secrets = [], files = null, source = "claude-desktop" }) {
  const fm = ["---", `title: ${JSON.stringify(meta.title || "")}`, `session: ${meta.sessionId}`,
    `project: ${project ? JSON.stringify(project) : "null"}`, `agent: ${agent}`,
    `created: ${new Date(meta.createdAt).toISOString()}`, `updated: ${new Date(meta.lastActivityAt || meta.createdAt).toISOString()}`,
    `model: ${meta.model || ""}`, `kind: ${meta.scheduledTaskId ? "scheduled" : "manual"}`,
    ...(meta.scheduledTaskId ? [`task: ${meta.scheduledTaskId}`] : []),
    ...(meta.isArchived ? ["archived: true"] : []),
    `folders: ${JSON.stringify(meta.userSelectedFolders || [])}`,
    ...(files ? [`files: ${JSON.stringify(files)}`] : []), `source: ${source}`, "---", ""];
  const body = `# ${meta.title || "Untitled"}\n\n${renderRecords(records, tz)}`;
  return redact((fm.join("\n") + body).replace(/\r\n?/g, "\n"), secrets);
}

/** Secrets in every string of a record (JSON fields, not serialized text, so escaping stays intact). */
export function redactDeep(value, secrets) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === "string") { const r = redact(v, secrets); count += r.count; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), count };
}

/**
 * A chat for the stock OpenClaw import (`sessions.catalog.import`, catalog `claude`): one
 * `<threadId>.jsonl` transcript in the Claude Code format and a `sessions-index.json` entry.
 * Parts of one chat are merged under one id; secrets redacted; Cowork service records dropped.
 */
export function stageSession(meta, records, { agent, secrets = [] }) {
  const threadId = meta.cliSessionId || String(meta.sessionId).replace(/^local_/, "");
  let count = 0;
  const lines = [];
  for (const r of records) {
    if (r.type !== "user" && r.type !== "assistant") continue;
    const red = redactDeep({ ...r, sessionId: threadId }, secrets);
    count += red.count;
    lines.push(JSON.stringify(red.value));
  }
  const entry = { sessionId: threadId, summary: clip(meta.title || "Untitled", 400),
    created: new Date(meta.createdAt).toISOString(), modified: new Date(meta.lastActivityAt || meta.createdAt).toISOString(),
    projectPath: (meta.userSelectedFolders || [])[0] || `/${agent}`, isSidechain: false };
  return { threadId, agent, displayName: entry.summary, jsonl: lines.join("\n") + "\n", entry, redacted: count };
}

/** Chat file front matter: key → value (quoted strings parsed as JSON). */
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const out = {};
  for (const line of m ? m[1].split("\n") : []) {
    const kv = /^([a-z]+): (.*)$/.exec(line);
    if (!kv) continue;
    try { out[kv[1]] = /^["[{]/.test(kv[2]) ? JSON.parse(kv[2]) : kv[2]; } catch { out[kv[1]] = kv[2]; }
  }
  return out;
}

/** chats/ table of contents: newest first; ⏰ marks a scheduled run, the source is Claude Desktop or OpenClaw. */
export function indexMarkdown(rows, tz) {
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const src = { "claude-desktop": "Claude Desktop", "claude-ai": "claude.ai", openclaw: "OpenClaw" };
  const sorted = [...rows].sort((a, b) => Date.parse(b.fm.created) - Date.parse(a.fm.created) || (a.rel < b.rel ? 1 : -1));
  const n = (s) => rows.filter((r) => r.fm.source === s).length;
  return ["# Chats", "", `Total ${rows.length}: from Claude Desktop ${n("claude-desktop")}, from claude.ai ${n("claude-ai")}, from OpenClaw ${n("openclaw")}. ⏰ marks a scheduled task run.`, "",
    "| Date | Chat | Agent | Source | |", "|---|---|---|---|---|",
    ...sorted.map((r) => `| ${localTime(Date.parse(r.fm.created), tz)} | [${cell(r.fm.title || "Untitled")}](<${r.rel}>) | ${r.fm.agent} | ${src[r.fm.source] || r.fm.source} | ${r.fm.kind === "scheduled" ? "⏰" : ""} |`), ""].join("\n");
}
