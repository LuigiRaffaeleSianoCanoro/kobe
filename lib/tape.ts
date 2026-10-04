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

export function parseStoredCoaching(raw: unknown): Record<string, { note: string; at: string }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { note: string; at: string }> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id || id.length > 64 || !value || typeof value !== "object") continue;
    const note = (value as { note?: unknown }).note;
    const at = (value as { at?: unknown }).at;
    if (typeof note !== "string" || typeof at !== "string") continue;
    const cleaned = cleanNote(note);
    if (!cleaned.ok) continue;
    out[id] = { note: cleaned.note, at };
  }
  return out;
}
