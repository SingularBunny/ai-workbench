import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { continuationIndex, readSessions } from "../source.mjs";

const rec = (uuid, t, text = uuid) => ({ uuid, type: "user", timestamp: `2026-01-0${t}T00:00:00Z`, message: { role: "user", content: text } });
const jsonl = (rs) => rs.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("Claude Code continuations: by name and by shared records, no duplicates; unrelated files are ignored", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cc-"));
  try {
    // A Claude Desktop export: one chat with two records.
    const s = path.join(root, "export", "sessions", "space-1", "s1");
    mkdirSync(s, { recursive: true });
    writeFileSync(path.join(s, "metadata.json"), JSON.stringify({ sessionId: "local_s1", cliSessionId: "c1", createdAt: 1, title: "Сад" }));
    const q = { type: "queue-operation", operation: "enqueue", timestamp: "2026-01-01T00:00:01Z" };
    writeFileSync(path.join(s, "part.jsonl"), jsonl([rec("a", 1), q, rec("b", 2)]));
    // Claude Code: a continuation under the same id, a part under another name (with the same first records
    // and a full copy, so shared uuids in two files), and an unrelated chat.
    const cc = path.join(root, "cc", "-x-garden");
    mkdirSync(cc, { recursive: true });
    writeFileSync(path.join(cc, "c1.jsonl"), jsonl([rec("a", 1), q, rec("b", 2), rec("c", 3)]));
    writeFileSync(path.join(cc, "p1.jsonl"), jsonl([rec("a", 1), rec("d", 4)]));
    writeFileSync(path.join(cc, "p2.jsonl"), jsonl([rec("a", 1), rec("b", 2)]));
    writeFileSync(path.join(cc, "other.jsonl"), jsonl([rec("z", 5)]));
    const index = continuationIndex([cc]);
    const [one] = [...readSessions(path.join(root, "export"), index)];
    // A service record without uuid present in both copies appears once.
    assert.deepEqual(one.records.map((r) => r.uuid || r.type), ["a", "queue-operation", "b", "c", "d"]);
    assert.deepEqual(one.extra.map((f) => path.basename(f)), ["c1.jsonl", "p1.jsonl", "p2.jsonl"]);
    assert.equal(one.continuedAt, Date.parse("2026-01-04T00:00:00Z"));
    // Without continuations: unchanged.
    const [plain] = [...readSessions(path.join(root, "export"))];
    assert.deepEqual(plain.records.map((r) => r.uuid || r.type), ["a", "queue-operation", "b"]);
    assert.deepEqual(plain.extra, []);
    assert.equal(plain.continuedAt, null);
    // A copy without new messages is not a continuation.
    rmSync(path.join(cc, "c1.jsonl")); rmSync(path.join(cc, "p1.jsonl"));
    assert.equal([...readSessions(path.join(root, "export"), continuationIndex([cc]))][0].continuedAt, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
