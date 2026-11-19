// GPU for embeddings. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

/** `vulkaninfo --summary` → [{ index, type, name }] in Vulkan order, which is how llama.cpp numbers them too. */
export function parseVulkanDevices(text) {
  const out = [];
  for (const block of String(text).split(/^GPU(?=\d+:)/m).slice(1)) {
    const index = Number(block.match(/^(\d+):/)?.[1]);
    const type = block.match(/deviceType\s*=\s*(\S+)/)?.[1] || "";
    const name = block.match(/deviceName\s*=\s*(.+)/)?.[1]?.trim() || "";
    if (Number.isInteger(index)) out.push({ index, type, name });
  }
  return out;
}

/** GPU for embeddings: the explicit index; otherwise a discrete NVIDIA; otherwise any discrete GPU. */
export function pickVulkanDevice(devices, wanted) {
  if (wanted !== undefined && wanted !== "") return devices.find((d) => d.index === Number(wanted)) || null;
  const discrete = devices.filter((d) => /DISCRETE/.test(d.type));
  return discrete.find((d) => /NVIDIA/i.test(d.name)) || discrete[0] || null;
}

/**
 * Memory embedding server (llama-cpp plugin) on the GPU via Vulkan: a pinned llama.cpp build
 * in <workbench>/llama.cpp/ with localService switched to it; it sees only the chosen GPU
 * (GGML_VK_VISIBLE_DEVICES). mode is WORKBENCH_LOCAL_EMBEDDINGS: "vulkan" or "vulkan:<index>".
 * The one-time server setup (openclaw models auth login --provider llama-cpp --method local)
 * is interactive; without it (no localService.command) the step is skipped with a hint.
 */
export function gpuEmbeddingsSteps({ mode, managedCommand, workbenchDir, build, devices, platform }) {
  const m = /^vulkan(?::(\d+))?$/.exec(mode || "");
  if (!m) return [];
  const id = "GPU embedding server";
  if (platform !== "linux") return [{ kind: "skip", id, reason: "the Vulkan build is pinned for Linux x64 only" }];
  if (!managedCommand) return [{ kind: "skip", id, reason: "one-time setup first: openclaw models auth login --provider llama-cpp --method local (with the Gateway stopped), then re-run the installer" }];
  const device = pickVulkanDevice(devices, m[1]);
  if (!device) return [{ kind: "skip", id, reason: devices.length ? `no ${m[1] !== undefined ? `GPU ${m[1]}` : "discrete GPU"} in vulkaninfo` : "vulkaninfo found no GPUs" }];
  const dir = path.join(workbenchDir, "llama.cpp", `${build.tag}-vulkan`);
  const bin = path.join(dir, ...build.binary.split("/"));
  return [
    { kind: "llama-download", id: build.asset, note: `llama.cpp ${build.tag}, Vulkan`, dir, bin, asset: build.asset, sha256: build.sha256,
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${build.tag}/${build.asset}` },
    { kind: "config", id: "models.providers.llama-cpp.localService.command", note: bin,
      argv: ["config", "set", "models.providers.llama-cpp.localService.command", JSON.stringify(bin), "--strict-json"] },
    { kind: "config", id: "models.providers.llama-cpp.localService.env", note: `GPU ${device.index}: ${device.name}`,
      argv: ["config", "set", "models.providers.llama-cpp.localService.env", JSON.stringify({ GGML_VK_VISIBLE_DEVICES: String(device.index) }), "--strict-json"] },
  ];
}
