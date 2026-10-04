import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tagFor } from "../../lib/voice";

describe("tagFor", () => {
  it("keeps the browser's regional tag", () => {
    expect(tagFor("es", ["en-US", "es-AR"])).toBe("es-AR");
    expect(tagFor("en", ["es-AR", "en-GB"])).toBe("en-GB");
  });

  it("falls back to a default region", () => {
    expect(tagFor("es", ["en-US"])).toBe("es-ES");
    expect(tagFor("en", [])).toBe("en-US");
  });

  it("does not match a longer language code", () => {
    expect(tagFor("en", ["eng"])).toBe("en-US");
  });
});

describe("voice turns and mute", () => {
  class Recognition extends EventTarget {
    static last: Recognition;
    constructor() {
      super();
      Recognition.last = this;
    }
    say(text: string) {
      this.dispatchEvent(Object.assign(new Event("result"), { results: [{ isFinal: true, 0: { transcript: text } }] }));
    }
    lang = "";
    continuous = false;
    interimResults = false;
    start() {}
    stop() {}
    abort() {}
  }
  class Utterance extends EventTarget {
    lang = "";
    voice = null;
  }
  let store: Map<string, string>;
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => never[] };

  // Load lib/voice the way a fresh page would, with this browser's storage.
  async function load() {
    vi.resetModules();
    vi.stubGlobal("window", { SpeechRecognition: Recognition, speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    vi.stubGlobal("navigator", { language: "es-AR", languages: ["es-AR"] });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    return import("../../lib/voice");
  }

  beforeEach(() => {
    store = new Map();
    synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("treats a message sent after the mic heard words as a voice turn, and only that one", async () => {
    const { dictation, voice } = await load();
    voice.send();
    expect(voice.isVoiceTurn()).toBe(false);
    dictation!.listen();
    Recognition.last.say("quién cumple años");
    voice.send();
    expect(voice.isVoiceTurn()).toBe(true);
    expect(voice.shouldSpeakReply()).toBe(true);
    voice.send();
    expect(voice.isVoiceTurn()).toBe(false);
  });

  it("does not make a typed message a voice turn when the mic only hushed Kobe", async () => {
    const { dictation, voice } = await load();
    dictation!.listen().cancel();
    voice.send();
    expect(voice.isVoiceTurn()).toBe(false);
  });

  it("hushes Kobe when the mic opens and when a message is sent", async () => {
    const { dictation, speech, voice } = await load();
    const reply = speech!.speak("Hola");
    dictation!.listen();
    expect(reply.status).toMatchObject({ type: "ended", reason: "cancelled" });
    const next = speech!.speak("Otra");
    voice.send();
    expect(next.status).toMatchObject({ type: "ended", reason: "cancelled" });
  });

  it("mute stops the voice, skips voice replies, and survives a reload", async () => {
    const first = await load();
    const reply = first.speech!.speak("Hola");
    first.voice.setMuted(true);
    expect(reply.status).toMatchObject({ type: "ended", reason: "cancelled" });
    first.dictation!.listen();
    Recognition.last.say("hola");
    first.voice.send();
    expect(first.voice.shouldSpeakReply()).toBe(false);

    const reloaded = await load();
    reloaded.dictation!.listen();
    Recognition.last.say("hola");
    reloaded.voice.send();
    expect(reloaded.voice.shouldSpeakReply()).toBe(false);
    reloaded.voice.setMuted(false);
    expect(reloaded.voice.shouldSpeakReply()).toBe(true);
    expect(store.get("kobe.voice.muted")).toBe("0");
  });
});

describe("private mode", () => {
  class Recognition extends EventTarget {
    static count = 0;
    constructor() {
      super();
      Recognition.count++;
    }
    lang = "";
    continuous = false;
    interimResults = false;
    start() {}
    stop() {}
    abort() {}
  }
  class FakeWorker {
    static posted: unknown[] = [];
    postMessage(message: unknown) {
      FakeWorker.posted.push(message);
    }
    addEventListener() {}
  }
  let store: Map<string, string>;

  async function load(browser: { webSpeech: boolean }) {
    vi.resetModules();
    vi.stubGlobal("window", browser.webSpeech ? { SpeechRecognition: Recognition } : {});
    vi.stubGlobal("navigator", { language: "es-AR", languages: ["es-AR"], mediaDevices: { getUserMedia: () => new Promise(() => {}) } });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("AudioContext", class { close() {} });
    return import("../../lib/voice");
  }

  beforeEach(() => {
    store = new Map();
    Recognition.count = 0;
    FakeWorker.posted = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is off by default and uses the browser's recognizer", async () => {
    const { canDictate, canGoPrivate, dictation } = await load({ webSpeech: true });
    expect(canGoPrivate).toBe(true);
    expect(canDictate({ private: false })).toBe(true);
    dictation!.listen();
    expect(Recognition.count).toBe(1);
    expect(FakeWorker.posted).toEqual([]);
  });

  it("turning it on starts the one-time download and survives a reload", async () => {
    const first = await load({ webSpeech: true });
    first.voice.setPrivate(true);
    expect(store.get("kobe.voice.private")).toBe("1");
    expect(FakeWorker.posted).toEqual([{ type: "load", model: "onnx-community/whisper-base", host: "https://huggingface.co/" }]);

    const reloaded = await load({ webSpeech: true });
    reloaded.dictation!.listen();
    expect(Recognition.count).toBe(0);
    expect(FakeWorker.posted.at(-1)).toMatchObject({ type: "load" });
  });

  it("uses the server's model source", async () => {
    const { voice } = await load({ webSpeech: true });
    voice.configureWhisper({ model: "kobe/whisper", host: "https://kobe.local/" });
    voice.setPrivate(true);
    expect(FakeWorker.posted).toEqual([{ type: "load", model: "kobe/whisper", host: "https://kobe.local/" }]);
  });

  it("gives Firefox a mic once private mode is on", async () => {
    const { canDictate, dictation } = await load({ webSpeech: false });
    expect(dictation).toBeDefined();
    expect(canDictate({ private: false })).toBe(false);
    expect(canDictate({ private: true })).toBe(true);
  });
});
