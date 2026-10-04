import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { VOICE_STYLE } from "./chat-request";
import { connectorInstructions, connectorMailbox, createConnectorTools, isLiveConnector, liveConnectors, type LiveConnectors, type Mailbox } from "./connectors";
import { DRAFT_CHANNELS, type Person } from "./data";
import { weeklyMixtape } from "./highlights";
import { conditionFits, mentionsConnectedAccount, planDetail, recordSupports, PLAN_CONDITIONS } from "./plans";
import { SAMPLE_CALENDAR, loadRoster, loadTouches } from "./roster";
import { coachingBlock, type CoachingItem } from "./tape";

// Any model in the Neon AI Gateway catalog works. The default is open-weight, so the same
// agent can later point at a self-hosted OpenAI-compatible server running the same model.
const MODEL = process.env.KOBE_MODEL ?? "neon/gpt-oss-120b";

function instructions(roster: Person[], coaching: CoachingItem[], flags: { gmail: boolean; slack: boolean }, voice: boolean) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `You are Kobe, a personal relationship agent. Mamba mentality applied to the people who matter: show up prepared and never miss the small things.

Today is ${today}. The ROSTER, CALENDAR and COACHING NOTES below are the only facts you know. Never invent people, dates, events, accounts or details. Coaching notes are a review of a past situation already on that person's record. They are not a connected inbox or social account. Follow a coaching note whenever that person comes up.

Style: one or two short sentences, warm and direct, with a light basketball flavor. Then call exactly one tool so the user sees a card:
- show_people: any list of people (birthdays coming up, who is cooling off, who to check in with).
- pregame_brief: before meeting someone, or when asked about a specific person. Also use this when they name a person and ask what happened with them, or ask you to review that person's tape.
- draft_message: when asked to write, reply, congratulate or wish someone well. The body is a message the recipient can read, in the user's voice, under 280 characters. Do not include private notes, open loops, talking points, next plans, or other internal record fields. Pick the channel they last used.
- resolve_conflict: when two calendar events overlap. Propose a fix and include a draft to the person affected. That draft body follows the same rule: no private notes.
- set_plan: the user wants a trigger, routine, reminder, or game-plan item kept on someone already on the roster. kind is "trigger" or "routine". A trigger condition is birthday, last_touch, next_up, or open_loop, and it must already be on that person's record. A routine condition is daily or weekly. The label names the plan. The prompt is the short ask Kobe should run later, such as "Brief me on Marcus".
- weekly_highlights: this week's mixtape from dates already on the stored records. Call it for highlights, a mixtape, a recap, or what happened this week when no specific person is named. Do not list the events yourself. A named person, or any brief, is not the mixtape.
The draft card is where a message is sent. Do not say a message was sent. A draft created in this turn does not send. Sending waits until the user confirms a draft they already saw. After a tool returns, do not repeat what the card shows. The set_plan card does not save until the user confirms.
If they ask you to watch an inbox, social network, calendar account, or any integration that is not connected, call no tool. Never invent a person or a connected account.
${connectorInstructions(flags)}

ROSTER:
${JSON.stringify(roster)}

CALENDAR (sample data already in the app, not a connected account):
${JSON.stringify(SAMPLE_CALENDAR)}

COACHING NOTES:
${coachingBlock(roster, coaching)}${voice ? `\n\n${VOICE_STYLE}` : ""}`;
}

export async function buildKobeAgent(coaching: CoachingItem[] = [], options?: { connectors?: LiveConnectors; mailbox?: Mailbox; voice?: boolean }) {
  const roster = await loadRoster();
  const probed = options?.connectors ?? (await liveConnectors());
  const mailbox = options?.mailbox ?? connectorMailbox;
  // A token probe is not a registered sender. This app does not register one, so the agent does not claim Gmail or Slack.
  const connectors = {
    gmail: isLiveConnector("gmail") ? probed.gmail : null,
    slack: isLiveConnector("slack") ? probed.slack : null,
  };
  const flags = { gmail: connectors.gmail !== null, slack: connectors.slack !== null };
  const [first, ...rest] = roster.map((r) => r.id);
  if (!first) throw new Error("Kobe needs at least one person in the roster.");
  const personId = z.enum([first, ...rest]);
  const draft = z.object({
    recordId: personId,
    channel: z.enum(DRAFT_CHANNELS),
    body: z.string().describe("A message the recipient can read. No private notes, open loops, talking points, next plans, or internal record fields."),
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
    description: "Show a message draft on a card. Send happens from that card. The body must be safe for the recipient to read, with no private notes.",
    inputSchema: draft,
    execute: async ({ recordId }) => ({ to: roster.find((r) => r.id === recordId)!.name, status: "awaiting user" }),
  });

  const weekly_highlights = createTool({
    id: "weekly_highlights",
    description: "Show this week's mixtape. The server fills it from stored records, their notes, logged drafts, and the sample calendar. Call this for highlights, a mixtape, a recap, or what happened this week when no person is named. Do not use it for a named person or a brief.",
    inputSchema: z.object({
      scope: z.string().optional().describe("Ignored. The server chooses the week and the tracks."),
    }),
    execute: async () => weeklyMixtape(roster, SAMPLE_CALENDAR, new Date(), await loadTouches()),
  });

  const set_plan = createTool({
    id: "set_plan",
    description: "Propose a trigger or routine saved on a person already on the roster. The user confirms before it is stored. Do not use this for a connected account.",
    inputSchema: z.object({
      recordId: personId,
      kind: z.enum(["trigger", "routine"]),
      condition: z.enum(PLAN_CONDITIONS),
      label: z.string().describe("Short label, from the record, with no account or integration name"),
      prompt: z.string().describe("What to ask Kobe when they run it, under 280 characters"),
    }),
    execute: async ({ recordId, kind, condition, label, prompt }) => {
      const person = roster.find((item) => item.id === recordId);
      if (!person) return { ok: false, reason: "That person isn't on the roster." };
      if (!conditionFits(kind, condition)) return { ok: false, reason: "That condition doesn't match a trigger or a routine." };
      if (mentionsConnectedAccount(`${label}\n${prompt}`)) return { ok: false, reason: "No accounts are connected. Set this from their record." };
      if (!recordSupports(person, condition)) return { ok: false, reason: `${person.name}'s record doesn't have that, so I won't invent it.` };
      return { ok: true, name: person.name, detail: planDetail(person, condition) };
    },
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
    instructions: instructions(
      roster,
      coaching.filter((note) => roster.some((person) => person.id === note.personId)),
      flags,
      options?.voice ?? false,
    ),
    model: MODEL,
    tools: {
      show_people,
      pregame_brief,
      draft_message,
      resolve_conflict,
      set_plan,
      weekly_highlights,
      ...createConnectorTools({ gmail: connectors.gmail, slack: connectors.slack, mailbox }),
    },
  });
}
