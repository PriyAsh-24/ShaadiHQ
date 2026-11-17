const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterBudgetRoots,
  getBudgetChildren,
  getBudgetRoots,
  getBudgetSpender,
  getBudgetTotal,
  getBudgetBalance,
} = require("./budget.js");

test("payment balance is the total less what is paid", () => {
  assert.equal(getBudgetBalance({ amount: 5000, paidAmount: 2000 }), 3000);
  assert.equal(getBudgetBalance({ amount: 5000 }), 5000);
});

const records = [
  { id: "legacy", title: "Decoration", amount: 18000 },
  { id: "zero", title: "Haldi", amount: 3000, parentId: "000000000000000000000000" },
  { id: "small", title: "Flowers", amount: 1200, parentId: "legacy", createdByName: "Priya Sharma" },
  { id: "other", title: "Dholak", amount: 5000 },
];

test("legacy and zero-parent budget records are treated as top-level entries", () => {
  assert.deepEqual(getBudgetRoots(records).map(({ id }) => id), ["legacy", "zero", "other"]);
  assert.deepEqual(getBudgetChildren(records).map(({ id }) => id), ["small"]);
});

test("known spend sums top-level expenses and excludes all sub-spend detail amounts", () => {
  assert.equal(getBudgetTotal(records), 18000 + 3000 + 5000);
});

test("budget search returns the parent when a nested spend detail matches", () => {
  assert.deepEqual(filterBudgetRoots(records, "flowers").map(({ id }) => id), ["legacy"]);
});

test("budget search is case-insensitive and includes creator names", () => {
  assert.deepEqual(filterBudgetRoots(records, "PRIYA").map(({ id }) => id), ["legacy"]);
});

test("spender display prefers the Google name and falls back to email", () => {
  assert.equal(getBudgetSpender(records[2]), "Priya Sharma");
  assert.equal(getBudgetSpender({ createdBy: "priya@example.com" }), "priya@example.com");
  assert.equal(getBudgetSpender({}), "Unknown");
});
