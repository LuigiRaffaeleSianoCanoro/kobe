import type { SpeechSynthesisAdapter } from "@assistant-ui/react";
import type { Lang } from "./voice";

// Read-aloud on the browser's own voices. assistant-ui's WebSpeechSynthesisAdapter never sets a
// language, so a Spanish reply would be read in an English voice. Voices installed on the device win
// over the browser's network voices, and none of them imitates a real person.

// Accented letters count on their own: \b does not see them as word characters.
const ES = /[¿¡ñáéíóú]|\b(que|de|el|los|las|del|para|por|con|una|esta|tu|su|hoy|mañana|cumple|años)\b/gi;
const EN = /\b(the|and|to|of|you|your|is|are|for|with|this|that|has|have|today|tomorrow|birthday)\b/gi;

/** Which language a reply is in, so a typed English answer isn't read with a Spanish voice. */
export function guessLang(text: string, fallback: Lang): Lang {
  const es = text.match(ES)?.length ?? 0;
  const en = text.match(EN)?.length ?? 0;
  return es === en ? fallback : es > en ? "es" : "en";
}

type Voice = Pick<SpeechSynthesisVoice, "lang" | "localService" | "default">;

/** The best voice for a BCP 47 tag: on the device first, then the exact region, then the default. */
export function pickVoice<V extends Voice>(voices: readonly V[], tag: string): V | undefined {
  const base = tag.toLowerCase().split("-")[0];
  const score = (v: V) => (v.localService ? 4 : 0) + (v.lang.toLowerCase().replace("_", "-") === tag.toLowerCase() ? 2 : 0) + (v.default ? 1 : 0);
  return voices
    .filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base)
    .reduce<V | undefined>((best, v) => (!best || score(v) > score(best) ? v : best), undefined);
}

type Options = {
  /** BCP 47 tag to read this text in. */
  language: (text: string) => string;
};

export class KobeSpeechAdapter implements SpeechSynthesisAdapter {
  private current?: SpeechSynthesisAdapter.Utterance;
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  static isSupported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  /** Silences whatever is being read. Safe to call when nothing is. */
  stop() {
    this.current?.cancel();
  }

  speak(text: string): SpeechSynthesisAdapter.Utterance {
    this.stop();
    const tag = this.options.language(text);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = tag;
    const voice = pickVoice(window.speechSynthesis.getVoices(), tag);
    if (voice) utterance.voice = voice;

    const subscribers = new Set<() => void>();
    const end = (reason: "finished" | "cancelled" | "error", error?: unknown) => {
      if (handle.status.type === "ended") return;
      handle.status = { type: "ended", reason, error };
      if (this.current === handle) this.current = undefined;
      subscribers.forEach((cb) => cb());
    };
    const handle: SpeechSynthesisAdapter.Utterance = {
      status: { type: "starting" },
      cancel: () => {
        if (handle.status.type === "ended") return;
        window.speechSynthesis.cancel();
        end("cancelled");
      },
      subscribe: (callback) => {
        subscribers.add(callback);
        return () => void subscribers.delete(callback);
      },
    };
    utterance.addEventListener("start", () => {
      if (handle.status.type !== "starting") return;
      handle.status = { type: "running" };
      subscribers.forEach((cb) => cb());
    });
    utterance.addEventListener("end", () => end("finished"));
    // Chrome reports its own cancel() as an "interrupted" or "canceled" error.
    utterance.addEventListener("error", (e) => {
      const code = (e as SpeechSynthesisErrorEvent).error;
      end(code === "interrupted" || code === "canceled" ? "cancelled" : "error", code);
    });

    this.current = handle;
    window.speechSynthesis.speak(utterance);
    return handle;
  }
}
