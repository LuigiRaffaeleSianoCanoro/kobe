import { sql } from "./db";

export type SavedCoaching = { personId: string; note: string; at: string };

// Null means there is no database. An empty list means the table was missing or had no rows.
export async function readCoaching(): Promise<SavedCoaching[] | null> {
  if (!sql) return null;
  try {
    const rows = await sql<{ person_id: string; note: string; at: Date }[]>`
      select person_id, note, updated_at as at from coaching_notes order by updated_at desc`;
    return rows.map((row) => ({
      personId: row.person_id,
      note: row.note,
      at: new Date(row.at).toISOString(),
    }));
  } catch (error) {
    console.error("[kobe] Could not read coaching notes. Re-run db/schema.sql if this database predates game tape.", error);
    return [];
  }
}

export async function writeCoaching(personId: string, note: string | null) {
  if (!sql) throw new Error("No database configured.");
  if (note === null) {
    await sql`delete from coaching_notes where person_id = ${personId}`;
    return;
  }
  await sql`
    insert into coaching_notes (person_id, note)
    values (${personId}, ${note})
    on conflict (person_id) do update set note = excluded.note, updated_at = now()`;
}
