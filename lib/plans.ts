import { z } from "zod";

// A trigger or routine the user sets on a person who is already on the roster.
// It reads that record. It does not connect an inbox, calendar, or social account.
export const PLAN_CONDITIONS = ["birthday", "last_touch", "next_up", "open_loop", "daily", "weekly"] as const;
export type PlanCondition = (typeof PLAN_CONDITIONS)[number];
export type PlanKind = "trigger" | "routine";

export type PlanPerson = {
  id: string;
  name: string;
  birthday: string;
  last: string;
  next: string;
  loop: string;
  prompt?: string;
};

export type Plan = {
  id: string;
  personId: string;
  kind: PlanKind;
  condition: PlanCondition;
  label: string;
  prompt: string;
};

const TRIGGERS = new Set<PlanCondition>(["birthday", "last_touch", "next_up", "open_loop"]);
const ROUTINES = new Set<PlanCondition>(["daily", "weekly"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HORIZON_DAYS = 14;
const SKIP_NAME = new Set([
  "me",
  "my",
  "the",
  "a",
  "an",
  "her",
  "his",
  "their",
  "them",
  "this",
  "that",
  "today",
  "tomorrow",
  "week",
  "day",
  "coffee",
  "birthday",
  "trigger",
  "routine",
  "record",
  "records",
  "game",
  "plan",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "daily",
  "weekly",
  "check",
  "next",
]);

const ACCOUNT =
  /\b(?:connect(?:ed|ion)?|oauth|inbox|webhook|integrations?|e-?mails?|gmail|outlook|icloud|slack|discord|telegram|whatsapp|instagram|linkedin|fathom|zoom|partiful|luma|eventbrite|calendly|tiktok|facebook|threads|google calendar|gcal)\b|\bwhen\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,2}\s+(?:texts?|dms?|messages?|posts?|emails?|calls?)\b/iu;

export const ACCOUNT_REPLY =
  "No accounts are connected. I can set a trigger or routine from a birthday, last touch, next plan, or open loop already on someone's record.";

export function mentionsConnectedAccount(text: string): boolean {
  return ACCOUNT.test(text);
}

export function conditionFits(kind: PlanKind, condition: PlanCondition): boolean {
  return kind === "trigger" ? TRIGGERS.has(condition) : ROUTINES.has(condition);
}

const PlanShape = z.object({
  id: z.string().regex(/^plan_[a-z0-9]{6,40}$/, "That plan id can't be saved."),
  personId: z.string().trim().min(1).max(64),
  kind: z.enum(["trigger", "routine"]),
  condition: z.enum(PLAN_CONDITIONS),
  label: z.string().trim().min(1).max(140),
  prompt: z.string().trim().min(1).max(280),
});

export const PlanId = PlanShape.pick({ id: true });

export const PlanWrite = PlanShape.superRefine((value, ctx) => {
  if (!conditionFits(value.kind, value.condition)) {
    ctx.addIssue({ code: "custom", message: "That condition doesn't match a trigger or a routine." });
  }
  if (mentionsConnectedAccount(`${value.label}\n${value.prompt}`)) {
    ctx.addIssue({ code: "custom", message: "No accounts are connected. Set this from their record." });
  }
});

export function planId(seed: string): string {
  const body = (seed.toLowerCase().replace(/[^a-z0-9]/g, "") + "record").slice(0, 32);
  return `plan_${body}`;
}

export function freshPlanId(): string {
  const seed = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return planId(seed);
}

// Tool-call ids such as call_0 are reused and truncated by planId. A card keeps one
// random id for its own person and condition, and that id is what gets stored.
const cardPlanIds = new Map<string, string>();

export function planIdForCard(toolCallId: string, slot: { personId: string; kind: string; condition: string }): string {
  const key = `${toolCallId}\0${slot.personId}\0${slot.kind}\0${slot.condition}`;
  const known = cardPlanIds.get(key);
  if (known) return known;
  const id = freshPlanId();
  cardPlanIds.set(key, id);
  return id;
}

export function samePlan(a: Pick<Plan, "personId" | "kind" | "condition">, b: Pick<Plan, "personId" | "kind" | "condition">): boolean {
  return a.personId === b.personId && a.kind === b.kind && a.condition === b.condition;
}

export type PlanIdReuse = "duplicate" | "conflict";

// A row that already owns this id can stand in for the save only when it is the same plan.
export function planIdReuse(
  existing: Pick<Plan, "personId" | "kind" | "condition">,
  incoming: Pick<Plan, "personId" | "kind" | "condition">,
): PlanIdReuse {
  return samePlan(existing, incoming) ? "duplicate" : "conflict";
}

export type SetPlanToolArgs = {
  recordId: string;
  kind: PlanKind;
  condition: PlanCondition;
  label: string;
  prompt: string;
};

// Live and offline set_plan cards both read recordId.
export function setPlanToolArgs(plan: Omit<Plan, "id">): SetPlanToolArgs {
  return {
    recordId: plan.personId,
    kind: plan.kind,
    condition: plan.condition,
    label: plan.label,
    prompt: plan.prompt,
  };
}

export function offlinePlanReply(input: string, people: PlanPerson[]) {
  const intent = interpretPlan(input, people);
  if (intent.type === "ignore") return null;
  if (intent.type === "say") return { text: intent.text };
  return { text: intent.text, args: setPlanToolArgs(intent.plan) };
}

export function planFromToolArgs(args: { recordId?: string; personId?: string; kind?: unknown; condition?: unknown; label?: unknown; prompt?: unknown }, id: string) {
  const recordId = typeof args.recordId === "string" ? args.recordId.trim() : "";
  const personId = typeof args.personId === "string" ? args.personId.trim() : "";
  return PlanWrite.safeParse({
    id,
    personId: recordId || personId,
    kind: args.kind,
    condition: args.condition,
    label: typeof args.label === "string" ? args.label : "",
    prompt: typeof args.prompt === "string" ? args.prompt : "",
  });
}

export function parseStoredPlans(raw: string | null): Plan[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.flatMap((item) => {
      const parsed = PlanWrite.safeParse(item);
      if (!parsed.success || seen.has(parsed.data.id)) return [];
      seen.add(parsed.data.id);
      return [parsed.data];
    });
  } catch {
    return [];
  }
}

export function recordSupports(person: Pick<PlanPerson, "birthday" | "last" | "next" | "loop">, condition: PlanCondition): boolean {
  if (condition === "daily" || condition === "weekly") return true;
  if (condition === "birthday") return person.birthday.trim().length > 0;
  if (condition === "last_touch") return person.last.trim().length > 0;
  if (condition === "open_loop") return person.loop.trim().length > 0;
  return person.next.trim().length > 0 && !/nothing scheduled/i.test(person.next);
}

export function conditionsFor(person: PlanPerson | undefined, kind: PlanKind): { condition: PlanCondition; label: string }[] {
  if (kind === "routine") {
    return [
      { condition: "daily", label: "Every day" },
      { condition: "weekly", label: "Every week" },
    ];
  }
  const options: { condition: PlanCondition; label: string }[] = [
    { condition: "birthday", label: "Birthday on the record" },
    { condition: "last_touch", label: "When they've gone quiet" },
    { condition: "next_up", label: "Before what's next" },
    { condition: "open_loop", label: "While an open loop is open" },
  ];
  return options.filter((option) => !!person && recordSupports(person, option.condition));
}

export function planDetail(person: Pick<PlanPerson, "birthday" | "last" | "next" | "loop">, condition: PlanCondition): string {
  if (condition === "daily") return "Every day, from this record";
  if (condition === "weekly") return "Every week, from this record";
  if (condition === "birthday") return person.birthday.trim() || "No birthday on the record";
  if (condition === "last_touch") return person.last.trim() || "No last touch on the record";
  if (condition === "open_loop") return person.loop.trim() || "No open loop on the record";
  return person.next.trim() || "Nothing next on the record";
}

export function planDue(person: PlanPerson, condition: PlanCondition, now = new Date()): boolean {
  if (!recordSupports(person, condition)) return false;
  if (condition === "birthday") return birthdaySoon(person.birthday, now);
  if (condition === "last_touch") return goneQuiet(person.last);
  return true;
}

export function describePlan(person: PlanPerson, condition: PlanCondition, weekday?: string): { label: string; prompt: string } {
  const first = firstName(person.name);
  const prompt = person.prompt?.trim() || `Draft a check-in for ${first}`;
  if (condition === "birthday") return { label: `When ${first}'s birthday is on the record`, prompt };
  if (condition === "last_touch") return { label: `When ${first} has gone quiet`, prompt };
  if (condition === "next_up") return { label: `Before what's next with ${first}`, prompt };
  if (condition === "open_loop") return { label: `While ${first} has an open loop`, prompt };
  if (condition === "daily") return { label: `Check in with ${first} every day`, prompt };
  const day = weekday ? weekday.replace(/^\p{L}/u, (letter) => letter.toUpperCase()) : "";
  return { label: day ? `Check in with ${first} every ${day}` : `Check in with ${first} every week`, prompt };
}

export type PlanIntent =
  | { type: "ignore" }
  | { type: "say"; text: string }
  | { type: "plan"; text: string; plan: Omit<Plan, "id"> };

export function isPlanAsk(text: string): boolean {
  const folded = fold(text);
  if (/\b(trigger|routine)\b/.test(folded)) return true;
  if (/\bremind me\b/.test(folded)) return true;
  if (/\b(every|each)\s+(day|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(folded)) return true;
  if (/\b(daily|weekly)\b/.test(folded) && /\b(check|text|message|ping|brief|routine|trigger)\b/.test(folded)) return true;
  if (/\bgame plan\b/.test(folded) && /\b(set|add|create|save|make|put)\b/.test(folded)) return true;
  return false;
}

export function interpretPlan(text: string, people: PlanPerson[]): PlanIntent {
  if (!isPlanAsk(text)) return { type: "ignore" };
  if (mentionsConnectedAccount(text)) return { type: "say", text: ACCOUNT_REPLY };

  const spec = detectSpec(fold(text));
  const found = matchPeople(text, people);
  if (found.type === "ambiguous") {
    return { type: "say", text: `Which one: ${found.people.map((person) => person.name).join(" or ")}?` };
  }
  const named = namedCandidate(text, people);
  if (!found.person && named && !named.known) {
    return { type: "say", text: `${displayName(named.raw)} isn't on the roster, so there's nowhere to save that.` };
  }
  if (!found.person) return { type: "say", text: "Which person on the roster should I save this with?" };

  const person = found.person;
  if (spec.type === "missing") {
    const options = conditionsFor(person, "trigger");
    if (options.length === 0) {
      return { type: "say", text: `${person.name}'s record has no birthday, last touch, next plan, or open loop to trigger on.` };
    }
    return {
      type: "say",
      text: `Which one should I watch on ${person.name}'s record: ${options.map((option) => option.label.toLowerCase()).join(", ")}?`,
    };
  }
  if (!recordSupports(person, spec.condition)) return { type: "say", text: unsupportedCopy(person, spec.condition) };

  const weekday = spec.condition === "weekly" ? fold(text).match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1] : undefined;
  const described = describePlan(person, spec.condition, weekday);
  return {
    type: "plan",
    text: `${described.label}. I'll keep it on ${person.name}'s record, using only what's already there.`,
    plan: { personId: person.id, kind: spec.kind, condition: spec.condition, label: described.label, prompt: described.prompt },
  };
}

function detectSpec(folded: string): { type: "ready"; kind: PlanKind; condition: PlanCondition } | { type: "missing" } {
  const daily = /\b(?:every|each)\s+day\b|\bdaily\b/.test(folded);
  const weekly =
    /\b(?:every|each)\s+week\b|\bweekly\b/.test(folded) ||
    /\b(?:every|each)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(folded);
  const wantsTrigger = /\btrigger\b/.test(folded);
  const wantsRoutine = /\broutine\b/.test(folded) || daily || weekly;
  if (wantsRoutine && !wantsTrigger) {
    return { type: "ready", kind: "routine", condition: daily && !weekly ? "daily" : "weekly" };
  }
  const specific = specificTrigger(folded);
  if (specific) return { type: "ready", kind: "trigger", condition: specific };
  if (/\bremind me\b/.test(folded)) return { type: "ready", kind: "routine", condition: daily && !weekly ? "daily" : "weekly" };
  return { type: "missing" };
}

function specificTrigger(folded: string): PlanCondition | null {
  if (/\b(birthday|b-day|turns)\b/.test(folded)) return "birthday";
  if (/\bopen loop\b/.test(folded)) return "open_loop";
  if (/\b(quiet|haven'?t talked|lost touch|last touch|no contact|gone cold)\b/.test(folded)) return "last_touch";
  if (/\b(next up|pregame|coffee)\b/.test(folded) || /\bbefore\b/.test(folded)) return "next_up";
  return null;
}

function matchPeople(text: string, people: PlanPerson[]): { type: "one"; person: PlanPerson | null } | { type: "ambiguous"; people: PlanPerson[] } {
  const folded = fold(text);
  const fullHits = people.filter((person) => folded.includes(fold(person.name)));
  if (fullHits.length > 1) return { type: "ambiguous", people: fullHits };
  if (fullHits.length === 1) return { type: "one", person: fullHits[0] };
  const firstHits = people.filter((person) => {
    const first = fold(person.name).split(/\s+/)[0] ?? "";
    if (first.length < 2) return false;
    return new RegExp(`\\b${escapeRegExp(first)}\\b`, "u").test(folded);
  });
  if (firstHits.length > 1) return { type: "ambiguous", people: firstHits };
  return { type: "one", person: firstHits[0] ?? null };
}

function namedCandidate(text: string, people: PlanPerson[]): { raw: string; known: boolean } | null {
  const match = text.match(/\b(?:for|with|about)\s+([\p{L}][\p{L}'’.-]*)(?:\s+([\p{L}][\p{L}'’.-]*))?/u);
  if (!match) return null;
  const first = cleanToken(match[1]);
  const second = match[2] ? cleanToken(match[2]) : "";
  if (skip(first)) return null;
  if (second && !skip(second)) {
    const both = `${first} ${second}`;
    if (knownName(both, people)) return { raw: both, known: true };
  }
  return { raw: first, known: knownName(first, people) };
}

function unsupportedCopy(person: PlanPerson, condition: PlanCondition): string {
  if (condition === "birthday") return `${person.name}'s record has no birthday, so I won't invent one.`;
  if (condition === "last_touch") return `${person.name}'s record has no last touch, so I won't invent one.`;
  if (condition === "open_loop") return `${person.name}'s record has no open loop, so I won't invent one.`;
  return `${person.name}'s record has nothing scheduled next, so I won't invent one.`;
}

function birthdaySoon(birthday: string, now: Date): boolean {
  const parsed = parseMonthDay(birthday);
  if (parsed) return daysUntil(parsed.month, parsed.day, now) <= HORIZON_DAYS;
  return /\btomorrow\b/i.test(birthday);
}

function parseMonthDay(text: string): { month: number; day: number } | null {
  const match = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].slice(0, 3));
  const day = Number(match[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  const probe = new Date(2024, month, day);
  if (probe.getMonth() !== month || probe.getDate() !== day) return null;
  return { month, day };
}

function daysUntil(month: number, day: number, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), month, day);
  if (target < start) target = new Date(now.getFullYear() + 1, month, day);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function goneQuiet(last: string): boolean {
  const text = last.toLowerCase();
  if (/\b(?:week|month|year)s?\b/.test(text)) return true;
  const days = text.match(/\b(\d+)\s*days?\b/);
  return !!days && Number(days[1]) >= 7;
}

function knownName(raw: string, people: PlanPerson[]): boolean {
  const wanted = fold(raw);
  return people.some((person) => {
    const name = fold(person.name);
    return name === wanted || name.split(/\s+/)[0] === wanted;
  });
}

function displayName(raw: string): string {
  if (raw.toLowerCase() !== raw) return raw;
  return raw.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

function cleanToken(token: string): string {
  return token.replace(/['’]s$/i, "");
}

function skip(token: string): boolean {
  return SKIP_NAME.has(fold(token));
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || name;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
