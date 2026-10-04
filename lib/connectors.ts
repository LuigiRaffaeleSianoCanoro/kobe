// Gmail and Slack can actually send. Every other integration switch is local:
// turning it on does not connect the account, and chat has to say so.
export type Connector = {
  id: string;
  name: string;
  live: boolean;
  mono: string;
  desc: string;
  aliases: string[];
};

export const CONNECTORS: Connector[] = [
  { id: "instagram", name: "Instagram", live: false, mono: "IG", desc: "DMs, stories, birthdays", aliases: ["instagram"] },
  { id: "linkedin", name: "LinkedIn", live: false, mono: "IN", desc: "Job changes and posts", aliases: ["linkedin"] },
  { id: "x", name: "X", live: false, mono: "X", desc: "Mentions and DMs", aliases: ["twitter"] },
  { id: "facebook", name: "Facebook", live: false, mono: "FB", desc: "Birthdays and events", aliases: ["facebook"] },
  { id: "fathom", name: "Fathom", live: false, mono: "FA", desc: "Call recordings and notes", aliases: ["fathom"] },
  { id: "zoom", name: "Zoom", live: false, mono: "ZM", desc: "Meetings and transcripts", aliases: ["zoom"] },
  { id: "meet", name: "Google Meet", live: false, mono: "GM", desc: "Transcripts and attendees", aliases: ["google meet"] },
  { id: "gmail", name: "Gmail", live: true, mono: "GM", desc: "Threads and contacts", aliases: ["gmail", "email"] },
  { id: "gcal", name: "Google Calendar", live: false, mono: "GC", desc: "Events and invites", aliases: ["google calendar", "gcal", "calendar"] },
  { id: "partiful", name: "Partiful", live: false, mono: "PA", desc: "Parties and RSVPs", aliases: ["partiful"] },
  { id: "luma", name: "Luma", live: false, mono: "LU", desc: "Events and guest lists", aliases: ["luma"] },
  { id: "telegram", name: "Telegram", live: false, mono: "TG", desc: "Chat with Kobe in a DM", aliases: ["telegram"] },
  { id: "whatsapp", name: "WhatsApp", live: false, mono: "WA", desc: "Briefs and nudges by message", aliases: ["whatsapp"] },
  { id: "slack", name: "Slack", live: true, mono: "SL", desc: "/kobe in your workspace", aliases: ["slack"] },
  { id: "discord", name: "Discord", live: false, mono: "DC", desc: "/kobe brief @name", aliases: ["discord"] },
  { id: "sms", name: "SMS", live: false, mono: "SM", desc: "Text messages", aliases: ["sms", "text message"] },
];

export const LIVE_CONNECTORS = CONNECTORS.filter((connector) => connector.live);

const LIVE_IDS = new Set(LIVE_CONNECTORS.map((connector) => connector.id));

export function isLiveConnector(id: string): boolean {
  return LIVE_IDS.has(id);
}

export function connectorById(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

export const TOGGLE_KEY = "kobe.source-toggles.v1";

// These start on so the switch is visibly local: chat still says the source is not connected.
export const DEFAULT_TOGGLES: Record<string, boolean> = { instagram: true, gcal: true, fathom: true };

export function sanitizeToggles(value: unknown): Record<string, boolean> {
  const toggles = { ...DEFAULT_TOGGLES };
  if (!value || typeof value !== "object") return toggles;
  for (const [id, on] of Object.entries(value as Record<string, unknown>)) {
    if (typeof on === "boolean" && !isLiveConnector(id) && connectorById(id)) toggles[id] = on;
  }
  return toggles;
}

export function readToggleStorage(): Record<string, boolean> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOGGLE_KEY);
    if (!raw) return null;
    return sanitizeToggles(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeToggleStorage(toggles: Record<string, boolean>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(TOGGLE_KEY, JSON.stringify(sanitizeToggles(toggles)));
  } catch {
    // The switch still updates this session when the browser rejects the write.
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sources named in the text. Longer aliases win, so "google calendar" is not also a second hit. */
export function sourcesNamed(text: string): Connector[] {
  const found: Connector[] = [];
  let masked = text.toLowerCase();
  const aliases = CONNECTORS.flatMap((connector) => connector.aliases.map((alias) => ({ alias, connector }))).sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, connector } of aliases) {
    const pattern = new RegExp(`(?<![a-z])${escapeRegExp(alias)}(?![a-z])`, "i");
    if (!pattern.test(masked)) continue;
    if (!found.some((item) => item.id === connector.id)) found.push(connector);
    masked = masked.replace(pattern, " ".repeat(alias.length));
  }
  return found;
}

export type LiveSender = (message: { to: string; body: string }) => Promise<{ ok: true } | { ok: false; reason?: string }>;

export type SendResult = { ok: true } | { ok: false; reason: string };

const senders: Partial<Record<"gmail" | "slack", LiveSender>> = {};

export function registerLiveSender(id: "gmail" | "slack", sender: LiveSender | null) {
  if (sender) senders[id] = sender;
  else delete senders[id];
}

export function resetLiveSenders() {
  delete senders.gmail;
  delete senders.slack;
}

const CHANNEL_IDS: Record<string, string> = {
  instagram: "instagram",
  whatsapp: "whatsapp",
  linkedin: "linkedin",
  sms: "sms",
  email: "gmail",
  gmail: "gmail",
  slack: "slack",
};

export function channelConnector(channel: string): Connector | undefined {
  const id = CHANNEL_IDS[channel.trim().toLowerCase()];
  return id ? connectorById(id) : undefined;
}

/** Sends only through Gmail or Slack, and only when that connector actually accepts the message. */
export async function deliverDraft(channel: string, message: { to: string; body: string }): Promise<SendResult> {
  const source = channelConnector(channel);
  if (!source?.live) return { ok: false, reason: `${source?.name ?? channel} is not connected.` };
  const sender = senders[source.id as "gmail" | "slack"];
  if (!sender) return { ok: false, reason: `${source.name} did not send this draft.` };
  try {
    const result = await sender(message);
    if (!result.ok) return { ok: false, reason: result.reason || `${source.name} did not send this draft.` };
    return { ok: true };
  } catch {
    return { ok: false, reason: `${source.name} did not send this draft.` };
  }
}

export function rapportForSend(result: SendResult): { sent: boolean; rapportDelta: number } {
  if (!result.ok) return { sent: false, rapportDelta: 0 };
  return { sent: true, rapportDelta: 3 };
}
