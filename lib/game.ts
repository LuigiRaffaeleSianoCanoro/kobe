"use client";

import { useSyncExternalStore } from "react";
import { FEED, PLAYS, RECORDS, type FeedItem, type PlayId, type RecordId } from "./data";

export type Alert = FeedItem & { id: number; visible: boolean; auto?: boolean };
export type Floater = { id: number; text: string };

type GameState = {
  xp: number;
  assists: number;
  streak: number;
  plays: Record<PlayId, boolean>;
  rapport: Record<RecordId, number>;
  sent: Record<string, boolean>;
  sources: Record<string, boolean>;
  channels: Record<string, boolean>;
  record: RecordId | null;
  modal: null | "sources" | "channels";
  alerts: Alert[];
  floaters: Floater[];
};

let state: GameState = {
  xp: 180,
  assists: 12,
  streak: 6,
  plays: { maya: false, marcus: false, dev: false },
  rapport: Object.fromEntries(Object.entries(RECORDS).map(([k, r]) => [k, r.score])) as Record<RecordId, number>,
  sent: {},
  sources: { gmail: true, gcal: true, instagram: true, fathom: true, agentmail: true },
  channels: {},
  record: null,
  modal: null,
  alerts: [],
  floaters: [],
};

const listeners = new Set<() => void>();
let uid = 0;

function set(patch: Partial<GameState> | ((s: GameState) => Partial<GameState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export function useGame<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
    () => selector(state),
  );
}

function persist(event: Record<string, unknown>) {
  fetch("/api/season", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) }).catch(() => {});
}

let askImpl: (text: string) => void = () => {};
export const registerAsk = (fn: (text: string) => void) => {
  askImpl = fn;
};

export const game = {
  get: () => state,
  ask: (text: string) => askImpl(text),

  pushAlert(a: FeedItem & { auto?: boolean }) {
    const id = ++uid;
    set((s) => ({ alerts: [...s.alerts, { ...a, id, visible: true }] }));
    if (a.auto) setTimeout(() => game.dismiss(id), 4200);
  },
  dismiss(id: number) {
    set((s) => ({ alerts: s.alerts.map((x) => (x.id === id ? { ...x, visible: false } : x)) }));
  },
  clearAlerts() {
    set((s) => ({ alerts: s.alerts.map((x) => ({ ...x, visible: false })) }));
  },

  award(xp: number, label: string) {
    const id = ++uid;
    set((s) => ({ xp: s.xp + xp, floaters: [...s.floaters, { id, text: `+${xp} XP · ${label}` }] }));
    setTimeout(() => set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) })), 1600);
  },
  completePlay(id: PlayId) {
    if (state.plays[id]) return;
    const play = PLAYS.find((p) => p.id === id)!;
    set((s) => ({ plays: { ...s.plays, [id]: true } }));
    game.award(play.xp, "PLAY");
    persist({ type: "play", playId: id, xp: play.xp });
  },

  async hydrate() {
    try {
      const res = await fetch("/api/season");
      const d = await res.json();
      if (!d.persisted) return;
      set((s) => ({
        xp: d.xp,
        assists: d.assists,
        streak: d.streak,
        rapport: { ...s.rapport, ...d.rapport },
        plays: { ...s.plays, ...Object.fromEntries((d.plays as string[]).map((p) => [p, true])) },
      }));
    } catch {
      // Offline or no database: keep the in-memory season.
    }
  },

  sendDraft(key: string, recordId: RecordId | undefined, to: string, channel: string) {
    if (state.sent[key]) return;
    set((s) => ({
      sent: { ...s.sent, [key]: true },
      assists: s.assists + 1,
      rapport: recordId ? { ...s.rapport, [recordId]: Math.min(99, s.rapport[recordId] + 3) } : s.rapport,
    }));
    game.award(15, "ASSIST");
    persist({ type: "assist", personId: recordId, channel, xp: 15 });
    if (recordId === "maya" || recordId === "dev") game.completePlay(recordId);
    game.pushAlert({ at: 0, kind: "ASSIST", source: channel.toUpperCase(), color: "#3DBE8B", title: `Message sent to ${to}`, body: "Logged to their record. Rapport +3.", auto: true });
  },

  openRecord: (record: RecordId | null) => set({ record }),
  openModal: (modal: GameState["modal"]) => set({ modal }),

  toggleSource(id: string, name: string) {
    const on = !state.sources[id];
    set((s) => ({ sources: { ...s.sources, [id]: on } }));
    if (on) game.pushAlert({ at: 0, kind: "SYNCED", source: name.toUpperCase(), color: "#3DBE8B", title: `${name} connected`, body: "Backfilling the last 12 months. New context will show up on records.", auto: true });
  },
  toggleChannel(id: string, name: string) {
    const on = !state.channels[id];
    set((s) => ({ channels: { ...s.channels, [id]: on } }));
    if (on) game.pushAlert({ at: 0, kind: "SYNCED", source: name.toUpperCase(), color: "#3DBE8B", title: `Kobe joined ${name}`, body: "Message Kobe there anytime. Alerts will follow you.", auto: true });
  },

  startFeed() {
    const timers = FEED.map((f) => setTimeout(() => game.pushAlert(f), f.at));
    return () => timers.forEach(clearTimeout);
  },
};
