import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4321/likar-poruch';
await fs.mkdir('artifacts/qa', { recursive: true });
const browser = await chromium.launch({ headless: true });
const viewports = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 900 }
];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error(`${viewport.name}: horizontal overflow`);
    if (errors.length) throw new Error(`${viewport.name}: browser errors: ${errors.join('; ')}`);
    await page.screenshot({ path: `artifacts/qa/${viewport.name}.png`, fullPage: true });
    if (viewport.width === 360) {
      const menu = page.locator('.menu-toggle');
      if (!(await menu.isVisible())) throw new Error('mobile menu toggle is not visible');
      await menu.click();
      if (!(await page.locator('#site-nav').isVisible())) throw new Error('mobile navigation did not open');
    }
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/likari/`, { waitUntil: 'networkidle' });
  await page.getByRole('searchbox').fill('педіатр');
  if ((await page.locator('[data-doctor]:visible').count()) !== 1) throw new Error('doctor text filter failed');
  if ((await page.locator('#result-count').textContent())?.trim() !== 'Знайдено: 1') throw new Error('doctor result count failed');
  await page.selectOption('#city-filter', 'Львів');
  if ((await page.locator('[data-doctor]:visible').count()) !== 1) throw new Error('doctor city filter failed');

  await page.goto(`${base}/likari/olena-koval/`, { waitUntil: 'networkidle' });
  const physicianSchemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.flatMap(n => { const parsed = JSON.parse(n.textContent || '{}'); return Array.isArray(parsed) ? parsed : [parsed]; }).filter(x => x['@type'] === 'ProfilePage' && x.mainEntity?.['@type'] === 'Physician'));
  if (physicianSchemas.length !== 1) throw new Error('Physician JSON-LD missing');
  await page.getByLabel('Ваше ім’я').fill('Тест');
  await page.getByLabel('Телефон').fill('+380000000000');
  await page.getByRole('button', { name: 'Показати демо' }).click();
  if (!(await page.locator('.form-status').textContent())?.includes('Готово')) throw new Error('demo booking confirmation missing');
  await page.screenshot({ path: 'artifacts/qa/profile-desktop.png', fullPage: true });

  await page.goto(`${base}/zhurnal/yak-obraty-simeinoho-likaria/`, { waitUntil: 'networkidle' });
  const articleSchemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.flatMap(n => { const parsed = JSON.parse(n.textContent || '{}'); return Array.isArray(parsed) ? parsed : [parsed]; }).filter(x => x['@type'] === 'MedicalWebPage' && x.mainEntity?.['@type'] === 'Article'));
  if (articleSchemas.length !== 1) throw new Error('MedicalWebPage JSON-LD missing');
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('article horizontal overflow');
  await page.close();

  console.log('Browser QA passed at 360px, 768px, 1280px, and 1440px. Mobile navigation, filtering, demo booking, structured data, console, and overflow checks pass.');
} finally {
  await browser.close();
}
