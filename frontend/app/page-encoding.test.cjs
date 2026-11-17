const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("page iconography remains valid UTF-8 instead of mojibake", () => {
  const page = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");
  assert.doesNotMatch(page, /[\u00e2\u00c3\u00c2\u00f0\u00ef][^\x00-\x7f]{1,3}/u);
  assert.match(page, /\u2733/u);
  assert.match(page, /\u2315/u);
});

test("workspace switcher icons use CSS shapes instead of fallback question marks", () => {
  const page = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "globals.css"), "utf8");
  assert.match(page, /className="mini-crest" aria-hidden="true"><\/span>/);
  assert.match(page, /className="chevron" aria-hidden="true"><\/span>/);
  assert.match(styles, /\.wedding-switch \.mini-crest::before/);
  assert.match(styles, /\.wedding-switch \.chevron\{[^}]*border-right/);
});
