// The profile .env: reading, writing and the Gateway token. Part of installer/lib.mjs (pure functions, no I/O).
import { randomBytes } from "node:crypto";

/** .env lines without the given keys: drops lines appended by an earlier install (manifest.env).
 *  The env.vars setting now provides the same values, and a .env line would override it. */
export const removeEnvLines = (envText, keys) =>
  envText.split(/(?<=\n)/).filter((line) => !keys.some((k) => line.startsWith(`${k}=`))).join("");

/** Keys a profile may not set in ENV: secrets and proxy URLs (they may hold credentials) stay in .env. */
const SECRET_ENV_KEY = /TOKEN|KEY|SECRET|PASSWORD|_PROXY$|PROXY_URL|PACKAGE_SHA256/;

/**
 * Profile ENV: non-secret WORKBENCH_* values the profile keeps in git (models, proxy hosts, folders,
 * presets). Returns { values, error }: values as strings; a key outside WORKBENCH_* or one that looks
 * secret is an error (it belongs in .env only).
 */
export function profileEnv(env = {}) {
  const values = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^WORKBENCH_[A-Z0-9_]+$/.test(k)) return { error: `ENV ${k}: only WORKBENCH_* keys` };
    if (SECRET_ENV_KEY.test(k)) return { error: `ENV ${k}: secrets and proxy URLs stay in .env, not in the profile` };
    if (k === "WORKBENCH_PROFILE" || k === "WORKBENCH_PLUGINS_ROOT") return { error: `ENV ${k}: read before the profile, set it in .env` };
    values[k] = String(v);
  }
  return { values };
}

/** A .env value as written: quoted when `set -a; . .env` would split or expand it (dotenv strips the quotes). */
export function envValue(v) {
  if (/^[\w@%+=:,./~-]*$/.test(v)) return v;
  return v.includes("'") ? `"${v}"` : `'${v}'`;
}

/** A .env value as read: surrounding quotes removed, as dotenv does. */
export function unquoteEnv(v) {
  const m = v.trim().match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : v.trim();
}

/** .env text with the given keys set: an existing line is replaced in place, a new key is appended. */
export function setEnvLines(envText, values) {
  let text = envText;
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${envValue(v)}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  return text;
}

/** .env lines: adds the Gateway token if missing; leaves existing values alone. */
export function ensureGatewayToken(envText, token = randomBytes(24).toString("hex")) {
  const has = /^OPENCLAW_GATEWAY_TOKEN=\S+/m.test(envText);
  if (has) return { text: envText, added: false };
  const sep = envText && !envText.endsWith("\n") ? "\n" : "";
  return { text: `${envText}${sep}OPENCLAW_GATEWAY_TOKEN=${token}\n`, added: true };
}
