const test = require("node:test");
const assert = require("node:assert/strict");
const { getApiBaseUrl } = require("./api.js");

test("uses the configured backend URL and removes trailing slashes", () => {
  assert.equal(getApiBaseUrl("https://api.example.com/shaadi/"), "https://api.example.com/shaadi");
});

test("falls back to localhost for local development when unset", () => {
  assert.equal(getApiBaseUrl("", "development"), "http://localhost:8080");
});

test("trims whitespace from the configured backend URL", () => {
  assert.equal(getApiBaseUrl("  http://192.168.1.40:8080/  "), "http://192.168.1.40:8080");
});

test("requires an explicit backend URL for production builds", () => {
  assert.throws(() => getApiBaseUrl("", "production"), /NEXT_PUBLIC_API_URL must be set/);
});
