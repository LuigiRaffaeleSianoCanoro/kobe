import type { TouchNote } from "./highlights";

/** The mixtape reads at most this many recent touches. Keep the newest, not the oldest. */
export const TOUCH_CAP = 100;

export function newestTouches<T extends { at: string }>(rows: readonly T[], limit = TOUCH_CAP): T[] {
  return [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-limit);
}

/** Drop only the touch whose save failed. Later touches that already landed stay. */
export function dropFailedTouch<T>(touches: readonly T[], failed: T | null): T[] {
  if (!failed) return [...touches];
  return touches.filter((item) => item !== failed);
}

export function knownToDatabase(persisted: boolean, personId: string | undefined, serverIds: ReadonlySet<string>): boolean {
  return persisted && !!personId && serverIds.has(personId);
}

/**
 * "Logged to their record" is only true after the database accepts a person it already has.
 * Someone added in the app has an id Postgres will reject.
 */
export function recordSavedBody(persisted: boolean, personId: string | undefined, serverIds: ReadonlySet<string>): string {
  if (persisted && personId && !serverIds.has(personId)) {
    return "Not saved. This person was added in the app and is not in the database.";
  }
  if (!persisted) return "Saved in this browser.";
  return "Logged to their record. Rapport +3.";
}

export function rememberTouch(touches: readonly TouchNote[], touch: TouchNote | null): TouchNote[] {
  if (!touch) return [...touches];
  return newestTouches([...touches, touch]);
}
