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

const META: readonly CardMetaField[] = ["role", "lastTouch"];
const RIGHT: readonly CardRightField[] = ["birthday", "lastTouch", "none"];

type Named = { id: string; name: string };

function isMeta(value: unknown): value is CardMetaField {
  return typeof value === "string" && META.includes(value as CardMetaField);
}

function isRight(value: unknown): value is CardRightField {
  return typeof value === "string" && RIGHT.includes(value as CardRightField);
}

function fallbackText(people?: PersonCard[], brief?: BriefCard, draft?: DraftCard): string {
  if (draft) return "Here's a draft. You send it.";
  if (brief) return "Pregame.";
  if (people?.length) return "Here's who I found.";
  return "I don't have anything new on that.";
}

/**
 * Model output -> the card shape the court already renders.
 * `sent` is never copied. The draft stays unsent until the user hits Send.
 */
export function toAgentReply(value: unknown, people: readonly Named[]): AgentReply {
  const known = new Map<string, string>();
  for (const person of people) {
    const id = person.id.trim();
    if (id) known.set(id, person.name.trim());
  }
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = typeof raw.text === "string" ? raw.text.trim() : "";

  let cards: PersonCard[] | undefined;
  if (Array.isArray(raw.people)) {
    const next: PersonCard[] = [];
    const seen = new Set<string>();
    for (const item of raw.people) {
      if (!item || typeof item !== "object") continue;
      const card = item as Record<string, unknown>;
      const id = typeof card.id === "string" ? card.id.trim() : "";
      if (!id || !known.has(id) || seen.has(id) || !isMeta(card.metaField) || !isRight(card.rightField)) continue;
      seen.add(id);
      next.push({ id, metaField: card.metaField, rightField: card.rightField });
      if (next.length === 5) break;
    }
    if (next.length) cards = next;
  }

  let brief: BriefCard | undefined;
  if (raw.brief && typeof raw.brief === "object") {
    const id = (raw.brief as Record<string, unknown>).id;
    if (typeof id === "string" && known.has(id.trim())) brief = { id: id.trim() };
  }

  let draft: DraftCard | undefined;
  if (raw.draft && typeof raw.draft === "object") {
    const item = raw.draft as Record<string, unknown>;
    const body = typeof item.body === "string" ? item.body.trim() : "";
    const channel = typeof item.channel === "string" ? item.channel.trim() : "";
    const toRaw = typeof item.to === "string" ? item.to.trim() : "";
    const named = known.get(toRaw);
    const to = named || toRaw;
    if (body && channel && to) draft = { to, channel, body };
  }

  const reply: AgentReply = { text: text || fallbackText(cards, brief, draft) };
  if (cards) reply.people = cards;
  if (brief) reply.brief = brief;
  if (draft) reply.draft = draft;
  return reply;
}

const UNAVAILABLE = "Kobe couldn't reach the model. Check the Neon AI Gateway credentials.";

/**
 * Asks the server for a reply. The Neon AI Gateway token stays in the server process;
 * this module is part of the Vite client and must not read it.
 */
export async function reply(text: string, sources: Record<string, boolean>, people: readonly Person[], personId?: string): Promise<AgentReply> {
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sources, people, personId }),
    });
    if (!response.ok) return { text: UNAVAILABLE };
    const payload: unknown = await response.json();
    return toAgentReply(payload, people);
  } catch {
    return { text: UNAVAILABLE };
  }
}
