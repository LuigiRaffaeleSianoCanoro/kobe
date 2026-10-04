import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KobeDictationAdapter, type DictationError } from "../../lib/dictation";

type Result = { isFinal: boolean; 0: { transcript: string } };

// A scripted stand-in for Chrome's SpeechRecognition. Tests drive its events by hand.
class FakeRecognition extends EventTarget {
  static instances: FakeRecognition[] = [];
  static available = vi.fn<(o: { langs: string[] }) => Promise<string>>();
  static install = vi.fn<(o: { langs: string[] }) => Promise<boolean>>();
  lang = "";
  continuous = false;
  interimResults = false;
  processLocally?: boolean;
  start = vi.fn(() => this.fire("start"));
  stop = vi.fn((): void => void setTimeout(() => this.fire("end"), 10));
  abort = vi.fn(() => {
    this.fail("aborted");
    this.fire("end");
  });
  constructor() {
    super();
    FakeRecognition.instances.push(this);
  }
  fire(type: string, extra: object = {}) {
    this.dispatchEvent(Object.assign(new Event(type), extra));
  }
  fail(error: string) {
    this.fire("error", { error });
  }
  say(...results: [string, boolean][]) {
    this.fire("result", { results: results.map(([transcript, isFinal]): Result => ({ isFinal, 0: { transcript } })) });
  }
}

const last = () => FakeRecognition.instances.at(-1)!;

function setup(lang = "es-AR") {
  const errors: DictationError[] = [];
  const adapter = new KobeDictationAdapter({ language: () => lang, onError: (e) => errors.push(e) });
  return { adapter, errors };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.available.mockReset();
  FakeRecognition.install.mockReset();
  vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
});

afterEach(() => vi.unstubAllGlobals());

describe("support", () => {
  it("is unsupported without SpeechRecognition (Firefox)", () => {
    vi.stubGlobal("window", {});
    expect(KobeDictationAdapter.isSupported()).toBe(false);
    expect(() => setup().adapter.listen()).toThrow();
  });

  it("is unsupported on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(KobeDictationAdapter.isSupported()).toBe(false);
  });

  it("is supported with the prefixed Chrome constructor", () => {
    expect(KobeDictationAdapter.isSupported()).toBe(true);
  });
});

describe("a session", () => {
  it("listens continuously in the chosen language with interim results", () => {
    const session = setup("es-AR").adapter.listen();
    expect(last()).toMatchObject({ lang: "es-AR", continuous: true, interimResults: true });
    expect(last().processLocally).toBeUndefined();
    expect(session.status).toEqual({ type: "running" });
  });

  it("previews interim text and commits each final result once", () => {
    const session = setup().adapter.listen();
    const heard: { transcript: string; isFinal?: boolean }[] = [];
    session.onSpeech((r) => heard.push(r));
    last().say(["hola", false]);
    last().say(["hola Kobe", true]);
    last().say(["hola Kobe", true], [" quién cumple", false]);
    last().say(["hola Kobe", true], [" quién cumple años", true]);
    expect(heard).toEqual([
      { transcript: "hola", isFinal: false },
      { transcript: "hola Kobe", isFinal: true },
      { transcript: "", isFinal: false },
      { transcript: "quién cumple", isFinal: false },
      { transcript: "quién cumple años", isFinal: true },
      { transcript: "", isFinal: false },
    ]);
  });

  it("reports speech start and the full transcript at the end", () => {
    const session = setup().adapter.listen();
    const start = vi.fn();
    const end = vi.fn();
    session.onSpeechStart(start);
    session.onSpeechEnd(end);
    last().fire("speechstart");
    last().say(["hola", true]);
    last().fire("end");
    expect(start).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ transcript: "hola" });
    expect(session.status).toEqual({ type: "ended", reason: "stopped" });
  });

  it("stops and waits for the browser to finish", async () => {
    const session = setup().adapter.listen();
    await session.stop();
    expect(last().stop).toHaveBeenCalledOnce();
    expect(session.status).toEqual({ type: "ended", reason: "stopped" });
  });

  it("gives up on a stop that never ends", async () => {
    vi.useFakeTimers();
    const session = setup().adapter.listen();
    last().stop.mockImplementation(() => {});
    const stopped = session.stop();
    await vi.advanceTimersByTimeAsync(5100);
    await stopped;
    expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
    expect(last().abort).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancels without reporting an error", () => {
    const { adapter, errors } = setup();
    const session = adapter.listen();
    session.cancel();
    expect(session.status).toEqual({ type: "ended", reason: "cancelled" });
    expect(errors).toEqual([]);
  });

  it("unsubscribes listeners", () => {
    const session = setup().adapter.listen();
    const heard = vi.fn();
    session.onSpeech(heard)();
    last().say(["hola", true]);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it.each([
    ["not-allowed", "denied"],
    ["service-not-allowed", "unavailable"],
    ["audio-capture", "no-mic"],
    ["no-speech", "no-speech"],
    ["network", "network"],
    ["language-not-supported", "language"],
    ["bad-grammar", "failed"],
  ])("maps %s to a %s notice and ends the session", (code, notice) => {
    const { adapter, errors } = setup();
    const session = adapter.listen();
    last().fail(code);
    last().fire("end");
    expect(errors).toEqual([notice]);
    expect(session.status).toEqual({ type: "ended", reason: "error" });
  });

  it("reports a failure instead of throwing when the browser refuses to start", () => {
    class Busy extends FakeRecognition {
      start = vi.fn(() => {
        throw new Error("InvalidStateError");
      });
    }
    vi.stubGlobal("window", { SpeechRecognition: Busy });
    const { adapter, errors } = setup();
    expect(adapter.listen().status).toEqual({ type: "ended", reason: "error" });
    expect(errors).toEqual(["failed"]);
  });
});

describe("on-device recognition", () => {
  it("runs on the device when the language pack is installed", async () => {
    FakeRecognition.available.mockResolvedValue("available");
    const { adapter } = setup("es-AR");
    await adapter.prepare();
    expect(FakeRecognition.available).toHaveBeenCalledWith({ langs: ["es-AR"], processLocally: true });
    expect(adapter.isLocal()).toBe(true);
    adapter.listen();
    expect(last().processLocally).toBe(true);
    expect(FakeRecognition.install).not.toHaveBeenCalled();
  });

  it("installs a downloadable pack on the tap and uses the browser service meanwhile", async () => {
    FakeRecognition.available.mockResolvedValue("downloadable");
    FakeRecognition.install.mockResolvedValue(true);
    const { adapter } = setup("es-AR");
    await adapter.prepare();
    adapter.listen();
    expect(last().processLocally).toBeUndefined();
    expect(FakeRecognition.install).toHaveBeenCalledWith({ langs: ["es-AR"], processLocally: true });
    await Promise.resolve();
    expect(adapter.isLocal()).toBe(true);
  });

  it("falls back to the browser service once when the device refuses", async () => {
    FakeRecognition.available.mockResolvedValue("available");
    const { adapter, errors } = setup();
    await adapter.prepare();
    const session = adapter.listen();
    last().fail("service-not-allowed");
    last().fire("end");
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(last().processLocally).toBeUndefined();
    expect(errors).toEqual([]);
    expect(session.status.type).toBe("running");
    expect(adapter.isLocal()).toBe(false);
  });

  it("does not fall back after the user stopped", async () => {
    FakeRecognition.available.mockResolvedValue("available");
    const { adapter } = setup();
    await adapter.prepare();
    const session = adapter.listen();
    last().fail("service-not-allowed");
    void session.stop();
    await vi.waitFor(() => expect(session.status).toEqual({ type: "ended", reason: "stopped" }));
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("stays on the browser service when the lookup fails or is missing", async () => {
    FakeRecognition.available.mockRejectedValue(new Error("nope"));
    const { adapter } = setup();
    await adapter.prepare();
    expect(adapter.isLocal()).toBe(false);
    vi.stubGlobal("window", { SpeechRecognition: class extends EventTarget {} });
    const older = setup("en-US").adapter;
    await older.prepare();
    expect(older.isLocal()).toBe(false);
  });
});
