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

  if (/maya/.test(t) && /(draft|message|write|birthday)/.test(t))
    return {
      text: coached("maya", "Kept it warm and specific. She posted from a Brooklyn run club last week."),
      tool: { toolName: "draft_message", args: { recordId: "maya", channel: "Instagram", body: "Happy birthday Maya! 29 looks good on you. Hope Brooklyn is treating you right. Send me that half marathon training plan, I want in." } },
    };
  if (/\bdev\b/.test(t))
    return {
      text: coached("dev", "He asked about the 17th. Your calendar is open that morning."),
      tool: { toolName: "draft_message", args: { recordId: "dev", channel: "WhatsApp", body: "Sorry for the slow reply! I'm free the morning of the 17th, count me in for the move. I'll bring the truck playlist." } },
    };
  if (/priya/.test(t))
    return {
      text: coached("priya", "She prefers voice notes, but here is a text version."),
      tool: { toolName: "draft_message", args: { recordId: "priya", channel: "LinkedIn", body: "Huge congrats on Head of Design at Northwind! Well deserved. Coffee soon for real this time? My treat." } },
    };
  if (/(thursday|conflict|double|resolve)/.test(t))
    return {
      text: coached("jordan", "Foul on the schedule. Thursday 7:00 PM has dinner with Jordan and Product sync. The sync has a free 5:30 slot, or we push dinner to 8."),
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
  if (/\bmarcus\b/.test(t) || (/\b(brief|coffee|pregame)\b/.test(t) && !ROSTER_NAME.test(t) && !/\bsarah\b/.test(t)))
    return { text: coached("marcus", "Here's your pregame for the 3:30 coffee."), tool: { toolName: "pregame_brief", args: { recordId: "marcus" } } };
  if (/(lately|haven|talk|lost touch|catch up|check in)/.test(t))
    return {
      text: "These people are cooling off. One touch each keeps them in the rotation.",
      tool: { toolName: "show_people", args: { title: "COOLING OFF", people: [person("dev", "Unanswered WhatsApp", "9 DAYS"), person("priya", "Last LinkedIn like", "2 MO"), person("maya", "Last Instagram DM", "6 WK")] } },
    };
  if (wantsMixtape(t))
    return { text: "Here's this week's mixtape. Every line is already on a stored record.", tool: { toolName: "weekly_highlights", args: {} } };

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
