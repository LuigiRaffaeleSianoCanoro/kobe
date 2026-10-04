import { D, type PersonRecord } from "./data";

export type PersonCard = { id: string; name: string; initials: string; meta: string; right: string };
export type BriefCard = { id: string; name: string; next: string; points: string[]; loop: string };
export type DraftCard = { to: string; channel: string; body: string };

export type AgentReply = {
  text: string;
  people?: PersonCard[];
  brief?: BriefCard;
  draft?: DraftCard;
};

function person(id: string, meta: string, right: string): PersonCard {
  const r: PersonRecord = D.records[id];
  return { id, name: r.name, initials: r.name.split(" ").map((w) => w[0]).join(""), meta, right };
}

export function connectedNames(sources: Record<string, boolean>): string[] {
  const out: string[] = [];
  D.groups.forEach((g) => g.items.forEach(([id, name]) => { if (sources[id]) out.push(name); }));
  return out;
}

/** Canned replies copied from the design logic (runAgent / reply). No model. */
export function reply(text: string, sources: Record<string, boolean>): AgentReply {
  const t = text.toLowerCase();
  const R = D.records;
  if (/maya/.test(t) && /(draft|message|write)/.test(t)) {
    return { text: "Kept it warm and specific. She posted from a Brooklyn run club last week.", draft: { to: "Maya Chen", channel: "Instagram", body: "Happy birthday Maya! 29 looks good on you. Hope Brooklyn is treating you right. Send me that half marathon training plan, I want in." } };
  }
  if (/\bdev\b/.test(t)) {
    return { text: "He asked about the 17th. Your calendar is open that morning.", draft: { to: "Dev Patel", channel: "WhatsApp", body: "Sorry for the slow reply! I'm free the morning of the 17th, count me in for the move. I'll bring the truck playlist." } };
  }
  if (/priya/.test(t)) {
    return { text: "She prefers voice notes, but here is a text version.", draft: { to: "Priya Nair", channel: "LinkedIn", body: "Huge congrats on Head of Design at Northwind! Well deserved. Coffee soon for real this time? My treat." } };
  }
  if (/(thursday|conflict|double|resolve)/.test(t)) {
    return { text: "Thursday 7:00 PM has Dinner with Jordan (Partiful) and Product sync (Google Calendar). The sync has a free 5:30 slot. I can ask Jordan to keep 7:00 and move the sync, or push dinner to 8:00.", draft: { to: "Jordan Blake", channel: "WhatsApp", body: "Hey! Still on for Thursday. Any chance we push to 8? Work thing ran over. I'll bring dessert for Biscuit's welcome party." } };
  }
  if (/birthday/.test(t)) {
    return { text: "Three birthdays in the next 10 days.", people: [person("maya", "College roommate · Instagram", "TOMORROW"), person("jordan", "Rec league · Partiful", "OCT 9"), person("priya", "Ex-colleague · LinkedIn", "OCT 13")] };
  }
  if (/(marcus|brief|coffee|pregame)/.test(t)) {
    const m = R.marcus;
    return { text: "Here's your pregame for 3:30. Pulled from your Sep 12 Fathom call and Gmail.", brief: { id: "marcus", name: m.name, next: m.next, points: m.points, loop: m.loop } };
  }
  if (/(lately|haven|talk|lost touch|catch up)/.test(t)) {
    return { text: "These people are cooling off.", people: [person("dev", "Unanswered WhatsApp", "9 DAYS"), person("priya", "Last LinkedIn like", "2 MO"), person("maya", "Last Instagram DM", "6 WK")] };
  }
  const names = connectedNames(sources);
  return { text: `I checked ${names.join(", ")} and found nothing new on that. Connect more sources in Integrations to widen what I can see.` };
}
