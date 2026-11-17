const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldShowGuestPage } = require("./auth.js");

test("denied membership routes to the public guest page", () => {
  assert.equal(shouldShowGuestPage(403), true);
});

test("a signed-in account with no wedding workspaces routes to guest view", () => {
  assert.equal(shouldShowGuestPage(200, 0), true);
  assert.equal(shouldShowGuestPage(200, 1), false);
});

test("unrelated server errors do not redirect away from sign-in", () => {
  assert.equal(shouldShowGuestPage(500), false);
});
