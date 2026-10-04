import { toAISdkStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStream, createUIMessageStreamResponse, safeValidateUIMessages, type UIMessage } from "ai";
import { parseChatRequest } from "@/lib/chat-request";
import { readCoaching } from "@/lib/coaching-db";
import { USER_TEXT } from "@/lib/connectors";
import { buildKobeAgent } from "@/lib/kobe-agent";
import { loadRoster } from "@/lib/roster";
import { CoachingList, mergeCoaching } from "@/lib/tape";

export const maxDuration = 60;

// There is no server-side memory: the browser resends the thread every turn, so cap what one request can carry.
const MAX_BODY_CHARS = 100_000;
const MAX_MESSAGES = 30;

const MODEL_ERROR = "Kobe couldn't reach the model. Check the Neon AI Gateway credentials.";

// The page posts a card after each WhatsApp import. The model reads the card's one-line summary instead;
// a card without one is dropped rather than sent as an empty turn.
function withImportSummaries(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    const parts = message.parts.flatMap((part) => {
      if (part.type !== "data-whatsapp-import") return [part];
      const summary = (part.data as { summary?: unknown } | null)?.summary;
      return typeof summary === "string" && summary.trim() ? [{ type: "text" as const, text: summary }] : [];
    });
    return parts.length ? [{ ...message, parts }] : [];
  });
}

export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return new Response("Expected application/json.", { status: 415 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return new Response("This conversation is too long. Reload to start a new one.", { status: 413 });
  const body = parseChatRequest(raw);
  const parsed = await safeValidateUIMessages({ messages: body.messages });
  if (!parsed.success) return new Response("Invalid messages.", { status: 400 });
  // Instructions come from the server only. Coaching is a separate field, checked against the roster.
  const messages = withImportSummaries(parsed.data.filter((m) => m.role !== "system").slice(-MAX_MESSAGES));
  const fromClient = CoachingList.safeParse(body.coaching).data ?? [];
  const roster = await loadRoster();
  const saved = ((await readCoaching()) ?? []).map(({ personId, note }) => ({ personId, note }));

  const requestContext = new RequestContext();
  requestContext.setRaw(USER_TEXT, lastUserText(messages));

  const agent = await buildKobeAgent(mergeCoaching(new Set(roster.map((person) => person.id)), saved, fromClient), { voice: body.voice });
  const stream = await agent.stream(messages, { maxSteps: 3, requestContext });

  const ui = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.merge(
        toAISdkStream(stream, {
          from: "agent",
          version: "v7",
          onError: (error) => {
            console.error("[kobe] agent error", error);
            return MODEL_ERROR;
          },
        }),
      );
    },
    onError: (error) => {
      console.error("[kobe] agent error", error);
      return MODEL_ERROR;
    },
  });
  return createUIMessageStreamResponse({ stream: ui });
}

function lastUserText(messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]) {
  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return "";
  return last.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .trim();
}
