/**
 * Person CRM records for courtside cards and the scouting report.
 *
 * Records stay in this browser under localStorage key `kobe.crm.v1`.
 * Neon is not connected. A database URL is never read here: Vite would
 * inline it into the browser bundle, password and all.
 */

export type Person = {
  id: string;
  name: string;
  role: string;
  tier: string;
  birthday: string;
  lastTouch: string;
  nextPlan: string;
  openLoop: string;
  sources: string[];
  points: string[];
  /** Seeded demo roster. Records created in the app are false. */
  sample: boolean;
  /** Rapport figure carried on the original demo people. Not computed. */
  score: number | null;
  /** Scouting-report action from the original demo. Empty on records created here. */
  action: string;
  /** Prompt the action button sends. Empty when there is no action. */
  prompt: string;
};

export type PersonForm = {
  id: string;
  name: string;
  role: string;
  tier: string;
  birthday: string;
  lastTouch: string;
  nextPlan: string;
  openLoop: string;
  sourcesText: string;
  pointsText: string;
};

export type CardMetaField = "role" | "lastTouch";
export type CardRightField = "birthday" | "lastTouch" | "none";

const STORAGE_KEY = "kobe.crm.v1";

const SAMPLE_PEOPLE: Person[] = [
  {
    id: "maya",
    name: "Maya Chen",
    role: "College roommate",
    tier: "STARTING FIVE",
    birthday: "Oct 5 · tomorrow · turns 29",
    lastTouch: "Instagram DM · 6 weeks ago",
    nextPlan: "Nothing scheduled",
    openLoop: "She asked for your running playlist.",
    sources: ["INSTAGRAM", "GMAIL"],
    points: ["Moved to Brooklyn in August", "Training for the NYC Half in March", "Favorite spot: Bunna Cafe"],
    sample: true,
    score: 82,
    action: "Draft birthday message",
    prompt: "Draft a birthday message for Maya",
  },
  {
    id: "marcus",
    name: "Marcus Reid",
    role: "Former manager · mentor",
    tier: "ROTATION",
    birthday: "Feb 11",
    lastTouch: "Fathom call · Sep 12",
    nextPlan: "Coffee today 3:30 PM · Blue Bottle",
    openLoop: "You promised an intro to Lena Ortiz.",
    sources: ["FATHOM", "GMAIL", "GOOGLE CALENDAR"],
    points: ["Relocated to Austin in August", "Daughter just started kindergarten", "Thinking about advising early-stage teams"],
    sample: true,
    score: 74,
    action: "Brief me again",
    prompt: "Brief me on Marcus",
  },
  {
    id: "jordan",
    name: "Jordan Blake",
    role: "Friend from rec league",
    tier: "STARTING FIVE",
    birthday: "Oct 9",
    lastTouch: "Partiful RSVP · 4 days ago",
    nextPlan: "Dinner Thu 7:00 PM · Nopa",
    openLoop: "Thursday dinner clashes with Product sync.",
    sources: ["PARTIFUL", "INSTAGRAM"],
    points: ["Just adopted a dog named Biscuit", "Tore an ACL in June, back on court now", "Hosting the dinner for 6"],
    sample: true,
    score: 88,
    action: "Fix Thursday conflict",
    prompt: "Fix my Thursday conflict",
  },
  {
    id: "priya",
    name: "Priya Nair",
    role: "Ex-colleague",
    tier: "BENCH",
    birthday: "Oct 13",
    lastTouch: "LinkedIn like · 2 months ago",
    nextPlan: "Nothing scheduled",
    openLoop: 'You both said "coffee soon" in July.',
    sources: ["LINKEDIN", "GMAIL"],
    points: ["Started as Head of Design at Northwind", "Ran her first marathon last spring", "Prefers voice notes over texts"],
    sample: true,
    score: 61,
    action: "Draft congrats",
    prompt: "Draft congrats to Priya",
  },
  {
    id: "dev",
    name: "Dev Patel",
    role: "Cousin",
    tier: "STARTING FIVE",
    birthday: "Jan 22",
    lastTouch: "WhatsApp · 9 days ago (unanswered)",
    nextPlan: "Family dinner Oct 18",
    openLoop: "Reply about helping him move.",
    sources: ["WHATSAPP", "GOOGLE CALENDAR"],
    points: ["Asked if you can help him move on the 17th", "Started a new job at a robotics lab", "Rooting hard for the home team this season"],
    sample: true,
    score: 79,
    action: "Draft reply",
    prompt: "Draft a reply to Dev",
  },
];

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** localStorage access can throw before any method call. Never let that blank the page. */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function cloneSeed(): Person[] {
  return SAMPLE_PEOPLE.map((person) => ({
    ...person,
    sources: [...person.sources],
    points: [...person.points],
  }));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizePerson(value: unknown): Person | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.trim() === "") return null;
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null;
  return {
    id: raw.id,
    name: asString(raw.name),
    role: asString(raw.role),
    tier: asString(raw.tier),
    birthday: asString(raw.birthday),
    lastTouch: asString(raw.lastTouch),
    nextPlan: asString(raw.nextPlan),
    openLoop: asString(raw.openLoop),
    sources: asStringList(raw.sources),
    points: asStringList(raw.points),
    sample: raw.sample === true,
    score,
    action: asString(raw.action),
    prompt: asString(raw.prompt),
  };
}

/** Older saved rows predate action/prompt. Keep the demo buttons for those ids. */
function withSampleAction(person: Person): Person {
  if (person.action && person.prompt) return person;
  const sample = SAMPLE_PEOPLE.find((item) => item.id === person.id);
  if (!sample) return person;
  return {
    ...person,
    action: person.action || sample.action,
    prompt: person.prompt || sample.prompt,
  };
}

export function readPeople(storage: StorageLike | null): Person[] {
  if (!storage) return cloneSeed();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null) {
      const seeded = cloneSeed();
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      } catch {
        // The roster still renders from memory when the first write is rejected.
      }
      return seeded;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePerson).filter((person): person is Person => person !== null).map(withSampleAction);
  } catch {
    return cloneSeed();
  }
}

/** False when the write did not happen. Callers must not treat the record as saved. */
export function writePeople(storage: StorageLike | null, people: Person[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(people));
    return true;
  } catch {
    return false;
  }
}

export function blankPerson(): Person {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `person-${Date.now()}`;
  return {
    id,
    name: "",
    role: "",
    tier: "",
    birthday: "",
    lastTouch: "",
    nextPlan: "",
    openLoop: "",
    sources: [],
    points: [],
    sample: false,
    score: null,
    action: "",
    prompt: "",
  };
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function toForm(person: Person): PersonForm {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    tier: person.tier,
    birthday: person.birthday,
    lastTouch: person.lastTouch,
    nextPlan: person.nextPlan,
    openLoop: person.openLoop,
    sourcesText: person.sources.join("\n"),
    pointsText: person.points.join("\n"),
  };
}

export function fromForm(form: PersonForm, existing?: Person): Person {
  return {
    id: form.id,
    name: form.name.trim(),
    role: form.role.trim(),
    tier: form.tier.trim(),
    birthday: form.birthday.trim(),
    lastTouch: form.lastTouch.trim(),
    nextPlan: form.nextPlan.trim(),
    openLoop: form.openLoop.trim(),
    sources: lines(form.sourcesText),
    points: lines(form.pointsText),
    sample: existing?.sample ?? false,
    score: existing?.score ?? null,
    action: existing?.action ?? "",
    prompt: existing?.prompt ?? "",
  };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0])
    .join("");
}

export function cardMeta(person: Person, field: CardMetaField): string {
  return field === "lastTouch" ? person.lastTouch : person.role;
}

export function cardRight(person: Person, field: CardRightField): string {
  if (field === "birthday") return person.birthday;
  if (field === "lastTouch") return person.lastTouch;
  return "";
}

export function findPerson(people: Person[], id: string): Person | undefined {
  return people.find((person) => person.id === id);
}
