import { toAISdkStream } from "@mastra/ai-sdk";
import { createUIMessageStream, createUIMessageStreamResponse, safeValidateUIMessages, type UIMessage } from "ai";
import { buildKobeAgent } from "@/lib/kobe-agent";

export const maxDuration = 60;

// There is no server-side memory: the browser resends the thread every turn, so cap what one request can carry.
const MAX_BODY_CHARS = 100_000;
const MAX_MESSAGES = 30;

function parse(raw: string): unknown {
  try {
    return (JSON.parse(raw) as { messages?: unknown }).messages;
  } catch {
    return undefined;
  }
}

// The page posts a card after each WhatsApp import. The model reads the card's one-line summary instead.
function withImportSummaries(message: UIMessage): UIMessage {
  const parts = message.parts.map((part) =>
    part.type === "data-whatsapp-import" ? { type: "text" as const, text: String((part.data as { summary?: unknown }).summary ?? "") } : part,
  );
  return { ...message, parts };
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return Response.json({ error: "This conversation is too long. Reload to start a new one." }, { status: 413 });
  const parsed = await safeValidateUIMessages({ messages: parse(raw) });
  if (!parsed.success) return Response.json({ error: "Invalid messages." }, { status: 400 });
  // Instructions come from the server only.
  const messages = parsed.data
    .filter((m) => m.role !== "system")
    .slice(-MAX_MESSAGES)
    .map(withImportSummaries);

  const agent = await buildKobeAgent();
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
