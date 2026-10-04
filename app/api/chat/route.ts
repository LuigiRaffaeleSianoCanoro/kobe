import { toAISdkStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createUIMessageStream, createUIMessageStreamResponse, safeValidateUIMessages } from "ai";
import { USER_TEXT } from "@/lib/connectors";
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

const MODEL_ERROR = "Kobe couldn't reach the model. Check the Neon AI Gateway credentials.";

export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return new Response("Expected application/json.", { status: 415 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return new Response("This conversation is too long. Reload to start a new one.", { status: 413 });
  const parsed = await safeValidateUIMessages({ messages: parse(raw) });
  if (!parsed.success) return new Response("Invalid messages.", { status: 400 });
  // Instructions come from the server only.
  const messages = parsed.data.filter((m) => m.role !== "system").slice(-MAX_MESSAGES);

  const requestContext = new RequestContext();
  requestContext.setRaw(USER_TEXT, lastUserText(messages));

  const agent = await buildKobeAgent();
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
