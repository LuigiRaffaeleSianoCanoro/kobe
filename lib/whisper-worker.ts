// Runs Whisper off the main thread, so transcribing never freezes the page. Audio arrives as 16 kHz
// mono samples and never leaves the browser; only the model files are downloaded, once, then cached.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WhisperRequest, WhisperResponse } from "./whisper";

const post = (message: WhisperResponse) => self.postMessage(message);
let asr: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

async function device() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return gpu && (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function load({ model, host, wasm }: Extract<WhisperRequest, { type: "load" }>) {
  env.allowLocalModels = false;
  env.remoteHost = host;
  if (wasm) env.backends.onnx.wasm!.wasmPaths = wasm;
  const where = await device();
  const transcriber = await pipeline("automatic-speech-recognition", model, {
    device: where,
    // Whisper's encoder is sensitive to quantization; on the GPU it stays full precision.
    dtype: where === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (info) => {
      if (info.status === "progress_total") post({ type: "progress", loaded: info.loaded, total: info.total });
    },
  });
  post({ type: "ready", device: where });
  return transcriber;
}

self.addEventListener("message", async (event: MessageEvent<WhisperRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    if (asr) return;
    asr = load(request);
    asr.catch((error) => {
      asr = undefined;
      post({ type: "error", message: String(error) });
    });
    return;
  }
  try {
    if (!asr) throw new Error("Whisper is not loaded.");
    const output = await (await asr)(request.audio, { language: request.language, task: "transcribe", chunk_length_s: 30 });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
    post({ type: "text", id: request.id, text: text.trim() });
  } catch (error) {
    post({ type: "error", id: request.id, message: String(error) });
  }
});
