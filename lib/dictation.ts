import type { DictationAdapter } from "@assistant-ui/react";

// A thin Web Speech wrapper. assistant-ui's WebSpeechDictationAdapter can't ask for on-device
// recognition or tell the UI why a session failed, so this one does both. Audio and transcripts
// never leave the browser through Kobe; with cloud recognition the browser's own speech service hears them.

type Alternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0?: Alternative };
type ResultEvent = Event & { results: ArrayLike<RecognitionResult> };
type ErrorEvent = Event & { error: string };
type Recognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
};
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type LocalOptions = { langs: string[]; processLocally: true };
type RecognitionClass = {
  new (): Recognition;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
};

export type DictationError = "denied" | "no-mic" | "no-speech" | "network" | "language" | "unavailable" | "model" | "failed";

const ERRORS: Record<string, DictationError> = {
  "not-allowed": "denied",
  "service-not-allowed": "unavailable",
  "audio-capture": "no-mic",
  "no-speech": "no-speech",
  network: "network",
  "language-not-supported": "language",
};

const STOP_TIMEOUT_MS = 5000;

function recognitionClass(): RecognitionClass | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

type Options = {
  /** BCP 47 tag read at the start of every session, so a language switch applies to the next one. */
  language: () => string;
  /** Called on every tap that opens the mic, before recognition starts. */
  onStart?: () => void;
  /** Called whenever the mic hears words. */
  onHeard?: () => void;
  onError?: (error: DictationError) => void;
};

export class KobeDictationAdapter implements DictationAdapter {
  private local = new Map<string, Availability>();
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  static isSupported() {
    return recognitionClass() !== undefined;
  }

  /** Whether the next session in this language runs on the device (Chrome 139+ with the language pack). */
  isLocal(lang = this.options.language()) {
    return this.local.get(lang) === "available";
  }

  /** Looks up on-device support ahead of the first tap. It never touches the microphone. */
  async prepare(lang = this.options.language()) {
    const available = recognitionClass()?.available;
    if (!available || this.local.has(lang)) return;
    try {
      this.local.set(lang, await available({ langs: [lang], processLocally: true }));
    } catch {
      this.local.set(lang, "unavailable");
    }
  }

  listen(): DictationAdapter.Session {
    const Recognition = recognitionClass();
    if (!Recognition) throw new Error("SpeechRecognition is not supported in this browser.");
    this.options.onStart?.();
    const lang = this.options.language();

    // The language pack downloads once, inside this tap; this session uses the browser service meanwhile.
    if (this.local.get(lang) === "downloadable" && Recognition.install) {
      this.local.set(lang, "downloading");
      Recognition.install({ langs: [lang], processLocally: true }).then(
        (ok) => this.local.set(lang, ok ? "available" : "unavailable"),
        () => this.local.set(lang, "unavailable"),
      );
    }

    const started = new Set<() => void>();
    const ended = new Set<(r: DictationAdapter.Result) => void>();
    const heard = new Set<(r: DictationAdapter.Result) => void>();
    const on = <T>(set: Set<T>) => (callback: T) => {
      set.add(callback);
      return () => void set.delete(callback);
    };

    let recognition: Recognition;
    let wanted = true;

    const session: DictationAdapter.Session = {
      status: { type: "starting" },
      stop: async () => {
        wanted = false;
        recognition.stop();
        const deadline = Date.now() + STOP_TIMEOUT_MS;
        while (session.status.type !== "ended") {
          if (Date.now() >= deadline) {
            session.status = { type: "ended", reason: "cancelled" };
            recognition.abort();
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      cancel: () => {
        wanted = false;
        recognition.abort();
      },
      onSpeechStart: on(started),
      onSpeechEnd: on(ended),
      onSpeech: on(heard),
    };

    const begin = (local: boolean) => {
      const r = new Recognition();
      recognition = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      if (local) r.processLocally = true;
      let fellBack = false;
      let final = "";
      let interim = "";

      r.addEventListener("start", () => {
        if (session.status.type === "starting") session.status = { type: "running" };
      });
      r.addEventListener("speechstart", () => started.forEach((cb) => cb()));
      r.addEventListener("result", (event) => {
        const results = Array.from((event as ResultEvent).results);
        const text = (finals: boolean) => results.filter((x) => x.isFinal === finals).map((x) => x[0]?.transcript ?? "").join("");
        // Every event carries the whole session so far. Commit only the final text not seen yet.
        const done = text(true);
        if (done.length > final.length) {
          const fresh = done.slice(final.length);
          final = done;
          heard.forEach((cb) => cb({ transcript: fresh.trim(), isFinal: true }));
        }
        const next = text(false);
        if (next || interim) heard.forEach((cb) => cb({ transcript: next.trim(), isFinal: false }));
        if ((done + next).trim()) this.options.onHeard?.();
        interim = next;
      });
      r.addEventListener("error", (event) => {
        const code = (event as ErrorEvent).error;
        // On-device can still refuse (pack removed, policy). Retry once with the browser service.
        if (local && code === "service-not-allowed") {
          fellBack = true;
          this.local.set(lang, "unavailable");
          return;
        }
        if (session.status.type === "ended") return;
        session.status = { type: "ended", reason: code === "aborted" ? "cancelled" : "error" };
        if (code !== "aborted") this.options.onError?.(ERRORS[code] ?? "failed");
      });
      r.addEventListener("end", () => {
        if (fellBack && wanted && session.status.type !== "ended") return begin(false);
        if (session.status.type !== "ended") session.status = { type: "ended", reason: "stopped" };
        ended.forEach((cb) => cb({ transcript: final }));
      });

      // The composer sees the ended status on its next poll, so a refused start shows a notice, not a crash.
      try {
        r.start();
      } catch {
        session.status = { type: "ended", reason: "error" };
        this.options.onError?.("failed");
      }
    };

    begin(this.isLocal(lang));
    return session;
  }
}
