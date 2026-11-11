import assert from "node:assert/strict";
import test from "node:test";

import { claudeProjectDir, conversationFolder, conversationRecords, messageText, ownedByImport } from "../core.mjs";

const conv = {
  uuid: "11111111-2222-4333-8444-555555555555",
  name: "Game strategy",
  created_at: "2026-10-13T16:49:10Z",
  updated_at: "2026-10-13T17:00:00Z",
  chat_messages: [
    { uuid: "m1", sender: "human", created_at: "2026-10-13T16:49:10Z", content: [{ type: "text", text: "Which fruit first?" }],
      attachments: [{ file_name: "notes.txt", extracted_content: "level 700" }], files: [] },
    { uuid: "m2", sender: "assistant", created_at: "2026-10-13T16:49:30Z", content: [
      { type: "thinking", thinking: "private" },
      { type: "tool_use", name: "web_search", input: { query: "best fruit" } },
      { type: "tool_result", name: "web_search", content: [{ type: "knowledge", title: "Wiki", text: "Dough is strong" }] },
      { type: "text", text: "Take Dough." }] },
    { uuid: "m3", sender: "human", created_at: "2026-10-13T16:50:00Z", content: [] },
  ],
};

test("cloud chat → Claude Code records: text only, chained, titled, marked", () => {
  const r = conversationRecords(conv, "/h/claude-desktop/_no_space");
  assert.deepEqual(r.map((x) => x.type), ["user", "assistant", "custom-title"]);
  assert.equal(r[0].parentUuid, null);
  assert.equal(r[1].parentUuid, "m1");
  assert.ok(r.slice(0, 2).every((x) => x.sessionId === conv.uuid && x.entrypoint === "claude-ai-export" && x.cwd === "/h/claude-desktop/_no_space"));
  assert.match(r[0].message.content, /Which fruit first\?[\s\S]*📎 notes\.txt\n\nlevel 700/);
  const answer = r[1].message.content[0].text;
  assert.match(answer, /🔧 web_search: best fruit/);
  assert.match(answer, /↩ web_search: Wiki\nDough is strong|↩ web_search: Dough is strong/);
  assert.ok(answer.endsWith("Take Dough."));
  assert.ok(!answer.includes("private"));
  assert.deepEqual(r[2], { type: "custom-title", customTitle: "Game strategy", sessionId: conv.uuid });
});

test("empty messages are skipped; a chat without text gives no records", () => {
  assert.equal(messageText({ content: [] }), "");
  assert.deepEqual(conversationRecords({ ...conv, chat_messages: [conv.chat_messages[2]] }, "/c"), []);
});

test("folder: a project's folder when it exists, otherwise the default", () => {
  const projects = new Map([["p1", "Garden"]]);
  assert.equal(conversationFolder({ project_uuid: "p1" }, projects, new Set(["Garden"]), "_no_space"), "Garden");
  assert.equal(conversationFolder({ project_uuid: "p1" }, projects, new Set(), "_no_space"), "_no_space");
  assert.equal(conversationFolder({}, projects, new Set(["Garden"]), "_no_space"), "_no_space");
});

test("only files written by the import are rewritten; Claude Code folder naming", () => {
  assert.ok(ownedByImport('{"type":"user","entrypoint":"claude-ai-export"}'));
  assert.ok(!ownedByImport('{"type":"user","entrypoint":"cli"}'));
  assert.equal(claudeProjectDir("/home/u/claude-desktop/_no_space"), "-home-u-claude-desktop--no-space");
});
