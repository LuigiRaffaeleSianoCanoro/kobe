// The scripted agent and the chat transport read the note Luigi just saved, without a server round trip.
let notes: Record<string, string> = {};

export function publishCoaching(next: Record<string, string>) {
  notes = next;
}

export function coachingFor(personId: string | undefined): string | undefined {
  if (!personId) return undefined;
  return notes[personId] || undefined;
}

export function coachingPayload(): { personId: string; note: string }[] {
  return Object.entries(notes).map(([personId, note]) => ({ personId, note }));
}
