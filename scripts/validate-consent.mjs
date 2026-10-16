import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const consent = await readFile(new URL('../src/components/CookieConsent.astro', import.meta.url), 'utf8');
const analytics = await readFile(new URL('../src/components/PostHogAnalytics.astro', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

// Contract tests for the consent boundary. These run without a browser so CI still
// catches accidental eager SDK initialization and missing lifecycle controls.
assert.match(consent, /data-consent-banner hidden/);
assert.match(consent, /data-consent-reject/);
assert.match(consent, /data-consent-accept/);
assert.match(consent, /data-consent-analytics/);
assert.match(consent, /localStorage\.getItem\(KEY/);
assert.match(consent, /localStorage\.setItem\(KEY/);
assert.match(consent, /MAX_AGE = 180/);
assert.match(consent, /purposes: \{ analytics: analyticsAllowed \}/);
assert.match(consent, /publish\(false, 'reject_all'\)/);
assert.match(consent, /publish\(analytics\.checked, 'save_preferences'\)/);
assert.match(consent, /likar:consent-changed/);

assert.match(analytics, /const enableAnalytics = async \(\) =>/);
assert.match(analytics, /import\('posthog-js'\)/);
assert.doesNotMatch(analytics, /import posthog from 'posthog-js'/);
assert.match(analytics, /if \(!posthogKey \|\| doNotTrackEnabled\) return/);
assert.match(analytics, /window\.addEventListener\('likar:consent-changed'/);
assert.match(analytics, /stored\?\.purposes\?\.analytics === true/);
assert.match(analytics, /posthog\.opt_out_capturing\(\)/);
assert.match(analytics, /posthog\.reset\(\)/);
assert.match(layout, /<CookieConsent \/>/);
assert.match(layout, /data-consent-open/);

console.log('Consent contract tests passed: default deny, accept/reject, granular choice, persistence, expiry, and withdrawal.');
