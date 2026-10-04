import { SAMPLE_CALENDAR, type StoredEvent } from "./calendar";
import { isLiveConnector, sourcesNamed, type Connector } from "./connectors";
import { type DraftChannel, type Person } from "./data";

export type ChatReply = {
  text: string;
  tool?: { toolName: string; args: Record<string, unknown> };
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABEL = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const STALE_AFTER_DAYS = 7;

const STOP = new Set([
  "me",
  "my",
  "the",
  "a",
  "an",
  "our",
  "your",
  "his",
  "her",
  "their",
  "them",
  "him",
  "this",
  "that",
  "these",
  "those",
  "today",
  "tomorrow",
  "week",
  "thursday",
  "monday",
  "tuesday",
  "wednesday",
  "friday",
  "saturday",
  "sunday",
  "birthday",
  "birthdays",
  "message",
  "messages",
  "reply",
  "congrats",
  "move",
  "coffee",
  "conflict",
  "conflicts",
  "anyone",
  "someone",
  "somebody",
  "people",
  "roster",
  "record",
  "records",
  "real",
  "once",
  "now",
  "later",
  "morning",
  "night",
  "dinner",
  "sync",
  "playlist",
  "day",
  "days",
  "time",
  "next",
  "last",
  "lately",
  "talked",
  "talk",
  "check",
  "draft",
  "write",
  "brief",
  "pregame",
  "notes",
  "note",
  "about",
  "from",
  "into",
  "just",
  "please",
  "what",
  "whats",
  "who",
  "new",
  "job",
  "stuff",
  "things",
  "something",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function monthIndex(token: string): number {
  return MONTHS.indexOf(token.toLowerCase().slice(0, 3));
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function monthDay(text: string): { month: number; day: number } | null {
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b/i);
  if (!named) return null;
  const month = monthIndex(named[1]);
  const day = Number(named[2]);
  if (month >= 0 && calendarDate(2000, month, day)) return { month, day };
  return null;
}

export function birthdayThisWeek(text: string, now: Date): boolean {
  const birthday = monthDay(text);
  if (!birthday) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  const named = monthDay(text);
  if (!named) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let year = today.getFullYear();
  const candidate = calendarDate(year, named.month, named.day);
  if (candidate && candidate.getTime() > today.getTime()) year -= 1;
  const then = calendarDate(year, named.month, named.day);
  if (!then) return null;
  return Math.round((today.getTime() - then.getTime()) / 86400000);
}

function neglected(person: Person, now: Date): boolean {
  const touch = person.last.trim();
  if (!touch) return true;
  const days = daysSince(touch, now);
  return days !== null && days > STALE_AFTER_DAYS;
}

function agoLabel(text: string, now: Date): string {
  const days = daysSince(text, now);
  if (days === null) return "QUIET";
  if (days >= 45) return `${Math.max(1, Math.round(days / 30))} MO`;
  if (days >= 14) return `${Math.round(days / 7)} WK`;
  return `${days} DAYS`;
}

function birthdayLabel(text: string, now: Date): string {
  const birthday = monthDay(text);
  if (!birthday) return "BDAY";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const event = new Date(now.getFullYear(), birthday.month, birthday.day);
  const diff = Math.round((event.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  return `${MONTH_LABEL[birthday.month]} ${birthday.day}`;
}

function listsSource(person: Person, source: Connector): boolean {
  return person.sources.some((item) => {
    const value = item.toLowerCase();
    return source.aliases.some((alias) => value.includes(alias));
  });
}

function channelFor(person: Person): DraftChannel {
  const blob = `${person.last} ${person.sources.join(" ")}`.toLowerCase();
  if (blob.includes("instagram")) return "Instagram";
  if (blob.includes("whatsapp")) return "WhatsApp";
  if (blob.includes("linkedin")) return "LinkedIn";
  if (blob.includes("slack")) return "Slack";
  if (blob.includes("gmail") || blob.includes("email")) return "Email";
  return "SMS";
}

function sentences(parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/[.!?]+$/u, ""))
    .filter(Boolean)
    .join(". ");
}

/**
 * A body the recipient could receive. Open loops, next plans, talking points,
 * and other record fields are private notes, so they stay off the message.
 */
export function draftBody(person: Person): string {
  const first = person.name.trim().split(/\s+/)[0] || person.name;
  return `Hi ${first}.`;
}

function quoteRecord(person: Person): string {
  return sentences([person.name, person.role, person.birthday, person.last, person.next, person.loop, ...person.points]);
}

function liveText(source: Connector, people: Person[], person?: Person): string {
  const head = `${source.name} is a live connector.`;
  if (person) {
    if (!listsSource(person, source)) return `${head} ${person.name}'s record does not list ${source.name}.`;
    return `${head} ${person.name}'s record lists ${source.name}. Last touch: ${person.last}. Open loop: ${person.loop}`;
  }
  const rows = people.filter((item) => listsSource(item, source));
  if (!rows.length) return `${head} No stored record lists ${source.name}.`;
  return `${head} ${rows.map((item) => `${item.name}'s record lists ${source.name}. Last touch: ${item.last}.`).join(" ")}`;
}

function isSourceWord(token: string): boolean {
  const value = token.toLowerCase().trim();
  return sourcesNamed(value).some((source) => source.aliases.includes(value));
}

function classifyFragment(raw: string, people: Person[]): { person?: Person; unknown?: string; ambiguous?: Person[] } | null {
  let text = raw.trim().replace(/^(?:the|a|an|my|our|your)\s+/i, "");
  text = text.replace(/\b(?:on|via|through)\s+[\p{L}0-9][\p{L}0-9 .'’-]*$/iu, "").trim();
  text = text.split(/\b(?:before|after|from|in|at|this|next|last|about)\b/i)[0]?.trim() ?? "";
  text = text.replace(/(?:'s|’s)$/i, "").trim();
  if (!text) return null;
  const lower = text.toLocaleLowerCase();
  if (STOP.has(lower) || isSourceWord(lower)) return null;
  const full = people.filter((person) => person.name.trim() && mentions(lower, person.name));
  if (full.length === 1) return { person: full[0] };
  if (full.length > 1) return { ambiguous: full };
  const token = text.match(/^[\p{L}][\p{L}'’.-]*/u)?.[0] ?? "";
  const tokenLower = token.toLocaleLowerCase();
  if (!token || STOP.has(tokenLower) || isSourceWord(tokenLower)) return null;
  if (!/^[\p{L}][\p{L}'’.-]*$/u.test(token)) return null;
  const byFirst = people.filter((person) => {
    const first = person.name.trim().split(/\s+/)[0]?.toLocaleLowerCase();
    return !!first && first.length >= 2 && (tokenLower === first || lower.startsWith(`${first} `));
  });
  if (byFirst.length === 1) return { person: byFirst[0] };
  if (byFirst.length > 1) return { ambiguous: byFirst };
  return { unknown: token };
}

function resolveAsk(text: string, people: Person[]): { person?: Person; unknown?: string; ambiguous?: Person[] } {
  const chunks = [...text.matchAll(/\b(?:on|about|for|to|with|regarding)\s+([^?.!]+)/gi)].map((match) => match[1]);
  for (const match of text.matchAll(/\b([\p{L}][\p{L}'’.-]{2,})(?:'s|’s)\b/giu)) chunks.push(match[1]);
  let person: Person | undefined;
  let unknown: string | undefined;
  let ambiguous: Person[] | undefined;
  for (const chunk of chunks) {
    for (const piece of chunk.split(/\b(?:and|or)\b/i)) {
      const hit = classifyFragment(piece, people);
      if (!hit) continue;
      if (hit.ambiguous && !ambiguous) ambiguous = hit.ambiguous;
      if (hit.person && !person) person = hit.person;
      if (hit.unknown && !unknown) unknown = hit.unknown;
    }
  }
  if (person) return { person, unknown };
  if (ambiguous) return { ambiguous };
  return { unknown };
}

function rosterIntent(text: string): boolean {
  return /\b(birthdays?|conflicts?|double-?book|thursday|lately|haven'?t|lost touch|catch up|check in|briefs?|pregame|draft|write|congrats|congratulate|reply|coffee)\b/i.test(text);
}

function peopleCard(title: string, rows: { id: string; meta: string; right: string }[]): ChatReply["tool"] {
  if (!rows.length) return undefined;
  return { toolName: "show_people", args: { title, people: rows } };
}

function briefReply(person: Person): ChatReply {
  return { text: sentences([person.name, person.next, person.loop]), tool: { toolName: "pregame_brief", args: { recordId: person.id } } };
}

function draftReply(person: Person): ChatReply {
  return {
    text: `Draft only. ${person.name}. ${person.loop}`,
    tool: { toolName: "draft_message", args: { recordId: person.id, channel: channelFor(person), body: draftBody(person) } },
  };
}

function conflictReply(people: Person[], calendar: StoredEvent[]): ChatReply {
  const busy = calendar.filter((event) => !/\(free/i.test(event.title));
  const grouped = new Map<string, StoredEvent[]>();
  for (const event of busy) {
    const list = grouped.get(event.when) ?? [];
    list.push(event);
    grouped.set(event.when, list);
  }
  const clash = [...grouped.entries()].find(([, events]) => events.length >= 2);
  if (!clash) return { text: "No overlap is stored on the calendar." };
  const [when, events] = clash;
  const day = when.split(" ")[0] ?? when;
  const free = calendar.find((event) => event.when.startsWith(day) && /\(free/i.test(event.title));
  const personId = events.find((event) => event.person)?.person;
  const person = personId ? people.find((item) => item.id === personId) : undefined;
  const text = `The stored calendar overlaps on ${when}: ${events.map((event) => event.title).join(" and ")}.${free ? ` A stored free slot is ${free.when}.` : ""}`;
  return {
    text,
    tool: {
      toolName: "resolve_conflict",
      args: {
        slot: when.toUpperCase(),
        a: { title: events[0].title, source: events[0].source, where: events[0].where },
        b: { title: events[1]?.title ?? "", source: events[1]?.source ?? "", where: events[1]?.where ?? "" },
        ...(person ? { draft: { recordId: person.id, channel: channelFor(person), body: draftBody(person) } } : {}),
      },
    },
  };
}

function connected(source: Connector): boolean {
  return isLiveConnector(source.id);
}

function prefixLocal(sources: Connector[], text: string): string {
  const lead = sources.filter((source) => !connected(source)).map((source) => `${source.name} is not connected.`).join(" ");
  return [lead, text].filter(Boolean).join(" ");
}

/**
 * Answers from the roster and the stored calendar.
 * A local integration switch is not a connection, even when it is on.
 * `toggles` is accepted so callers can pass that switch state; it does not change the reply.
 */
export function replyFromRecords(input: string, people: Person[], toggles: Record<string, boolean> = {}, now = new Date()): ChatReply {
  void toggles;
  const sources = sourcesNamed(input);
  const locals = sources.filter((source) => !connected(source));
  const lives = sources.filter((source) => connected(source));
  const asked = resolveAsk(input, people);

  if (asked.ambiguous) {
    const names = asked.ambiguous.map((person) => person.name.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const list = names.length === 2 ? `${names[0]} or ${names[1]}` : names.join(", ");
    return { text: prefixLocal(locals, `Which person? ${list}.`) };
  }

  if (asked.unknown) {
    const known = asked.person ? ` ${quoteRecord(asked.person)}` : "";
    return { text: prefixLocal(locals, `${asked.unknown} is not in the records.${known}`) };
  }

  const person = asked.person;
  const wantsRecord = rosterIntent(input) || (!!person && /\b(record|notes?|about|who)\b/i.test(input));

  if (locals.length && !wantsRecord) {
    const lead = locals.map((source) => `${source.name} is not connected.`).join(" ");
    const live = lives.map((source) => liveText(source, people, person)).join(" ");
    if (person) return { text: [lead, live, quoteRecord(person)].filter(Boolean).join(" ") };
    if (/\bwho\b/i.test(input)) {
      const rows = people.filter((item) => locals.some((source) => listsSource(item, source)));
      return {
        text: [lead, live].filter(Boolean).join(" "),
        tool: peopleCard(
          `${locals[0].name.toUpperCase()} ON THE RECORD`,
          rows.map((item) => ({ id: item.id, meta: `${item.role} · ${item.sources[0] ?? "record"}`, right: "RECORD" })),
        ),
      };
    }
    return { text: [lead, live].filter(Boolean).join(" ") };
  }

  if (lives.length && !wantsRecord) return { text: lives.map((source) => liveText(source, people, person)).join(" ") };

  let reply: ChatReply | null = null;
  if (/\b(briefs?|pregame|coffee)\b/i.test(input) && !/\b(draft|write|congrats|reply)\b/i.test(input)) {
    const chosen = person ?? people.find((item) => item.id === "marcus");
    reply = chosen ? briefReply(chosen) : { text: "That person is not in the records." };
  } else if (person && /\b(draft|write|message|congrats|congratulate|reply|birthday)\b/i.test(input)) {
    reply = draftReply(person);
  } else if (/\b(conflicts?|double-?book|thursday)\b/i.test(input)) {
    reply = conflictReply(people, SAMPLE_CALENDAR);
  } else if (/\bbirthdays?\b/i.test(input)) {
    const celebrating = people.filter((item) => birthdayThisWeek(item.birthday, now));
    reply = {
      text: celebrating.length === 0 ? "No birthdays this week are stored." : celebrating.length === 1 ? "One birthday this week is stored." : `${celebrating.length} birthdays this week are stored.`,
      tool: peopleCard(
        "BIRTHDAYS THIS WEEK",
        celebrating.map((item) => ({ id: item.id, meta: `${item.role} · ${item.sources[0] ?? "record"}`, right: birthdayLabel(item.birthday, now) })),
      ),
    };
  } else if (/\b(lately|haven'?t|lost touch|catch up|check in)\b/i.test(input)) {
    const quiet = people.filter((item) => neglected(item, now)).sort((a, b) => (daysSince(b.last, now) ?? 0) - (daysSince(a.last, now) ?? 0));
    reply = {
      text: quiet.length ? "These stored records are past a week since the last touch." : "Every stored record has a last touch within a week.",
      tool: peopleCard(
        "COOLING OFF",
        quiet.map((item) => ({ id: item.id, meta: item.last, right: agoLabel(item.last, now) })),
      ),
    };
  } else if (person) {
    reply = briefReply(person);
  }

  if (!reply) return { text: prefixLocal(locals, lives.length ? lives.map((source) => liveText(source, people, person)).join(" ") : "I can only answer from the records stored here.") };
  if (lives.length && wantsRecord) reply = { ...reply, text: `${lives.map((source) => liveText(source, people, person)).join(" ")} ${reply.text}` };
  return { ...reply, text: prefixLocal(locals, reply.text) };
}
