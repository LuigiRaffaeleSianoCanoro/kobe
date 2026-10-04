"use client";

import { useSyncExternalStore } from "react";
import { publishCoaching } from "./coaching-memory";
import { DEFAULT_TOGGLES, isLiveConnector, readToggleStorage, sanitizeToggles, writeToggleStorage } from "./connectors";
import { ASSIST_XP, FEED, PLAYS, SEED_ROSTER, type DraftChannel, type FeedItem, type Person, type PlayId } from "./data";
import type { TouchNote } from "./highlights";
import { PlanWrite, insertPlanRecord, planIdReuse, plansFromStoredJson, recordSupports, samePlan, withoutPlan, type Plan } from "./plans";
import type { Season, SeasonEvent } from "./season";
import { NOTE_MAX, TAPE_STORAGE_KEY, cleanNote, parseStoredCoaching } from "./tape";
import { dropFailedTouch, newestTouches, recordSavedBody, rememberTouch } from "./touch-log";

export type PlanStorage = "browser" | "postgres" | "session";
const PLAN_KEY = "kobe.plans.v1";

export type Alert = FeedItem & { id: number; visible: boolean; auto?: boolean };
export type Floater = { id: number; text: string };

type Coaching = Record<string, { note: string; at: string }>;

type GameState = {
  xp: number;
  assists: number;
  streak: number;
  activeToday: boolean;
  plays: Record<PlayId, boolean>;
  people: Record<string, Person>;
  logged: Record<string, boolean>;
  sent: Record<string, boolean>;
  toggles: Record<string, boolean>;
  touches: TouchNote[];
  record: string | null;
  tape: string | null;
  coaching: Coaching;
  modal: null | "sources" | "channels" | "highlights" | "roster";
  alerts: Alert[];
  floaters: Floater[];
  plans: Plan[];
  planStorage: PlanStorage;
  // Read out by screen readers when an import finishes.
  notice: string;
};

const NO_PLAYS: Record<PlayId, boolean> = { maya: false, marcus: false, dev: false };
const byId = (people: Person[]) => Object.fromEntries(people.map((p) => [p.id, p]));
const TOUCH_KEY = "kobe.touches.v1";

function initialState(): GameState {
  return {
    xp: 180,
    assists: 12,
    streak: 6,
    activeToday: false,
    plays: { ...NO_PLAYS },
    people: byId(SEED_ROSTER),
    logged: {},
    sent: {},
    toggles: { ...DEFAULT_TOGGLES },
    touches: [],
    record: null,
    tape: null,
    coaching: {},
    modal: null,
    alerts: [],
    floaters: [],
    plans: [],
    planStorage: "browser",
    notice: "",
  };
}

let state: GameState = initialState();
let serverIds = new Set(SEED_ROSTER.map((person) => person.id));

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
function sync(event?: SeasonEvent, onFail?: () => void, onOk?: () => void) {
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
    onOk?.();
    if (inflight === 0) applySeason(season);
  });
}

let tapeGen = 0;

function kept(people: Record<string, Person>, coaching: Coaching): Coaching {
  const allowed = new Set(Object.keys(people));
  const next: Coaching = {};
  for (const [id, value] of Object.entries(coaching)) {
    if (allowed.has(id)) next[id] = value;
  }
  publishCoaching(Object.fromEntries(Object.entries(next).map(([id, value]) => [id, value.note])));
  return next;
}

function readLocal(): Coaching {
  try {
    const raw = localStorage.getItem(TAPE_STORAGE_KEY);
    return raw ? parseStoredCoaching(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeLocal(coaching: Coaching) {
  try {
    localStorage.setItem(TAPE_STORAGE_KEY, JSON.stringify(coaching));
    return true;
  } catch {
    return false;
  }
}

function readStoredTouches(): TouchNote[] {
  try {
    const raw = localStorage.getItem(TOUCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Partial<TouchNote>;
      if (!row.personId || !row.at || !row.body) return [];
      return [{ personId: row.personId, channel: row.channel ?? "", body: row.body, at: row.at }];
    });
  } catch {
    return [];
  }
}

function writeStoredTouches(touches: TouchNote[]) {
  try {
    localStorage.setItem(TOUCH_KEY, JSON.stringify(touches));
  } catch {
    // The note still shows until reload when the browser rejects the write.
  }
}

function tapeAlert(ok: boolean, title: string, body: string) {
  game.pushAlert({ at: 0, kind: "TAPE", source: ok ? "ROSTER" : "THIS BROWSER", color: ok ? "#3DBE8B" : "#E0712A", title, body, auto: true });
}

async function pushTape(personId: string, note: string) {
  const res = await fetch("/api/tape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId, note }),
  }).catch(() => null);
  return !!res?.ok;
}

let tapeWrite: Promise<unknown> = Promise.resolve();
function enqueueTape(task: () => Promise<unknown>) {
  tapeWrite = tapeWrite.then(task, task);
}

async function pullTape(people: Record<string, Person>) {
  const gen = ++tapeGen;
  const res = await fetch("/api/tape", { cache: "no-store" }).catch(() => null);
  if (!res?.ok || gen !== tapeGen) return;
  const data = (await res.json().catch(() => null)) as { notes?: { personId?: string; note?: string; at?: string }[] } | null;
  const incoming: Coaching = {};
  for (const row of data?.notes ?? []) {
    if (!row || typeof row.personId !== "string" || typeof row.note !== "string") continue;
    const cleaned = cleanNote(row.note);
    if (!cleaned.ok) continue;
    incoming[row.personId] = { note: cleaned.note, at: typeof row.at === "string" ? row.at : new Date().toISOString() };
  }
  if (gen !== tapeGen) return;
  const localOnly = Object.entries(state.coaching).filter(([id]) => !incoming[id]);
  const coaching = kept(people, { ...state.coaching, ...incoming });
  writeLocal(coaching);
  set({ coaching });
  for (const [personId, value] of localOnly) enqueueTape(() => pushTape(personId, value.note));
}

let askImpl: (text: string) => void = () => {};
export const registerAsk = (fn: (text: string) => void) => {
  askImpl = fn;
};

export function rosterNow(): Person[] {
  return Object.values(state.people);
}

export function sourceToggles(): Record<string, boolean> {
  return { ...state.toggles };
}

export type SaveResult = { status: "saved" | "duplicate" } | { status: "rejected"; message: string };

let planEpoch = 0;

function readStoredPlans(): { plans: Plan[]; blocked: boolean } {
  if (typeof window === "undefined") return { plans: [], blocked: false };
  try {
    const plans = plansFromStoredJson(localStorage.getItem(PLAN_KEY));
    if (plans === null) return { plans: [], blocked: true };
    return { plans, blocked: false };
  } catch {
    return { plans: [], blocked: true };
  }
}

// Re-read inside the lock so a second tab cannot overwrite plans the first tab just saved.
function withPlanLock<T>(task: () => T): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(task());
  return locks.request(PLAN_KEY, () => task());
}

type PlanWriteResult =
  | { kind: "saved" | "duplicate"; plans: Plan[] }
  | { kind: "conflict" }
  | { kind: "blocked"; plans: Plan[] | null };

function commitPlanWrite(plan: Plan): PlanWriteResult {
  const read = readStoredPlans();
  if (read.blocked) return { kind: "blocked", plans: null };
  const merged = insertPlanRecord(read.plans, plan);
  if (merged.status === "conflict") return { kind: "conflict" };
  if (merged.status === "duplicate") return { kind: "duplicate", plans: merged.plans };
  if (!writeStoredPlans(merged.plans)) return { kind: "blocked", plans: read.plans };
  return { kind: "saved", plans: merged.plans };
}

function commitPlanRemoval(id: string): { ok: true; plans: Plan[] } | { ok: false; plans: Plan[] | null } {
  const read = readStoredPlans();
  if (read.blocked) return { ok: false, plans: null };
  const next = withoutPlan(read.plans, id);
  if (!writeStoredPlans(next)) return { ok: false, plans: read.plans };
  return { ok: true, plans: next };
}

function writeStoredPlans(plans: Plan[]): boolean {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
    return true;
  } catch {
    return false;
  }
}

function knownPlans(plans: Plan[]): Plan[] {
  return plans.filter((plan) => state.people[plan.personId]);
}

function notSaved(title: string, body: string) {
  game.pushAlert({ at: 0, kind: "NOT SAVED", source: "RECORD", color: "#E5484D", title, body, auto: true });
}

type LoggedDraft = { personId?: string; to: string; channel: DraftChannel; body: string; copied: boolean };
type SentDraft = { personId?: string; to: string; channel: DraftChannel; body: string };

export const game = {
  reset() {
    persisted = false;
    serverIds = new Set(SEED_ROSTER.map((person) => person.id));
    state = initialState();
    publishCoaching({});
    listeners.forEach((listener) => listener());
  },

  isSent: (key: string) => !!state.sent[key],
  ask: (text: string) => askImpl(text),

  load(roster: Person[], withDatabase: boolean, touches: TouchNote[] = []) {
    persisted = withDatabase;
    serverIds = new Set(roster.map((person) => person.id));
    const people = byId(roster);
    const coaching = kept(people, readLocal());
    const mergedTouches = newestTouches([...touches, ...readStoredTouches()]);
    if (withDatabase) {
      set({ people, planStorage: "postgres", coaching, touches: mergedTouches });
      sync();
      void refreshPlans();
      void pullTape(people);
      return;
    }
    const stored = readStoredPlans();
    set({
      people,
      plans: stored.plans.filter((plan) => people[plan.personId]),
      planStorage: stored.blocked ? "session" : "browser",
      coaching,
      touches: mergedTouches,
    });
    sync();
  },
  // After a WhatsApp import: everyone in the returned roster is stored on the server, including new contacts.
  mergeServerRoster(roster: Person[]) {
    for (const person of roster) serverIds.add(person.id);
    game.mergePeople(roster);
  },
  notify: (notice: string) => set({ notice }),

  mergePeople(people: Person[]) {
    set((current) => {
      const next = { ...current.people };
      for (const person of people) {
        if (!person.id || !person.name.trim()) continue;
        next[person.id] = person;
      }
      return { people: next };
    });
  },

  async savePlan(input: Plan): Promise<SaveResult> {
    const parsed = PlanWrite.safeParse(input);
    if (!parsed.success) return { status: "rejected", message: parsed.error.issues[0]?.message ?? "That plan can't be saved." };
    const plan = parsed.data;
    const person = state.people[plan.personId];
    if (!person) return { status: "rejected", message: "That person isn't on the roster." };
    if (!recordSupports(person, plan.condition)) return { status: "rejected", message: `${person.name}'s record doesn't have that, so I won't invent it.` };
    const byId = state.plans.find((item) => item.id === plan.id);
    if (byId) return planIdReuse(byId, plan) === "duplicate" ? { status: "duplicate" } : { status: "rejected", message: "That plan id is already on a different record." };
    const existing = state.plans.find((item) => samePlan(item, plan));
    if (existing) return { status: "duplicate" };

    planEpoch++;
    const prev = state.plans;
    set({ plans: [...prev, plan] });
    if (!persisted) {
      if (state.planStorage === "session") return { status: "saved" };
      const result = await withPlanLock(() => commitPlanWrite(plan));
      if (result.kind === "blocked") {
        set({ plans: result.plans ? knownPlans(result.plans) : prev, planStorage: "session" });
        notSaved("Stored for this session", "This browser blocked saving the trigger onto their record.");
        return { status: "rejected", message: "This browser blocked saving the trigger onto their record." };
      }
      if (result.kind === "conflict") {
        set({ plans: prev });
        return { status: "rejected", message: "That plan id is already on a different record." };
      }
      set({ plans: knownPlans(result.plans) });
      return { status: result.kind === "duplicate" ? "duplicate" : "saved" };
    }

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
    planEpoch++;
    const prev = state.plans;
    if (!prev.some((plan) => plan.id === id)) return;
    set({ plans: prev.filter((plan) => plan.id !== id) });
    if (!persisted) {
      if (state.planStorage === "session") return;
      const result = await withPlanLock(() => commitPlanRemoval(id));
      if (!result.ok) {
        set({ plans: result.plans ? knownPlans(result.plans) : prev, planStorage: "session" });
        notSaved("Couldn't remove it", "This browser blocked updating their record.");
        return;
      }
      set({ plans: knownPlans(result.plans) });
      return;
    }
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

  noteCopied({ personId, channel, body }: { personId?: string; channel: DraftChannel; body: string }) {
    if (!personId || !body.trim()) return;
    const touch: TouchNote = { personId, channel, body: body.trim(), at: new Date().toISOString() };
    set((current) => {
      const touches = rememberTouch(current.touches, touch);
      writeStoredTouches(touches);
      return { touches };
    });
  },

  // Copying a draft does not send it. Rapport moves only after a live send that the database accepts.
  recordSent(key: string, { personId, to, channel, body }: SentDraft) {
    if (state.sent[key]) return;
    const before = personId ? state.people[personId] : undefined;
    const addedHere = persisted && !!personId && !serverIds.has(personId);
    const touch = before && body.trim() ? { personId: before.id, channel, body: body.trim(), at: new Date().toISOString() } : null;
    if (addedHere) {
      set((current) => {
        const touches = rememberTouch(current.touches, touch);
        writeStoredTouches(touches);
        return { sent: { ...current.sent, [key]: true }, touches };
      });
      game.pushAlert({
        at: 0,
        kind: "NOT SAVED",
        source: "SEASON",
        color: "#E5484D",
        title: `Couldn't update ${to}'s record`,
        body: recordSavedBody(true, personId, serverIds),
        auto: true,
      });
      return;
    }
    const startsDay = !state.activeToday;
    set((current) => {
      const touches = rememberTouch(current.touches, touch);
      writeStoredTouches(touches);
      return {
        sent: { ...current.sent, [key]: true },
        logged: { ...current.logged, [key]: true },
        assists: current.assists + 1,
        ...markActive(current),
        people: before ? { ...current.people, [before.id]: { ...before, rapport: Math.min(99, before.rapport + 3), last: `${channel} · just now` } } : current.people,
        touches,
      };
    });
    game.award(ASSIST_XP, "ASSIST");
    const savedBody = recordSavedBody(persisted, personId, serverIds);
    if (!persisted) {
      game.pushAlert({ at: 0, kind: "SENT", source: channel.toUpperCase(), color: "#3DBE8B", title: `Message sent to ${to}`, body: savedBody, auto: true });
    } else {
      sync(
        { type: "assist", personId, channel, body },
        () => {
          set((current) => {
            const touches = dropFailedTouch(current.touches, touch);
            writeStoredTouches(touches);
            return {
              sent: { ...current.sent, [key]: false },
              logged: { ...current.logged, [key]: false },
              xp: current.xp - ASSIST_XP,
              assists: current.assists - 1,
              people: before ? { ...current.people, [before.id]: before } : current.people,
              touches,
              ...(startsDay ? { streak: current.streak - 1, activeToday: false } : {}),
            };
          });
          game.pushAlert({
            at: 0,
            kind: "NOT SAVED",
            source: "SEASON",
            color: "#E5484D",
            title: `Couldn't update ${to}'s record`,
            body: "The send stood. Their record was not updated.",
            auto: true,
          });
        },
        () => {
          game.pushAlert({ at: 0, kind: "SENT", source: channel.toUpperCase(), color: "#3DBE8B", title: `Message sent to ${to}`, body: savedBody, auto: true });
        },
      );
    }
    if (personId === "maya" || personId === "dev") game.completePlay(personId);
  },

  // Kept for callers that still log a copied draft. A database rejection never says the record was updated.
  logDraft(key: string, draft: LoggedDraft) {
    if (draft.copied) {
      game.noteCopied(draft);
      return;
    }
    game.recordSent(key, draft);
  },

  hydrateToggles() {
    const stored = readToggleStorage();
    if (stored) set({ toggles: stored });
  },

  toggleSource(id: string) {
    if (isLiveConnector(id)) return;
    set((current) => {
      const toggles = sanitizeToggles({ ...current.toggles, [id]: !current.toggles[id] });
      writeToggleStorage(toggles);
      return { toggles };
    });
  },

  openRecord: (record: string | null) => set(record ? { record, tape: null } : { record }),
  openModal: (modal: GameState["modal"]) => set({ modal }),
  openTape(personId?: string) {
    const id = personId && state.people[personId] ? personId : Object.values(state.people)[0]?.id;
    if (!id) return;
    set({ tape: id, record: null, modal: null });
  },
  closeTape: () => set({ tape: null }),
  saveCoaching(personId: string, raw: string) {
    const person = state.people[personId];
    if (!person) return;
    const cleaned = cleanNote(raw);
    if (!cleaned.ok && !cleaned.empty) {
      tapeAlert(false, `Coaching for ${person.name} is too long`, `Keep it under ${NOTE_MAX} characters.`);
      return;
    }
    tapeGen++;
    const coaching = { ...state.coaching };
    if (cleaned.ok) coaching[personId] = { note: cleaned.note, at: new Date().toISOString() };
    else delete coaching[personId];
    const next = kept(state.people, coaching);
    const stored = writeLocal(next);
    set({ coaching: next });
    const title = cleaned.ok ? `Coaching saved on ${person.name}` : `Coaching cleared on ${person.name}`;
    if (!persisted) {
      tapeAlert(
        stored,
        title,
        stored ? "Kobe will use it the next time this situation comes up. Saved in this browser." : "This browser blocked the save. The note stays until you reload.",
      );
      return;
    }
    const note = cleaned.ok ? cleaned.note : "";
    enqueueTape(async () => {
      const ok = await pushTape(personId, note);
      tapeAlert(ok, title, ok ? "Kobe will use it the next time this situation comes up." : "Kept in this browser. The database did not store it.");
    });
  },

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
