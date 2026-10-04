"use client";

import { useSyncExternalStore } from "react";
import { ASSIST_XP, FEED, PLAYS, SEED_ROSTER, type DraftChannel, type FeedItem, type Person, type PlayId } from "./data";
import type { TouchNote } from "./highlights";
import type { Season, SeasonEvent } from "./season";

export type Alert = FeedItem & { id: number; visible: boolean; auto?: boolean };
export type Floater = { id: number; text: string };

type GameState = {
  xp: number;
  assists: number;
  streak: number;
  activeToday: boolean;
  plays: Record<PlayId, boolean>;
  people: Record<string, Person>;
  logged: Record<string, boolean>;
  record: string | null;
  modal: null | "sources" | "channels" | "highlights";
  touches: TouchNote[];
  alerts: Alert[];
  floaters: Floater[];
};

const NO_PLAYS: Record<PlayId, boolean> = { maya: false, marcus: false, dev: false };
const byId = (people: Person[]) => Object.fromEntries(people.map((p) => [p.id, p]));

let state: GameState = {
  xp: 180,
  assists: 12,
  streak: 6,
  activeToday: false,
  plays: NO_PLAYS,
  people: byId(SEED_ROSTER),
  logged: {},
  record: null,
  modal: null,
  touches: [],
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

// The first assist or play of the day extends the streak. /api/season applies the same rule.
const markActive = (s: GameState) => (s.activeToday ? {} : { streak: s.streak + 1, activeToday: true });

// True only when Postgres is configured and the API is reachable. Otherwise the season lives in memory.
let persisted = false;
let queue = Promise.resolve();
let inflight = 0;

async function request(event?: SeasonEvent): Promise<Season> {
  const res = await fetch(
    "/api/season",
    event ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) } : { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`/api/season ${res.status}`);
  return res.json();
}

function applySeason(d: Season) {
  set((s) => ({
    xp: d.xp,
    assists: d.assists,
    streak: d.streak,
    activeToday: d.activeToday,
    plays: { ...NO_PLAYS, ...Object.fromEntries(d.plays.map((p) => [p, true])) },
    people: Object.fromEntries(Object.entries(s.people).map(([id, p]) => [id, d.people[id] ? { ...p, ...d.people[id] } : p])),
  }));
}

// Requests run one at a time and only the last response is applied. A read that started before
// an award can't roll it back, because the award's own write answers after it.
function sync(event?: SeasonEvent, onFail?: () => void) {
  if (!persisted) return;
  inflight++;
  queue = queue.then(async () => {
    const season = await request(event).catch(() => null);
    inflight--;
    if (!season) {
      onFail?.();
      // Re-read the totals so the HUD drops whatever the server did not keep.
      if (event) sync();
      return;
    }
    if (inflight === 0) applySeason(season);
  });
}

let askImpl: (text: string) => void = () => {};
export const registerAsk = (fn: (text: string) => void) => {
  askImpl = fn;
};

type LoggedDraft = { personId?: string; to: string; channel: DraftChannel; body: string; copied: boolean };

export const game = {
  ask: (text: string) => askImpl(text),

  load(roster: Person[], withDatabase: boolean, touches: TouchNote[] = []) {
    persisted = withDatabase;
    set({ people: byId(roster), touches });
    sync();
  },

  pushAlert(a: FeedItem & { auto?: boolean }) {
    const id = ++uid;
    set((s) => ({ alerts: [...s.alerts, { ...a, id, visible: true }] }));
    if (a.auto) setTimeout(() => game.dismiss(id), 4200);
    return id;
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
    set((s) => ({ plays: { ...s.plays, [id]: true }, ...markActive(s) }));
    game.award(play.xp, "PLAY");
    sync({ type: "play", playId: id }, () => set((s) => ({ plays: { ...s.plays, [id]: false }, xp: s.xp - play.xp })));
  },

  // Kobe can't send messages. The user copies the draft, sends it themselves, and this logs the assist.
  logDraft(key: string, { personId, to, channel, body, copied }: LoggedDraft) {
    if (state.logged[key]) return;
    const before = personId ? state.people[personId] : undefined;
    const beforeTouches = state.touches;
    const startsDay = !state.activeToday;
    const touch = before && body.trim() ? { personId: before.id, channel, body: body.trim(), at: new Date().toISOString() } : null;
    set((s) => ({
      logged: { ...s.logged, [key]: true },
      assists: s.assists + 1,
      ...markActive(s),
      people: before ? { ...s.people, [before.id]: { ...before, rapport: Math.min(99, before.rapport + 3), last: `${channel} · just now` } } : s.people,
      touches: touch ? [...s.touches, touch] : s.touches,
    }));
    game.award(ASSIST_XP, "ASSIST");
    const logged = game.pushAlert({
      at: 0,
      kind: "ASSIST",
      source: channel.toUpperCase(),
      color: "#3DBE8B",
      title: copied ? `Draft for ${to} copied` : `Logged your message to ${to}`,
      body: copied ? `Paste it into ${channel} to send it. Logged to their record.` : "Logged to their record.",
      auto: true,
    });
    sync({ type: "assist", personId, channel, body }, () => {
      game.dismiss(logged);
      set((s) => ({
        logged: { ...s.logged, [key]: false },
        xp: s.xp - ASSIST_XP,
        assists: s.assists - 1,
        people: before ? { ...s.people, [before.id]: before } : s.people,
        touches: beforeTouches,
        ...(startsDay ? { streak: s.streak - 1, activeToday: false } : {}),
      }));
      game.pushAlert({ at: 0, kind: "NOT SAVED", source: "SEASON", color: "#E5484D", title: `Couldn't log your message to ${to}`, body: "Their record was not updated. Try again in a moment.", auto: true });
    });
    if (personId === "maya" || personId === "dev") game.completePlay(personId);
  },

  openRecord: (record: string | null) => set({ record }),
  openModal: (modal: GameState["modal"]) => set({ modal }),

  startFeed() {
    const timers = FEED.map((f) => setTimeout(() => game.pushAlert(f), f.at));
    return () => timers.forEach(clearTimeout);
  },
};
