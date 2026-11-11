// ai-workbench public build: shared parts only. The user's own plugins, skills, MCP servers and
// tasks live in the personal profile (`--profile <dir>` or WORKBENCH_PROFILE), not here.
//
// OpenClaw settings applied by the installer (installer/setup.mjs).
// Each [path, value] pair goes to `openclaw config set <path> <value> --strict-json`:
// OpenClaw writes it itself, with schema validation and a backup; we never edit its JSON.
//
// No secrets here, only ${VAR} references. Values live in ~/.openclaw/.env
// (OpenClaw reads it itself, docs/gateway/config-secrets-env.md). A config key not
// found in the openclaw 5f68d354 docs does not go here.

export const OPENCLAW_VERSION = "2026.10.10";

/** @param {{ home: string, sep: string, env: Record<string, string|undefined> }} ctx */
export function settings(ctx) {
  const model = ctx.env.WORKBENCH_DEFAULT_MODEL || "openrouter/auto";
  const fallbacks = (ctx.env.WORKBENCH_FALLBACK_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  const out = [
    // Gateway on this machine only, token auth only.
    ["gateway.mode", "local"],
    ["gateway.bind", "loopback"],
    ["gateway.port", 18789],
    ["gateway.auth", { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" }],

    // Models. OpenRouter and Anthropic are built-in providers; they only need
    // OPENROUTER_API_KEY / ANTHROPIC_API_KEY from .env (docs/providers/openrouter.md,
    // anthropic.md). openrouter/auto is the default model from the same docs;
    // pick a specific one with `openclaw models set …`.
    // ${VAR:-…} is not allowed here: OpenClaw validates the model reference on write (checked
    // in a Docker run, 03.11.2026), so the installer substitutes the value.
    // Fallbacks are comma-separated, in case the primary fails (limits, network).
    ["agents.defaults.model", { primary: model, ...(fallbacks.length ? { fallbacks } : {}) }],

  ];

  // The default agent is shown by the name of its model family rather than its id `main`
  // (identity.name, as the project agents have); the id and its sessions stay the same.
  const family = [["anthropic/", "Claude"], ["openai/", "ChatGPT"], ["google/", "Gemini"]].find(([p]) => model.startsWith(p));
  if (family) out.push(["agents.entries.main.identity.name", family[1]]);

  // Dreaming (nightly transfer of notes into MEMORY.md, docs concepts/dreaming.md) uses its own model,
  // usually a light one; otherwise it runs on the agent's model. With WORKBENCH_DEFAULT_RUNTIME, on the same runtime.
  const dreaming = ctx.env.WORKBENCH_DREAMING_MODEL;
  if (dreaming) {
    out.push(["plugins.entries.memory-core.config.dreaming.model", dreaming],
      ["plugins.entries.memory-core.subagent.allowModelOverride", true]);
    if (ctx.env.WORKBENCH_DEFAULT_RUNTIME && dreaming !== model) {
      out.push([`agents.defaults.models[${JSON.stringify(dreaming)}].agentRuntime`, { id: ctx.env.WORKBENCH_DEFAULT_RUNTIME }]);
    }
  }

  // Multi-model (aiwb-compare, docs/features/multi-model.md) calls the models chosen on its page by name: OpenClaw
  // lets a plugin pick the model only with this opt-in (docs plugins/sdk-runtime/models.md).
  out.push(["plugins.entries.aiwb-compare.llm.allowModelOverride", true]);

  // Groups (aiwb-groups, docs/features/groups.md) takes each agent's reply from the agent_end hook, which OpenClaw
  // gives a non-bundled plugin only with this opt-in (docs plugins/sdk-runtime.md).
  out.push(["plugins.entries.aiwb-groups.hooks.allowConversationAccess", true]);

  // Semantic memory search with a local embeddings model (llama-cpp plugin, docs
  // plugins/llama-cpp.md): WORKBENCH_LOCAL_EMBEDDINGS=cpu|vulkan[:<GPU index>].
  if (ctx.env.WORKBENCH_LOCAL_EMBEDDINGS) out.push(["memory.search.provider", "local"]);

  // MCP Apps (OpenClaw docs cli/mcp/apps.md): HTML views from MCP servers, in a sandbox on the Gateway
  // port + 1. Opt-in, because the HTML comes from the server: WORKBENCH_MCP_APPS=1 enables, 0 disables,
  // empty leaves the setting as it is.
  const mcpApps = String(ctx.env.WORKBENCH_MCP_APPS ?? "").trim();
  if (mcpApps === "1" || mcpApps === "0") out.push(["mcp.apps.enabled", mcpApps === "1"]);

  // Claude Code and Claude Desktop session catalog (docs/providers/anthropic.md): the "Projects"
  // plugin adopts old chats from it into agents.
  out.push(["plugins.entries.anthropic.config.sessionCatalog.enabled", true]);

  // Run the model on another runtime: claude-cli is Claude Code with its login (Claude subscription);
  // the model reference stays anthropic/* (docs/providers/anthropic.md, "Config example").
  // Applies to all agents and their scheduled tasks, which use the agent's model.
  if (ctx.env.WORKBENCH_DEFAULT_RUNTIME) {
    out.push([`agents.defaults.models[${JSON.stringify(model)}].agentRuntime`, { id: ctx.env.WORKBENCH_DEFAULT_RUNTIME }]);
  }

  // Local Ollama, or a model on a VM via `ssh -L`. Without /v1:
  // the OpenAI-compatible URL breaks tool calls (docs/providers/ollama).
  if (ctx.env.WORKBENCH_OLLAMA_URL) {
    out.push(["models.providers.ollama", {
      baseUrl: "${WORKBENCH_OLLAMA_URL}", api: "ollama", apiKey: "ollama-local", timeoutSeconds: 300,
      models: [],
    }]);
  }

  // Claude CLI on a remote VM via acpx (tested on a remote VM bench).
  // acp-reaper on the VM is required: without it, agent commands are left orphaned on disconnect.
  if (ctx.env.WORKBENCH_VM_SSH) {
    out.push(
      ["acp", { enabled: true, allowedAgents: ["claude"] }],
      ["plugins.entries.acpx.config.agents.claude", {
        command: "ssh",
        args: ["-T", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "${WORKBENCH_VM_SSH}",
          "exec", "setsid", "-w", "acp-reaper", "claude-agent-acp"],
      }],
    );
  }
  return out;
}

// llama.cpp Vulkan build for the GPU memory embeddings server (WORKBENCH_LOCAL_EMBEDDINGS=vulkan).
// Same version the llama-cpp plugin installs for CPU (its models.ini fits); sha256 is
// from the GitHub release (digest field), verified 05.11.2026. Update together with OpenClaw.
export const LLAMA_CPP_VULKAN = {
  tag: "b10809",
  asset: "llama-b10809-bin-ubuntu-vulkan-x64.tar.gz",
  sha256: "07f029cef440c82c3cff5310641eb6347e5cbcd865a5d88990215058aa049e93",
  binary: "llama-b10809/llama-server",
};

// Where plugins are downloaded from. The public build uses only the ai-workbench plugins repository
// (judge, projects, shared memory, fork settings, document preview, scheduled-tasks MCP); other own
// repositories are added by the profile. Entry format: { dir, repo }, see installer/lib.mjs, repoSteps.
export const PLUGINS_REPO = { dir: "aiwb-plugins", repo: "https://github.com/SingularBunny/aiwb-plugins.git" };
export const REPOS = [PLUGINS_REPO];

// Plugins. own are installed with `--link` from a folder (root: "project" for this repository,
// "profile" for the profile folder, otherwise --plugins-root, where REPOS are cloned); bases are marketplace plugins.
export const PLUGINS = {
  own: [
    // Judge (judge skill).
    { id: "judge", dir: "aiwb-plugins/judge" },
    // Claude Desktop & Code bridge: chats by project folder, as in Claude Desktop, old chats continued in agents,
    // live run status, live import of Claude Code memory (docs/features/chats.md).
    { id: "aiwb-claude-bridge", dir: "aiwb-plugins/claude-bridge" },
    // Shared memory of all agents, as in Claude Desktop (docs/features/memory.md).
    { id: "aiwb-memory", dir: "aiwb-plugins/shared-memory" },
    // Which OpenClaw fork settings are active in the Gateway (docs/openclaw-fork.md), and the Proxy page
    // (docs/install/network.md). ui: the page needs Custom plugin UI (pluginUiSteps).
    { id: "aiwb-fork-settings", dir: "aiwb-plugins/fork-settings", ui: "Proxy" },
    // Office document preview in chat: LibreOffice → PDF (docs/features/document-preview.md).
    { id: "aiwb-office", dir: "aiwb-plugins/office" },
    // Several models answer one question; a judge picks the most consistent answer (docs/features/multi-model.md).
    { id: "aiwb-compare", dir: "aiwb-plugins/compare", ui: "Multi-model" },
    // Several agents in one conversation; a manager picks who speaks next (docs/features/groups.md).
    { id: "aiwb-groups", dir: "aiwb-plugins/groups", ui: "Groups" },
  ],
  // OpenClaw rejects the remote marketplace entirely: it has 99 `git-subdir` entries, which
  // are not allowed for remote ones (checked in a Docker run, 03.11.2026). So we use our own clone
  // of the marketplace repository (not Claude Code's clone), and OpenClaw installs base plugins at
  // the commits pinned in the marketplace. Cloned only if a base plugin from it is needed.
  // commit is a full sha: base plugins are pinned inside the marketplace (superpowers, data-engineering
  // by their own sha, skill-creator lives in it), so this commit pins all three.
  // Update deliberately: new sha → tools/validate_in_docker.sh → entry in research.md.
  marketplaces: {
    "claude-plugins-official": { repo: "https://github.com/anthropics/claude-plugins-official.git",
      commit: "fa4eb54397ee2faccb6940512a19c017cb1337f3" },   // 03.11.2026
  },
  bases: [],
  // Needed only if WORKBENCH_VM_SSH is set.
  runtime: [{ id: "@openclaw/acpx", when: "WORKBENCH_VM_SSH" },
    // Local embeddings model for memory search (WORKBENCH_LOCAL_EMBEDDINGS).
    { id: "@openclaw/llama-cpp-provider", when: "WORKBENCH_LOCAL_EMBEDDINGS" },
    // Free-tier model providers shipped as separate packages, installed once their key is in .env
    // (docs/install/free-providers.md); Google, NVIDIA and Hugging Face are built into OpenClaw.
    { id: "@openclaw/groq-provider", when: "GROQ_API_KEY" },
    { id: "@openclaw/cerebras-provider", when: "CEREBRAS_API_KEY" },
    { id: "@openclaw/mistral-provider", when: "MISTRAL_API_KEY" }],
};

// Own plugins renamed in November 2026 (folder and id). An existing install still has the old ids in
// plugins.entries, plugins.load.paths and plugins.allow/deny: the installer moves them to the new ones
// (installer/lib.mjs, pluginRenameSteps), and uninstall also removes what is left under the old ids.
export const PLUGIN_RENAMES = [
  { from: "ai-workbench", to: "judge", fromDir: "aiwb-plugins/ai-workbench", toDir: "aiwb-plugins/judge" },
  { from: "aiwb-projects", to: "aiwb-claude-bridge", fromDir: "aiwb-plugins/projects", toDir: "aiwb-plugins/claude-bridge" },
  { from: "aiwb-memory", to: "aiwb-memory", fromDir: "aiwb-plugins/memory", toDir: "aiwb-plugins/shared-memory" },
  { from: "aiwb-settings", to: "aiwb-fork-settings", fromDir: "aiwb-plugins/settings", toDir: "aiwb-plugins/fork-settings" },
];

// Public build MCP servers come only from the plugins repository (root: "plugins", relative to --plugins-root); own ones go in the profile.
// Format: installer/lib.mjs, mcpSteps.
export const MCP = [
  // Scheduled tasks with the Claude Desktop contract on top of `openclaw automations`.
  // Installed only if the profile sets TASKS; the list of allowed tasks comes from there too.
  { id: "scheduled-tasks", kind: "project", root: "plugins", entry: "aiwb-plugins/mcp/scheduled-tasks/server.mjs", needs: "TASKS" },
];
