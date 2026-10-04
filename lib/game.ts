"use client";

import { useSyncExternalStore } from "react";
import { ASSIST_XP, FEED, PLAYS, SEED_ROSTER, type DraftChannel, type FeedItem, type Person, type PlayId } from "./data";
import { PlanWrite, applyPlanRemove, applyPlanSave, parseStoredPlans, planIdReuse, plansFromStoredJson, recordSupports, samePlan, type Plan } from "./plans";
import type { Season, SeasonEvent } from "./season";

export type PlanStorage = "browser" | "postgres" | "session";
const PLAN_KEY = "kobe.plans.v1";

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
  modal: null | "sources" | "channels";
  alerts: Alert[];
  floaters: Floater[];
  plans: Plan[];
  planStorage: PlanStorage;
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
  alerts: [],
  floaters: [],
  plans: [],
  planStorage: "browser",
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

export function rosterNow(): Person[] {
  return Object.values(state.people);
}

export type SaveResult = { status: "saved" | "duplicate" } | { status: "rejected"; message: string };

let planEpoch = 0;

function readStoredPlans(): { plans: Plan[]; blocked: boolean } {
  if (typeof window === "undefined") return { plans: [], blocked: false };
  try {
    return { plans: parseStoredPlans(localStorage.getItem(PLAN_KEY)), blocked: false };
  } catch {
    return { plans: [], blocked: true };
  }
}

type StoredPlanRead = { plans: Plan[] } | { blocked: true } | { unreadable: true };

function readPlansForUpdate(): StoredPlanRead {
  if (typeof window === "undefined") return { blocked: true };
  let raw: string | null;
  try {
    raw = localStorage.getItem(PLAN_KEY);
  } catch {
    return { blocked: true };
  }
  if (raw == null) return { plans: [] };
  const plans = plansFromStoredJson(raw);
  if (!plans) return { unreadable: true };
  return { plans };
}

function writeStoredPlans(plans: Plan[]): boolean {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
    return true;
  } catch {
    return false;
  }
}

function withPlanLock<T>(work: () => T): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return Promise.resolve().then(work);
  return locks.request(PLAN_KEY, work);
}

let watchingPlans = false;

function watchPlanStorage() {
  if (watchingPlans || typeof window === "undefined") return;
  watchingPlans = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== PLAN_KEY || persisted || state.planStorage === "session") return;
    const read = readPlansForUpdate();
    if (!("plans" in read)) return;
    set({ plans: knownPlans(read.plans) });
  });
}

function knownPlans(plans: Plan[]): Plan[] {
  return plans.filter((plan) => state.people[plan.personId]);
}

function notSaved(title: string, body: string) {
  game.pushAlert({ at: 0, kind: "NOT SAVED", source: "RECORD", color: "#E5484D", title, body, auto: true });
}

function rememberPlans(plans: Plan[], storage: GameState["planStorage"] = state.planStorage) {
  planEpoch++;
  set({ plans: knownPlans(plans), planStorage: storage });
}

function savePlanInMemory(plan: Plan): SaveResult {
  const outcome = applyPlanSave(state.plans, plan);
  if (outcome.status === "rejected") return { status: "rejected", message: outcome.message };
  if (outcome.status === "duplicate") return { status: "duplicate" };
  rememberPlans(outcome.plans);
  return { status: "saved" };
}

function commitPlanSave(plan: Plan): SaveResult {
  const read = readPlansForUpdate();
  if ("blocked" in read) {
    const outcome = savePlanInMemory(plan);
    if (outcome.status === "saved") {
      set({ planStorage: "session" });
      notSaved("Stored for this session", "This browser blocked saving the trigger onto their record.");
    }
    return outcome;
  }
  if ("unreadable" in read) {
    notSaved("Couldn't save the game plan", "This browser's saved plans could not be read.");
    return { status: "rejected", message: "Couldn't save that on their record." };
  }
  const outcome = applyPlanSave(read.plans, plan);
  if (outcome.status === "duplicate") {
    rememberPlans(outcome.plans);
    return { status: "duplicate" };
  }
  if (outcome.status === "rejected") {
    rememberPlans(outcome.plans);
    return { status: "rejected", message: outcome.message };
  }
  if (!writeStoredPlans(outcome.plans)) {
    rememberPlans(outcome.plans, "session");
    notSaved("Stored for this session", "This browser blocked saving the trigger onto their record.");
    return { status: "saved" };
  }
  rememberPlans(outcome.plans);
  return { status: "saved" };
}

async function savePlanLocally(plan: Plan): Promise<SaveResult> {
  if (state.planStorage === "session") return savePlanInMemory(plan);
  try {
    return await withPlanLock(() => commitPlanSave(plan));
  } catch {
    notSaved("Couldn't save the game plan", "This browser could not update their record.");
    return { status: "rejected", message: "Couldn't save that on their record." };
  }
}

function commitPlanRemove(id: string): void {
  const read = readPlansForUpdate();
  if ("blocked" in read) {
    rememberPlans(applyPlanRemove(state.plans, id), "session");
    notSaved("Couldn't remove it", "This browser blocked updating their record.");
    return;
  }
  if ("unreadable" in read) {
    notSaved("Couldn't remove it", "This browser's saved plans could not be read.");
    return;
  }
  const next = applyPlanRemove(read.plans, id);
  if (!writeStoredPlans(next)) {
    notSaved("Couldn't remove it", "This browser blocked updating their record.");
    return;
  }
  rememberPlans(next);
}

async function removePlanLocally(id: string): Promise<void> {
  if (state.planStorage === "session") {
    rememberPlans(applyPlanRemove(state.plans, id));
    return;
  }
  try {
    await withPlanLock(() => commitPlanRemove(id));
  } catch {
    notSaved("Couldn't remove it", "This browser could not update their record.");
  }
}

type LoggedDraft = { personId?: string; to: string; channel: DraftChannel; body: string; copied: boolean };

export const game = {
  ask: (text: string) => askImpl(text),

  load(roster: Person[], withDatabase: boolean) {
    persisted = withDatabase;
    const people = byId(roster);
    if (withDatabase) {
      set({ people, planStorage: "postgres" });
      sync();
      void refreshPlans();
      return;
    }
    watchPlanStorage();
    const stored = readStoredPlans();
    set({
      people,
      plans: stored.plans.filter((plan) => people[plan.personId]),
      planStorage: stored.blocked ? "session" : "browser",
    });
    sync();
  },

  async savePlan(input: Plan): Promise<SaveResult> {
    const parsed = PlanWrite.safeParse(input);
    if (!parsed.success) return { status: "rejected", message: parsed.error.issues[0]?.message ?? "That plan can't be saved." };
    const plan = parsed.data;
    const person = state.people[plan.personId];
    if (!person) return { status: "rejected", message: "That person isn't on the roster." };
    if (!recordSupports(person, plan.condition)) return { status: "rejected", message: `${person.name}'s record doesn't have that, so I won't invent it.` };
    if (!persisted) return savePlanLocally(plan);

    const byId = state.plans.find((item) => item.id === plan.id);
    if (byId) return planIdReuse(byId, plan) === "duplicate" ? { status: "duplicate" } : { status: "rejected", message: "That plan id is already on a different record." };
    const existing = state.plans.find((item) => samePlan(item, plan));
    if (existing) return { status: "duplicate" };

    planEpoch++;
    const prev = state.plans;
    set({ plans: [...prev, plan] });

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      const body = (await res.json().catch(() => null)) as { plan?: unknown; error?: string; duplicate?: boolean } | null;
      if (!res.ok) {
        planEpoch++;
        set({ plans: prev });
        const message = body?.error || "Couldn't save that on their record.";
        notSaved("Couldn't save the game plan", message);
        return { status: "rejected", message };
      }
      const saved = PlanWrite.safeParse(body?.plan);
      if (!saved.success || planIdReuse(saved.data, plan) === "conflict") {
        planEpoch++;
        set({ plans: prev });
        notSaved("Couldn't save the game plan", "Their record did not keep it.");
        return { status: "rejected", message: "Couldn't save that on their record." };
      }
      planEpoch++;
      set((current) => ({ plans: [...current.plans.filter((item) => item.id !== plan.id && item.id !== saved.data.id), saved.data] }));
      return { status: body?.duplicate ? "duplicate" : "saved" };
    } catch {
      planEpoch++;
      set({ plans: prev });
      notSaved("Couldn't save the game plan", "Their record did not keep it.");
      return { status: "rejected", message: "Couldn't save that on their record." };
    }
  },

  async removePlan(id: string): Promise<void> {
    if (!state.plans.some((plan) => plan.id === id)) return;
    if (!persisted) return removePlanLocally(id);
    planEpoch++;
    const prev = state.plans;
    set({ plans: prev.filter((plan) => plan.id !== id) });
    try {
      const res = await fetch("/api/plans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        planEpoch++;
        set({ plans: prev });
        notSaved("Couldn't remove it", "Their record still has that trigger or routine.");
      }
    } catch {
      planEpoch++;
      set({ plans: prev });
      notSaved("Couldn't remove it", "Their record still has that trigger or routine.");
    }
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
    const startsDay = !state.activeToday;
    set((s) => ({
      logged: { ...s.logged, [key]: true },
      assists: s.assists + 1,
      ...markActive(s),
      people: before ? { ...s.people, [before.id]: { ...before, rapport: Math.min(99, before.rapport + 3), last: `${channel} · just now` } } : s.people,
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

async function refreshPlans() {
  if (!persisted) return;
  const epoch = planEpoch;
  try {
    const res = await fetch("/api/plans", { cache: "no-store" });
    if (epoch !== planEpoch) return;
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { plans?: unknown };
    if (epoch !== planEpoch) return;
    const plans = Array.isArray(body.plans) ? knownPlans(body.plans.flatMap((item) => {
      const parsed = PlanWrite.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })) : [];
    if (epoch !== planEpoch) return;
    set({ plans });
  } catch {
    if (epoch !== planEpoch) return;
    notSaved("Couldn't read triggers and routines", "The records are still here. Try again in a moment.");
  }
}
