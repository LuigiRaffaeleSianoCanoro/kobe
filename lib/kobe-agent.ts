import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CALENDAR, loadRoster, type RosterEntry } from "./roster";

// Any model in the Neon AI Gateway catalog works. The default is open-weight, so the same
// agent can later point at a self-hosted OpenAI-compatible server running the same model.
const MODEL = process.env.KOBE_MODEL ?? "neon/gpt-oss-120b";

const CHANNELS = ["Instagram", "WhatsApp", "LinkedIn", "SMS", "Email"] as const;

function instructions(roster: RosterEntry[]) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `You are Kobe, a personal relationship agent. Mamba mentality applied to the people who matter: show up prepared and never miss the small things.

Today is ${today}. The ROSTER and CALENDAR below are the only facts you know. Never invent people, dates, events or details.

Style: one or two short sentences, warm and direct, with a light basketball flavor. Then call exactly one tool so the user sees a card:
- show_people: any list of people (birthdays coming up, who is cooling off, who to check in with).
- pregame_brief: before meeting someone, or when asked about a specific person.
- draft_message: when asked to write, reply, congratulate or wish someone well. Write the body in the user's own voice, specific to that person's details, under 280 characters. Pick the channel they last used.
- resolve_conflict: when two calendar events overlap. Propose a fix and include a draft to the person affected.
Never say a message was sent; the user sends it from the card. After a tool returns, do not repeat what the card shows.

ROSTER:
${JSON.stringify(roster)}

CALENDAR:
${JSON.stringify(CALENDAR)}`;
}

export async function buildKobeAgent() {
  const roster = await loadRoster();
  const ids = roster.map((r) => r.id) as [string, ...string[]];
  const personId = z.enum(ids);
  const draft = z.object({
    recordId: personId,
    channel: z.enum(CHANNELS),
    body: z.string().describe("The message, in the user's voice"),
  });
  const slot = z.object({ title: z.string(), source: z.string(), where: z.string() });

  const show_people = createTool({
    id: "show_people",
    description: "Show a ranked list of people from the roster as a card.",
    inputSchema: z.object({
      title: z.string().describe("Short uppercase heading, e.g. BIRTHDAYS · NEXT 10 DAYS"),
      people: z
        .array(
          z.object({
            id: personId,
            meta: z.string().describe("Relationship · source, e.g. College roommate · Instagram"),
            right: z.string().describe("Short uppercase tag, e.g. TOMORROW, OCT 9, 9 DAYS"),
          }),
        )
        .min(1)
        .max(5),
    }),
    execute: async ({ people }) => ({ shown: people.length }),
  });

  const pregame_brief = createTool({
    id: "pregame_brief",
    description: "Show a pregame brief card for one person: talking points and open loops.",
    inputSchema: z.object({ recordId: personId }),
    execute: async ({ recordId }) => {
      const p = roster.find((r) => r.id === recordId)!;
      return { name: p.name, next: p.next, points: p.points, loop: p.loop };
    },
  });

  const draft_message = createTool({
    id: "draft_message",
    description: "Show a message draft card the user can edit and send.",
    inputSchema: draft,
    execute: async ({ recordId }) => ({ to: roster.find((r) => r.id === recordId)!.name, status: "awaiting user" }),
  });

  const resolve_conflict = createTool({
    id: "resolve_conflict",
    description: "Show two overlapping calendar events side by side plus a draft that fixes the clash.",
    inputSchema: z.object({ slot: z.string().describe("e.g. THU 7:00 PM"), a: slot, b: slot, draft }),
    execute: async () => ({ status: "awaiting user" }),
  });

  return new Agent({
    id: "kobe",
    name: "Kobe",
    instructions: instructions(roster),
    model: MODEL,
    tools: { show_people, pregame_brief, draft_message, resolve_conflict },
  });
}
