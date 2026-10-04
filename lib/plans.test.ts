import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanWrite,
  interpretPlan,
  isPlanAsk,
  mentionsConnectedAccount,
  parseStoredPlans,
  planDue,
  planId,
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
    kind: "trigger",
    condition: "birthday",
    label: "When Maya's birthday is on the record",
    prompt: "Draft a birthday message for Maya",
  };
  const parsed = parseStoredPlans(JSON.stringify([good, { id: "nope" }, null]));
  assert.deepEqual(parsed, [good]);
  assert.equal(PlanWrite.safeParse({ ...good, kind: "routine" }).success, false);
  assert.equal(PlanWrite.safeParse({ ...good, label: "When Gmail gets a mail" }).success, false);
});
