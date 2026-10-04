"use client";

import { useSyncExternalStore } from "react";
import { KobeDictationAdapter, type DictationError } from "./dictation";
import { KobeSpeechAdapter, guessLang } from "./speech";

export type Lang = "es" | "en";

type VoiceState = { lang: Lang; notice: string | null; muted: boolean };

export const LANG_NAMES: Record<Lang, string> = { es: "Spanish", en: "English" };

const KEY = "kobe.dictation.lang";
const MUTED_KEY = "kobe.voice.muted";

const NOTICES: Record<DictationError, (lang: Lang) => string> = {
  denied: () => "The microphone is blocked for this page. Allow it from the address bar, then tap the mic again.",
  "no-mic": () => "No microphone found. Plug one in, or type instead.",
  "no-speech": () => "Didn't catch that. Tap the mic and try again.",
  network: () => "Dictation needs a connection right now. Type instead, or try again.",
  language: (lang) => `This browser can't transcribe ${LANG_NAMES[lang]}. Switch language or type.`,
  unavailable: () => "This browser's speech service is turned off. Type instead.",
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

function initialMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

const SERVER: VoiceState = { lang: "en", notice: null, muted: false };
let state: VoiceState = typeof window === "undefined" ? SERVER : { lang: initialLang(), notice: null, muted: initialMuted() };
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
    try {
      localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
    } catch {}
    if (muted) speech?.stop();
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

// One adapter for both runtimes. Undefined on the server and where Web Speech is missing (Firefox),
// which hides the mic.
export const dictation = KobeDictationAdapter.isSupported()
  ? new KobeDictationAdapter({
      language: () => tagFor(state.lang),
      // Kobe hushes the moment the mic opens, so it never talks over Luigi or into the mic.
      onStart: () => speech?.stop(),
      // Only words the mic heard make the next message a voice turn; a tap just to hush Kobe doesn't.
      onHeard: () => {
        dictated = true;
      },
      onError: (error) => voice.notify(NOTICES[error](state.lang)),
    })
  : undefined;
