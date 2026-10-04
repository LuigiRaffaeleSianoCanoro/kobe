import { toAISdkStream } from "@mastra/ai-sdk";
import { createUIMessageStream, createUIMessageStreamResponse, safeValidateUIMessages } from "ai";
import { readCoaching } from "@/lib/coaching-db";
import { buildKobeAgent } from "@/lib/kobe-agent";
import { loadRoster } from "@/lib/roster";
import { CoachingList, mergeCoaching } from "@/lib/tape";

export const maxDuration = 60;

// There is no server-side memory: the browser resends the thread every turn, so cap what one request can carry.
const MAX_BODY_CHARS = 100_000;
const MAX_MESSAGES = 30;

function parse(raw: string): { messages: unknown; coaching: unknown } {
  try {
    const body = JSON.parse(raw) as { messages?: unknown; coaching?: unknown };
    return { messages: body.messages, coaching: body.coaching };
  } catch {
    return { messages: undefined, coaching: undefined };
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return Response.json({ error: "This conversation is too long. Reload to start a new one." }, { status: 413 });
  const body = parse(raw);
  const parsed = await safeValidateUIMessages({ messages: body.messages });
  if (!parsed.success) return Response.json({ error: "Invalid messages." }, { status: 400 });
  // Instructions come from the server only. Coaching is a separate field, checked against the roster.
  const messages = parsed.data.filter((m) => m.role !== "system").slice(-MAX_MESSAGES);
  const fromClient = CoachingList.safeParse(body.coaching).data ?? [];
  const roster = await loadRoster();
  const saved = ((await readCoaching()) ?? []).map(({ personId, note }) => ({ personId, note }));
  const agent = await buildKobeAgent(mergeCoaching(new Set(roster.map((person) => person.id)), saved, fromClient));
  const stream = await agent.stream(messages, { maxSteps: 3 });

  const ui = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.merge(toAISdkStream(stream, { from: "agent", version: "v7" }));
    },
    onError: (error) => {
      console.error("[kobe] agent error", error);
      return "Kobe couldn't reach the model. Check the Neon AI Gateway credentials.";
    },
  });
  return createUIMessageStreamResponse({ stream: ui });
}
