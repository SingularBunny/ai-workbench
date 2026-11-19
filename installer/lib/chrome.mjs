// The Chrome native messaging host. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

export const chromeHostFile = (dataDir) => path.join(dataDir, "NativeMessagingHosts", "ai.openclaw.browser_bootstrap.json");

/** Browser data folders for which OpenClaw registers the extension's native host. */
export function chromeDataDirs(platform, home) {
  if (platform === "darwin") return ["Google/Chrome", "Google/Chrome for Testing", "Chromium"].map((d) => path.join(home, "Library", "Application Support", d));
  return ["google-chrome", "google-chrome-for-testing", "chromium"].map((d) => path.join(home, ".config", d));
}

/**
 * The OpenClaw Chrome extension finds the local OpenClaw through a native host
 * (ai.openclaw.browser_bootstrap); without it, the extension reports that no local install was found.
 * `openclaw browser extension install` registers the host for browsers that have already run. The
 * extension itself comes from the Chrome Web Store; OpenClaw does not install it for the user.
 * WORKBENCH_CHROME_EXTENSION=0 skips this step.
 */
/**
 * Daily versioned backup of OpenClaw databases (WORKBENCH_BACKUP=<folder>, OpenClaw docs install/backups.md):
 * a local Git repository of `openclaw backup git` and the Gateway-owned 24h schedule, without a remote.
 * The schedule needs a running Gateway; without one the step only prints the command to run later.
 */
export function backupSteps({ dir, exists }) {
  if (!dir) return [];
  return [
    ...(exists(path.join(dir, ".git")) ? [] : [{ kind: "backup", id: `git repository ${dir}`, argv: ["backup", "git", "init", "--repository", dir] }]),
    { kind: "backup-schedule", id: "daily, local", note: dir, argv: ["backup", "enable", "--repository", dir, "--every", "24h"] },
  ];
}

export function chromeHostSteps({ value, platform, home, exists }) {
  if (String(value ?? "").trim() === "0") return [];
  const id = "ai.openclaw.browser_bootstrap";
  if (platform === "win32") return [{ kind: "skip", id: `Chrome extension host`, reason: "Windows uses a separate OpenClaw executable that the installer does not set up" }];
  if (!chromeDataDirs(platform, home).some(exists)) return [{ kind: "skip", id: "Chrome extension host", reason: "Chrome or Chromium has not been run yet; start it and re-run the install" }];
  // Exit code 1 and "Setup needs attention" while the extension is not in Chrome, yet the host is installed:
  // the step succeeds when the host file exists (chromeHostFile), not by the command's exit code.
  return [{ kind: "chrome-host", id, argv: ["browser", "extension", "install", "--wait-ms", "1000"] }];
}
