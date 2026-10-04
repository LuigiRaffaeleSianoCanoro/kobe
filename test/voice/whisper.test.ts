import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WHISPER, WhisperDictationAdapter, resample, whisperConfigFromEnv, type WhisperRequest, type WhisperResponse } from "../../lib/whisper";
import type { DictationError } from "../../lib/dictation";

// A scripted stand-in for the Whisper worker; tests answer its requests by hand.
class FakeWorker {
  posted: WhisperRequest[] = [];
  private listeners = { message: [] as ((e: { data: WhisperResponse }) => void)[], error: [] as (() => void)[] };
  postMessage(message: WhisperRequest) {
    this.posted.push(message);
  }
  addEventListener(type: "message" | "error", listener: never) {
    this.listeners[type].push(listener);
  }
  emit(data: WhisperResponse) {
    this.listeners.message.forEach((l) => l({ data }));
  }
  crash() {
    this.listeners.error.forEach((l) => l());
  }
  transcriptions() {
    return this.posted.filter((m): m is Extract<WhisperRequest, { type: "transcribe" }> => m.type === "transcribe");
  }
  answer(text: string, index = -1) {
    this.emit({ type: "text", id: this.transcriptions().at(index)!.id, text });
  }
}

let worker: FakeWorker;
let mic: { onChunk?: (s: Float32Array) => void; stop: ReturnType<typeof vi.fn>; open: Promise<{ sampleRate: number; stop: () => void }> };
let errors: DictationError[];
let loads: unknown[];
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(openMic?: () => Promise<{ sampleRate: number; stop: () => void }>) {
  return new WhisperDictationAdapter({
    language: () => "es",
    config: () => ({ model: "m", host: "https://models.example/" }),
    onError: (e) => errors.push(e),
    onLoad: (l) => loads.push(l),
    createWorker: () => worker as never,
    openMic: (onChunk) => {
      mic.onChunk = onChunk;
      return openMic ? openMic() : mic.open;
    },
  });
}

async function running(adapter: WhisperDictationAdapter) {
  const session = adapter.listen();
  worker.emit({ type: "ready", device: "webgpu" });
  await flush();
  return session;
}

beforeEach(() => {
  worker = new FakeWorker();
  const stop = vi.fn();
  mic = { stop, open: Promise.resolve({ sampleRate: 48_000, stop }) };
  errors = [];
  loads = [];
});

afterEach(() => vi.useRealTimers());

describe("resample", () => {
  it("averages 48 kHz down to 16 kHz", () => {
    expect(Array.from(resample(new Float32Array([0, 0.3, 0.6, 1, 1, 1]), 48_000))).toEqual([expect.closeTo(0.3), 1]);
  });

  it("returns 16 kHz audio untouched", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resample(input, 16_000)).toBe(input);
  });
});

describe("whisperConfigFromEnv", () => {
  it("defaults to whisper-base on the Hugging Face Hub", () => {
    expect(whisperConfigFromEnv({})).toEqual(DEFAULT_WHISPER);
    expect(DEFAULT_WHISPER.model).toBe("onnx-community/whisper-base");
  });

  it("lets a self-hosted install serve the model and the runtime itself", () => {
    expect(whisperConfigFromEnv({ KOBE_WHISPER_MODEL: "kobe/whisper", KOBE_WHISPER_HOST: "https://kobe.local/models", KOBE_WHISPER_WASM: "https://kobe.local/ort/" })).toEqual({
      model: "kobe/whisper",
      host: "https://kobe.local/models/",
      wasm: "https://kobe.local/ort/",
    });
  });
});

describe("support", () => {
  it("is unsupported without Workers and AudioWorklet (server, old browsers)", () => {
    expect(WhisperDictationAdapter.isSupported()).toBe(false);
  });
});

describe("loading the model", () => {
  it("loads once with the configured source, reports progress, then clears it", async () => {
    const adapter = setup();
    const first = adapter.load();
    adapter.load();
    expect(worker.posted).toEqual([{ type: "load", model: "m", host: "https://models.example/" }]);
    worker.emit({ type: "progress", loaded: 10, total: 100 });
    worker.emit({ type: "ready", device: "wasm" });
    await first;
    expect(loads).toEqual([{ loaded: 10, total: 100 }, null]);
  });

  it("fails and lets the next attempt retry", async () => {
    const adapter = setup();
    const first = adapter.load();
    worker.emit({ type: "error", message: "offline" });
    await expect(first).rejects.toThrow("offline");
    expect(loads).toEqual([null]);
    adapter.load();
    expect(worker.posted.filter((m) => m.type === "load")).toHaveLength(2);
  });

  it("fails when the worker crashes", async () => {
    const adapter = setup();
    const load = adapter.load();
    worker.crash();
    await expect(load).rejects.toThrow("stopped");
  });
});

describe("a private dictation session", () => {
  it("starts once the mic and the model are ready", async () => {
    const onStart = vi.fn();
    const adapter = new WhisperDictationAdapter({ language: () => "es", config: () => DEFAULT_WHISPER, onStart, createWorker: () => worker as never, openMic: () => mic.open });
    const session = adapter.listen();
    expect(onStart).toHaveBeenCalledOnce();
    expect(session.status).toEqual({ type: "starting" });
    const started = vi.fn();
    session.onSpeechStart(started);
    worker.emit({ type: "ready", device: "webgpu" });
    await flush();
    expect(session.status).toEqual({ type: "running" });
    expect(started).toHaveBeenCalledOnce();
  });

  it("previews every second, then commits the final text on stop", async () => {
    vi.useFakeTimers();
    const onHeard = vi.fn();
    const adapter = new WhisperDictationAdapter({
      language: () => "es",
      config: () => DEFAULT_WHISPER,
      onHeard,
      createWorker: () => worker as never,
      openMic: (onChunk) => {
        mic.onChunk = onChunk;
        return mic.open;
      },
    });
    const session = adapter.listen();
    worker.emit({ type: "ready", device: "webgpu" });
    await vi.advanceTimersByTimeAsync(0);
    const heard: unknown[] = [];
    session.onSpeech((r) => heard.push(r));
    const end = vi.fn();
    session.onSpeechEnd(end);

    mic.onChunk!(new Float32Array(48_000));
    await vi.advanceTimersByTimeAsync(1000);
    const preview = worker.transcriptions()[0];
    expect(preview).toMatchObject({ language: "es" });
    expect(preview.audio).toHaveLength(16_000);
    worker.answer("quién cumple");
    await vi.advanceTimersByTimeAsync(0);

    mic.onChunk!(new Float32Array(48_000));
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(worker.transcriptions().at(-1)!.audio).toHaveLength(32_000);
    worker.answer("quién cumple años");
    await stopped;
    expect(heard).toEqual([
      { transcript: "quién cumple", isFinal: false },
      { transcript: "quién cumple años", isFinal: true },
    ]);
    expect(onHeard).toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith({ transcript: "quién cumple años" });
    expect(session.status).toEqual({ type: "ended", reason: "stopped" });
  });

  it("runs one transcription at a time", async () => {
    vi.useFakeTimers();
    const session = await (async () => {
      const s = setup().listen();
      worker.emit({ type: "ready", device: "webgpu" });
      await vi.advanceTimersByTimeAsync(0);
      return s;
    })();
    mic.onChunk!(new Float32Array(4800));
    await vi.advanceTimersByTimeAsync(1000);
    void session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.transcriptions()).toHaveLength(1);
    worker.answer("hola");
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.transcriptions()).toHaveLength(2);
  });

  it("stopping before the model is ready cancels and closes the mic", async () => {
    const adapter = setup();
    const session = adapter.listen();
    await session.stop();
    expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
    worker.emit({ type: "ready", device: "wasm" });
    await flush();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(session.status.type).toBe("ended");
  });

  it("cancel ignores a transcription that arrives late", async () => {
    const session = await running(setup());
    mic.onChunk!(new Float32Array(16_000));
    const heard = vi.fn();
    session.onSpeech(heard);
    const stopped = session.stop();
    await flush();
    session.cancel();
    worker.answer("tarde");
    await stopped;
    expect(heard).not.toHaveBeenCalled();
    expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
  });

  it("a denied microphone shows the plain notice", async () => {
    const session = setup(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }))).listen();
    worker.emit({ type: "ready", device: "wasm" });
    await flush();
    expect(errors).toEqual(["denied"]);
    expect(session.status).toEqual({ type: "ended", reason: "error" });
  });

  it("no microphone shows its own notice", async () => {
    setup(() => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" }))).listen();
    worker.emit({ type: "ready", device: "wasm" });
    await flush();
    expect(errors).toEqual(["no-mic"]);
  });

  it("a model that cannot load ends the session and closes the mic", async () => {
    const session = setup().listen();
    worker.emit({ type: "error", message: "offline" });
    await flush();
    await flush();
    expect(errors).toEqual(["model"]);
    expect(session.status).toEqual({ type: "ended", reason: "error" });
    expect(mic.stop).toHaveBeenCalledOnce();
  });

  it("a failed final transcription reports a failure", async () => {
    const session = await running(setup());
    mic.onChunk!(new Float32Array(16_000));
    const stopped = session.stop();
    await flush();
    worker.emit({ type: "error", id: worker.transcriptions().at(-1)!.id, message: "boom" });
    await stopped;
    expect(errors).toEqual(["failed"]);
    expect(session.status).toEqual({ type: "ended", reason: "error" });
  });
});
