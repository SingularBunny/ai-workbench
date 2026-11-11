// Migrates Claude Desktop projects (spaces) into OpenClaw agent workspaces.
// Pure functions: agent name, AGENTS.md, memory index. OpenClaw has no stock import of spaces
// (`openclaw migrate claude` takes Claude Code memory, not Claude Desktop projects).
//
// A Claude Desktop project: name, folders[{path}], instructions, memory in spaces/<id>/memory:
// facts <slug>.md and the MEMORY.md index (one line per fact, linking the file next to it).
// An OpenClaw workspace: AGENTS.md (in context), MEMORY.md (in context, up to 20,000 chars,
// docs concepts/agent-workspace.md), memory/*.md (searched by memory_search).

export const MEMORY_MAX_CHARS = 20000;

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };

/** OpenClaw agent name from a project title: Latin, kebab-case. "Сад" → sad. */
export function agentId(name) {
  const id = [...String(name).toLowerCase()].map((c) => TRANSLIT[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (!id) throw new Error(`cannot derive an agent name from the project title: ${JSON.stringify(name)}`);
  return id;
}

/** AGENTS.md: the project instructions as is, then its folders and where memory lives. */
export function agentsMd({ name, instructions, folders }, { importedAt }) {
  const parts = [`# ${name}`, ""];
  if (instructions && instructions.trim()) parts.push(instructions.trim(), "");
  parts.push("## Project folders", "",
    "Project files live in these folders: read and write there, not in the agent workspace:", "");
  for (const f of folders) parts.push(`- \`${f}\``);
  parts.push("", "## Memory", "",
    `Project memory migrated from Claude Desktop on ${importedAt}: index in \`MEMORY.md\`, facts in \`memory/*.md\`.`,
    "A new fact goes into its own file in `memory/` plus a line in `MEMORY.md`.", "");
  return parts.join("\n");
}

/** Memory index: `](fact.md)` links point into memory/, since in OpenClaw the index sits one level up. */
export function rewriteIndex(text, factNames) {
  const known = new Set(factNames);
  return text.replace(/\]\(([^)\s/]+\.md)\)/g, (m, file) => (known.has(file) ? `](memory/${file})` : m));
}

/** What to write for one project: files and warnings; existing files are not overwritten without force. */
export function projectPlan(space, memory, { importedAt, exists, force = false }) {
  const id = agentId(space.name);
  const folders = (space.folders || []).map((f) => f.path);
  const files = [];
  const warn = [];
  files.push({ path: "project.json", text: JSON.stringify({ id, name: space.name, folders,
    source: { app: "claude-desktop", spaceId: space.id, importedAt } }, null, 2) + "\n" });
  files.push({ path: "AGENTS.md", text: agentsMd({ name: space.name, instructions: space.instructions, folders }, { importedAt }) });
  const facts = Object.keys(memory).filter((n) => n !== "MEMORY.md" && n.endsWith(".md")).sort();
  if (memory["MEMORY.md"] != null) {
    const index = rewriteIndex(memory["MEMORY.md"], facts);
    if ([...index].length > MEMORY_MAX_CHARS) {
      warn.push(`MEMORY.md is ${[...index].length} chars, over ${MEMORY_MAX_CHARS}: OpenClaw will truncate it in context`);
    }
    files.push({ path: "MEMORY.md", text: index });
  }
  for (const n of facts) files.push({ path: `memory/${n}`, text: memory[n] });
  const other = Object.keys(memory).filter((n) => !n.endsWith(".md"));
  if (other.length) warn.push(`non-.md files in memory, not migrated: ${other.join(", ")}`);
  const kept = files.filter((f) => exists(f.path) && !force).map((f) => f.path);
  return { id, name: space.name, folders, facts: facts.length, warn, kept,
    write: files.filter((f) => !kept.includes(f.path)) };
}

// Claude Desktop shared memory becomes the memory of agent main; the user profile goes to every agent's
// USER.md: scheduled runs see it too, while they do not load MEMORY.md (docs concepts/user-model.md).
export const USER_MAX_CHARS = 4000;

/** A Claude Desktop memory fact: front matter (name, description, metadata.type) and the text after it. */
export function parseFact(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return { body: text.trim() };
  const head = {};
  for (const line of m[1].split("\n")) {
    const kv = /^\s*([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv && kv[2]) head[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { name: head.name, description: head.description, type: head.type, body: m[2].trim() };
}

/** USER.md in the OpenClaw format: one entry per user-type fact with a date, status active, one line. */
export function userMd(facts, { importedAt }) {
  const parts = ["# USER.md", "",
    `User profile from Claude Desktop shared memory, migrated on ${importedAt}. One entry, one rule;`,
    "when a rule changes, mark the old one `status: superseded` and write the new one next to it.", ""];
  for (const f of facts) {
    parts.push(`<!-- observed: ${f.observed} | status: active -->`, "",
      `- ${f.body.replace(/\s*\n\s*/g, " ")} (details in \`memory/${f.file}\` of agent main)`, "");
  }
  return parts.join("\n");
}

/**
 * Shared memory → the main workspace: MEMORY.md, memory/*.md as is, USER.md from user-type facts.
 * observed: { file: YYYY-MM-DD } is the fact date (file modification time).
 */
export function globalPlan(memory, { importedAt, observed = {}, exists, force = false }) {
  const facts = Object.keys(memory).filter((n) => n !== "MEMORY.md" && n.endsWith(".md")).sort();
  const files = [];
  const warn = [];
  if (memory["MEMORY.md"] != null) files.push({ path: "MEMORY.md", text: rewriteIndex(memory["MEMORY.md"], facts) });
  for (const n of facts) files.push({ path: `memory/${n}`, text: memory[n] });
  const user = facts.map((file) => ({ file, observed: observed[file] || importedAt, ...parseFact(memory[file]) }))
    .filter((f) => f.type === "user");
  const userText = user.length ? userMd(user, { importedAt }) : null;
  if (userText) {
    files.push({ path: "USER.md", text: userText });
    if ([...userText].length > USER_MAX_CHARS) warn.push(`USER.md is ${[...userText].length} chars, over ${USER_MAX_CHARS}: OpenClaw will truncate it`);
  }
  const other = Object.keys(memory).filter((n) => !n.endsWith(".md"));
  if (other.length) warn.push(`non-.md files in memory, not migrated: ${other.join(", ")}`);
  const kept = files.filter((f) => exists(f.path) && !force).map((f) => f.path);
  return { facts: facts.length, user: user.length, userText, warn, kept, write: files.filter((f) => !kept.includes(f.path)) };
}
