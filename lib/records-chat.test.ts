import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deliverDraft, isLiveConnector, rapportForSend, registerLiveSender, resetLiveSenders } from "./connectors.ts";
import { SEED_ROSTER } from "./data.ts";
import { game, rosterNow } from "./game.ts";
import { draftBody, replyFromRecords } from "./records-chat.ts";

const oct4 = new Date(2026, 9, 4);
const roster = SEED_ROSTER;
const invented = /run club|truck playlist|my treat|bring dessert|Brooklyn run club/i;

test("a local switch is not a connection", () => {
  const on = replyFromRecords("Check Instagram", roster, { instagram: true }, oct4);
  const off = replyFromRecords("Check Instagram", roster, { instagram: false }, oct4);
  assert.equal(on.text, "Instagram is not connected.");
  assert.equal(off.text, on.text);
  assert.equal(on.tool, undefined);
  assert.doesNotMatch(on.text, /playlist|Lena|Biscuit|Northwind|jazz/i);
});

test("gmail and slack stay not connected until a sender is registered", () => {
  resetLiveSenders();
  assert.equal(isLiveConnector("gmail"), false);
  assert.equal(isLiveConnector("slack"), false);
  assert.equal(isLiveConnector("instagram"), false);

  const gmail = replyFromRecords("Check Gmail", roster, { gmail: true }, oct4);
  assert.equal(gmail.text, "Gmail is not connected.");
  assert.doesNotMatch(gmail.text, /live connector/i);

  const slack = replyFromRecords("What's in Slack?", roster, {}, oct4);
  assert.equal(slack.text, "Slack is not connected.");
  assert.doesNotMatch(slack.text, invented);

  registerLiveSender("gmail", async () => ({ ok: true }));
  assert.equal(isLiveConnector("gmail"), true);
  const live = replyFromRecords("Check Gmail", roster, {}, oct4);
  assert.match(live.text, /Gmail is a live connector/);
  assert.doesNotMatch(live.text, /not connected/i);
  assert.match(live.text, /Maya Chen/);
  assert.match(live.text, /Instagram DM · 6 weeks ago/);
  resetLiveSenders();
  assert.equal(isLiveConnector("gmail"), false);
});

test("an unknown person gets no invented notes", () => {
  const reply = replyFromRecords("Brief me on Sarah. She loves jazz and just moved to Paris.", roster, {}, oct4);
  assert.match(reply.text, /Sarah is not in the records/);
  assert.equal(reply.tool, undefined);
  assert.doesNotMatch(reply.text, /jazz|Paris|Lena|playlist|Biscuit|Northwind|Brooklyn|Maya|Marcus/);
});

test("named source plus an unknown person stays inside the records", () => {
  const reply = replyFromRecords("Check Instagram for Sarah", roster, { instagram: true }, oct4);
  assert.match(reply.text, /Sarah is not in the records/);
  assert.match(reply.text, /Instagram is not connected/);
  assert.equal(reply.tool, undefined);
  assert.doesNotMatch(reply.text, /playlist|jazz/);
});

test("roster answers quote stored fields", () => {
  const maya = replyFromRecords("Draft a birthday message for Maya", roster, { instagram: true }, oct4);
  assert.match(maya.text, /She asked for your running playlist/);
  assert.doesNotMatch(maya.text, invented);
  assert.equal(maya.tool?.toolName, "draft_message");
  const body = (maya.tool?.args.body as string) ?? "";
  assert.equal(body, "Hi Maya.");
  assert.doesNotMatch(body, /playlist|Brooklyn|turns 29|Nothing scheduled/);
  assert.doesNotMatch(body, invented);

  const marcus = replyFromRecords("Brief me on Marcus", roster, {}, oct4);
  assert.match(marcus.text, /Lena Ortiz/);
  assert.match(marcus.text, /Blue Bottle/);
  assert.equal(marcus.tool?.toolName, "pregame_brief");
  assert.equal(marcus.tool?.args.recordId, "marcus");

  const birthdays = replyFromRecords("Who has a birthday this week?", roster, {}, oct4);
  const ids = ((birthdays.tool?.args.people as { id: string }[]) ?? []).map((person) => person.id);
  assert.deepEqual(ids, ["maya", "jordan"]);
  assert.doesNotMatch(birthdays.text, /not connected/i);

  const quiet = replyFromRecords("Who haven't I talked to lately?", roster, {}, oct4);
  const quietIds = ((quiet.tool?.args.people as { id: string }[]) ?? []).map((person) => person.id);
  assert.ok(quietIds.includes("dev"));
  assert.ok(quietIds.includes("priya"));
  assert.ok(quietIds.includes("maya"));
  assert.equal(quietIds.includes("jordan"), false);
});

test("a sendable draft leaves private notes off the message", () => {
  const priya = roster.find((person) => person.id === "priya")!;
  assert.equal(draftBody(priya), "Hi Priya.");
  assert.doesNotMatch(draftBody(priya), /Northwind|coffee soon|marathon|voice notes/);

  const dev = roster.find((person) => person.id === "dev")!;
  const body = draftBody(dev);
  assert.equal(body, "Hi Dev.");
  assert.doesNotMatch(body, /helping him move|Family dinner|robotics|home team|Jan 22/);
  const reply = replyFromRecords("Draft a reply to Dev", roster, {}, oct4);
  assert.equal(reply.tool?.args.body, "Hi Dev.");
  assert.doesNotMatch(body, invented);
});

test("copy does not send, and rapport waits for a real send", async () => {
  game.reset();
  const before = rosterNow().find((person) => person.id === "maya")!.rapport;
  const blocked = await deliverDraft("Instagram", { to: "Maya Chen", body: "Hi" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /Instagram is not connected/);
  assert.deepEqual(rapportForSend(blocked), { sent: false, rapportDelta: 0 });
  assert.equal(rosterNow().find((person) => person.id === "maya")!.rapport, before);
  assert.equal(game.isSent("maya-draft"), false);

  registerLiveSender("gmail", async () => ({ ok: false, reason: "Gmail did not send this draft." }));
  const failed = await deliverDraft("Email", { to: "Maya Chen", body: "Hi" });
  assert.equal(failed.ok, false);
  assert.equal(rapportForSend(failed).sent, false);
  assert.equal(rosterNow().find((person) => person.id === "maya")!.rapport, before);

  registerLiveSender("gmail", async () => {
    throw new Error("down");
  });
  const threw = await deliverDraft("Email", { to: "Maya Chen", body: "Hi" });
  assert.equal(threw.ok, false);
  assert.equal(game.isSent("maya-draft"), false);

  registerLiveSender("gmail", async () => ({ ok: true }));
  const sent = await deliverDraft("Email", { to: "Maya Chen", body: "Hi" });
  assert.equal(sent.ok, true);
  assert.equal(rapportForSend(sent).rapportDelta, 3);
  game.recordSent("maya-draft", { personId: "maya", to: "Maya Chen", channel: "Email", body: "Hi" });
  assert.equal(game.isSent("maya-draft"), true);
  assert.equal(rosterNow().find((person) => person.id === "maya")!.rapport, before + 3);

  game.recordSent("maya-draft", { personId: "maya", to: "Maya Chen", channel: "Email", body: "Hi" });
  assert.equal(rosterNow().find((person) => person.id === "maya")!.rapport, before + 3);
  resetLiveSenders();
});

test("slack send without a live acceptance does not add rapport", async () => {
  game.reset();
  const before = rosterNow().find((person) => person.id === "dev")!.rapport;
  const result = await deliverDraft("Slack", { to: "Dev Patel", body: "Hi" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Slack is not connected/);
  assert.equal(rapportForSend(result).rapportDelta, 0);
  assert.equal(rosterNow().find((person) => person.id === "dev")!.rapport, before);
  resetLiveSenders();
});

test("the live agent does not claim a sender or forbid the send button", () => {
  const agent = readFileSync(new URL("./kobe-agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(agent, /You cannot send/);
  assert.match(agent, /not connected/);
  assert.match(agent, /private notes/);
  const gateway = readFileSync(new URL("../server/agent-reply.ts", import.meta.url), "utf8");
  assert.doesNotMatch(gateway, /You cannot send/);
  assert.doesNotMatch(gateway, /CONNECTED SOURCES/);
});
