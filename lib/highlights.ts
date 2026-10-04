import type { CalendarEntry, Person } from "./data";

// A weekly mixtape built only from records already stored, notes on those records,
// drafts the user has logged, and the sample calendar. Nothing in here reads an
// integration, and account names are never added.

export type TouchNote = {
  personId: string;
  channel: string;
  body: string;
  at: string;
};

export type MixtapeLine = {
  text: string;
  from: "record" | "sample calendar" | "logged note";
};

export type MixtapeNote = { text: string; loop: boolean };

export type MixtapeTrack = {
  id: string;
  personId: string;
  name: string;
  role: string;
  kind: "BIRTHDAY" | "PLAN" | "TOUCH";
  /** Local calendar day, YYYY-MM-DD. */
  when: string;
  whenLabel: string;
  lines: MixtapeLine[];
  notes: MixtapeNote[];
  /** Draft channels the user copied for. Not connected accounts. */
  via: string[];
  cited: string;
};

export type Mixtape = {
  /** Inclusive Sunday, YYYY-MM-DD. */
  start: string;
  /** Inclusive Saturday, YYYY-MM-DD. */
  end: string;
  label: string;
  tracks: MixtapeTrack[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_FIRST = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b`, "i");
const WEEKDAYS: { re: RegExp; index: number }[] = [
  { re: /\b(?:sunday|sun)\b/i, index: 0 },
  { re: /\b(?:monday|mon)\b/i, index: 1 },
  { re: /\b(?:tuesday|tues|tue)\b/i, index: 2 },
  { re: /\b(?:wednesday|wed)\b/i, index: 3 },
  { re: /\b(?:thursday|thur|thurs|thu)\b/i, index: 4 },
  { re: /\b(?:friday|fri)\b/i, index: 5 },
  { re: /\b(?:saturday|sat)\b/i, index: 6 },
];

const KIND_RANK = { BIRTHDAY: 0, PLAN: 1, TOUCH: 2 } as const;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function labelOf(date: Date): string {
  return `${MONTHS[date.getMonth()].toUpperCase()} ${date.getDate()}`;
}

function inWeek(date: Date, start: Date, end: Date): boolean {
  const day = startOfDay(date).getTime();
  return day >= start.getTime() && day < end.getTime();
}

function monthIndex(name: string): number {
  const stem = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((month) => stem.startsWith(month));
}

function parseMonthDay(text: string): { month: number; day: number } | null {
  const forward = text.match(MONTH_FIRST);
  const backward = text.match(DAY_FIRST);
  const monthName = forward?.[1] ?? backward?.[2];
  const dayText = forward?.[2] ?? backward?.[1];
  if (!monthName || !dayText) return null;
  const month = monthIndex(monthName);
  const day = Number(dayText);
  if (month < 0 || day < 1 || day > 31) return null;
  return { month, day };
}

function monthDayInWeek(text: string, start: Date, end: Date): Date | null {
  const parsed = parseMonthDay(text);
  if (!parsed) return null;
  const years = new Set([start.getFullYear(), addDays(end, -1).getFullYear()]);
  for (const year of years) {
    const date = new Date(year, parsed.month, parsed.day);
    if (date.getFullYear() !== year || date.getMonth() !== parsed.month || date.getDate() !== parsed.day) continue;
    if (inWeek(date, start, end)) return startOfDay(date);
  }
  return null;
}

// Explicit dates win over "today", "tomorrow", and weekday words. A match that
// falls outside this Sunday–Saturday week is skipped, not reinterpreted.
function dateInWeekFromText(text: string, now: Date, start: Date, end: Date): Date | null {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return inWeek(date, start, end) ? startOfDay(date) : null;
  }
  if (parseMonthDay(text)) return monthDayInWeek(text, start, end);

  const daysFromNow = (days: number) => {
    if (!Number.isFinite(days)) return null;
    const date = addDays(startOfDay(now), days);
    return inWeek(date, start, end) ? date : null;
  };
  if (/\bjust now\b|\btoday\b/i.test(text)) return daysFromNow(0);
  if (/\byesterday\b/i.test(text)) return daysFromNow(-1);
  if (/\btomorrow\b/i.test(text)) return daysFromNow(1);
  const daysAgo = text.match(/\b(\d+)\s+days?\s+ago\b/i);
  if (daysAgo) return daysFromNow(-Number(daysAgo[1]));
  const weeksAgo = text.match(/\b(\d+)\s+weeks?\s+ago\b/i);
  if (weeksAgo) return daysFromNow(-Number(weeksAgo[1]) * 7);
  if (/\ba week ago\b/i.test(text)) return daysFromNow(-7);
  for (const weekday of WEEKDAYS) {
    if (weekday.re.test(text)) return addDays(start, weekday.index);
  }
  return null;
}

function asPoints(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function notesOf(person: Person): MixtapeNote[] {
  const notes: MixtapeNote[] = [];
  const loop = str(person.loop);
  if (loop) notes.push({ text: loop, loop: true });
  for (const point of asPoints(person.points)) {
    const text = str(point);
    if (!text || notes.some((note) => note.text.toLowerCase() === text.toLowerCase())) continue;
    notes.push({ text, loop: false });
  }
  return notes;
}

function dedupeLines(lines: MixtapeLine[]): MixtapeLine[] {
  const unique: MixtapeLine[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || unique.some((kept) => kept.text.toLowerCase() === text.toLowerCase())) continue;
    unique.push({ text, from: line.from });
  }
  return unique.filter((line, index) => {
    const needle = line.text.toLowerCase();
    return !unique.some((other, otherIndex) => otherIndex !== index && other.text.length > line.text.length && other.text.toLowerCase().includes(needle));
  });
}

function cite(froms: Set<MixtapeLine["from"]>): string {
  const extras: string[] = [];
  if (froms.has("sample calendar")) extras.push("the sample calendar");
  if (froms.has("logged note")) extras.push("a note you logged");
  if (!extras.length) return "On their record";
  if (extras.length === 1) return `On their record and ${extras[0]}`;
  return `On their record, ${extras[0]}, and ${extras[1]}`;
}

type Cue = {
  personId: string;
  kind: MixtapeTrack["kind"];
  date: Date;
  lines: MixtapeLine[];
  via: string[];
};

export function weeklyMixtape(people: readonly Person[], calendar: readonly CalendarEntry[], now: Date, touches: readonly TouchNote[] = []): Mixtape {
  const start = addDays(startOfDay(now), -now.getDay());
  const end = addDays(start, 7);
  const roster = new Map<string, Person>();
  for (const person of people) {
    const id = str(person?.id);
    if (id) roster.set(id, person);
  }

  const groups = new Map<string, Cue>();
  const add = (cue: Cue) => {
    const key = `${cue.personId}|${cue.kind}|${iso(cue.date)}`;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...cue, lines: [...cue.lines], via: [...cue.via] });
      return;
    }
    prev.lines.push(...cue.lines);
    prev.via.push(...cue.via);
  };

  for (const [id, person] of roster) {
    const birthday = str(person.birthday);
    const birthdayOn = birthday ? dateInWeekFromText(birthday, now, start, end) : null;
    if (birthdayOn) add({ personId: id, kind: "BIRTHDAY", date: birthdayOn, lines: [{ text: birthday, from: "record" }], via: [] });

    const next = str(person.next);
    if (next && !/^nothing scheduled\.?$/i.test(next)) {
      const nextOn = dateInWeekFromText(next, now, start, end);
      if (nextOn) add({ personId: id, kind: "PLAN", date: nextOn, lines: [{ text: next, from: "record" }], via: [] });
    }

    const last = str(person.last);
    if (last) {
      const lastOn = dateInWeekFromText(last, now, start, end);
      if (lastOn) add({ personId: id, kind: "TOUCH", date: lastOn, lines: [{ text: last, from: "record" }], via: [] });
    }
  }

  for (const event of calendar) {
    const personId = str(event?.person);
    if (!personId || !roster.has(personId)) continue;
    const title = str(event.title);
    if (/^\(free( slot)?\)$/i.test(title)) continue;
    const when = str(event.when);
    const on = when ? dateInWeekFromText(when, now, start, end) : null;
    if (!on) continue;
    const lines: MixtapeLine[] = [];
    if (title) lines.push({ text: title, from: "sample calendar" });
    if (when) lines.push({ text: when, from: "sample calendar" });
    const where = str(event.where);
    if (where) lines.push({ text: where, from: "sample calendar" });
    if (lines.length) add({ personId, kind: "PLAN", date: on, lines, via: [] });
  }

  for (const touch of touches) {
    const personId = str(touch?.personId);
    const body = str(touch?.body);
    if (!personId || !body || !roster.has(personId)) continue;
    const at = new Date(touch.at);
    if (Number.isNaN(at.getTime()) || !inWeek(at, start, end)) continue;
    const channel = str(touch.channel);
    add({
      personId,
      kind: "TOUCH",
      date: startOfDay(at),
      lines: [{ text: body, from: "logged note" }],
      via: channel ? [channel] : [],
    });
  }

  const tracks = [...groups.values()].flatMap((cue): MixtapeTrack[] => {
    const person = roster.get(cue.personId);
    if (!person) return [];
    const froms = new Set(cue.lines.map((line) => line.from));
    const lines = dedupeLines(cue.lines);
    if (!lines.length) return [];
    const when = iso(cue.date);
    return [
      {
        id: `${cue.personId}:${cue.kind}:${when}`,
        personId: cue.personId,
        name: str(person.name),
        role: str(person.role),
        kind: cue.kind,
        when,
        whenLabel: labelOf(cue.date),
        lines,
        notes: notesOf(person),
        via: [...new Set(cue.via.map((channel) => channel.trim()).filter(Boolean))],
        cited: cite(froms),
      },
    ];
  });

  tracks.sort((a, b) => a.when.localeCompare(b.when) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId));

  const last = addDays(end, -1);
  return { start: iso(start), end: iso(last), label: `${labelOf(start)} – ${labelOf(last)}`, tracks };
}

export function mixtapeText(tape: Mixtape): string {
  return tape.tracks.flatMap((track) => [track.name, track.role, track.cited, ...track.lines.map((line) => line.text), ...track.notes.map((note) => note.text), ...track.via]).join("\n");
}
