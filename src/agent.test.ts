import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { reply, toAgentReply, type AgentReply } from "./agent.ts";
import type { Person } from "./crm.ts";

const roster = [
  { id: "maya", name: "Maya Chen" },
  { id: "marcus", name: "Marcus Reid" },
];

test("maps a people card and drops unknown or duplicate ids", () => {
  const result = toAgentReply(
    {
      text: "Two birthdays.",
      sent: true,
      people: [
        { id: "maya", metaField: "role", rightField: "birthday" },
        { id: "nope", metaField: "role", rightField: "birthday" },
        { id: "maya", metaField: "role", rightField: "birthday" },
        { id: "marcus", metaField: "nope", rightField: "birthday" },
      ],
    },
    roster,
  );
  assert.deepEqual(result, {
    text: "Two birthdays.",
    people: [{ id: "maya", metaField: "role", rightField: "birthday" }],
  });
  assert.equal("sent" in result, false);
});

test("maps a brief and a draft, and rewrites an id in the draft name", () => {
  const brief = toAgentReply({ text: "Pregame for Marcus.", brief: { id: "marcus" }, draft: null }, roster);
  assert.deepEqual(brief.brief, { id: "marcus" });
  const draft = toAgentReply(
    { text: "Here's a draft.", draft: { to: "maya", channel: "Instagram", body: "Happy birthday" } },
    roster,
  );
  assert.deepEqual(draft.draft, { to: "Maya Chen", channel: "Instagram", body: "Happy birthday" });
  assert.equal(draft.sent, undefined);
});

test("omits cards that cannot render", () => {
  const result = toAgentReply(
    {
      text: "   ",
      people: [],
      brief: { id: "missing" },
      draft: { to: "", channel: "Instagram", body: "Hi" },
    },
    roster,
  );
  assert.deepEqual(result, { text: "I don't have anything new on that." });
});

test("keeps a brief when the model leaves the text blank", () => {
  const result = toAgentReply({ text: "", brief: { id: " marcus " } }, roster);
  assert.equal(result.text, "Pregame.");
  assert.deepEqual(result.brief, { id: "marcus" });
});

test("the Vite client posts to the server and does not keep sent", async () => {
  const calls: { url: string; body: string }[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    const payload = { text: "Pregame for Marcus.", sent: true, brief: { id: "marcus" } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const people = [{ id: "marcus", name: "Marcus Reid" }] as Person[];
    const result: AgentReply = await reply("Brief me on Marcus", { gmail: true }, people);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/agent");
    const posted = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    assert.deepEqual(Object.keys(posted).sort(), ["people", "sources", "text"]);
    assert.equal(JSON.stringify(posted).includes("NEON_AI_GATEWAY"), false);
    assert.deepEqual(result, { text: "Pregame for Marcus.", brief: { id: "marcus" } });
    assert.equal("sent" in result, false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("a refused response does not become a card", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("Sign in with any username and your KOBE_PASSWORD.", { status: 401 });
  try {
    const result = await reply("Brief me", {}, [{ id: "marcus", name: "Marcus Reid" }] as Person[]);
    assert.deepEqual(result, { text: "Kobe couldn't reach the model. Check the Neon AI Gateway credentials." });
    assert.equal(result.brief, undefined);
  } finally {
    globalThis.fetch = previous;
  }
});

test("the Next app does not grow a second agent route", () => {
  assert.equal(existsSync(new URL("../app/api/agent/route.ts", import.meta.url)), false);
});

test("the client module never references the gateway token or provider", () => {
  const source = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.equal(source.includes("NEON_AI_GATEWAY_TOKEN"), false);
  assert.equal(source.includes("NEON_AI_GATEWAY_BASE_URL"), false);
  assert.equal(source.includes("@neon/ai-sdk-provider"), false);
  assert.equal(source.includes("createNeon"), false);
  assert.equal(source.includes("@ai-sdk/gateway"), false);
});

test("the server calls the Neon provider, not the Vercel AI Gateway", () => {
  const source = readFileSync(new URL("../server/agent-reply.ts", import.meta.url), "utf8");
  assert.equal(source.includes('from "@neon/ai-sdk-provider"'), true);
  assert.equal(source.includes("createNeon"), true);
  assert.equal(source.includes("@ai-sdk/gateway"), false);
  assert.equal(source.includes("gateway("), false);
});
