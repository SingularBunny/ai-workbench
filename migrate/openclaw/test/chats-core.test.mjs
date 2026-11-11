import assert from "node:assert/strict";
import test from "node:test";

import { frontmatter, indexMarkdown } from "../../claude-desktop/chats-core.mjs";
import { continuesOf, isImported, segmentOf, sessionKind, sessionMarkdown, sessionPath, sessionTitle, toRecords } from "../chats-core.mjs";

// Messages in the shape chat.history returns in OpenClaw 2026.10.10.
const T = Date.parse("2026-11-04T10:35:00Z");
const msg = (seq, role, content, extra = {}) => ({ role, content, timestamp: T + seq * 1000, __openclaw: { id: `m${seq}`, seq }, ...extra });
const PRESERVED = 'catalog-preservation:["claude","2222-bbbb","id","u1"]';
const HISTORY = [
  msg(1, "assistant", [{ type: "text", text: "service note" }], { idempotencyKey: "catalog-preservation:notice" }),
  msg(2, "user", "old question", { idempotencyKey: PRESERVED }),
  msg(3, "user", "tool: echo hi", { idempotencyKey: "run1:user" }),
  msg(4, "assistant", [{ type: "thinking", thinking: "pondering" }, { type: "toolCall", id: "c1", name: "exec", arguments: { command: "echo hi" } }]),
  msg(5, "toolResult", [{ type: "text", text: "hi" }], { toolCallId: "c1", toolName: "exec", isError: false }),
  msg(6, "assistant", [{ type: "text", text: "Done: hi" }]),
];
const INFO = { key: "agent:sad:catalog-import:ab", agentId: "sad", sessionId: "f902c95d-bce3", displayName: "Сад: сливы",
  createdAt: T, updatedAt: T + 6000, modelProvider: "fake", model: "echo" };

test("content adopted from Claude Desktop is recognized, source chat id comes from the preservation key, notice is skipped", () => {
  assert.deepEqual(HISTORY.filter(isImported).map((m) => m.__openclaw.seq), [1, 2]);
  assert.equal(continuesOf(HISTORY), "2222-bbbb");
  assert.equal(continuesOf(HISTORY.slice(2)), null);
});

test("catalog chat continuation (\"Continue\"): adopted content is recognized, chat id comes from the key", () => {
  const h = [msg(1, "user", "old", { idempotencyKey: "claude-catalog:3333-cccc:u1:0" }),
    msg(2, "assistant", [{ type: "text", text: "old answer" }], { idempotencyKey: "claude-catalog:3333-cccc:a1:0" }),
    msg(3, "user", "new", { idempotencyKey: "run2:user" }),
    // A copy from the Claude CLI transcript that the Gateway mixes into the history of a bound session.
    { role: "assistant", content: "old answer", timestamp: T, __openclaw: { id: "a1", importedFrom: "claude-cli", cliSessionId: "3333-cccc" } }];
  assert.deepEqual(h.filter(isImported).map((m) => m.__openclaw.seq ?? m.__openclaw.id), [1, 2, "a1"]);
  assert.equal(continuesOf(h), "3333-cccc");
});

test("messages → Claude Code records: tool call becomes tool_use, result becomes tool_result", () => {
  const r = toRecords(HISTORY.slice(2));
  assert.deepEqual(r.map((x) => x.type), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual(r[1].message.content[1], { type: "tool_use", id: "c1", name: "exec", input: { command: "echo hi" } });
  assert.deepEqual(r[2].message.content, [{ type: "tool_result", content: [{ type: "text", text: "hi" }], is_error: false }]);
  assert.equal(r[0].timestamp, new Date(T + 3000).toISOString());
});

test("chat file: front matter source: openclaw and continues, body as for Claude Desktop, no thinking, secrets redacted", () => {
  const own = HISTORY.filter((m) => !isImported(m));
  own[0] = { ...own[0], content: "tool: echo hi; пароль Zz9-secret-x" };
  const { text, count } = sessionMarkdown(INFO, own, { title: "Сад: сливы", tz: "Europe/Istanbul", secrets: ["Zz9-secret-x"], continues: "2222-bbbb" });
  const fm = frontmatter(text);
  assert.equal(fm.source, "openclaw");
  assert.equal(fm.continues, "2222-bbbb");
  assert.equal(fm.updated, new Date(T + 6000).toISOString());
  assert.equal(fm.model, "fake/echo");
  assert.match(text, /## 👤 User · 2026-11-04 13:35\n\ntool: echo hi; пароль ‹secret›/);
  assert.match(text, /<summary>🔧 exec — echo hi<\/summary>/);
  assert.match(text, /↩ result<\/summary>\n\n```\nhi\n```/);
  assert.doesNotMatch(text, /pondering|old question|Zz9-secret-x/);
  assert.equal(count, 1);
});

test("title, kind and path: as in the Control UI, else the first message; cron is scheduled", () => {
  assert.equal(sessionTitle(INFO, []), "Сад: сливы");
  assert.equal(sessionTitle({ key: "agent:main:main" }, [msg(1, "user", "First question\nmore")]), "First question");
  assert.equal(sessionTitle({ key: "agent:main:main" }, []), "agent:main:main");
  assert.equal(sessionKind({ key: "agent:sad:cron:report-planner" }), "scheduled");
  assert.equal(sessionKind(INFO), "manual");
  assert.equal(sessionPath(INFO, "Сад: сливы", "Europe/Istanbul"), "sad/2026-11/2026-11-04_1335_sad-slivy_f902c95d.md");
});

test("/new reset starts a new segment: another file dated at the segment start; the old path differs", () => {
  const before = [msg(1, "user", "Hello")];
  const after = [{ ...msg(9, "system", [{ type: "text", text: "Reset" }]), __openclaw: { id: "c0ffee99-reset", seq: 1 } }, msg(10, "user", "After the reset")];
  assert.equal(segmentOf(before), "m1");
  assert.equal(segmentOf(after), "c0ffee99-reset");
  const p1 = sessionPath(INFO, "t", "UTC", { segment: segmentOf(before), startedAt: before[0].timestamp });
  const p2 = sessionPath(INFO, "t", "UTC", { segment: segmentOf(after), startedAt: after[0].timestamp });
  assert.equal(p1, "sad/2026-11/2026-11-04_1035_t_f902c95d-m1.md");
  assert.equal(p2, "sad/2026-11/2026-11-04_1035_t_f902c95d-c0ffee.md");
  assert.notEqual(p1, p2);
  assert.match(sessionMarkdown(INFO, after.slice(1), { title: "t", tz: "UTC", segment: "c0ffee99-reset" }).text, /\nsession: f902c95d-bce3\nsegment: c0ffee99-reset\n/);
});

test("table of contents: both sources, newest first, ⏰ on scheduled runs", () => {
  const rows = [
    { rel: "a.md", fm: { title: "Old", created: "2026-08-01T10:00:00Z", agent: "sad", source: "claude-desktop", kind: "manual" } },
    { rel: "b.md", fm: { title: "New | with a pipe", created: "2026-11-04T10:00:00Z", agent: "main", source: "openclaw", kind: "scheduled" } },
  ];
  const md = indexMarkdown(rows, "UTC");
  assert.match(md, /Total 2: from Claude Desktop 1, from claude.ai 0, from OpenClaw 1/);
  assert.ok(md.indexOf("b.md") < md.indexOf("a.md"));
  assert.match(md, /\[New \\\| with a pipe\]\(<b\.md>\) \| main \| OpenClaw \| ⏰ \|/);
});

test("scheduled run: the task prompt (assistant without provider) is ⏰ with the prompt collapsed, the model reply is the assistant", () => {
  const info = { key: "agent:sad:cron:9f7b", agentId: "sad", sessionId: "3cb5504a-05c8", displayName: "Automation: stand-task", createdAt: T, updatedAt: T };
  const h = [msg(1, "assistant", "Morning garden round\nCurrent time: …"), msg(2, "assistant", [{ type: "text", text: "Walked around" }], { provider: "fake" })];
  const { text } = sessionMarkdown(info, h, { title: "Automation: stand-task", tz: "UTC" });
  assert.match(text, /kind: scheduled/);
  assert.match(text, /## ⏰ Scheduled task `stand-task` · [^\n]+\n\n<details><summary>task prompt<\/summary>\n\n```\n<scheduled-task name="stand-task">\nMorning garden round/);
  assert.match(text, /## 🤖 Assistant · [^\n]+\n\nWalked around/);
  // In a regular session an assistant message without provider is still the assistant.
  assert.doesNotMatch(sessionMarkdown({ ...info, key: "agent:sad:main" }, h, { title: "t", tz: "UTC" }).text, /⏰/);
});

test("system messages: Compaction gives a \"context compacted\" mark, Reset gives nothing", () => {
  const r = toRecords([msg(1, "system", [{ type: "text", text: "Reset" }]), msg(2, "user", "a"), msg(3, "system", [{ type: "text", text: "Compaction" }])]);
  assert.deepEqual(r.map((x) => x.type + (x.subtype ? ":" + x.subtype : "")), ["user", "system:compact_boundary"]);
  assert.match(sessionMarkdown(INFO, [msg(2, "user", "a"), msg(3, "system", [{ type: "text", text: "Compaction" }])], { title: "t", tz: "UTC" }).text, /_context compacted_/);
});
