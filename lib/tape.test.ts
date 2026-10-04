import assert from "node:assert/strict";
import test from "node:test";
import { publishCoaching } from "./coaching-memory";
import { reply } from "./agent";
import { cleanNote, clipFrom, mergeCoaching, parseStoredCoaching, withCoaching } from "./tape";

const maya = {
  id: "maya",
  name: "Maya Chen",
  role: "College roommate",
  last: "Instagram DM · 6 weeks ago",
  next: "Nothing scheduled",
  points: ["Moved to Brooklyn in August"],
  loop: "She asked for your running playlist.",
};

test("a clip quotes the record and does not add a situation", () => {
  const clip = clipFrom(maya);
  assert.equal(clip.situation, "She asked for your running playlist.");
  assert.match(clip.read, /running playlist/);
  assert.match(clip.read, /Instagram DM · 6 weeks ago/);
  assert.match(clip.read, /Moved to Brooklyn in August/);
  assert.doesNotMatch(clip.read, /run club/);
  assert.doesNotMatch(clip.read, /connected/i);
});

test("an empty record stays empty", () => {
  const clip = clipFrom({ ...maya, last: "  ", next: "", points: ["  "], loop: "" });
  assert.equal(clip.situation, "No open loop on this record.");
  assert.equal(clip.read, "There are no notes on this record to review.");
  assert.deepEqual(clip.notes, []);
});

test("cleanNote trims and rejects an empty or oversized note", () => {
  assert.deepEqual(cleanNote("   "), { ok: false, empty: true });
  assert.deepEqual(cleanNote("a".repeat(401)), { ok: false, empty: false });
  assert.deepEqual(cleanNote("  Send the playlist first.  "), { ok: true, note: "Send the playlist first." });
});

test("merge drops anyone not on the roster and lets the new note win", () => {
  const merged = mergeCoaching(new Set(["maya"]), [
    { personId: "maya", note: "old" },
    { personId: "ghost", note: "nope" },
  ], [{ personId: "maya", note: "Send the playlist first." }]);
  assert.deepEqual(merged, [{ personId: "maya", note: "Send the playlist first." }]);
});

test("stored coaching ignores junk", () => {
  assert.deepEqual(parseStoredCoaching({ maya: { note: "Lead with the intro.", at: "t" }, bad: { note: 1 }, "": { note: "x", at: "t" } }), {
    maya: { note: "Lead with the intro.", at: "t" },
  });
});

test("withCoaching leaves an uncoached reply alone", () => {
  assert.equal(withCoaching("Pregame.", undefined), "Pregame.");
  assert.match(withCoaching("Pregame.", "Ask about Lena."), /Luigi's coaching on this situation: Ask about Lena\./);
});

test("reviewing the tape uses Maya's notes and Luigi's coaching", () => {
  publishCoaching({ maya: "Send the playlist before you ask for hers." });
  const reviewed = reply("Review the tape on Maya");
  assert.match(reviewed.text, /running playlist/);
  assert.match(reviewed.text, /Send the playlist before you ask for hers/);
  assert.equal(reviewed.tool?.toolName, "pregame_brief");
  assert.equal(reviewed.tool?.args.recordId, "maya");

  const unnamed = reply("Review game tape");
  assert.equal(unnamed.tool?.toolName, "show_people");
  assert.match(unnamed.text, /No inbox or social account is connected/);
  const people = (unnamed.tool?.args.people ?? []) as { id: string }[];
  assert.deepEqual(people.map((p) => p.id).sort(), ["dev", "jordan", "marcus", "maya", "priya"]);
});

test("a person who is not on the roster is not replaced with someone who is", () => {
  publishCoaching({});
  const reviewed = reply("Review the tape on Sarah");
  assert.equal(reviewed.tool?.toolName, "show_people");
  assert.doesNotMatch(reviewed.text, /Marcus/);
});
