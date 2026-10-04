import { toAISdkStream } from "@mastra/ai-sdk";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { buildKobeAgent } from "@/lib/kobe-agent";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] };
  const agent = await buildKobeAgent();
  const stream = await agent.stream(messages as never, { maxSteps: 3 });

  const ui = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.merge(toAISdkStream(stream, { from: "agent" }) as never);
    },
    onError: (error) => {
      console.error("[kobe] agent error", error);
      return "Kobe couldn't reach the model. Check the Neon AI Gateway credentials.";
    },
  });
  return createUIMessageStreamResponse({ stream: ui });
}
