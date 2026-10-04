"use client";

import { useSyncExternalStore } from "react";
import { KobeDictationAdapter, type DictationError } from "./dictation";

export type Lang = "es" | "en";

type VoiceState = { lang: Lang; notice: string | null };

export const LANG_NAMES: Record<Lang, string> = { es: "Spanish", en: "English" };

const KEY = "kobe.dictation.lang";

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

const SERVER: VoiceState = { lang: "en", notice: null };
let state: VoiceState = typeof window === "undefined" ? SERVER : { lang: initialLang(), notice: null };
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
};

// One adapter for both runtimes. Undefined on the server and where Web Speech is missing (Firefox),
// which hides the mic.
export const dictation = KobeDictationAdapter.isSupported()
  ? new KobeDictationAdapter({
      language: () => tagFor(state.lang),
      onError: (error) => voice.notify(NOTICES[error](state.lang)),
    })
  : undefined;
