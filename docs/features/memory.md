# Shared memory

Claude Desktop's shared memory (for all chats) becomes, in OpenClaw, the memory of the `main` agent, which has no
project; its agent workspace is the profile's `main/`. OpenClaw has no file shared by all agents:
each one reads only its own folder. Therefore:

- facts go to `main/memory/*.md` as is, the index to `main/MEMORY.md`; any agent's `memory_search`
  finds them through `memory.search.extraPaths` (OpenClaw docs `reference/memory-config.md`);
- facts about the user (type `user`) also go to `USER.md`: for `main` and in every project. Scheduled
  runs load it too, while they do not load `MEMORY.md`.

```bash
node migrate/claude-desktop/memory.mjs --to <profile>/main --projects <profile>/projects --dry-run
```

## Shared memory for all agents

**Shared memory for all agents** (the `aiwb-memory` plugin, folder `shared-memory/` of aiwb-plugins, like Claude Desktop memory): its own folder, set in the
profile as `SHARED_MEMORY = { dir: "shared" }`, holds `USER.md` (about the user), `MEMORY.md`
(table of contents) and `memory/*.md` (facts). On every turn of any agent the plugin puts `USER.md` and the
table of contents into the system prompt along with a rule: facts about the user and rules for all projects
go to this folder, project facts go to the project's own memory. Memory search finds the facts (`memory.search.extraPaths`
includes this folder's `memory/`). The installer sets `plugins.entries.aiwb-memory.config.dir` and
`plugins.entries.aiwb-memory.hooks`: `allowPromptInjection` and `allowConversationAccess` (without them OpenClaw does not let the addition
through). The folder is not an agent workspace: OpenClaw stops putting an agent's root `MEMORY.md` and `USER.md`
into context once someone other than the agent edits them. All agents write to the shared folder, and all of them see its text:
whatever an agent writes there from a third-party site, the others will see too.

Along with shared memory the plugin also supplies a rule for background command notifications: after an answer OpenClaw
wakes the chat with an `Exec completed …` message (`tools.exec.notifyOnExit`), and an agent on Claude CLI used to reply
to it with "the result is already above". Now, if the result is already in the answer, the agent replies `NO_REPLY` and nothing
goes to the chat; a failed command or a new result is still reported. This is a request to the model,
not a filter; to turn notifications off entirely, set `tools.exec.notifyOnExit=false` (the agent then also won't learn about
long commands that finished without it).

Existing files are not overwritten without `--force`. For a profile with `MAIN = { dir: "main" }` the installer
sets `agents.entries.main.workspace` and `memory.search.extraPaths`. Edit `MEMORY.md` and `USER.md`
through the agent or before the first conversation: after an outside edit, the agent's next write
marks the file untrusted, and OpenClaw stops putting it into context (`openclaw doctor`,
the `memory-provenance` check; OpenClaw docs `concepts/memory-provenance.md`).

## How agents learn

**How agents learn** (OpenClaw docs `concepts/memory.md`, `concepts/dreaming.md`,
`tools/self-learning.md`):

- **memory**: the agent writes facts to `MEMORY.md` and `memory/<date>.md` in its agent workspace itself,
  and automatically before context compaction. Semantic `memory_search` needs an embeddings service
  (`memory.search.provider`; OpenAI by default, keyword-only without a key). Local and
  free: `WORKBENCH_LOCAL_EMBEDDINGS` ([below](#local-semantic-search));
- **Dreaming**: every night at 03:00 moves what is durable from notes and transcripts into `MEMORY.md`
  (journal: `DREAMS.md`). It runs on the agent's model; a lighter one is `WORKBENCH_DREAMING_MODEL` in `.env`;
- **learned skills** (Skill Workshop): the agent saves a technique as a skill or fixes one that failed;
  by hand, `/learn` in chat. They live in `~/.openclaw/agents/<id>/agent/workshop-skills/`; OpenClaw does not accept
  links pointing outside, so the chats timer puts a copy of them in the data repository (`learnedSkills`
  in the profile's `CHATS`, [Chats](chats.md)). OpenClaw runs the background review after 10 turns only for
  workers that report the model and tools (built-in, Codex); according to the
  documentation it does not trigger with Claude CLI.

## Local semantic search

**Local semantic search**: the EmbeddingGemma embedding model (~0.3 GB) on your own llama.cpp server
(OpenClaw docs `plugins/llama-cpp.md`). In `.env`, set `WORKBENCH_LOCAL_EMBEDDINGS=cpu` or `vulkan`;
the installer installs the plugin and enables `memory.search.provider: local`. One-time server setup is
interactive, with the Gateway stopped: decline the chat model and accept "only the
local embedding model":

```bash
openclaw models auth login --provider llama-cpp --method local --agent main
```

With `vulkan`, rerunning the installer puts a pinned llama.cpp build with Vulkan (sha256 in
`LLAMA_CPP_VULKAN` in `openclaw/workbench.config.mjs`) into `~/.openclaw/workbench/llama.cpp/` and
switches the server to it, exposing only the discrete GPU (`vulkaninfo`; for another one,
`vulkan:<index>`). OpenClaw provides no ready llama.cpp build with CUDA for Linux, while the NVIDIA
driver supports Vulkan. After changing the embedding model, rebuild the index with the Gateway
stopped: `openclaw memory index --force --agent <id>`; with chat transcripts included
(`rememberAcrossConversations`, on by default) this takes long, minutes per agent on a GPU.

**When the index updates.** OpenClaw starts indexing an agent's memory and chats only on that agent's first
memory search after a Gateway start (OpenClaw docs `concepts/memory-builtin.md`). Chats on Claude CLI rarely
search, so new chats and memory files could stay out of the index for days. With OpenClaw from the fork, the
installer sets `env.vars.OPENCLAW_MEMORY_INDEX_ON_START=1`: every agent's index opens when the Gateway starts
and then follows changes to memory files and chats.

## Old chats into memory

`openclaw memory session-backfill --agent <id>` moves old conversations into long-term memory
(without `--apply` it only previews). It takes only the owner's messages, while import from the
OpenClaw catalog marks imported messages as someone else's, so the preview of imported chats is empty.
`WORKBENCH_FORK_PRESETS=catalog-owner` ([OpenClaw from the fork](../openclaw-fork.md)) makes the import mark user messages as the
owner's (the owner runs it). It applies to imports made after the patch. To redo an already imported chat:
delete its session in OpenClaw (the Claude Code transcript stays; the import key is the same, and an archived
session would be brought back as is, without the marks), then run `claude-code-catalog.mjs --readopt "<title>"`.
Turns made in that session in OpenClaw are lost in the process. `--apply` does not call the model: the candidates
wait for the nightly Dreaming, which decides what goes into `MEMORY.md`; `--rollback` removes them.

Large chats and worker queue limits: [OpenClaw from the fork](../openclaw-fork.md).
