const test = require("node:test");
const assert = require("node:assert/strict");
const { weddingWorkspacePath, isWeddingMainAdmin } = require("./workspace.js");

test("workspace routes are encoded as one route segment", () => {
  assert.equal(weddingWorkspacePath("upadhyay wedding"), "/upadhyay%20wedding");
});

test("main admin comparison ignores email case and whitespace", () => {
  assert.equal(isWeddingMainAdmin("Bride@Gmail.com ", "bride@gmail.com"), true);
  assert.equal(isWeddingMainAdmin("family@gmail.com", "bride@gmail.com"), false);
  assert.equal(isWeddingMainAdmin("", "bride@gmail.com"), false);
});
