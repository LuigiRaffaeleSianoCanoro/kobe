import assert from "node:assert/strict";
import { test } from "node:test";
import { scriptedReply } from "./agent.ts";
import { SAMPLE_CALENDAR, SEED_ROSTER, type Person } from "./data.ts";
import { mixtapeText, weeklyMixtape, type TouchNote } from "./highlights.ts";

const OCT_4 = new Date(2026, 9, 4, 12);

function person(partial: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return {
    role: "",
    tier: "ROTATION",
    birthday: "",
    last: "",
    next: "",
    points: [],
    loop: "",
    sources: [],
    rapport: 50,
    ...partial,
  };
}

test("the week of Oct 4 2026 plays the dated notes already stored", () => {
  const tape = weeklyMixtape(SEED_ROSTER, SAMPLE_CALENDAR, OCT_4);
  assert.equal(tape.start, "2026-10-04");
  assert.equal(tape.end, "2026-10-10");
  assert.equal(tape.label, "OCT 4 – OCT 10");
  assert.deepEqual(
    tape.tracks.map((track) => `${track.personId}:${track.kind}:${track.when}`),
    ["marcus:PLAN:2026-10-04", "maya:BIRTHDAY:2026-10-05", "jordan:PLAN:2026-10-08", "jordan:BIRTHDAY:2026-10-09"],
  );

  const marcus = tape.tracks[0];
  assert.deepEqual(
    marcus.lines.map((line) => line.text),
    ["Coffee today 3:30 PM · Blue Bottle", "Coffee with Marcus Reid"],
  );
  assert.equal(marcus.cited, "On their record and the sample calendar");
  assert.deepEqual(marcus.notes[0], { text: "You promised an intro to Lena Ortiz.", loop: true });
  assert.equal(marcus.notes.some((note) => note.text === "Relocated to Austin in August"), true);

  const maya = tape.tracks[1];
  assert.deepEqual(
    maya.lines.map((line) => line.text),
    ["Oct 5 · tomorrow · turns 29"],
  );
  assert.equal(maya.cited, "On their record");
  assert.deepEqual(maya.notes[0], { text: "She asked for your running playlist.", loop: true });
  assert.equal(maya.notes.some((note) => note.text === "Moved to Brooklyn in August"), true);

  const dinner = tape.tracks[2];
  assert.deepEqual(
    dinner.lines.map((line) => line.text),
    ["Dinner Thu 7:00 PM · Nopa", "Dinner with Jordan Blake"],
  );
  assert.equal(dinner.notes[0]?.text, "Thursday dinner clashes with Product sync.");
  assert.equal(dinner.notes.some((note) => note.text === "Just adopted a dog named Biscuit"), true);

  const text = mixtapeText(tape);
  assert.match(text, /Maya Chen/);
  assert.match(text, /Marcus Reid/);
  assert.match(text, /Jordan Blake/);
  assert.doesNotMatch(text, /Priya Nair|Dev Patel|Northwind|robotics/);
  assert.doesNotMatch(text, /INSTAGRAM|GMAIL|PARTIFUL|FATHOM|LINKEDIN|WHATSAPP|GOOGLE|connected|posted|run club/i);
});

test("an explicit date wins over today, and dates outside the week stay off the tape", () => {
  const outside = person({ id: "a", name: "A", next: "Oct 18 · today" });
  assert.equal(weeklyMixtape([outside], [], OCT_4).tracks.length, 0);

  const saturday = new Date(2026, 9, 10, 12);
  const tomorrow = person({ id: "a", name: "A", next: "Coffee tomorrow" });
  assert.equal(weeklyMixtape([tomorrow], [], saturday).tracks.length, 0);

  const thursday = person({ id: "a", name: "A", next: "Dinner Thu 7:00 PM · Nopa" });
  assert.equal(weeklyMixtape([thursday], [], saturday).tracks[0]?.when, "2026-10-08");
});

test("Priya's birthday is on the following week's tape, and Maya's is not", () => {
  const tape = weeklyMixtape(SEED_ROSTER, SAMPLE_CALENDAR, new Date(2026, 9, 13, 12));
  assert.equal(tape.start, "2026-10-11");
  assert.equal(tape.end, "2026-10-17");
  assert.equal(tape.tracks.some((track) => track.personId === "priya" && track.kind === "BIRTHDAY" && track.when === "2026-10-13"), true);
  assert.equal(tape.tracks.some((track) => track.personId === "maya"), false);
  assert.equal(tape.tracks.some((track) => track.personId === "dev"), false);
});

test("the year boundary keeps Jan 1 on the week that contains it", () => {
  const tape = weeklyMixtape([person({ id: "a", name: "A", birthday: "Jan 1" })], [], new Date(2026, 11, 30, 12));
  assert.equal(tape.start, "2026-12-27");
  assert.equal(tape.end, "2027-01-02");
  assert.equal(tape.tracks[0]?.when, "2027-01-01");
});

test("Feb 29 is a track only in a week that contains that day", () => {
  const leap = weeklyMixtape([person({ id: "a", name: "A", birthday: "Feb 29" })], [], new Date(2028, 1, 29, 12));
  assert.equal(leap.tracks[0]?.when, "2028-02-29");
  const notLeap = weeklyMixtape([person({ id: "a", name: "A", birthday: "Feb 29" })], [], new Date(2026, 1, 27, 12));
  assert.equal(notLeap.tracks.length, 0);
});

test("calendar rows without a stored person, free slots, and account labels are left out", () => {
  const tape = weeklyMixtape(SEED_ROSTER, SAMPLE_CALENDAR, OCT_4);
  assert.equal(tape.tracks.some((track) => /product sync|free slot/i.test(track.lines.map((line) => line.text).join(" "))), false);

  const withSource = weeklyMixtape(
    [person({ id: "maya", name: "Maya Chen", birthday: "Oct 5", sources: ["INSTAGRAM", "GMAIL"] })],
    [{ when: "Today 1:00 PM", title: "Call", source: "INSTAGRAM", where: "Park", person: "maya" }, { when: "Today 2:00 PM", title: "Secret", source: "X", where: "", person: "nobody" }],
    OCT_4,
  );
  assert.equal(withSource.tracks.some((track) => track.kind === "PLAN" && track.lines.some((line) => line.text === "Call")), true);
  assert.equal(mixtapeText(withSource).includes("INSTAGRAM"), false);
  assert.equal(mixtapeText(withSource).includes("Secret"), false);
  assert.equal(mixtapeText(withSource).includes("GMAIL"), false);
});

test("a logged draft in the week is the note, and last week's draft is not", () => {
  const maya = person({
    id: "maya",
    name: "Maya Chen",
    role: "College roommate",
    last: "WhatsApp · just now",
    loop: "She asked for your running playlist.",
    points: ["Moved to Brooklyn in August"],
  });
  const touch: TouchNote = { personId: "maya", channel: "WhatsApp", body: "Count me in for the move.", at: new Date(2026, 9, 4, 18).toISOString() };
  const old: TouchNote = { personId: "maya", channel: "Instagram", body: "Old note that must stay off this tape.", at: new Date(2026, 8, 30, 18).toISOString() };
  const tape = weeklyMixtape([maya], [], OCT_4, [touch, old]);
  assert.equal(tape.tracks.length, 1);
  const track = tape.tracks[0];
  assert.equal(track.kind, "TOUCH");
  assert.deepEqual(
    track.lines.map((line) => line.text),
    ["WhatsApp · just now", "Count me in for the move."],
  );
  assert.deepEqual(track.via, ["WhatsApp"]);
  assert.equal(track.cited, "On their record and a note you logged");
  assert.equal(mixtapeText(tape).includes("Old note"), false);
  assert.equal(mixtapeText(tape).includes("Instagram"), false);
});

test("blank records and an empty roster do not invent a track", () => {
  assert.equal(weeklyMixtape([], [], OCT_4).tracks.length, 0);
  const blank = person({ id: "x", name: "", next: "Nothing scheduled", birthday: "", last: "", loop: "", points: [] });
  assert.equal(weeklyMixtape([blank], [], OCT_4).tracks.length, 0);
});

test("asking for the mixtape does not steal birthdays, conflicts, or briefs", () => {
  assert.equal(scriptedReply("This week's mixtape").tool?.toolName, "weekly_highlights");
  assert.equal(scriptedReply("What happened this week?").tool?.toolName, "weekly_highlights");
  assert.equal(scriptedReply("Highlights").tool?.toolName, "weekly_highlights");
  assert.equal(scriptedReply("Who has a birthday this week?").tool?.toolName, "show_people");
  assert.equal(scriptedReply("Any conflicts this week?").tool?.toolName, "resolve_conflict");
  assert.equal(scriptedReply("Brief me on Marcus").tool?.toolName, "pregame_brief");
  assert.equal(scriptedReply("Who haven't I talked to lately?").tool?.toolName, "show_people");
  assert.equal(scriptedReply("Draft a birthday message for Maya").tool?.toolName, "draft_message");
  assert.doesNotMatch(scriptedReply("This week's mixtape").text, /posted|run club|connected account/i);
});

test("a named person or a brief is that person's card, not the mixtape", () => {
  assert.equal(scriptedReply("What happened with Dev").tool?.toolName, "draft_message");
  assert.equal(scriptedReply("what happened with Marcus").tool?.toolName, "pregame_brief");
  assert.equal(scriptedReply("Brief me on what happened with Marcus").tool?.toolName, "pregame_brief");
  assert.equal(scriptedReply("What happened at coffee with Marcus?").tool?.toolName, "pregame_brief");
  assert.equal(scriptedReply("What happened this week?").tool?.toolName, "weekly_highlights");
});
