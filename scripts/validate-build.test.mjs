import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourceDist = path.join(projectRoot, 'dist');
const validator = path.join(projectRoot, 'scripts/validate-build.mjs');

function runMutation(mutate) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'likar-poruch-validator-'));
  const distRoot = path.join(tempRoot, 'dist');
  fs.cpSync(sourceDist, distRoot, { recursive: true });
  mutate(distRoot);
  try {
    execFileSync(process.execPath, [validator], {
      cwd: projectRoot,
      env: { ...process.env, VALIDATE_BUILD_ROOT: distRoot, PUBLIC_SITE_URL: 'https://aph3xx.github.io' },
      encoding: 'utf8',
      stdio: 'pipe'
    });
    assert.fail('validator unexpectedly accepted the mutated build');
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    return `${error.stdout || ''}${error.stderr || ''}`;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('rejects root-relative links outside the configured base path', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace('</body>', '<a href="/definitely-missing/">Missing</a></body>'));
  });
  assert.match(output, /index\.html: broken internal link \/definitely-missing\//);
});

test('rejects privacy pages that become indexable', () => {
  const output = runMutation((distRoot) => {
    const privacyPath = path.join(distRoot, 'privacy', 'index.html');
    const html = fs.readFileSync(privacyPath, 'utf8');
    fs.writeFileSync(privacyPath, html.replace('noindex, nofollow', 'index, follow'));
  });
  assert.match(output, /privacy\/index\.html: privacy route must remain noindex, nofollow/);
});
