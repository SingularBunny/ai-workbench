// Settings only the OpenClaw fork reads. Part of installer/lib.mjs (pure functions, no I/O).

// OpenClaw fork: values hard-coded upstream become environment variables the fork reads when used;
// they are set via the env.vars setting (`openclaw config set`, Gateway method config.patch); without them it behaves like OpenClaw.
// Presets (WORKBENCH_FORK_PRESETS): worker-limits — worker queues and heap (one heap shared by all: a
// ceiling, not memory in use); catalog-owner — user messages imported from the catalog get the owner mark.
export const FORK_SETTINGS = {
  "worker-limits": {
    OPENCLAW_WORKER_PENDING_TASKS: "4096",
    OPENCLAW_WORKER_PENDING_BYTES: String(4 * 1024 ** 3),
    OPENCLAW_WORKER_HEAP_MB: "8192",
  },
  "catalog-owner": { OPENCLAW_CATALOG_IMPORT_OWNER: "1" },
};

/** Fork presets: WORKBENCH_FORK_PRESETS is a comma-separated list of FORK_SETTINGS names, set as env.vars.
 *  They need the OpenClaw fork (fork); legacy: the old name of the key, WORKBENCH_OPENCLAW_PATCHES, was used. */
export function forkPresetSteps(value, { fork = false, legacy = false } = {}) {
  const names = String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) return [];
  const renamed = legacy ? [{ kind: "skip", id: "WORKBENCH_OPENCLAW_PATCHES", reason: "renamed to WORKBENCH_FORK_PRESETS; rename it in .env" }] : [];
  if (!fork) return [...renamed, { kind: "skip", id: `fork presets ${names.join(", ")}`, reason: "need the OpenClaw fork (WORKBENCH_OPENCLAW_PACKAGE)" }];
  return [...renamed, ...names.flatMap((n) => FORK_SETTINGS[n]
    ? Object.entries(FORK_SETTINGS[n]).map(([k, v]) => ({ kind: "config", id: `env.vars.${k}`, note: `${n}: ${v}`,
      argv: ["config", "set", `env.vars.${k}`, JSON.stringify(v), "--strict-json"] }))
    : [{ kind: "skip", id: `fork preset ${n}`, reason: `no such preset (available: ${Object.keys(FORK_SETTINGS).join(", ")})` }])];
}
