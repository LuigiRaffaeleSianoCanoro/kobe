import { D } from "./data";
import type { CardMetaField, CardRightField, Person } from "./crm";

export type PersonCard = { id: string; metaField: CardMetaField; rightField: CardRightField };
export type BriefCard = { id: string };
export type DraftCard = { to: string; channel: string; body: string };

export type AgentReply = {
  text: string;
  people?: PersonCard[];
  brief?: BriefCard;
  draft?: DraftCard;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Last touch older than a week counts as "haven't talked lately". */
const STALE_AFTER_DAYS = 7;

function connectedNames(sources: Record<string, boolean>): string[] {
  const out: string[] = [];
  D.groups.forEach((group) => group.items.forEach(([id, name]) => { if (sources[id]) out.push(name); }));
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthIndex(token: string): number {
  return MONTHS.indexOf(token.toLowerCase().slice(0, 3));
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return startOfDay(date);
}

/** Month and day from free text. Ignores unrelated numbers such as "turns 29". */
export function monthDay(text: string): { month: number; day: number } | null {
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b/i);
  if (named) {
    const month = monthIndex(named[1]);
    const day = Number(named[2]);
    if (month >= 0 && calendarDate(2000, month, day)) return { month, day };
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    if (calendarDate(Number(iso[1]), month, day)) return { month, day };
  }
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const day = Number(slash[2]);
    if (month >= 0 && month <= 11 && calendarDate(2000, month, day)) return { month, day };
  }
  return null;
}

/** Sunday–Saturday week that contains `now`, matching the courtside Sunday. */
export function birthdayThisWeek(text: string, now = new Date()): boolean {
  const birthday = monthDay(text);
  if (!birthday) return false;
  const start = startOfDay(now);
  start.setDate(start.getDate() - start.getDay());
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    if (day.getMonth() === birthday.month && day.getDate() === birthday.day) return true;
  }
  return false;
}

function daysSince(text: string, now: Date): number | null {
  const relative = text.match(/(\d+)\s*(day|week|month|year)s?\s*ago/i);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    if (unit.startsWith("day")) return count;
    if (unit.startsWith("week")) return count * 7;
    if (unit.startsWith("month")) return count * 30;
    return count * 365;
  }
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i);
  if (named) {
    const month = monthIndex(named[1]);
    const day = Number(named[2]);
    const today = startOfDay(now);
    let year = named[3] ? Number(named[3]) : today.getFullYear();
    if (!named[3]) {
      const candidate = calendarDate(year, month, day);
      if (candidate && candidate.getTime() > today.getTime()) year -= 1;
    }
    const then = calendarDate(year, month, day);
    if (!then) return null;
    return Math.round((today.getTime() - then.getTime()) / 86400000);
  }
  return null;
}

/** No recorded touch, or the last touch is more than a week old. */
export function neglected(person: Person, now = new Date()): boolean {
  const touch = person.lastTouch.trim();
  if (!touch) return true;
  const days = daysSince(touch, now);
  return days !== null && days > STALE_AFTER_DAYS;
}

/** First roster person whose name is mentioned. Does not invent a person. */
export function mentionedPerson(people: Person[], text: string): Person | undefined {
  const ranked = [...people].sort((a, b) => b.name.length - a.name.length);
  return ranked.find((person) => {
    const name = person.name.trim();
    if (!name) return false;
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text)) return true;
    const first = name.split(/\s+/)[0];
    if (!first || first.length < 3) return false;
    return new RegExp(`\\b${escapeRegExp(first)}\\b`, "i").test(text);
  });
}

function personName(people: Person[], id: string): string {
  return people.find((person) => person.id === id)?.name ?? "";
}

function briefFor(person: Person): AgentReply {
  return { text: person.name.trim() ? `Pregame for ${person.name}.` : "Pregame.", brief: { id: person.id } };
}

function countText(count: number, singular: string, plural: string): string {
  if (count === 0) return `No ${plural}.`;
  if (count === 1) return `One ${singular}.`;
  return `${count} ${plural}.`;
}

/** Canned replies. Person cards and briefs point at CRM ids; the UI reads fields from the store. */
export function reply(text: string, sources: Record<string, boolean>, people: Person[]): AgentReply {
  const t = text.toLowerCase();
  if (/(brief|pregame)/.test(t)) {
    const named = mentionedPerson(people, text);
    const marcus = people.find((person) => person.id === "marcus");
    const target = named ?? marcus;
    if (!target) return { text: "That person is not on the roster." };
    return briefFor(target);
  }
  if (/\b(marcus|coffee)\b/.test(t) && !/(draft|message|write|congrats)/.test(t)) {
    const marcus = people.find((person) => person.id === "marcus");
    if (!marcus) return { text: "That person is not on the roster." };
    return briefFor(marcus);
  }
  if (/maya/.test(t) && /(draft|message|write)/.test(t)) {
    return { text: "Kept it warm and specific. She posted from a Brooklyn run club last week.", draft: { to: personName(people, "maya"), channel: "Instagram", body: "Happy birthday Maya! 29 looks good on you. Hope Brooklyn is treating you right. Send me that half marathon training plan, I want in." } };
  }
  if (/\bdev\b/.test(t)) {
    return { text: "He asked about the 17th. Your calendar is open that morning.", draft: { to: personName(people, "dev"), channel: "WhatsApp", body: "Sorry for the slow reply! I'm free the morning of the 17th, count me in for the move. I'll bring the truck playlist." } };
  }
  if (/priya/.test(t)) {
    return { text: "She prefers voice notes, but here is a text version.", draft: { to: personName(people, "priya"), channel: "LinkedIn", body: "Huge congrats on Head of Design at Northwind! Well deserved. Coffee soon for real this time? My treat." } };
  }
  if (/(thursday|conflict|double|resolve)/.test(t)) {
    return { text: "Thursday 7:00 PM has Dinner with Jordan (Partiful) and Product sync (Google Calendar). The sync has a free 5:30 slot. I can ask Jordan to keep 7:00 and move the sync, or push dinner to 8:00.", draft: { to: personName(people, "jordan"), channel: "WhatsApp", body: "Hey! Still on for Thursday. Any chance we push to 8? Work thing ran over. I'll bring dessert for Biscuit's welcome party." } };
  }
  if (/birthday/.test(t)) {
    const celebrating = people.filter((person) => birthdayThisWeek(person.birthday));
    return {
      text: countText(celebrating.length, "birthday this week", "birthdays this week"),
      ...(celebrating.length
        ? { people: celebrating.map((person) => ({ id: person.id, metaField: "role" as const, rightField: "birthday" as const })) }
        : {}),
    };
  }
  if (/(lately|haven|talk|lost touch|catch up)/.test(t)) {
    const quiet = people.filter((person) => neglected(person));
    return {
      text: quiet.length ? "These people are cooling off." : "Everyone has been in touch lately.",
      ...(quiet.length
        ? { people: quiet.map((person) => ({ id: person.id, metaField: "role" as const, rightField: "lastTouch" as const })) }
        : {}),
    };
  }
  const names = connectedNames(sources);
  return { text: `I checked ${names.join(", ")} and found nothing new on that. Connect more sources in Integrations to widen what I can see.` };
}
