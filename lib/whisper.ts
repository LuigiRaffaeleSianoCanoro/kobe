import type { DictationAdapter } from "@assistant-ui/react";
import type { DictationError } from "./dictation";

// Private dictation: Whisper runs in a Web Worker on this device (WebGPU, WASM fallback). Audio is
// captured with the Web Audio API and never leaves the browser. The model downloads once from
// `host` and is cached; a self-hosted install points `host` (and `wasm`) at its own server.

export type WhisperConfig = { model: string; host: string; wasm?: string };

export const DEFAULT_WHISPER: WhisperConfig = { model: "onnx-community/whisper-base", host: "https://huggingface.co/" };

/** Server env → client config, read at request time so a Docker image can be pointed elsewhere. */
export function whisperConfigFromEnv(env: Record<string, string | undefined>): WhisperConfig {
  const host = env.KOBE_WHISPER_HOST || DEFAULT_WHISPER.host;
  return {
    model: env.KOBE_WHISPER_MODEL || DEFAULT_WHISPER.model,
    host: host.endsWith("/") ? host : `${host}/`,
    ...(env.KOBE_WHISPER_WASM && { wasm: env.KOBE_WHISPER_WASM }),
  };
}

export type WhisperRequest = ({ type: "load" } & WhisperConfig) | { type: "transcribe"; id: number; audio: Float32Array; language: string };
export type WhisperResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: string }
  | { type: "text"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

type WorkerLike = {
  postMessage(message: WhisperRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WhisperResponse>) => void): void;
  addEventListener(type: "error", listener: () => void): void;
};
type Capture = { sampleRate: number; stop(): void };
type OpenMic = (onChunk: (samples: Float32Array) => void) => Promise<Capture>;
export type WhisperLoad = { loaded: number; total: number } | null;

const RATE = 16_000;
const INTERIM_MS = 1000;

/** Downsamples mono audio to 16 kHz by averaging each window, which also softens aliasing. */
export function resample(input: Float32Array, from: number, to = RATE): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    out[i] = sum / (end - start);
  }
  return out;
}

function join(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Buffers about 0.1 s of samples per message so the main thread isn't flooded.
const WORKLET = `registerProcessor("kobe-capture", class extends AudioWorkletProcessor {
  buffer = []; size = 0;
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) { this.buffer.push(channel.slice(0)); this.size += channel.length; }
    if (this.size >= 4096) { const out = new Float32Array(this.size); let o = 0; for (const b of this.buffer) { out.set(b, o); o += b.length; } this.port.postMessage(out, [out.buffer]); this.buffer = []; this.size = 0; }
    return true;
  }
});`;
let workletUrl: string | undefined;

// The AudioContext is created inside the tap: browsers only let it run after a user gesture.
const openMic: OpenMic = (onChunk) => {
  const context = new AudioContext();
  return (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(workletUrl);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "kobe-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
      source.connect(node).connect(context.destination);
      let open = true;
      return {
        sampleRate: context.sampleRate,
        stop: () => {
          if (!open) return;
          open = false;
          stream.getTracks().forEach((track) => track.stop());
          void context.close();
        },
      };
    } catch (error) {
      void context.close();
      throw error;
    }
  })();
};

function micError(error: unknown): DictationError {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-mic";
  return "failed";
}

type Options = {
  language: () => string;
  config: () => WhisperConfig;
  onStart?: () => void;
  onHeard?: () => void;
  onError?: (error: DictationError) => void;
  /** Download progress while the model loads, then null once it is ready. */
  onLoad?: (load: WhisperLoad) => void;
  createWorker?: () => WorkerLike;
  openMic?: OpenMic;
};

export class WhisperDictationAdapter implements DictationAdapter {
  private options: Options;
  private worker?: WorkerLike;
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private requests = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  private loadFailed?: (error: Error) => void;
  private nextId = 0;

  constructor(options: Options) {
    this.options = options;
  }

  static isSupported() {
    return (
      typeof window !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof WebAssembly === "object" &&
      typeof AudioWorkletNode !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  /** Starts the one-time model download (or reads it from cache). Safe to call repeatedly. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = new Promise<void>((resolve, reject) => {
      this.loadFailed = reject;
      const worker = this.connect();
      const onMessage = (event: MessageEvent<WhisperResponse>) => {
        const message = event.data;
        if (message.type === "progress") this.options.onLoad?.({ loaded: message.loaded, total: message.total });
        if (message.type === "ready") resolve();
        if (message.type === "error" && message.id === undefined) reject(new Error(message.message));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "load", ...this.options.config() });
    }).then(
      () => this.options.onLoad?.(null),
      (error) => {
        this.loading = undefined; // let the next tap retry, for example once the network is back
        this.options.onLoad?.(null);
        throw error;
      },
    );
    return this.loading;
  }

  private connect() {
    if (this.worker) return this.worker;
    const worker: WorkerLike = this.options.createWorker?.() ?? new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", ({ data }) => {
      if ((data.type !== "text" && data.type !== "error") || data.id === undefined) return;
      const request = this.requests.get(data.id);
      this.requests.delete(data.id);
      if (data.type === "text") request?.resolve(data.text);
      else request?.reject(new Error(data.message));
    });
    // A crashed worker (out of memory, blocked script) fails everything waiting on it; the next tap starts fresh.
    worker.addEventListener("error", () => {
      const crash = new Error("The speech worker stopped.");
      this.requests.forEach((request) => request.reject(crash));
      this.requests.clear();
      this.loadFailed?.(crash);
      this.worker = undefined;
    });
    this.worker = worker;
    return worker;
  }

  // One transcription at a time: a GPU session must not run twice at once.
  private transcribe(audio: Float32Array, language: string): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const id = ++this.nextId;
        this.requests.set(id, { resolve, reject });
        this.connect().postMessage({ type: "transcribe", id, audio, language }, [audio.buffer]);
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  listen(): DictationAdapter.Session {
    this.options.onStart?.();
    const language = this.options.language();
    const started = new Set<() => void>();
    const ended = new Set<(r: DictationAdapter.Result) => void>();
    const heard = new Set<(r: DictationAdapter.Result) => void>();
    const on = <T>(set: Set<T>) => (callback: T) => {
      set.add(callback);
      return () => void set.delete(callback);
    };

    const chunks: Float32Array[] = [];
    let capture: Capture | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopping = false;
    let busy = false;
    const audio = () => resample(join(chunks), capture?.sampleRate ?? RATE);
    const isEnded = () => session.status.type === "ended";
    const say = (text: string, isFinal: boolean) => {
      heard.forEach((cb) => cb({ transcript: text, isFinal }));
      if (text) this.options.onHeard?.();
    };
    const finish = (reason: "stopped" | "cancelled" | "error", transcript = "") => {
      if (session.status.type === "ended") return;
      stopping = true;
      clearInterval(timer);
      capture?.stop();
      session.status = { type: "ended", reason };
      ended.forEach((cb) => cb({ transcript }));
    };
    const fail = (error: DictationError) => {
      if (session.status.type === "ended") return;
      this.options.onError?.(error);
      finish("error");
    };
    const interim = async () => {
      if (busy || stopping || !chunks.length) return;
      busy = true;
      try {
        const text = await this.transcribe(audio(), language);
        if (!stopping) say(text, false);
      } catch {
        // A missed preview is fine; the final pass on stop still runs.
      } finally {
        busy = false;
      }
    };

    const session: DictationAdapter.Session = {
      status: { type: "starting" },
      stop: async () => {
        if (session.status.type === "ended") return;
        if (!capture) return finish("cancelled");
        stopping = true;
        clearInterval(timer);
        capture.stop();
        try {
          const text = await this.transcribe(audio(), language);
          if (isEnded()) return;
          if (text) say(text, true);
          finish("stopped", text);
        } catch {
          fail("failed");
        }
      },
      cancel: () => finish("cancelled"),
      onSpeechStart: on(started),
      onSpeechEnd: on(ended),
      onSpeech: on(heard),
    };

    const mic = (this.options.openMic ?? openMic)((samples) => chunks.push(samples));
    Promise.all([
      mic.catch((error) => Promise.reject(micError(error))),
      this.load().catch(() => Promise.reject<DictationError>("model")),
    ]).then(
      ([opened]) => {
        if (session.status.type === "ended") return opened.stop();
        capture = opened;
        session.status = { type: "running" };
        started.forEach((cb) => cb());
        timer = setInterval(interim, INTERIM_MS);
      },
      (error: DictationError) => {
        void mic.then((opened) => opened.stop(), () => {});
        fail(error);
      },
    );
    return session;
  }
}
