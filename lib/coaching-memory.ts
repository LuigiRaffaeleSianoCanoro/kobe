// The scripted agent reads the note just saved in this browser. The live agent reads the database.
let notes: Record<string, string> = {};

export function publishCoaching(next: Record<string, string>) {
  notes = next;
}

export function coachingFor(personId: string | undefined): string | undefined {
  if (!personId) return undefined;
  return notes[personId] || undefined;
}
