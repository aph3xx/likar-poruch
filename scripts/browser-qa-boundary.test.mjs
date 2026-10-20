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

test("browser QA protects every post-201 assertion with smoke cleanup", () => {
  assert.match(source, /let submittedId = null;\s+try \{/);
  assert.match(source, /QA_FORCE_POST_201_ASSERTION_FAILURE/);
  assert.match(source, /finally \{\s+if \(process\.env\.QA_BOOKING_SMOKE_TOKEN && submittedId\)/);
  assert.match(source, /expected exactly one booking cleanup DELETE request/);
});

test("browser QA applies the stale-copy guard to routes and FAQ JSON-LD", () => {
  assert.match(source, /const staleCopyRoutes =/);
  for (const route of ["/", "/kontakty/", "/privacy/", "/zapys/"])
    assert.ok(source.includes(`"${route}"`));
  assert.match(source, /assertNoLocalDraftDeliveryPromises\(body, `\$\{route\}: stale booking copy`\)/);
  assert.match(source, /assertNoLocalDraftDeliveryPromises\(JSON\.stringify\(faqEntries\), "homepage: FAQ JSON-LD stale booking copy"\)/);
});
