/**
 * Person CRM records for courtside cards and the scouting report.
 *
 * Neon project shy-scene-82014972 (branch production) is the intended database,
 * but only when a connection string is already configured. This app does not
 * invent one. `neonConfigured` is true only when Vite already has a database
 * URL; the UI still must not say Neon is connected until a row is read back.
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
  },
];

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function envDatabaseUrl(): string {
  const env = import.meta.env;
  if (!env) return "";
  const viteUrl = env.VITE_DATABASE_URL;
  if (typeof viteUrl === "string" && viteUrl.trim()) return viteUrl.trim();
  return "";
}

/** True when a database URL was already provided to the client build. */
export function neonConfigured(): boolean {
  return envDatabaseUrl().length > 0;
}

/**
 * Neon is connected only after a record is read back from the project.
 * No credentials are present in this environment, and this module never
 * opens a connection or fabricates a URL, so this stays false.
 */
export function neonConnected(): boolean {
  return false;
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
  };
}

export function readPeople(storage: StorageLike | null): Person[] {
  if (!storage) return cloneSeed();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw == null) {
      const seeded = cloneSeed();
      storage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePerson).filter((person): person is Person => person !== null);
  } catch {
    return cloneSeed();
  }
}

export function writePeople(storage: StorageLike | null, people: Person[]): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(people));
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
