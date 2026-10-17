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
      env: { ...process.env, VALIDATE_BUILD_ROOT: distRoot, PUBLIC_SITE_URL: 'https://example.test' },
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
  assert.match(output, /index\.html: internal link escapes configured base \/definitely-missing\//);
});

test('rejects root-relative links that bypass the configured base to an existing route', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace('</body>', '<a href="/kontakty/">Контакти</a></body>'));
  });
  assert.match(output, /index\.html: internal link escapes configured base \/kontakty\//);
});

test('rejects same-origin absolute links that bypass the configured base', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace('</body>', '<a href="https://example.test/kontakty/">Контакти</a></body>'));
  });
  assert.match(output, /index\.html: internal link escapes configured base https:\/\/example\.test\/kontakty\//);
});

test('rejects privacy pages that become indexable', () => {
  const output = runMutation((distRoot) => {
    const privacyPath = path.join(distRoot, 'privacy', 'index.html');
    const html = fs.readFileSync(privacyPath, 'utf8');
    fs.writeFileSync(privacyPath, html.replace('noindex, nofollow', 'index, follow'));
  });
  assert.match(output, /privacy\/index\.html: privacy route must remain noindex, nofollow/);
});

test('rejects homepage social images outside the approved brand allowlist', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace(/(<meta property="og:image" content=")[^"]+/, '$1https://example.test/likar-poruch/images/clinic-doctor.webp'));
  });
  assert.match(output, /homepage: og:image must use an approved brand asset/);
});

test('rejects homepage social images from a foreign origin with an approved pathname', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace(/(<meta property="og:image" content=")[^"]+/, '$1https://attacker.invalid/likar-poruch/brand/logo-horizontal.svg'));
  });
  assert.match(output, /homepage: og:image must use an approved brand asset/);
});

test('rejects homepage social images whose approved asset is missing', () => {
  const output = runMutation((distRoot) => {
    const indexPath = path.join(distRoot, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    fs.writeFileSync(indexPath, html.replace(/(<meta property="og:image" content=")[^"]+/, '$1https://example.test/likar-poruch/brand/logo-horizontal.svg'));
    fs.rmSync(path.join(distRoot, 'brand', 'logo-horizontal.svg'));
  });
  assert.match(output, /homepage: approved og:image asset is missing/);
});

test('rejects RSS feeds whose channel link escapes the configured base path', () => {
  const output = runMutation((distRoot) => {
    const rssPath = path.join(distRoot, 'rss.xml');
    const xml = fs.readFileSync(rssPath, 'utf8');
    fs.writeFileSync(rssPath, xml.replace('<link>https://example.test/likar-poruch/</link>', '<link>https://example.test/</link>'));
  });
  assert.match(output, /rss\.xml: channel link must match configured origin\/base/);
});

test('rejects RSS feeds whose item GUID differs from its item link', () => {
  const output = runMutation((distRoot) => {
    const rssPath = path.join(distRoot, 'rss.xml');
    const xml = fs.readFileSync(rssPath, 'utf8');
    fs.writeFileSync(rssPath, xml.replace(/<guid isPermaLink="true">[^<]+<\/guid>/, '<guid isPermaLink="true">https://example.test/likar-poruch/wrong/</guid>'));
  });
  assert.match(output, /rss\.xml: item link and GUID must match/);
});
