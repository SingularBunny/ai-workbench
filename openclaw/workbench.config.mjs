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

export const OPENCLAW_VERSION = "2026.11.6";

/** @param {{ home: string, sep: string, env: Record<string, string|undefined>, pluginsRoot?: string }} ctx */
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

  // Models of the pdf and image tools (docs/features/document-preview.md): they read PDFs, scans and images for agents
  // whose own model cannot. With WORKBENCH_DEFAULT_RUNTIME they run on the same runtime: on Claude CLI the fork asks
  // them in one isolated CLI turn (Claude by subscription, no API key); without the settings the tools stay as
  // OpenClaw has them.
  const runtimeSet = new Set([model, dreaming]);
  for (const [key, ref] of [["agents.defaults.pdfModel", ctx.env.WORKBENCH_PDF_MODEL], ["agents.defaults.imageModel", ctx.env.WORKBENCH_IMAGE_MODEL]]) {
    if (!ref) continue;
    out.push([key, { primary: ref }]);
    if (ctx.env.WORKBENCH_DEFAULT_RUNTIME && !runtimeSet.has(ref)) {
      runtimeSet.add(ref);
      out.push([`agents.defaults.models[${JSON.stringify(ref)}].agentRuntime`, { id: ctx.env.WORKBENCH_DEFAULT_RUNTIME }]);
    }
  }

  // Multi-model (aiwb-compare, docs/features/multi-model.md) calls the models chosen on its page by name: OpenClaw
  // lets a plugin pick the model only with this opt-in (docs plugins/sdk-runtime/models.md).
  out.push(["plugins.entries.aiwb-compare.llm.allowModelOverride", true]);

  // Agents work with each other's chats (docs/features/chats.md#agents-managing-chats): agents_list lists every agent
  // with its name, and sessions_spawn may target any of them (docs concepts/session-tool.md). Without it an agent sees
  // only itself and starts a requested chat "in agent Claude" in its own agent. WORKBENCH_AGENT_TARGETS narrows the
  // list (comma-separated ids) or turns it off (`self`).
  const targets = (ctx.env.WORKBENCH_AGENT_TARGETS || "*").split(",").map((t) => t.trim()).filter(Boolean);
  if (!(targets.length === 1 && targets[0] === "self")) out.push(["agents.defaults.subagents.allowAgents", targets]);

  // Claude CLI turns stay unmanaged (fork F62): since 2026.11 OpenClaw runs them without Claude Code's own tools,
  // skills, plugins, slash commands and Chrome; the workbench's Claude CLI features need them. Only with the fork:
  // the official build's anthropic plugin rejects unknown keys.
  if (ctx.env.WORKBENCH_OPENCLAW_PACKAGE) out.push(["plugins.entries.anthropic.config.managedTurns", false]);
  // A chat keeps its Claude Code process for a workday (fork): upstream closes an idle one after 10 minutes, and each
  // new process opens a new Claude in Chrome tab group; Claude Desktop keeps one group per chat.
  if (ctx.env.WORKBENCH_OPENCLAW_PACKAGE) out.push(["plugins.entries.anthropic.config.liveSessionIdleMinutes", 480]);
  // A chat that switches models keeps one conversation (fork F72): back on Claude CLI, Claude gets the turns other
  // models and agents wrote, also in a fresh Claude session with its own CLI login (one owner, no API key to check).
  // The turn count is bounded by the history character budget, not by the upstream 8.
  if (ctx.env.WORKBENCH_OPENCLAW_PACKAGE) out.push(["plugins.entries.anthropic.config.cliHistory", { allowUnknownAuth: true, maxUnseenTurns: 200 }]);
  // Managed turns (the official build, or the fork with the switch on) keep Claude's background agents and
  // workflows: OpenClaw allows exactly these two native tools there (managedNativeTools, docs gateway/cli-backends.md).
  out.push(["plugins.entries.anthropic.config.managedNativeTools.default", ["Agent", "Workflow"]]);

  // Groups (aiwb-groups, docs/features/groups.md) takes each agent's reply from the agent_end hook, which OpenClaw
  // gives a non-bundled plugin only with this opt-in (docs plugins/sdk-runtime.md).
  out.push(["plugins.entries.aiwb-groups.hooks.allowConversationAccess", true]);
  // Plan mode (aiwb-plan, docs/features/plan-mode.md) puts its note into the prompt of a planning chat.
  out.push(["plugins.entries.aiwb-plan.hooks.allowConversationAccess", true]);

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

  // ACP agents through acpx: Claude CLI on a remote VM, JetBrains Junie.
  const acpAgents = [];
  // Claude CLI on a remote VM (tested on a remote VM bench).
  // acp-reaper on the VM is required: without it, agent commands are left orphaned on disconnect.
  if (ctx.env.WORKBENCH_VM_SSH) {
    acpAgents.push("claude");
    out.push(["plugins.entries.acpx.config.agents.claude", {
      command: "ssh",
      args: ["-T", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "${WORKBENCH_VM_SSH}",
        "exec", "setsid", "-w", "acp-reaper", "claude-agent-acp"],
    }]);
  }
  // JetBrains Junie CLI (docs/integrations/junie.md): its own login, spends JetBrains AI credits. A chat hands itself
  // to Junie with `/acp spawn junie --bind here`; an agent hands Junie one task with
  // sessions_spawn({ runtime: "acp", agentId: "junie" }). No separate OpenClaw agent: OpenClaw honours an agent's
  // runtime.type "acp" only in channel bindings and spawns, so its ordinary chat would answer with the default model.
  if (ctx.env.WORKBENCH_JUNIE) {
    acpAgents.push("junie");
    // JetBrains answers 451 to Russia and 403 to some data-centre exits. WORKBENCH_JUNIE_PROXY (Linux, macOS) points
    // only Junie's process at a proxy of your own through env(1), since acpx agents take no environment of their own;
    // else, with WORKBENCH_PROXY_POOL, Junie runs through the aiwb-proxy-pool wrapper and its local proxy.
    const viaProxy = ctx.env.WORKBENCH_JUNIE_PROXY && ctx.sep === "/";
    const viaPool = ctx.env.WORKBENCH_PROXY_POOL && ctx.pluginsRoot;
    const proxyVars = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].map((name) => `${name}=\${WORKBENCH_JUNIE_PROXY}`);
    // The fork's acpx (WORKBENCH_ACPX_PACKAGE) shows Junie's JetBrains AI credit balance in the Limits views: it asks
    // Junie's own /stats in a throwaway session (no model call) and caches it for 10 minutes. npm acpx rejects the key.
    const usage = ctx.env.WORKBENCH_ACPX_PACKAGE ? { usage: { command: "stats" } } : {};
    out.push(["plugins.entries.acpx.config.agents.junie", viaProxy
      ? { command: "/usr/bin/env", args: ["-u", "ALL_PROXY", "-u", "all_proxy", ...proxyVars,
        "NO_PROXY=localhost,127.0.0.1,::1", "no_proxy=localhost,127.0.0.1,::1", "${WORKBENCH_JUNIE}", "--acp=true"], ...usage }
      : viaPool
        ? { command: [ctx.pluginsRoot, "aiwb-plugins", "proxy-pool", "bin", "junie-via-pool"].join(ctx.sep),
          args: ["--junie", "${WORKBENCH_JUNIE}", "--acp=true"], ...usage }
        : { command: "${WORKBENCH_JUNIE}", args: ["--acp=true"], ...usage }]);
  }
  // With the fork (F72) an agent a chat is handed to gets the chat so far, and its replies stay in the history the
  // next model sees.
  if (acpAgents.length) out.push(["acp", { enabled: true, backend: "acpx", allowedAgents: acpAgents,
    ...(ctx.env.WORKBENCH_OPENCLAW_PACKAGE ? { seedParentHistory: true } : {}) }]);
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
// (judge, Claude Desktop & Code bridge, shared memory, fork settings, document preview, multi-model compare,
// groups, plan mode, GPU use, scheduled-tasks MCP); other own
// repositories are added by the profile. Entry format: { dir, repo }, see installer/lib/repos.mjs, repoSteps.
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
    // Plan mode for any model: /plan, then research and an approved plan before any change (docs/features/plan-mode.md).
    { id: "aiwb-plan", dir: "aiwb-plugins/plan", ui: "Plan" },
    // GPU load and memory, and which models and processes hold it: a line in the chat header, a side panel
    // (docs/features/gpu.md).
    { id: "aiwb-gpu", dir: "aiwb-plugins/gpu", ui: "GPU" },
    // Chat menu items for any model: Forget a topic (with the fork's chat.forget methods), New chat, Learn a skill,
    // Reset chat (docs/features/chats.md). ui: the menu items need Custom plugin UI.
    { id: "aiwb-chat-tools", dir: "aiwb-plugins/chat-tools", ui: "Chat tools" },
    // In an automation's chat: Run now in the header and the Runs side panel (docs/features/chats.md). Needs a fork
    // build with the run viewer for plugins; on an older one it adds nothing.
    { id: "aiwb-automation-chat", dir: "aiwb-plugins/automation-chat", ui: "Automation chat" },
    // A local proxy (127.0.0.1:18795) over free proxies found by proxybroker2 and checked, for programs that a
    // country block or a blocked exit keeps out; only JetBrains Junie is sent through it (docs/integrations/junie.md).
    // Off unless WORKBENCH_PROXY_POOL is set; needs proxybroker2 (plugin config proxybrokerPython).
    { id: "aiwb-proxy-pool", dir: "aiwb-plugins/proxy-pool", ui: "Proxy pool", when: "WORKBENCH_PROXY_POOL" },
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
  // Needed only if WORKBENCH_VM_SSH or WORKBENCH_JUNIE is set. From npm, or with WORKBENCH_ACPX_PACKAGE (+ _SHA256)
  // from the ACPX package built from the fork next to the core (tools/openclaw-fork-build.sh, docs/openclaw-fork.md).
  runtime: [{ id: "@openclaw/acpx", when: ["WORKBENCH_VM_SSH", "WORKBENCH_JUNIE"], package: "WORKBENCH_ACPX_PACKAGE" },
    // Local embeddings model for memory search (WORKBENCH_LOCAL_EMBEDDINGS).
    { id: "@openclaw/llama-cpp-provider", when: "WORKBENCH_LOCAL_EMBEDDINGS" },
    // Free-tier model providers shipped as separate packages, installed once their key is in .env
    // (docs/install/free-providers.md); Google, NVIDIA and Hugging Face are built into OpenClaw.
    { id: "@openclaw/groq-provider", when: "GROQ_API_KEY" },
    { id: "@openclaw/cerebras-provider", when: "CEREBRAS_API_KEY" },
    { id: "@openclaw/mistral-provider", when: "MISTRAL_API_KEY" },
    // DeepSeek: paid per token, with no free tier, but cheap; also a separate package.
    { id: "@openclaw/deepseek-provider", when: "DEEPSEEK_API_KEY" },
    // Scheduled tasks that wake the model only when a check script finds work, or run a script without the model
    // (ClawHub, MIT; inert until rules are configured — docs/features/scheduled-tasks.md).
    { id: "cronhook", spec: "clawhub:cronhook",
      optional: "add clawhub.ai to WORKBENCH_PROXY_HOSTS if ClawHub is not reachable directly, then re-run the installer" }],
};

// Own plugins renamed in November 2026 (folder and id). An existing install still has the old ids in
// plugins.entries, plugins.load.paths and plugins.allow/deny: the installer moves them to the new ones
// (installer/lib/manifest.mjs, pluginRenameSteps), and uninstall also removes what is left under the old ids.
export const PLUGIN_RENAMES = [
  { from: "ai-workbench", to: "judge", fromDir: "aiwb-plugins/ai-workbench", toDir: "aiwb-plugins/judge" },
  { from: "aiwb-projects", to: "aiwb-claude-bridge", fromDir: "aiwb-plugins/projects", toDir: "aiwb-plugins/claude-bridge" },
  { from: "aiwb-memory", to: "aiwb-memory", fromDir: "aiwb-plugins/memory", toDir: "aiwb-plugins/shared-memory" },
  { from: "aiwb-settings", to: "aiwb-fork-settings", fromDir: "aiwb-plugins/settings", toDir: "aiwb-plugins/fork-settings" },
];

// Public build MCP servers come only from the plugins repository (root: "plugins", relative to --plugins-root); own ones go in the profile.
// Format: installer/lib/repos.mjs, mcpSteps.
export const MCP = [
  // Scheduled tasks with the Claude Desktop contract on top of `openclaw automations`.
  // Installed only if the profile sets TASKS; the list of allowed tasks comes from there too.
  { id: "scheduled-tasks", kind: "project", root: "plugins", entry: "aiwb-plugins/mcp/scheduled-tasks/server.mjs", needs: "TASKS" },
];
