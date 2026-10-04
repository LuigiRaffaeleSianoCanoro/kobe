import { createAgentReply } from "@/server/agent-reply";

export const maxDuration = 60;

const MAX_BODY_CHARS = 100_000;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return Response.json({ text: "That note is too long." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ text: "Kobe couldn't read that." }, { status: 400 });
  }
  return Response.json(await createAgentReply(body));
}
