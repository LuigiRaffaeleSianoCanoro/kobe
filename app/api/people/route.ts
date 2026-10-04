import { sql } from "@/lib/db";
import { PersonWrite, savePerson } from "@/lib/roster";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  const parsed = PersonWrite.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This record could not be saved." }, { status: 400 });
  try {
    return Response.json(await savePerson(sql, parsed.data));
  } catch (error) {
    console.error("[kobe] Could not save person.", error);
    return Response.json({ error: "Couldn't save this person." }, { status: 500 });
  }
}
