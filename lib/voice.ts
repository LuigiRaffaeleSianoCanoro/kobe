"use client";

import { useSyncExternalStore } from "react";
import { KobeDictationAdapter, type DictationError } from "./dictation";
import { KobeSpeechAdapter, guessLang } from "./speech";
import { DEFAULT_WHISPER, WhisperDictationAdapter, type WhisperConfig, type WhisperLoad } from "./whisper";

export type Lang = "es" | "en";

type VoiceState = { lang: Lang; notice: string | null; muted: boolean; private: boolean; download: WhisperLoad };

export const LANG_NAMES: Record<Lang, string> = { es: "Spanish", en: "English" };

const KEY = "kobe.dictation.lang";
const MUTED_KEY = "kobe.voice.muted";
const PRIVATE_KEY = "kobe.voice.private";

const NOTICES: Record<DictationError, (lang: Lang) => string> = {
  denied: () => "The microphone is blocked for this page. Allow it from the address bar, then tap the mic again.",
  "no-mic": () => "No microphone found. Plug one in, or type instead.",
  "no-speech": () => "Didn't catch that. Tap the mic and try again.",
  network: () => "Dictation needs a connection right now. Type instead, or try again.",
  language: (lang) => `This browser can't transcribe ${LANG_NAMES[lang]}. Switch language or type.`,
  unavailable: () => "This browser's speech service is turned off. Type instead.",
  model: () => "Couldn't get the private speech model. Check the connection, then tap the mic again.",
  failed: () => "Dictation stopped. Tap the mic to try again.",
};

// Recognition gets the browser's own regional tag when it has one, so es-AR stays es-AR.
export function tagFor(lang: Lang, preferred: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages) {
  return preferred.find((tag) => tag.toLowerCase().split("-")[0] === lang) ?? (lang === "es" ? "es-ES" : "en-US");
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {}
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function saved(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {}
}

const SERVER: VoiceState = { lang: "en", notice: null, muted: false, private: false, download: null };
let state: VoiceState =
  typeof window === "undefined" ? SERVER : { ...SERVER, lang: initialLang(), muted: saved(MUTED_KEY), private: saved(PRIVATE_KEY) };
const listeners = new Set<() => void>();

function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useVoice<T>(selector: (s: VoiceState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
    () => selector(SERVER),
  );
}

const subscribeNothing = () => () => {};
/** False on the server and during hydration, so browser-only controls never cause a mismatch. */
export const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

// Voice mode: a message sent after the mic heard words is a voice turn, and only its reply is read
// aloud on its own. Typed turns stay silent unless the speaker on a message is tapped.
let dictated = false;
let voiceTurn = false;
let whisperConfig: WhisperConfig = DEFAULT_WHISPER;

export const voice = {
  setLang(lang: Lang) {
    set({ lang, notice: null });
    try {
      localStorage.setItem(KEY, lang);
    } catch {}
  },
  notify(notice: string | null) {
    clearTimeout(noticeTimer);
    set({ notice });
    if (notice) noticeTimer = setTimeout(() => set({ notice: null }), 7000);
  },
  setMuted(muted: boolean) {
    set({ muted });
    save(MUTED_KEY, muted);
    if (muted) speech?.stop();
  },
  /** Private mode: Whisper on this device. Turning it on is the opt-in, so the download starts here. */
  setPrivate(on: boolean) {
    set({ private: on, notice: null });
    save(PRIVATE_KEY, on);
    if (!on || !whisper) return;
    voice.notify("Private dictation transcribes on this device. The first time, it downloads a speech model (around 100 MB).");
    whisper.load().then(
      () => state.private && voice.notify("Private dictation is ready. Your voice stays on this device."),
      () => state.private && voice.notify(NOTICES.model(state.lang)),
    );
  },
  configureWhisper(config: WhisperConfig) {
    whisperConfig = config;
  },
  /** A message was sent: Kobe stops talking, and the turn is a voice turn if the mic heard words for it. */
  send() {
    speech?.stop();
    voiceTurn = dictated;
    dictated = false;
  },
  isVoiceTurn: () => voiceTurn,
  /** Read the finished reply aloud on its own: a voice turn, not muted. */
  shouldSpeakReply: () => voiceTurn && !state.muted,
};

// Spoken in the reply's own language, falling back to the dictation language.
export const speech = KobeSpeechAdapter.isSupported()
  ? new KobeSpeechAdapter({ language: (text) => tagFor(guessLang(text, state.lang)) })
  : undefined;

const hooks = {
  // Kobe hushes the moment the mic opens, so it never talks over Luigi or into the mic.
  onStart: () => speech?.stop(),
  // Only words the mic heard make the next message a voice turn; a tap just to hush Kobe doesn't.
  onHeard: () => {
    dictated = true;
  },
  onError: (error: DictationError) => voice.notify(NOTICES[error](state.lang)),
};

// The browser's recognizer. Undefined on the server and where Web Speech is missing (Firefox).
const web = KobeDictationAdapter.isSupported() ? new KobeDictationAdapter({ language: () => tagFor(state.lang), ...hooks }) : undefined;

// Whisper in a worker, for private mode. Undefined where Web Workers, WASM or AudioWorklet are missing.
const whisper = WhisperDictationAdapter.isSupported()
  ? new WhisperDictationAdapter({ language: () => state.lang, config: () => whisperConfig, onLoad: (download) => set({ download }), ...hooks })
  : undefined;

export const canGoPrivate = !!whisper;

/** Whether the mic works right now: Whisper in private mode, the browser's recognizer otherwise. */
export const canDictate = (s: { private: boolean }) => (s.private ? !!whisper : !!web);

// One adapter for both runtimes; each tap picks the engine. Undefined when neither exists.
export const dictation =
  web || whisper
    ? {
        listen: () => {
          const engine = state.private ? whisper : web;
          if (!engine) throw new Error("No dictation engine for this mode.");
          return engine.listen();
        },
        prepare: () => web?.prepare() ?? Promise.resolve(),
        isLocal: () => state.private || !!web?.isLocal(),
      }
    : undefined;
