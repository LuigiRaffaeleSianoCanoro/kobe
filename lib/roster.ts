import type { Sql } from "postgres";
import { z } from "zod";
import { SEED_ROSTER, type Person } from "./data";
import { sql } from "./db";

const line = (max: number) => z.string().trim().max(max);

// What Add person is allowed to write. Rapport is not in here: an assist is the only way it moves.
export const PersonWrite = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: line(200),
  role: line(200),
  tier: line(40),
  birthday: line(200),
  last: line(200),
  next: line(200),
  loop: line(2000),
  points: z.array(line(500)).max(20),
  sources: z.array(line(80)).max(20),
});
export type PersonWrite = z.infer<typeof PersonWrite>;

function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function rowToPerson(row: Person): Person {
  return {
    id: row.id,
    name: row.name ?? "",
    role: row.role ?? "",
    tier: row.tier ?? "",
    birthday: row.birthday ?? "",
    last: row.last ?? "",
    next: row.next ?? "",
    points: asStrings(row.points),
    loop: row.loop ?? "",
    sources: asStrings(row.sources),
    rapport: Number.isFinite(Number(row.rapport)) ? Number(row.rapport) : 50,
  };
}

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
    if (rows.length) return rows.map(rowToPerson);
    console.warn("[kobe] The people table is empty. Using the sample roster.");
  } catch (error) {
    console.error("[kobe] Could not read people. Using the sample roster.", error);
  }
  return SEED_ROSTER;
}

// Insert a person, or update their record without touching rapport. The season log adds rapport later.
export async function savePerson(db: Sql, input: PersonWrite): Promise<Person> {
  const rows = await db<Person[]>`
    insert into people (id, name, role, tier, birthday, last_touch, next_up, rapport, points, open_loop, sources)
    values (
      ${input.id}, ${input.name}, ${input.role}, ${input.tier}, ${input.birthday},
      ${input.last}, ${input.next}, 50, ${db.json(input.points)}, ${input.loop}, ${input.sources}
    )
    on conflict (id) do update set
      name = excluded.name,
      role = excluded.role,
      tier = excluded.tier,
      birthday = excluded.birthday,
      last_touch = excluded.last_touch,
      next_up = excluded.next_up,
      points = excluded.points,
      open_loop = excluded.open_loop,
      sources = excluded.sources
    returning id, name, coalesce(role, '') as role, tier, coalesce(birthday, '') as birthday,
      coalesce(last_touch, '') as last, coalesce(next_up, '') as next, rapport, points,
      coalesce(open_loop, '') as loop, sources`;
  const row = rows[0];
  if (!row) throw new Error("The people table did not return the saved record.");
  return rowToPerson(row);
}
