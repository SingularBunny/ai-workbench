// claude.ai cloud chats (official data export, conversations.json) → Claude Code sessions.
// Cloud chats are not on disk, so the Claude Desktop migration does not see them. Written as Claude
// Code sessions in a Claude Desktop folder, they join the chat tree, adoption by agents and
// `claude --resume` like local chats. Only text is carried over: tool calls (web search and the
// like) become short text notes, because the resumed session has no matching tools; thinking is
// dropped.
import path from "node:path";

/** Marks records written by this import: files without it are never overwritten. */
export const ENTRYPOINT = "claude-ai-export";
const LIMITS = { toolInput: 300, toolResult: 1500, attachment: 20000 };

const clip = (s, max) => (s.length > max ? `${s.slice(0, max)}… (${s.length - max} more chars)` : s);

/** Claude Code project folder name for a working folder: every character except Latin letters and digits → "-". */
export const claudeProjectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

function toolInputSummary(input = {}) {
  const v = input.query ?? input.url ?? input.command ?? input.path ?? input.prompt ?? input.text;
  return typeof v === "string" ? v : JSON.stringify(input);
}

function toolResultText(content) {
  if (typeof content === "string") return content;
  return (content || []).map((b) => b.text ?? b.title ?? b.url ?? (b.type ? `[${b.type}]` : "")).filter(Boolean).join("\n");
}

/** Visible text of one export message: text parts, tool notes and attachment contents. */
export function messageText(m) {
  const parts = [];
  for (const c of m.content || []) {
    if (c.type === "text" && c.text?.trim()) parts.push(c.text.trim());
    else if (c.type === "tool_use") parts.push(`🔧 ${c.name}: ${clip(toolInputSummary(c.input).replace(/\s+/g, " ").trim(), LIMITS.toolInput)}`);
    else if (c.type === "tool_result") {
      const text = toolResultText(c.content).trim();
      if (text) parts.push(`↩ ${c.name || "result"}: ${clip(text, LIMITS.toolResult)}`);
    }
  }
  if (!parts.length && m.text?.trim()) parts.push(m.text.trim());
  for (const a of m.attachments || []) {
    const body = a.extracted_content?.trim();
    parts.push(`📎 ${a.file_name || "attachment"}${body ? `\n\n${clip(body, LIMITS.attachment)}` : ""}`);
  }
  for (const f of m.files || []) if (f.file_name) parts.push(`📎 ${f.file_name}`);
  return parts.join("\n\n");
}

/**
 * One export conversation → Claude Code session records (JSONL objects) in chat order, followed by its
 * title. The session id is the conversation uuid: cloud ids never collide with local session ids.
 */
export function conversationRecords(conv, cwd) {
  const records = [];
  let parent = null;
  for (const m of conv.chat_messages || []) {
    const text = messageText(m);
    if (!text) continue;
    const user = m.sender === "human";
    records.push({
      type: user ? "user" : "assistant",
      uuid: m.uuid,
      parentUuid: parent,
      sessionId: conv.uuid,
      timestamp: m.created_at,
      cwd,
      entrypoint: ENTRYPOINT,
      userType: "external",
      isSidechain: false,
      message: user
        ? { role: "user", content: text }
        : { role: "assistant", type: "message", model: "claude-ai", content: [{ type: "text", text }], stop_reason: "end_turn" },
    });
    parent = m.uuid;
  }
  if (records.length) records.push({ type: "custom-title", customTitle: conv.name || "Untitled", sessionId: conv.uuid });
  return records;
}

/** Claude Desktop folder of a conversation: its project's name when that folder exists, else the default folder. */
export function conversationFolder(conv, projects, folders, fallback) {
  const uuid = conv.project_uuid ?? conv.project?.uuid;
  const name = uuid ? projects.get(uuid) : undefined;
  return name && folders.has(name) ? name : fallback;
}

/** Session metadata for the text archive (chats-core chatMarkdown). */
export function archiveMeta(conv, folder) {
  return {
    sessionId: conv.uuid,
    title: conv.name || "Untitled",
    createdAt: Date.parse(conv.created_at),
    lastActivityAt: Date.parse(conv.updated_at || conv.created_at),
    model: "claude-ai",
    userSelectedFolders: [folder],
  };
}

/** Whether an existing session file was written by this import (its first record carries the marker). */
export const ownedByImport = (head) => head.includes(`"entrypoint":"${ENTRYPOINT}"`);

export const sessionFile = (claudeDir, cwd, uuid) => path.join(claudeDir, "projects", claudeProjectDir(cwd), `${uuid}.jsonl`);
