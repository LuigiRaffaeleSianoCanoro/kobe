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

function connectedNames(sources: Record<string, boolean>): string[] {
  const out: string[] = [];
  D.groups.forEach((group) => group.items.forEach(([id, name]) => { if (sources[id]) out.push(name); }));
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First roster person whose name is mentioned. Does not invent a person. */
export function mentionedPerson(people: Person[], text: string): Person | undefined {
  const haystack = text.toLowerCase();
  const ranked = [...people].sort((a, b) => b.name.length - a.name.length);
  return ranked.find((person) => {
    const name = person.name.trim().toLowerCase();
    if (!name) return false;
    if (haystack.includes(name)) return true;
    const first = name.split(/\s+/)[0];
    if (!first || first.length < 3) return false;
    return new RegExp(`\\b${escapeRegExp(first)}\\b`, "i").test(text);
  });
}

function personName(people: Person[], id: string): string {
  return people.find((person) => person.id === id)?.name ?? "";
}

/** Canned replies. Person cards and briefs point at CRM ids; the UI reads fields from the store. */
export function reply(text: string, sources: Record<string, boolean>, people: Person[]): AgentReply {
  const t = text.toLowerCase();
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
    return {
      text: "Birthdays saved on the roster.",
      people: people.map((person) => ({ id: person.id, metaField: "role", rightField: "birthday" })),
    };
  }
  if (/(marcus|brief|coffee|pregame)/.test(t)) {
    const named = mentionedPerson(people, text);
    const marcus = people.find((person) => person.id === "marcus");
    const target = named ?? marcus;
    if (!target) return { text: "That person is not on the roster." };
    return { text: target.name.trim() ? `Pregame for ${target.name}.` : "Pregame.", brief: { id: target.id } };
  }
  if (/(lately|haven|talk|lost touch|catch up)/.test(t)) {
    return {
      text: "Last touch for each person on the roster.",
      people: people.map((person) => ({ id: person.id, metaField: "role", rightField: "lastTouch" })),
    };
  }
  const names = connectedNames(sources);
  return { text: `I checked ${names.join(", ")} and found nothing new on that. Connect more sources in Integrations to widen what I can see.` };
}
