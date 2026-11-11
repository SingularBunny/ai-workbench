import assert from "node:assert/strict";
import test from "node:test";

import { REDACTED, chatMarkdown, chatPath, clip, fence, filesPath, mergeTranscripts, redact, renderRecords, secretValues } from "../chats-core.mjs";

const at = (s) => `2026-08-01T10:00:${String(s).padStart(2, "0")}.000Z`;
const user = (s, content, extra = {}) => ({ type: "user", uuid: `u${s}`, timestamp: at(s), message: { content }, ...extra });
const asst = (s, content) => ({ type: "assistant", uuid: `a${s}`, timestamp: at(s), message: { content } });

test("secrets: .env values, environment variables, JSON, URLs, provider keys", () => {
  const values = secretValues("ALPHA_PASS='p@ss:w0rd!'\nALPHA_USER=someone-long\nexport BETA_TOKEN=\"tok-123456\"\n");
  assert.deepEqual(values, ["p@ss:w0rd!", "tok-123456"]);        // a login is not a secret
  const { text, count } = redact([
    "cat .env → p@ss:w0rd! and tok-123456",
    "GAMMA_PASS=hunter2hunter",
    '{"password": "s3cr3t-value"}',
    "https://bob:pa55word@example.com/x",
    "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAabc\nQkFTRTY0\n… (900 more chars)",
    "max_tokens=4096; passed: 12345678; X-Atlassian-Token: no-check; DELTA_TOKEN=$DELTA_TOKEN",
  ].join("\n"), values);
  assert.equal(count, 7);
  assert.ok(!/p@ss|tok-123456|hunter2|s3cr3t|pa55word|sk-ant|MIIE|QkFT/.test(text));
  assert.ok(text.includes(`GAMMA_PASS=${REDACTED}`) && text.includes(`bob:${REDACTED}@`));
  assert.ok(text.includes("max_tokens=4096") && text.includes("passed: 12345678") && text.includes("no-check") && text.includes("=$DELTA_TOKEN"));
});

test("render: messages in full, tools as one line, no thinking or service records", () => {
  const md = renderRecords([
    user(1, "Find the file"),
    user(2, "service note", { isMeta: true }),
    asst(3, [{ type: "thinking", thinking: "pondering" }, { type: "text", text: "Searching." }]),
    asst(4, [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "Сад", path: "/x" } }]),
    user(5, [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image" }, { type: "text", text: "x".repeat(3000) }] }]),
    user(6, [{ type: "text", text: "Base directory for this skill: /p/skills/alpha-check\n\n# body" }]),
    user(7, '<scheduled-task name="alpha-morning" file="/x">go</scheduled-task>'),
  ], "UTC");
  assert.ok(md.includes("## 👤 User · 2026-08-01 10:00\n\nFind the file"));
  assert.ok(!md.includes("service note") && !md.includes("pondering"));
  assert.equal(md.match(/## 🤖 Assistant/g).length, 1);           // consecutive blocks form one section
  assert.ok(md.includes("🔧 Grep — Сад"));
  assert.ok(md.includes(" more chars)") && md.includes("[image]"));
  assert.ok(md.includes("loaded skill `alpha-check`") && !md.includes("# body"));
  assert.ok(md.includes("⏰ Scheduled task `alpha-morning`"));
});

test("file merge: deduplicated by uuid, ordered by time", () => {
  const a = [user(1, "one"), asst(2, [{ type: "text", text: "two" }])];
  const b = [user(1, "one"), user(3, "three")];
  assert.deepEqual(mergeTranscripts([b, a]).map((r) => r.uuid), ["u1", "a2", "u3"]);
});

test("path and front matter: local time, transliterated title, project agent", () => {
  const meta = { sessionId: "local_0123abcd-x", title: "Сад: план", createdAt: Date.parse("2026-08-01T21:30:00Z"), model: "m" };
  assert.equal(chatPath(meta, "sad", "Europe/Istanbul"), "sad/2026-08/2026-08-02_0030_sad-plan_0123abcd.md");
  const { text } = chatMarkdown(meta, [user(1, "hello")], { agent: "sad", project: "Сад", tz: "UTC" });
  assert.ok(text.startsWith('---\ntitle: "Сад: план"\nsession: local_0123abcd-x\nproject: "Сад"\nagent: sad\n'));
  assert.ok(text.includes("kind: manual") && text.includes("# Сад: план"));
  assert.ok(!text.includes("files:"));
  assert.equal(filesPath(meta, "sad", "Europe/Istanbul"), "sad/2026-08/2026-08-02_0030_sad-plan_0123abcd/");
  const withFiles = chatMarkdown(meta, [user(1, "hello")], { agent: "sad", tz: "UTC", files: filesPath(meta, "sad", "UTC") }).text;
  assert.match(withFiles, /\nfiles: "sad\/2026-08\/2026-08-01_2130_sad-plan_0123abcd\/"\nsource: claude-desktop\n/);
});

test("code inside code does not break the block; clipping counts characters", () => {
  assert.ok(fence("a ``` b").startsWith("````\n"));
  assert.equal(clip("абв", 3), "абв");
  assert.equal(clip("абвг", 2), "аб\n… (2 more chars)");
});

test("for OpenClaw: parts under one id, secrets in fields redacted, service records dropped", async () => {
  const { stageSession } = await import("../chats-core.mjs");
  const meta = { sessionId: "local_x", cliSessionId: "cli-1", title: "Сад", createdAt: 0, userSelectedFolders: ["/p/sad"] };
  const recs = [user(1, 'cat .env\nALPHA_PASS="p@ss:w0rd!"', { sessionId: "cli-0" }), { type: "attachment", uuid: "x", timestamp: at(2) },
    asst(3, [{ type: "text", text: "ok" }])];
  const s = stageSession(meta, recs, { agent: "sad", secrets: ["p@ss:w0rd!"] });
  const lines = s.jsonl.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((r) => [r.type, r.sessionId]), [["user", "cli-1"], ["assistant", "cli-1"]]);
  assert.ok(!s.jsonl.includes("p@ss") && s.redacted === 1);
  assert.deepEqual([s.threadId, s.entry.summary, s.entry.projectPath], ["cli-1", "Сад", "/p/sad"]);
});

test("redact: a quoted value may start with any character", () => {
  const { text, count } = redact("`BANK_PASS='}a:b1c2d3'`, `OTHER_PASS='<from .env>'`");
  assert.equal(text, "`BANK_PASS='‹secret›'`, `OTHER_PASS='<from .env>'`");
  assert.equal(count, 1);
  const shell = `P=$(grep -E "APP_PASSWORD=" .env | cut -d= -f2- | tr -d "'")`;
  assert.equal(redact(shell).text, shell);
});
