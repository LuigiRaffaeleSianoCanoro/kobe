import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PlanWrite,
  applyPlanRemove,
  applyPlanSave,
  interpretPlan,
  isPlanAsk,
  mentionsConnectedAccount,
  offlinePlanReply,
  parseStoredPlans,
  planDue,
  planFromToolArgs,
  planId,
  planIdForCard,
  planIdReuse,
  recordSupports,
  type PlanPerson,
} from "./plans.ts";

const oct4 = new Date(2026, 9, 4);

function person(partial: Partial<PlanPerson> & Pick<PlanPerson, "id" | "name">): PlanPerson {
  return {
    birthday: "",
    last: "",
    next: "",
    loop: "",
    prompt: `Draft a check-in for ${partial.name.split(" ")[0]}`,
    ...partial,
  };
}

const roster: PlanPerson[] = [
  person({
    id: "maya",
    name: "Maya Chen",
    birthday: "Oct 5 · tomorrow · turns 29",
    last: "Instagram DM · 6 weeks ago",
    next: "Nothing scheduled",
    loop: "She asked for your running playlist.",
    prompt: "Draft a birthday message for Maya",
  }),
  person({
    id: "marcus",
    name: "Marcus Reid",
    birthday: "Feb 11",
    last: "Fathom call · Sep 12",
    next: "Coffee today 3:30 PM · Blue Bottle",
    loop: "You promised an intro to Lena Ortiz.",
    prompt: "Brief me on Marcus",
  }),
  person({
    id: "jordan",
    name: "Jordan Blake",
    birthday: "Oct 9",
    last: "Partiful RSVP · 4 days ago",
    next: "Dinner Thu 7:00 PM · Nopa",
    loop: "Thursday dinner clashes with Product sync.",
    prompt: "Fix my Thursday conflict",
  }),
  person({
    id: "priya",
    name: "Priya Nair",
    birthday: "Oct 13",
    last: "LinkedIn like · 2 months ago",
    next: "Nothing scheduled",
    loop: 'You both said "coffee soon" in July.',
    prompt: "Draft congrats to Priya",
  }),
  person({
    id: "dev",
    name: "Dev Patel",
    birthday: "Jan 22",
    last: "WhatsApp · 9 days ago (unanswered)",
    next: "Family dinner Oct 18",
    loop: "Reply about helping him move.",
    prompt: "Draft a reply to Dev",
  }),
];

test("ordinary questions are not a game-plan ask", () => {
  for (const line of ["Who has a birthday this week?", "Brief me on Marcus", "Any conflicts this week?", "Draft a birthday message for Maya"]) {
    assert.equal(isPlanAsk(line), false);
    assert.equal(interpretPlan(line, roster).type, "ignore");
  }
});

test("a birthday trigger is saved against Maya's record", () => {
  const intent = interpretPlan("Remind me before Maya's birthday", roster);
  assert.equal(intent.type, "plan");
  if (intent.type !== "plan") return;
  assert.equal(intent.plan.personId, "maya");
  assert.equal(intent.plan.kind, "trigger");
  assert.equal(intent.plan.condition, "birthday");
  assert.equal(intent.plan.prompt, "Draft a birthday message for Maya");
  assert.match(intent.text, /Maya Chen's record/);
  assert.equal(mentionsConnectedAccount(intent.text), false);
});

test("a weekly routine keeps the weekday and Dev's existing prompt", () => {
  const intent = interpretPlan("Every Sunday, check in with Dev", roster);
  assert.equal(intent.type, "plan");
  if (intent.type !== "plan") return;
  assert.deepEqual(intent.plan, {
    personId: "dev",
    kind: "routine",
    condition: "weekly",
    label: "Check in with Dev every Sunday",
    prompt: "Draft a reply to Dev",
  });
});

test("before coffee becomes Marcus's next-up trigger", () => {
  const intent = interpretPlan("Remind me to brief Marcus before coffee", roster);
  assert.equal(intent.type, "plan");
  if (intent.type !== "plan") return;
  assert.equal(intent.plan.personId, "marcus");
  assert.equal(intent.plan.condition, "next_up");
  assert.equal(intent.plan.prompt, "Brief me on Marcus");
});

test("a daily routine is not a trigger", () => {
  const intent = interpretPlan("Set a daily routine to check in with Priya", roster);
  assert.equal(intent.type, "plan");
  if (intent.type !== "plan") return;
  assert.equal(intent.plan.kind, "routine");
  assert.equal(intent.plan.condition, "daily");
  assert.equal(intent.plan.personId, "priya");
});

test("connected accounts are refused", () => {
  for (const line of [
    "Set a trigger when Maya posts on Instagram",
    "Remind me when Dev texts me",
    "Remind me when Dev replies",
    "Remind me when Maya responds",
    "Remind me when Maya writes back",
    "Remind me if Dev answers",
    "Set a trigger for Maya from Gmail",
    "Connect Slack and add a routine",
  ]) {
    const intent = interpretPlan(line, roster);
    assert.equal(intent.type, "say", line);
    if (intent.type === "say") assert.match(intent.text, /No accounts are connected/);
  }
  const reconnect = interpretPlan("Set a weekly routine to reconnect with Maya", roster);
  assert.equal(reconnect.type, "plan");
  const textHer = interpretPlan("Set a weekly routine to text Maya", roster);
  assert.equal(textHer.type, "plan");
  const replyToDev = interpretPlan("Remind me to reply to Dev", roster);
  assert.equal(replyToDev.type, "plan");
});

test("unknown, ambiguous, and missing people stay off invented records", () => {
  const unknown = interpretPlan("Set a trigger for Sarah's birthday", roster);
  assert.equal(unknown.type, "say");
  if (unknown.type === "say") assert.match(unknown.text, /Sarah isn't on the roster/);

  const missing = interpretPlan("Set a weekly routine", roster);
  assert.equal(missing.type, "say");
  if (missing.type === "say") assert.match(missing.text, /Which person on the roster/);

  const vague = interpretPlan("Set a trigger for Maya", roster);
  assert.equal(vague.type, "say");
  if (vague.type === "say") assert.match(vague.text, /birthday on the record/);

  const two = [
    ...roster,
    person({ id: "marcus-j", name: "Marcus Johnson", birthday: "Mar 2", last: "Text · 2 days ago", next: "Lunch Friday", loop: "Bring the book." }),
  ];
  const ambiguous = interpretPlan("Set a trigger for Marcus's birthday", two);
  assert.equal(ambiguous.type, "say");
  if (ambiguous.type === "say") assert.match(ambiguous.text, /Marcus Reid or Marcus Johnson|Marcus Johnson or Marcus Reid/);
  const full = interpretPlan("Set a birthday trigger for Marcus Johnson", two);
  assert.equal(full.type, "plan");
  if (full.type === "plan") assert.equal(full.plan.personId, "marcus-j");
});

test("a trigger is refused when the record does not have that field", () => {
  const blank = [person({ id: "ada", name: "Ada Lovelace", prompt: "Draft a check-in for Ada" })];
  const intent = interpretPlan("Set a birthday trigger for Ada", blank);
  assert.equal(intent.type, "say");
  if (intent.type === "say") assert.match(intent.text, /no birthday/);
  const next = interpretPlan("Remind me before what's next with Maya", roster);
  assert.equal(next.type, "say");
  if (next.type === "say") assert.match(next.text, /nothing scheduled next/);
});

test("due state comes from the record, including a date that only says tomorrow", () => {
  const maya = roster[0];
  const marcus = roster[1];
  const jordan = roster[2];
  const priya = roster[3];
  const dev = roster[4];
  assert.equal(planDue(maya, "birthday", oct4), true);
  assert.equal(planDue(marcus, "birthday", oct4), false);
  assert.equal(planDue(jordan, "birthday", oct4), true);
  assert.equal(planDue(priya, "birthday", oct4), true);
  assert.equal(planDue(person({ id: "x", name: "X", birthday: "Oct 19" }), "birthday", oct4), false);
  assert.equal(planDue(person({ id: "x", name: "X", birthday: "tomorrow" }), "birthday", oct4), true);
  assert.equal(planDue(person({ id: "x", name: "X", birthday: "Jan 3" }), "birthday", new Date(2026, 11, 28)), true);
  assert.equal(planDue(dev, "last_touch", oct4), true);
  assert.equal(planDue(jordan, "last_touch", oct4), false);
  assert.equal(planDue(marcus, "last_touch", oct4), false);
  assert.equal(recordSupports(maya, "next_up"), false);
  assert.equal(planDue(marcus, "next_up", oct4), true);
  assert.equal(planDue(maya, "open_loop", oct4), true);
});

test("stored plans drop invalid rows and reject account wording", () => {
  const good = {
    id: planId("maya-birthday"),
    personId: "maya",
    kind: "trigger" as const,
    condition: "birthday" as const,
    label: "When Maya's birthday is on the record",
    prompt: "Draft a birthday message for Maya",
  };
  const other = {
    ...good,
    id: good.id,
    personId: "dev",
    kind: "routine" as const,
    condition: "weekly" as const,
    label: "Check in with Dev every week",
    prompt: "Draft a reply to Dev",
  };
  const parsed = parseStoredPlans(JSON.stringify([good, other, { id: "nope" }, null]));
  assert.deepEqual(parsed, [good]);
  assert.equal(PlanWrite.safeParse({ ...good, kind: "routine" }).success, false);
  assert.equal(PlanWrite.safeParse({ ...good, label: "When Gmail gets a mail" }).success, false);
});

test("the offline adapter forwards those recordId args", () => {
  const source = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
  assert.match(source, /offlinePlanReply\(/);
  assert.match(source, /args:\s*plan\.args/);
  assert.doesNotMatch(source, /args:\s*intent\.plan/);
});

test("offline set_plan args use recordId and parse on the card", () => {
  for (const line of ["Remind me before Maya's birthday", "Every Sunday, check in with Dev"]) {
    const reply = offlinePlanReply(line, roster);
    assert.ok(reply?.args, line);
    if (!reply?.args) continue;
    assert.equal(Object.hasOwn(reply.args, "personId"), false);
    const parsed = planFromToolArgs(reply.args, planIdForCard("call_0", { personId: reply.args.recordId, kind: reply.args.kind, condition: reply.args.condition }));
    assert.equal(parsed.success, true, line);
    if (!parsed.success) continue;
    assert.equal(parsed.data.personId, reply.args.recordId);
    assert.equal(parsed.data.kind, reply.args.kind);
    assert.equal(parsed.data.condition, reply.args.condition);
    assert.equal(parsed.data.label, reply.args.label);
  }
  const maya = offlinePlanReply("Remind me before Maya's birthday", roster);
  assert.equal(maya?.args?.recordId, "maya");
  const dev = offlinePlanReply("Every Sunday, check in with Dev", roster);
  assert.equal(dev?.args?.recordId, "dev");
  assert.equal(dev?.args?.condition, "weekly");
  const fromPersonId = planFromToolArgs(
    { personId: "maya", kind: "trigger", condition: "birthday", label: "When Maya's birthday is on the record", prompt: "Draft a birthday message for Maya" },
    planId("fallback"),
  );
  assert.equal(fromPersonId.success, true);
  if (fromPersonId.success) assert.equal(fromPersonId.data.personId, "maya");
});

test("a second tab merges onto stored plans instead of replacing them", () => {
  const dev = {
    id: planId("dev-weekly"),
    personId: "dev",
    kind: "routine" as const,
    condition: "weekly" as const,
    label: "Check in with Dev every week",
    prompt: "Draft a reply to Dev",
  };
  const maya = {
    id: planId("maya-birthday"),
    personId: "maya",
    kind: "trigger" as const,
    condition: "birthday" as const,
    label: "When Maya's birthday is on the record",
    prompt: "Draft a birthday message for Maya",
  };
  const saved = applyPlanSave([dev], maya);
  assert.equal(saved.status, "saved");
  if (saved.status === "saved") assert.deepEqual(saved.plans.map((plan) => plan.personId), ["dev", "maya"]);
  const removed = applyPlanRemove([dev, maya], dev.id);
  assert.deepEqual(removed.map((plan) => plan.personId), ["maya"]);
  const conflict = applyPlanSave([maya], { ...dev, id: maya.id });
  assert.equal(conflict.status, "rejected");
  if (conflict.status === "rejected") assert.deepEqual(conflict.plans, [maya]);
});

test("a reused plan id is a conflict when it belongs to someone else", () => {
  const maya = { personId: "maya", kind: "trigger" as const, condition: "birthday" as const };
  const dev = { personId: "dev", kind: "routine" as const, condition: "weekly" as const };
  assert.equal(planIdReuse(maya, maya), "duplicate");
  assert.equal(planIdReuse(maya, dev), "conflict");
  assert.equal(planId("call_0"), "plan_call0record");
  assert.equal(planId("call_0"), planId("call_0"));
  const mayaCard = planIdForCard("call_0", maya);
  const mayaAgain = planIdForCard("call_0", maya);
  const devCard = planIdForCard("call_0", dev);
  assert.equal(mayaCard, mayaAgain);
  assert.notEqual(mayaCard, devCard);
  assert.notEqual(mayaCard, planId("call_0"));
  assert.match(mayaCard, /^plan_[a-z0-9]{6,40}$/);
  assert.match(devCard, /^plan_[a-z0-9]{6,40}$/);
});
