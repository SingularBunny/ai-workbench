// OpenClaw chats → Markdown in the data repository (backup): pure functions. chat.history messages
// are converted to records in the Claude Code layout, then rendered and redacted the same way as
// Claude Desktop chats (../claude-desktop/chats-core.mjs).
import { chatPath, redact, renderRecords } from "../claude-desktop/chats-core.mjs";

const keyOf = (m) => String(m.idempotencyKey ?? m.__openclaw?.idempotencyKey ?? "");
// Continuation of a catalog chat ("Continue" in the Control UI): key "<catalog>-catalog:<chat id>:<record>".
const CONTINUED = /^[a-z0-9-]+-catalog:([^:]+):/;

/** Adopted from the catalog (sessions.catalog.import or a continuation) or mixed in by the Gateway
 *  from the Claude CLI transcript itself (__openclaw.importedFrom): it is already in chats/ as text. */
export const isImported = (m) => keyOf(m).startsWith("catalog-preservation:") || CONTINUED.test(keyOf(m)) || Boolean(m.__openclaw?.importedFrom);

/** Id of the Claude Desktop chat that an imported session continues, taken from the preservation key. */
export function continuesOf(messages) {
  for (const m of messages) {
    const k = keyOf(m);
    const c = CONTINUED.exec(k);
    if (c) return c[1];
    if (!k.startsWith("catalog-preservation:")) continue;
    // The service "catalog-preservation:notice" comes first; it is not JSON and is skipped.
    try { const v = JSON.parse(k.slice("catalog-preservation:".length)); if (Array.isArray(v) && v[1]) return v[1]; } catch { /* not a record key */ }
  }
  return null;
}

const blocksOf = (c) => (typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : []);
const assistantBlock = (b) => (b.type === "toolCall" ? { type: "tool_use", id: b.id, name: b.name, input: b.arguments ?? {} } : b);

/**
 * chat.history messages (in order) → records for renderRecords. task is the task name of a cron
 * session: chat.history returns its prompt with role assistant but no provider; it is not a model
 * reply and is rendered like a Claude Desktop scheduled run (⏰ with the prompt collapsed).
 */
export function toRecords(messages, { task = null } = {}) {
  const out = [];
  for (const m of messages) {
    const timestamp = new Date(m.timestamp ?? m.__openclaw?.recordTimestampMs ?? 0).toISOString();
    const blocks = blocksOf(m.content);
    // Context compaction: chat.history keeps the whole history and adds a system "Compaction" message.
    if (m.role === "system") {
      if (/^Compaction\b/.test(blocks.map((b) => b.text || "").join("").trim())) out.push({ type: "system", subtype: "compact_boundary", timestamp });
      continue;
    }
    if (task && m.role === "assistant" && !m.provider) {
      const text = blocks.map((b) => b.text || "").join("\n");
      out.push({ type: "user", timestamp, message: { content: [{ type: "text", text: `<scheduled-task name="${task}">\n${text}` }] } });
    } else if (m.role === "user") out.push({ type: "user", timestamp, message: { content: blocks } });
    else if (m.role === "assistant") out.push({ type: "assistant", timestamp, message: { content: blocks.map(assistantBlock) } });
    else if (m.role === "toolResult") out.push({ type: "user", timestamp, message: { content: [{ type: "tool_result", content: blocks, is_error: !!m.isError }] } });
  }
  return out;
}

/** Title: as in the Control UI, else the first user message, else the session key. */
export function sessionTitle(info, messages) {
  if (info.displayName || info.label) return info.displayName || info.label;
  const u = messages.find((m) => m.role === "user");
  const line = u && blocksOf(u.content).map((b) => b.text || "").join(" ").trim().split("\n")[0];
  return line ? line.slice(0, 80) : info.key;
}

/** A cron session is a scheduled run; anything else is a conversation. */
export const sessionKind = (info) => (/:cron(:|$)/.test(info.key || "") ? "scheduled" : "manual");

/**
 * A history segment is identified by the id of its first message. After /new and /reset the key keeps
 * the same sessionId, but chat.history returns only what follows the reset (a system Reset first):
 * that is a new segment and a new file, the previous one is not overwritten (verified on OpenClaw 2026.10.10).
 */
export const segmentOf = (messages) => String(messages[0]?.__openclaw?.id ?? "");

/** File path: the Claude Desktop chat layout; the date is the segment start, the id is sessionId plus segment. */
export function sessionPath(info, title, tz, { segment = "", startedAt = null } = {}) {
  const p = chatPath({ sessionId: info.sessionId, title, createdAt: startedAt ?? info.createdAt ?? info.updatedAt }, info.agentId, tz);
  return segment ? p.replace(/\.md$/, `-${segment.replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}.md`) : p;
}

/**
 * The whole chat file: front matter, heading, body; secrets redacted. messages are own messages only
 * (without those adopted from Claude Desktop); continues is the id of that chat if the session continues it.
 */
export function sessionMarkdown(info, messages, { title, tz, secrets = [], continues = null, segment = null }) {
  const fm = ["---", `title: ${JSON.stringify(title)}`, `session: ${info.sessionId}`, ...(segment ? [`segment: ${segment}`] : []), `key: ${info.key}`,
    `agent: ${info.agentId}`, `created: ${new Date(info.createdAt ?? info.updatedAt).toISOString()}`,
    `updated: ${new Date(info.updatedAt).toISOString()}`,
    `model: ${[info.modelProvider, info.model].filter(Boolean).join("/")}`, `kind: ${sessionKind(info)}`,
    ...(continues ? [`continues: ${continues}`] : []), ...(info.archived ? ["archived: true"] : []),
    "source: openclaw", "---", ""];
  const task = sessionKind(info) === "scheduled" ? title.replace(/^Automation: /, "") : null;
  const body = `# ${title}\n\n${continues ? "_Continuation of a Claude Desktop chat; the beginning is in its file (`continues`)._\n\n" : ""}${renderRecords(toRecords(messages, { task }), tz)}`;
  return redact((fm.join("\n") + body).replace(/\r\n?/g, "\n"), secrets);
}
