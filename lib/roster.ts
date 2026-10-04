import { RECORDS, type PersonRecord } from "./data";
import { sql } from "./db";

export type RosterEntry = Pick<PersonRecord, "name" | "role" | "tier" | "birthday" | "last" | "next" | "points" | "loop" | "sources"> & {
  id: string;
  rapport: number;
};

export const CALENDAR = [
  { when: "Today 3:30 PM", title: "Coffee with Marcus Reid", source: "GOOGLE CALENDAR", where: "Blue Bottle", person: "marcus" },
  { when: "Thu 7:00 PM", title: "Dinner with Jordan Blake", source: "PARTIFUL", where: "Nopa", person: "jordan" },
  { when: "Thu 7:00 PM", title: "Product sync", source: "GOOGLE CALENDAR", where: "Zoom" },
  { when: "Thu 5:30 PM", title: "(free slot)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 17 morning", title: "(free)", source: "GOOGLE CALENDAR", where: "" },
  { when: "Oct 18 7:00 PM", title: "Family dinner", source: "GOOGLE CALENDAR", where: "Mom's place", person: "dev" },
];

// Reads people from Postgres when DATABASE_URL is set, otherwise from the bundled seed.
export async function loadRoster(): Promise<RosterEntry[]> {
  if (sql) {
    try {
      const rows = await sql`select id, name, role, tier, birthday, last_touch, next_up, rapport, points, open_loop, sources from people order by rapport desc`;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        tier: r.tier,
        birthday: r.birthday,
        last: r.last_touch,
        next: r.next_up,
        rapport: r.rapport,
        points: r.points,
        loop: r.open_loop,
        sources: r.sources,
      }));
    } catch {
      // Fall through to the seed so the agent keeps working if the database is unreachable.
    }
  }
  return Object.entries(RECORDS).map(([id, r]) => ({ id, rapport: r.score, ...r }));
}
