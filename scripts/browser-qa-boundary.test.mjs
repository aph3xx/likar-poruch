import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("./browser-qa.mjs", import.meta.url), "utf8");

test("browser QA uses explicit first-party completion instead of network-idle", () => {
  assert.doesNotMatch(source, /networkidle/);
  assert.match(source, /waitUntil: "commit"/);
  assert.match(source, /attempt <= 3/);
  assert.match(source, /requestfinished/);
  assert.match(source, /requestfailed/);
  assert.match(source, /first-party resources did not complete/);
  assert.match(source, /document\.images\]\.every/);
});

test("browser QA keeps a bounded manifest fetch assertion", () => {
  assert.match(source, /link\[rel="manifest"\]/);
  assert.match(source, /controller\.abort\(\), 10_000/);
  assert.match(source, /manifest MIME is/);
});
