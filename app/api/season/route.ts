import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!sql) return Response.json({ persisted: false });
  const [season] = await sql`select xp, assists, streak from season where id = 'me'`;
  const people = await sql`select id, rapport from people`;
  const plays = await sql`select play_id from plays where day = current_date`;
  return Response.json({
    persisted: true,
    xp: season?.xp ?? 0,
    assists: season?.assists ?? 0,
    streak: season?.streak ?? 0,
    rapport: Object.fromEntries(people.map((p) => [p.id, p.rapport])),
    plays: plays.map((p) => p.play_id),
  });
}

type Event =
  | { type: "assist"; personId?: string; channel: string; body?: string; xp: number }
  | { type: "play"; playId: string; xp: number };

export async function POST(req: Request) {
  if (!sql) return Response.json({ persisted: false });
  const e = (await req.json()) as Event;
  const xp = Math.max(0, Math.min(100, Math.trunc(e.xp)));

  await sql.begin(async (tx) => {
    if (e.type === "assist") {
      await tx`update season set xp = xp + ${xp}, assists = assists + 1 where id = 'me'`;
      if (e.personId) {
        await tx`insert into touches (person_id, channel, body) values (${e.personId}, ${e.channel}, ${e.body ?? null})`;
        await tx`update people set rapport = least(99, rapport + 3), last_touch = ${`${e.channel} · just now`} where id = ${e.personId}`;
      }
    } else if (e.type === "play") {
      const inserted = await tx`insert into plays (play_id) values (${e.playId}) on conflict do nothing returning play_id`;
      if (inserted.length) await tx`update season set xp = xp + ${xp} where id = 'me'`;
    }
  });
  return Response.json({ persisted: true });
}
