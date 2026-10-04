import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import type { RecordId } from "./data";
import { game } from "./game";

type ToolCall = { toolName: string; args: Record<string, unknown> };
type Reply = { text: string; tool?: ToolCall };

const person = (id: RecordId, meta: string, right: string) => ({ id, meta, right });

function reply(input: string): Reply {
  const t = input.toLowerCase();
  if (/maya/.test(t) && /(draft|message|write|birthday)/.test(t))
    return {
      text: "Kept it warm and specific. She posted from a Brooklyn run club last week.",
      tool: { toolName: "draft_message", args: { recordId: "maya", channel: "Instagram", body: "Happy birthday Maya! 29 looks good on you. Hope Brooklyn is treating you right. Send me that half marathon training plan, I want in." } },
    };
  if (/\bdev\b/.test(t))
    return {
      text: "He asked about the 17th. Your calendar is open that morning.",
      tool: { toolName: "draft_message", args: { recordId: "dev", channel: "WhatsApp", body: "Sorry for the slow reply! I'm free the morning of the 17th, count me in for the move. I'll bring the truck playlist." } },
    };
  if (/priya/.test(t))
    return {
      text: "She prefers voice notes, but here is a text version.",
      tool: { toolName: "draft_message", args: { recordId: "priya", channel: "LinkedIn", body: "Huge congrats on Head of Design at Northwind! Well deserved. Coffee soon for real this time? My treat." } },
    };
  if (/(thursday|conflict|double|resolve)/.test(t))
    return {
      text: "Foul on the schedule. Thursday 7:00 PM has dinner with Jordan and Product sync. The sync has a free 5:30 slot, or we push dinner to 8.",
      tool: {
        toolName: "resolve_conflict",
        args: {
          slot: "THU 7:00 PM",
          a: { title: "Dinner with Jordan", source: "PARTIFUL", where: "Nopa" },
          b: { title: "Product sync", source: "GOOGLE CALENDAR", where: "Zoom" },
          draft: { recordId: "jordan", channel: "WhatsApp", body: "Hey! Still on for Thursday. Any chance we push to 8? Work thing ran over. I'll bring dessert for Biscuit's welcome party." },
        },
      },
    };
  if (/birthday/.test(t))
    return {
      text: "Three birthdays in the next 10 days. Shot clock is running on Maya.",
      tool: { toolName: "show_people", args: { title: "BIRTHDAYS · NEXT 10 DAYS", people: [person("maya", "College roommate · Instagram", "TOMORROW"), person("jordan", "Rec league · Partiful", "OCT 9"), person("priya", "Ex-colleague · LinkedIn", "OCT 13")] } },
    };
  if (/(marcus|brief|coffee|pregame)/.test(t))
    return { text: "Here's your pregame for 3:30. Pulled from your Sep 12 Fathom call and Gmail.", tool: { toolName: "pregame_brief", args: { recordId: "marcus" } } };
  if (/(lately|haven|talk|lost touch|catch up|check in)/.test(t))
    return {
      text: "These people are cooling off. One touch each keeps them in the rotation.",
      tool: { toolName: "show_people", args: { title: "COOLING OFF", people: [person("dev", "Unanswered WhatsApp", "9 DAYS"), person("priya", "Last LinkedIn like", "2 MO"), person("maya", "Last Instagram DM", "6 WK")] } },
    };
  const connected = Object.entries(game.get().sources).filter(([, on]) => on).length;
  return { text: `I checked your ${connected} connected sources and found nothing new on that. Connect more in Integrations to widen what I can see.` };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

function lastUserText(messages: readonly ThreadMessage[]) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.content.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
}

// Local scripted agent: streams text, then a tool call whose result renders as a card.
// Swap for a Mastra/AI SDK backend by replacing this adapter.
export const kobeAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const r = reply(lastUserText(messages));
    await sleep(650, abortSignal);

    const words = r.text.split(" ");
    let text = "";
    for (let i = 0; i < words.length; i++) {
      text += (i ? " " : "") + words[i];
      yield { content: [{ type: "text", text }] };
      await sleep(28, abortSignal);
    }

    if (!r.tool) return;
    await sleep(220, abortSignal);
    yield {
      content: [
        { type: "text", text },
        {
          type: "tool-call",
          toolCallId: `call_${Date.now()}`,
          toolName: r.tool.toolName,
          args: r.tool.args as never,
          argsText: JSON.stringify(r.tool.args),
          result: { ok: true },
        },
      ],
      status: { type: "complete", reason: "stop" },
    };
  },
};
