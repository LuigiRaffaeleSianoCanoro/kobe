import { PlanId, PlanWrite, planIdReuse, recordSupports, type Plan } from "@/lib/plans";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  personId: string;
  kind: Plan["kind"];
  condition: Plan["condition"];
  label: string;
  prompt: string;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";
}

export async function GET() {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  try {
    const plans = await sql<PlanRow[]>`
      select id, person_id as "personId", kind, condition, label, prompt
      from plans order by created_at asc`;
    return Response.json({ plans });
  } catch (error) {
    console.error("[kobe] could not read plans", error);
    return Response.json({ error: "Couldn't read plans." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  const parsed = PlanWrite.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan." }, { status: 400 });
  }
  const plan = parsed.data;

  try {
    const saved = await sql.begin(async (tx) => {
      const [person] = await tx<{ birthday: string; last: string; next: string; loop: string; name: string }[]>`
        select name, coalesce(birthday, '') as birthday, coalesce(last_touch, '') as last,
               coalesce(next_up, '') as next, coalesce(open_loop, '') as loop
        from people where id = ${plan.personId}`;
      if (!person) return { error: "That person isn't on the roster.", status: 400 as const };
      if (!recordSupports(person, plan.condition)) {
        return { error: `${person.name}'s record doesn't have that, so I won't invent it.`, status: 400 as const };
      }
      const [row] = await tx<PlanRow[]>`
        insert into plans (id, person_id, kind, condition, label, prompt)
        values (${plan.id}, ${plan.personId}, ${plan.kind}, ${plan.condition}, ${plan.label}, ${plan.prompt})
        on conflict (id) do nothing
        returning id, person_id as "personId", kind, condition, label, prompt`;
      if (row) return { plan: row, duplicate: false };
      const [byId] = await tx<PlanRow[]>`
        select id, person_id as "personId", kind, condition, label, prompt
        from plans where id = ${plan.id}`;
      if (byId && planIdReuse(byId, plan) === "duplicate") return { plan: byId, duplicate: true };
      if (byId) return { error: "That plan id is already on a different record.", status: 409 as const };
      return { error: "Couldn't save that on their record.", status: 409 as const };
    });
    if ("error" in saved) return Response.json({ error: saved.error }, { status: saved.status });
    return Response.json(saved);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [existing] = await sql<PlanRow[]>`
        select id, person_id as "personId", kind, condition, label, prompt
        from plans
        where person_id = ${plan.personId} and kind = ${plan.kind} and condition = ${plan.condition}`;
      if (existing) return Response.json({ plan: existing, duplicate: true });
    }
    console.error("[kobe] could not save plan", error);
    return Response.json({ error: "Couldn't save that on their record." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!sql) return Response.json({ error: "No database configured." }, { status: 404 });
  const parsed = PlanId.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid plan." }, { status: 400 });
  const [row] = await sql<{ id: string }[]>`delete from plans where id = ${parsed.data.id} returning id`;
  if (!row) return Response.json({ error: "That plan isn't on the record." }, { status: 404 });
  return Response.json({ ok: true });
}
