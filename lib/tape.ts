import { z } from "zod";

// A clip is a past situation already written on a person. Nothing here is fetched from an account.
export type TapeSource = {
  id: string;
  name: string;
  role: string;
  last: string;
  next: string;
  points: string[];
  loop: string;
};

export type TapeClip = TapeSource & {
  situation: string;
  notes: string[];
  read: string;
};

export const NOTE_MAX = 400;
export const TAPE_STORAGE_KEY = "kobe.game-tape.v1";

export const CoachingNote = z.object({
  personId: z.string().min(1).max(64),
  note: z.string().min(1).max(NOTE_MAX),
});

// `note` may be empty: that clears the coaching on this person.
export const CoachingWrite = z.object({
  personId: z.string().min(1).max(64),
  note: z.string().max(NOTE_MAX),
});

export const CoachingList = z.array(CoachingNote).max(20);

export type CoachingItem = z.infer<typeof CoachingNote>;

type Clean = { ok: true; note: string } | { ok: false; empty: boolean };

export function cleanNote(raw: string): Clean {
  const note = raw.replace(/\s+/g, " ").trim();
  if (!note) return { ok: false, empty: true };
  if (note.length > NOTE_MAX) return { ok: false, empty: false };
  return { ok: true, note };
}

export function clipFrom(person: TapeSource): TapeClip {
  const notes = Array.isArray(person.points) ? person.points.map((n) => String(n).trim()).filter(Boolean) : [];
  const situation = person.loop.trim();
  const parts: string[] = [];
  if (situation) parts.push(situation);
  if (person.last.trim()) parts.push(`Last touch on the record: ${person.last.trim()}.`);
  if (notes.length) parts.push(`Notes already here: ${notes.join(". ")}.`);
  const read = parts.length ? parts.join(" ") : "There are no notes on this record to review.";
  return {
    ...person,
    points: notes,
    situation: situation || "No open loop on this record.",
    notes,
    read,
  };
}

export function withCoaching(text: string, note: string | undefined): string {
  if (!note) return text;
  return `${text} Luigi's coaching on this situation: ${note}`;
}

// Saved notes first, then the note Luigi just wrote. Ids that are not on the roster are dropped.
export function mergeCoaching(rosterIds: ReadonlySet<string>, saved: CoachingItem[], fromClient: CoachingItem[]): CoachingItem[] {
  const map = new Map<string, string>();
  for (const item of saved) {
    const cleaned = cleanNote(item.note);
    if (cleaned.ok && rosterIds.has(item.personId)) map.set(item.personId, cleaned.note);
  }
  for (const item of fromClient) {
    const cleaned = cleanNote(item.note);
    if (cleaned.ok && rosterIds.has(item.personId)) map.set(item.personId, cleaned.note);
  }
  return [...map].map(([personId, note]) => ({ personId, note }));
}

export function coachingBlock(roster: { id: string; name: string }[], notes: CoachingItem[]): string {
  const names = new Map(roster.map((p) => [p.id, p.name]));
  const lines = notes.filter((n) => names.has(n.personId)).map((n) => `- ${names.get(n.personId)}: ${n.note}`);
  return lines.length ? lines.join("\n") : "None yet.";
}

export type StoredCoaching = { note: string; at: string; pending?: boolean };

const EPOCH = new Date(0).toISOString();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The server list is the whole set after a successful read. Ids off the roster, blank notes, and oversized notes are dropped.
export function adoptServerCoaching(rosterIds: ReadonlySet<string>, notes: readonly unknown[]): Record<string, StoredCoaching> {
  const out: Record<string, StoredCoaching> = {};
  for (const row of notes) {
    if (!row || typeof row !== "object") continue;
    const { personId, note, at } = row as { personId?: unknown; note?: unknown; at?: unknown };
    if (typeof personId !== "string" || !rosterIds.has(personId) || typeof note !== "string") continue;
    const cleaned = cleanNote(note);
    if (!cleaned.ok) continue;
    out[personId] = { note: cleaned.note, at: typeof at === "string" && at ? at : EPOCH };
  }
  return out;
}

// Synced local notes follow the server. A pending save or a pending clear stays until the server agrees.
export function coachingFromServer(
  rosterIds: ReadonlySet<string>,
  server: readonly unknown[],
  local: Record<string, StoredCoaching>,
): Record<string, StoredCoaching> {
  const next = adoptServerCoaching(rosterIds, server);
  for (const [id, value] of Object.entries(local)) {
    if (!value?.pending || !rosterIds.has(id)) continue;
    if (!value.note) {
      delete next[id];
      next[id] = { note: "", at: value.at, pending: true };
      continue;
    }
    if (next[id]?.note === value.note) continue;
    next[id] = { note: value.note, at: value.at, pending: true };
  }
  return next;
}

// True when they asked to review the tape and did not name someone on the roster.
export function isTapeListRequest(text: string, names: readonly string[]): boolean {
  const asked = text.toLowerCase();
  if (!/(game tape|review the tape)/.test(asked)) return false;
  return !names.some((name) => {
    const first = name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) return false;
    return new RegExp(`\\b${escapeRegExp(first)}\\b`).test(asked);
  });
}

export function parseStoredCoaching(raw: unknown): Record<string, StoredCoaching> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, StoredCoaching> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id || id.length > 64 || !value || typeof value !== "object") continue;
    const note = (value as { note?: unknown }).note;
    const at = (value as { at?: unknown }).at;
    const pending = (value as { pending?: unknown }).pending === true;
    if (typeof note !== "string" || typeof at !== "string") continue;
    if (pending && !note.trim()) {
      out[id] = { note: "", at, pending: true };
      continue;
    }
    const cleaned = cleanNote(note);
    if (!cleaned.ok) continue;
    out[id] = pending ? { note: cleaned.note, at, pending: true } : { note: cleaned.note, at };
  }
  return out;
}
