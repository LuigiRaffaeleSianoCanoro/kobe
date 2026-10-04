import assert from "node:assert/strict";
import test from "node:test";
import { dropFailedTouch, newestTouches, recordSavedBody, TOUCH_CAP } from "./touch-log.ts";

test("a window larger than the cap keeps this week's newest notes", () => {
  const rows = Array.from({ length: TOUCH_CAP + 1 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
    body: `note ${index}`,
  }));
  const kept = newestTouches(rows);
  assert.equal(kept.length, TOUCH_CAP);
  assert.equal(kept[0]?.body, "note 1");
  assert.equal(kept.at(-1)?.body, `note ${TOUCH_CAP}`);
  assert.equal(kept.some((row) => row.body === "note 0"), false);
  assert.ok(Date.parse(kept[0]!.at) < Date.parse(kept.at(-1)!.at));
});

test("a failed save drops only that touch", () => {
  const older = { at: "2026-10-04T10:00:00.000Z", body: "Dev" };
  const failed = { at: "2026-10-04T11:00:00.000Z", body: "Maya" };
  const later = { at: "2026-10-04T12:00:00.000Z", body: "Jordan" };
  assert.deepEqual(dropFailedTouch([older, failed, later], failed), [older, later]);
  assert.deepEqual(dropFailedTouch([older, later], null), [older, later]);
});

test("a person added in the app is not described as logged when the database would reject them", () => {
  const server = new Set(["maya", "marcus"]);
  const body = recordSavedBody(true, "6f0c0a2e-1b2c-4d5e-8f90-123456789abc", server);
  assert.equal(body.includes("Logged to their record"), false);
  assert.match(body, /added in the app/);
  assert.equal(recordSavedBody(true, "maya", server), "Logged to their record. Rapport +3.");
  assert.equal(recordSavedBody(false, "6f0c0a2e-1b2c-4d5e-8f90-123456789abc", server), "Saved in this browser.");
});
