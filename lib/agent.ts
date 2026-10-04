import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { coachingFor } from "./coaching-memory";
import { promptForPerson, RECORDS, type RecordId } from "./data";
import { rosterNow, sourceToggles } from "./game";
import { offlinePlanReply } from "./plans";
import { replyFromRecords } from "./records-chat";
import { clipFrom, withCoaching, type TapeSource } from "./tape";

type ToolCall = { toolName: string; args: Record<string, unknown> };
type Reply = { text: string; tool?: ToolCall };

const ROSTER_NAME = /\b(maya|marcus|jordan|priya|dev)\b/;

const person = (id: RecordId, meta: string, right: string) => ({
  id,
  meta: coachingFor(id) ? `${meta} · coached` : meta,
  right,
});

function asTape(id: RecordId): TapeSource {
  const record = RECORDS[id];
  return { id, name: record.name, role: record.role, last: record.last, next: record.next, points: record.points, loop: record.loop };
}

function mentioned(text: string): RecordId | null {
  if (/\bmarcus\b/.test(text)) return "marcus";
  if (/\bmaya\b/.test(text)) return "maya";
  if (/\bjordan\b/.test(text)) return "jordan";
  if (/\bpriya\b/.test(text)) return "priya";
  if (/\bdev\b/.test(text)) return "dev";
  return null;
}

function coached(id: RecordId, text: string) {
  return withCoaching(text, coachingFor(id));
}

function wantsMixtape(text: string): boolean {
  const asks = /\b(mixtapes?|highlights?)\b/.test(text) || /what happened/.test(text) || /week in review/.test(text);
  if (!asks) return false;
  if (/\bbrief\b/.test(text) || ROSTER_NAME.test(text)) return false;
  return true;
}

// Plans, game tape, and the mixtape stay on this page. Every other reply comes from stored records.
export function scriptedReply(input: string): Reply {
  const plan = offlinePlanReply(
    input,
    rosterNow().map((entry) => ({ ...entry, prompt: promptForPerson(entry.id, entry.name) })),
  );
  if (plan?.args) return { text: plan.text, tool: { toolName: "set_plan", args: plan.args } };
  if (plan) return { text: plan.text };

  const t = input.toLowerCase();
  if (/(game tape|review the tape|\bcoach\b)/.test(t)) {
    const id = mentioned(t);
    if (!id) {
      return {
        text: "These situations are already on the roster. Pick one and coach me. No inbox or social account is connected.",
        tool: {
          toolName: "show_people",
          args: {
            title: "GAME TAPE",
            people: (Object.keys(RECORDS) as RecordId[]).map((rid) => person(rid, RECORDS[rid].loop, "TAPE")),
          },
        },
      };
    }
    return { text: coached(id, clipFrom(asTape(id)).read), tool: { toolName: "pregame_brief", args: { recordId: id } } };
  }

  if (wantsMixtape(t)) return { text: "Here's this week's mixtape. Every line is already on a stored record.", tool: { toolName: "weekly_highlights", args: {} } };

  return replyFromRecords(input, rosterNow(), sourceToggles());
}

export const reply = scriptedReply;

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

// Local stand-in for /api/chat: streams a reply from stored records, then a tool call whose result renders as a card.
export const kobeAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const r = scriptedReply(lastUserText(messages));
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
