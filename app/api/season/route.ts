import type { Sql } from "postgres";
import { ASSIST_XP, PLAYS } from "@/lib/data";
import { sql } from "@/lib/db";
import { SeasonEvent, type Season } from "@/lib/season";

export const dynamic = "force-dynamic";

async function readSeason(db: Sql): Promise<Season> {
  const [season] = await db`
    select xp, assists,
           case when last_active >= current_date - 1 then streak else 0 end as streak,
           coalesce(last_active = current_date, false) as active_today
    from season where id = 'me'`;
  const people = await db`select id, rapport, coalesce(last_touch, '') as last from people`;
  const plays = await db`select play_id from plays where day = current_date`;
  return {
    xp: season?.xp ?? 0,
    assists: season?.assists ?? 0,
    streak: season?.streak ?? 0,
    activeToday: season?.active_today ?? false,
    plays: plays.map((p) => p.play_id),
    people: Object.fromEntries(people.map((p) => [p.id, { rapport: p.rapport, last: p.last }])),
  };
}

export async function GET() {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  return Response.json(await readSeason(sql));
}

export async function POST(req: Request) {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  const parsed = SeasonEvent.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid event." }, { status: 400 });
  const e = parsed.data;

  const known = await sql.begin(async (tx) => {
    if (e.type === "assist" && e.personId) {
      const [person] = await tx`
        update people set rapport = least(99, rapport + 3), last_touch = ${`${e.channel} · just now`}
        where id = ${e.personId} returning id`;
      if (!person) return false;
      await tx`insert into touches (person_id, channel, body) values (${e.personId}, ${e.channel}, ${e.body})`;
    }
    if (e.type === "play") {
      const [fresh] = await tx`insert into plays (play_id) values (${e.playId}) on conflict do nothing returning play_id`;
      // Already counted today: replaying the event changes nothing.
      if (!fresh) return true;
    }
    const xp = e.type === "assist" ? ASSIST_XP : PLAYS.find((p) => p.id === e.playId)!.xp;
    await tx`
      update season set
        xp = xp + ${xp},
        assists = assists + ${e.type === "assist" ? 1 : 0},
        streak = case when last_active = current_date then streak
                      when last_active = current_date - 1 then streak + 1
                      else 1 end,
        last_active = current_date
      where id = 'me'`;
    return true;
  });
  if (!known) return Response.json({ error: "Unknown person." }, { status: 400 });
  return Response.json(await readSeason(sql));
}
