import { handleConnectorSend } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  const raw = await req.text();
  if (raw.length > 8_000) return Response.json({ error: "Too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = null;
  }
  const outcome = await handleConnectorSend(body);
  return Response.json(outcome.body, { status: outcome.status });
}
