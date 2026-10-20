import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("./browser-qa.mjs", import.meta.url), "utf8");
const appointmentFormSource = await fs.readFile(
  new URL("../src/components/AppointmentForm.astro", import.meta.url),
  "utf8"
);

const removedLocalDraftCopy =
  "Запит збережеться лише як локальна чернетка на цьому пристрої. Сайт не надсилає його до медичного центру.";

test("appointment form omits the obsolete local-draft notice", () => {
  assert.doesNotMatch(appointmentFormSource, new RegExp(removedLocalDraftCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

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
