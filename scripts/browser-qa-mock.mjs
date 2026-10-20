import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const astro = join(root, "node_modules/.bin/astro");
await access(astro);
const port = process.env.QA_MOCK_PORT || String(45000 + (process.pid % 1000));
const base = `http://127.0.0.1:${port}/likar-poruch`;
const server = spawn(astro, ["preview", "--host", "127.0.0.1", "--port", port], {
  cwd: root,
  env: process.env,
  stdio: "ignore",
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);
try {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) throw new Error("preview server did not become ready");
  const result = spawn(process.execPath, ["scripts/browser-qa.mjs"], {
    cwd: root,
    env: { ...process.env, QA_BASE_URL: base, QA_MOCK_BOOKING: "1" },
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    result.once("error", reject);
    result.once("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`browser QA exited ${code ?? signal}`)),
    );
  });
} finally {
  stop();
}
