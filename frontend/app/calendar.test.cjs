const test = require("node:test");
const assert = require("node:assert/strict");
const { googleCalendarURL, googleCalendarEventURL } = require("./calendar.js");

test("due-date reminder creates a one-day all-day Google Calendar event", () => {
  const url = new URL(googleCalendarURL("Pick up wedding clothes", "2026-11-19T00:00:00.000Z", "Shop details"));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("dates"), "20261119/20261120");
  assert.equal(url.searchParams.get("text"), "Pick up wedding clothes");
  assert.equal(url.searchParams.get("details"), "Shop details");
});

test("event reminder preserves its scheduled time, venue and notes", () => {
  const url = new URL(googleCalendarEventURL("Sangeet", "2026-11-25T13:30:00.000Z", "2026-11-25T16:00:00.000Z", "Garden Hotel", "Meet at the main lawn"));
  assert.equal(url.searchParams.get("dates"), "20261125T133000Z/20261125T160000Z");
  assert.equal(url.searchParams.get("location"), "Garden Hotel");
  assert.equal(url.searchParams.get("details"), "Meet at the main lawn");
});
