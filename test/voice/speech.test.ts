import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KobeSpeechAdapter, guessLang, pickVoice } from "../../lib/speech";

const voice = (lang: string, localService: boolean, isDefault = false) => ({ lang, localService, default: isDefault, name: `${lang}-${localService}` });

// A stand-in for the browser's utterance; tests fire its events by hand.
class FakeUtterance extends EventTarget {
  static last: FakeUtterance;
  lang = "";
  voice: unknown = null;
  constructor(public text: string) {
    super();
    FakeUtterance.last = this;
  }
  fire(type: string, extra: object = {}) {
    this.dispatchEvent(Object.assign(new Event(type), extra));
  }
}

let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => ReturnType<typeof voice>[] };

beforeEach(() => {
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [voice("en-US", true, true), voice("es-ES", false), voice("es-MX", true)] };
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => vi.unstubAllGlobals());

const adapter = (tag = "es-AR") => new KobeSpeechAdapter({ language: () => tag });

describe("guessLang", () => {
  it("hears Spanish and English replies", () => {
    expect(guessLang("Maya cumple años mañana. ¿Le escribo algo?", "en")).toBe("es");
    expect(guessLang("Maya turns 29 tomorrow. Want me to draft a birthday note?", "es")).toBe("en");
  });

  it("falls back on a tie", () => {
    expect(guessLang("Marcus, 7 PM.", "es")).toBe("es");
    expect(guessLang("", "en")).toBe("en");
  });
});

describe("pickVoice", () => {
  it("prefers a voice on the device over a network voice", () => {
    expect(pickVoice([voice("es-AR", false), voice("es-MX", true)], "es-AR")?.lang).toBe("es-MX");
  });

  it("prefers the exact region among device voices, and reads Android tags", () => {
    expect(pickVoice([voice("es-MX", true), voice("es_AR", true)], "es-AR")?.lang).toBe("es_AR");
  });

  it("returns nothing for a language without voices", () => {
    expect(pickVoice([voice("en-US", true)], "es-AR")).toBeUndefined();
  });
});

describe("KobeSpeechAdapter", () => {
  it("is unsupported without speechSynthesis", () => {
    vi.stubGlobal("window", {});
    expect(KobeSpeechAdapter.isSupported()).toBe(false);
  });

  it("speaks in the reply's language with a device voice", () => {
    const language = vi.fn(() => "es-AR");
    new KobeSpeechAdapter({ language }).speak("Hola Luigi");
    expect(language).toHaveBeenCalledWith("Hola Luigi");
    expect(FakeUtterance.last).toMatchObject({ text: "Hola Luigi", lang: "es-AR", voice: { lang: "es-MX" } });
    expect(synth.speak).toHaveBeenCalledWith(FakeUtterance.last);
  });

  it("speaks with no voice set when the browser has none loaded yet", () => {
    synth.getVoices = () => [];
    adapter().speak("Hola");
    expect(FakeUtterance.last.voice).toBeNull();
    expect(FakeUtterance.last.lang).toBe("es-AR");
  });

  it("moves from starting to running to finished and tells subscribers", () => {
    const handle = adapter().speak("Hola");
    const seen = vi.fn();
    handle.subscribe(seen);
    expect(handle.status).toEqual({ type: "starting" });
    FakeUtterance.last.fire("start");
    expect(handle.status).toEqual({ type: "running" });
    FakeUtterance.last.fire("end");
    expect(handle.status).toEqual({ type: "ended", reason: "finished", error: undefined });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("cancels, and ignores the browser's own interrupted error after", () => {
    const handle = adapter().speak("Hola");
    handle.cancel();
    FakeUtterance.last.fire("error", { error: "interrupted" });
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(handle.status).toEqual({ type: "ended", reason: "cancelled", error: undefined });
  });

  it("treats an interruption from elsewhere as a cancel", () => {
    const handle = adapter().speak("Hola");
    FakeUtterance.last.fire("error", { error: "interrupted" });
    expect(handle.status).toMatchObject({ type: "ended", reason: "cancelled" });
  });

  it("reports a synthesis failure", () => {
    const handle = adapter().speak("Hola");
    FakeUtterance.last.fire("error", { error: "synthesis-failed" });
    expect(handle.status).toEqual({ type: "ended", reason: "error", error: "synthesis-failed" });
  });

  it("stop() silences the current reply and is safe when idle", () => {
    const speaker = adapter();
    speaker.stop();
    expect(synth.cancel).not.toHaveBeenCalled();
    const handle = speaker.speak("Hola");
    speaker.stop();
    expect(handle.status).toMatchObject({ type: "ended", reason: "cancelled" });
    speaker.stop();
    expect(synth.cancel).toHaveBeenCalledOnce();
  });

  it("a new reply cuts off the previous one", () => {
    const speaker = adapter();
    const first = speaker.speak("Uno");
    speaker.speak("Dos");
    expect(first.status).toMatchObject({ type: "ended", reason: "cancelled" });
  });

  it("unsubscribes listeners", () => {
    const handle = adapter().speak("Hola");
    const seen = vi.fn();
    handle.subscribe(seen)();
    FakeUtterance.last.fire("end");
    expect(seen).not.toHaveBeenCalled();
  });
});
