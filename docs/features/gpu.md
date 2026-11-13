# GPU use

How busy the GPU is, and which models and programs hold its memory. It comes with the `aiwb-gpu` plugin and shows
NVIDIA GPUs (through `nvidia-smi`, part of the NVIDIA driver).

- **In the chat header**: `GPU 35% · 5.1/8.0 GB` for each GPU — load and memory in use, refreshed every 5 seconds.
  The line is not shown on a machine without an NVIDIA GPU or driver.
- **Click it** to open the **GPU** side panel: load and memory bars, and who holds GPU memory, largest first,
  refreshed every 2 seconds while the panel is open:
    - **Ollama**, with each loaded model and how much of it is in GPU memory (`/api/ps`; the address comes from
      `WORKBENCH_OLLAMA_URL`);
    - **Memory search embeddings (llama.cpp)**, the local embedding server the Gateway starts with
      `WORKBENCH_LOCAL_EMBEDDINGS=vulkan`;
    - **llama.cpp server** and **LM Studio** started by you;
    - **OpenClaw Gateway** itself, and other programs by name.

Load is for the whole GPU: `nvidia-smi` gives memory per process exactly, but load per process only by sampling, so
it is not shown. Cloud models and Claude do not use your GPU; with no local model running the panel shows little.

AMD and Intel GPUs are not shown yet: the panel says that `nvidia-smi` is missing.

The Control UI needs Custom plugin UI (`gateway.controlUi.experimental.customPlugins`), which the installer turns on.
