import { SEED_ROSTER, type Person } from "./data";
import { sql } from "./db";

// Sample calendar for the demo. No calendar integration reads or replaces it yet.
export const SAMPLE_CALENDAR = [
  { when: "Today 3:30 PM", title: "Coffee with Marcus Reid", source: "GOOGLE CALENDAR", where: "Blue Bottle", person: "marcus" },
  { when: "Thu 7:00 PM", title: "Dinner with Jordan Blake", source: "PARTIFUL", where: "Nopa", person: "jordan" },
  { when: "Thu 7:00 PM", title: "Product sync", source: "GOOGLE CALENDAR", where: "Zoom" },
  { when: "Thu 5:30 PM", title: "(free slot)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 17 morning", title: "(free)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 18 7:00 PM", title: "Family dinner", source: "GOOGLE CALENDAR", where: "Mom's place", person: "dev" },
];

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
