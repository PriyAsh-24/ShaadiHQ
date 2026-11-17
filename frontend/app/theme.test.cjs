const test = require("node:test");
const assert = require("node:assert/strict");
const { nextTheme, readSavedTheme, saveTheme, THEME_STORAGE_KEY } = require("./theme.js");

test("theme toggle switches both directions", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
});

test("theme preference is saved and restored", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  saveTheme(storage, "dark");
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");
  assert.equal(readSavedTheme(storage), "dark");
});

test("invalid or unavailable stored themes safely fall back to light", () => {
  assert.equal(readSavedTheme({ getItem: () => "sepia" }), "light");
  assert.equal(readSavedTheme({ getItem: () => { throw new Error("storage blocked"); } }), "light");
  assert.doesNotThrow(() => saveTheme({ setItem: () => { throw new Error("storage blocked"); } }, "dark"));
});
