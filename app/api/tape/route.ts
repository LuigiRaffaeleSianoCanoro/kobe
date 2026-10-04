import { readCoaching, writeCoaching } from "@/lib/coaching-db";
import { sql } from "@/lib/db";
import { loadRoster } from "@/lib/roster";
import { cleanNote, CoachingWrite } from "@/lib/tape";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  const notes = await readCoaching();
  if (notes === null) return Response.json({ error: "Coaching notes could not be read." }, { status: 503 });
  return Response.json({ notes });
}

export async function POST(req: Request) {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Use application/json." }, { status: 415 });
  }
  const parsed = CoachingWrite.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid coaching note." }, { status: 400 });

  const roster = await loadRoster();
  if (!roster.some((person) => person.id === parsed.data.personId)) {
    return Response.json({ error: "That person is not on the roster." }, { status: 400 });
  }

  const cleaned = cleanNote(parsed.data.note);
  if (!cleaned.ok && !cleaned.empty) return Response.json({ error: "Coaching note is too long." }, { status: 400 });

  try {
    await writeCoaching(parsed.data.personId, cleaned.ok ? cleaned.note : null);
  } catch (error) {
    console.error("[kobe] Could not save coaching note.", error);
    return Response.json({ error: "Coaching note was not saved." }, { status: 503 });
  }
  const notes = await readCoaching();
  if (notes === null) return Response.json({ error: "Coaching notes could not be read." }, { status: 503 });
  return Response.json({ notes });
}
