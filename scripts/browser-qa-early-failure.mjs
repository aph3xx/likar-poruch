import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const mock = join(root, "scripts/browser-qa-mock.mjs");
await access(mock);

for (const bodyFailure of ["malformed", "unreadable"]) {
  const child = spawn(process.execPath, [mock], {
    cwd: root,
    env: {
      ...process.env,
      QA_BOOKING_SMOKE_TOKEN: "boundary-regression-token",
      QA_MOCK_BOOKING_BODY_FAILURE: bodyFailure,
    },
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`early ${bodyFailure} response probe exited ${code ?? signal}`)),
    );
  });
}

console.log("Early post-201 cleanup regression passed for malformed and unreadable response bodies.");
