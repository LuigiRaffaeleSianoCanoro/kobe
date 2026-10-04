import { SEED_ROSTER, type Person } from "./data";
import { sql } from "./db";
import type { TouchNote } from "./highlights";
import { newestTouches } from "./touch-log";

export { SAMPLE_CALENDAR } from "./calendar";

// The page and /api/chat both read the roster here, so the agent and the cards see the same people.
// The seed covers a missing, unreachable or empty database, so the roster is never empty.
export async function loadRoster(): Promise<Person[]> {
  if (!sql) return SEED_ROSTER;
  try {
    const rows = await sql<Person[]>`
      select id, name, coalesce(role, '') as role, tier, coalesce(birthday, '') as birthday,
             coalesce(last_touch, '') as last, coalesce(next_up, '') as next, rapport, points,
             coalesce(open_loop, '') as loop, sources
      from people order by rapport desc`;
    if (rows.length) return [...rows];
    console.warn("[kobe] The people table is empty. Using the sample roster.");
  } catch (error) {
    console.error("[kobe] Could not read people. Using the sample roster.", error);
  }
  return SEED_ROSTER;
}

// Newest drafts in the last two weeks. Ascending limit would keep the oldest rows and drop this week.
export async function loadTouches(): Promise<TouchNote[]> {
  if (!sql) return [];
  try {
    const rows = await sql<{ person_id: string | null; channel: string | null; body: string | null; created_at: Date | string }[]>`
      select person_id, channel, coalesce(body, '') as body, created_at
      from touches
      where created_at >= now() - interval '14 days'
      order by created_at desc
      limit 100`;
    const notes = rows.flatMap((row) => {
      if (!row.person_id) return [];
      const at = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
      if (Number.isNaN(at.getTime())) return [];
      return [{ personId: row.person_id, channel: row.channel ?? "", body: row.body ?? "", at: at.toISOString() }];
    });
    return newestTouches(notes);
  } catch (error) {
    console.error("[kobe] Could not read logged drafts. The mixtape will use the records only.", error);
    return [];
  }
}
