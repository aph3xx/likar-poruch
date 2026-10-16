import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4321/likar-poruch';
const resolverRules = process.env.QA_HOST_RESOLVER_RULES;
const widths = [320, 360, 390, 640, 768, 1024, 1280, 1440];

await fs.mkdir('artifacts/qa', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: resolverRules ? [`--host-resolver-rules=${resolverRules}`] : [],
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parseRgb = (value) => {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert(channels?.length === 3, `could not parse CSS color: ${value}`);
  return channels;
};

const relativeLuminance = (value) => {
  const channels = parseRgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (first, second) => {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
};

try {
  for (const width of widths) {
    const height = width < 640 ? 800 : 900;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const geometry = await page.evaluate(() => {
      const columns = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).gridTemplateColumns.split(' ').length : 0;
      };
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        h1Count: document.querySelectorAll('h1').length,
        mainCount: document.querySelectorAll('main').length,
        serviceColumns: columns('[data-service-grid]'),
        heroColumns: columns('[data-hero-grid]'),
        contactColumns: columns('[data-contact-grid]'),
      };
    });

    assert(geometry.scrollWidth <= geometry.clientWidth, `${width}px: horizontal overflow ${geometry.scrollWidth}/${geometry.clientWidth}`);
    assert(geometry.h1Count === 1, `${width}px: expected one H1`);
    assert(geometry.mainCount === 1, `${width}px: expected one main landmark`);
    assert(await page.locator('.skip-link').count() === 1, `${width}px: skip link missing`);
    assert(await page.getByRole('heading', { name: /Здоров’я ближче/ }).isVisible(), `${width}px: clinic hero missing`);
    const phoneTargets = await page.locator('a[href^="tel:"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    assert(phoneTargets.length >= 2, `${width}px: phone links missing`);
    assert(phoneTargets.every((target) => target === 'tel:+380931080095'), `${width}px: phone links must use the dialable clinic number`);
    assert(errors.length === 0, `${width}px: ${errors.join('; ')}`);

    await page.locator('.brand').first().focus();
    const focusStyle = await page.locator('.brand').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: Number.parseFloat(style.outlineWidth),
        style: style.outlineStyle,
        targetHeight: element.getBoundingClientRect().height,
      };
    });
    assert(focusStyle.width >= 2 && focusStyle.style !== 'none', `${width}px: visible focus indicator missing`);
    assert(focusStyle.targetHeight >= 44, `${width}px: header brand target is ${focusStyle.targetHeight}px high`);

    const expectedServiceColumns = width < 640 ? 1 : width < 1024 ? 2 : 3;
    assert(geometry.serviceColumns === expectedServiceColumns, `${width}px: expected ${expectedServiceColumns} service columns, got ${geometry.serviceColumns}`);
    assert(geometry.heroColumns === (width < 1024 ? 1 : 2), `${width}px: incorrect hero columns`);
    assert(geometry.contactColumns === (width < 1024 ? 1 : 2), `${width}px: incorrect contact columns`);

    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const banned of [
      'каталог лікарів',
      'демонстраційні профілі',
      'платного ранжування',
      'олена коваленко',
      '+38 (000)',
      'хрещатик, 1',
      '1800',
      '4.9',
    ]) {
      assert(!text.includes(banned), `${width}px: unsupported content: ${banned}`);
    }

    if (width < 1024) {
      const menu = page.locator('.menu-toggle');
      assert(await menu.isVisible(), `${width}px: mobile/tablet menu missing`);
      assert(await page.locator('.mobile-action-bar').isVisible(), `${width}px: mobile action bar missing`);
      await menu.focus();
      await menu.click();
      assert(await page.locator('#site-nav').isVisible(), `${width}px: mobile nav failed to open`);
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#site-nav').isVisible()), `${width}px: mobile nav failed to close on Escape`);
      assert(await menu.evaluate((element) => element === document.activeElement), `${width}px: menu focus was not restored`);
    } else {
      assert(!(await page.locator('.menu-toggle').isVisible()), `${width}px: desktop menu trigger should be hidden`);
    }

    if ([320, 390, 768, 1024, 1440].includes(width)) {
      await page.screenshot({ path: `artifacts/qa/home-${width}.png`, fullPage: true });
    }
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const retainedRoutes = [
    '/posluhy/', '/pro-nas/', '/kontakty/', '/zapys/', '/privacy/', '/zhurnal/',
    '/zhurnal/yak-obraty-simeinoho-likaria/', '/zhurnal/yak-pidhotuvatysia-do-konsultatsii/',
    '/zhurnal/koly-vyklykaty-103/', '/zhurnal/dokazova-medytsyna-prostymy-slovamy/',
    '/ru/', '/ru/uslugi/', '/ru/kontakty/', '/ru/zapis/',
  ];
  for (const width of [320, 360, 390, 640, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 800 : 900 });
    for (const route of retainedRoutes) {
      const response = await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
      assert(response?.ok(), `${width}px ${route}: ${response?.status()}`);
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert(geometry.scrollWidth <= geometry.clientWidth, `${width}px ${route}: horizontal overflow ${geometry.scrollWidth}/${geometry.clientWidth}`);
    }
  }

  await page.goto(`${base}/posluhy/`, { waitUntil: 'networkidle' });
  const darkSecondary = page.locator('.section-ink .button.secondary');
  const darkSecondaryColors = await darkSecondary.evaluate((element) => {
    const style = getComputedStyle(element);
    const sectionStyle = getComputedStyle(element.closest('.section-ink'));
    return { foreground: style.color, background: sectionStyle.backgroundColor };
  });
  assert(contrast(darkSecondaryColors.foreground, darkSecondaryColors.background) >= 4.5, 'secondary CTA has insufficient contrast on dark section');
  await darkSecondary.focus();
  const darkFocus = await darkSecondary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineColor, background: getComputedStyle(element.closest('.section-ink')).backgroundColor };
  });
  assert(contrast(darkFocus.outline, darkFocus.background) >= 3, 'focus indicator has insufficient contrast on dark section');

  const footerLink = page.locator('.footer-grid a').first();
  await footerLink.focus();
  const footerMetrics = await footerLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      outline: style.outlineColor,
      background: getComputedStyle(element.closest('.site-footer')).backgroundColor,
    };
  });
  assert(footerMetrics.height >= 44, `footer link target is ${footerMetrics.height}px high, expected at least 44px`);
  assert(contrast(footerMetrics.outline, footerMetrics.background) >= 3, 'footer focus indicator has insufficient contrast');
  const footerNavTops = await page.locator('.footer-grid > div:nth-child(2) a').evaluateAll((links) =>
    links.map((link) => link.getBoundingClientRect().top),
  );
  assert(footerNavTops.every((top, index) => index === 0 || top > footerNavTops[index - 1]), 'footer navigation links must stack vertically');

  await page.goto(`${base}/privacy/`, { waitUntil: 'networkidle' });
  const privacyStyles = await page.evaluate(() => ({
    sectionPadding: Number.parseFloat(getComputedStyle(document.querySelector('.section-compact')).paddingTop),
    copySize: Number.parseFloat(getComputedStyle(document.querySelector('.content-copy')).fontSize),
  }));
  assert(privacyStyles.sectionPadding >= 48, 'compact content section spacing regressed');
  assert(privacyStyles.copySize > 16, 'long-form content typography regressed');

  await page.goto(`${base}/zhurnal/`, { waitUntil: 'networkidle' });
  const journalCallout = await page.locator('.callout').evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: Number.parseFloat(style.borderLeftWidth), background: style.backgroundColor };
  });
  assert(journalCallout.border >= 4 && journalCallout.background !== 'rgba(0, 0, 0, 0)', 'journal callout styling regressed');

  await page.goto(`${base}/zhurnal/yak-obraty-simeinoho-likaria/`, { waitUntil: 'networkidle' });
  const articleStyles = await page.evaluate(() => ({
    headerMaxWidth: Number.parseFloat(getComputedStyle(document.querySelector('.article-header')).maxWidth),
    bylineDisplay: getComputedStyle(document.querySelector('.article-byline')).display,
    introSize: Number.parseFloat(getComputedStyle(document.querySelector('.article-intro')).fontSize),
    introBorder: Number.parseFloat(getComputedStyle(document.querySelector('.article-intro')).borderLeftWidth),
  }));
  assert(articleStyles.headerMaxWidth <= 900, 'article header measure regressed');
  assert(articleStyles.bylineDisplay === 'flex', 'article byline layout regressed');
  assert(articleStyles.introSize >= 20 && articleStyles.introBorder >= 4, 'article introduction styling regressed');

  await page.goto(`${base}/404/`, { waitUntil: 'networkidle' });
  const notFoundStyles = await page.locator('.not-found').evaluate((element) => {
    const style = getComputedStyle(element);
    return { textAlign: style.textAlign, paddingTop: Number.parseFloat(style.paddingTop) };
  });
  assert(notFoundStyles.textAlign === 'center' && notFoundStyles.paddingTop >= 80, '404 layout styling regressed');

  await page.goto(`${base}/zapys/`, { waitUntil: 'networkidle' });
  const booking = page.locator('[data-appointment-form]');
  assert(await booking.isVisible(), 'booking form missing');
  assert(await booking.locator('label').count() >= 6, 'booking controls need persistent labels');
  for (const name of ['name', 'phone', 'service', 'date', 'time', 'consent']) {
    assert(await booking.locator(`[name="${name}"]`).count() === 1, `booking field ${name} missing`);
  }
  await booking.locator('button[type="submit"]').click();
  assert(await page.locator('[data-error-summary]').isVisible(), 'booking validation summary missing');
  assert(await booking.locator('[aria-invalid="true"]').count() >= 5, 'booking errors are not linked to fields');

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await booking.locator('[name="name"]').fill('Тестовий Пацієнт');
  await booking.locator('[name="phone"]').fill('093 123 45 67');
  await booking.locator('[name="service"]').selectOption({ index: 1 });
  await booking.locator('[name="date"]').fill(tomorrow);
  await booking.locator('[name="time"]').fill('12:00');
  await booking.locator('[name="consent"]').check();
  assert((await booking.getAttribute('data-booking-endpoint')) === 'sms:+380931080095', 'booking endpoint must use the dialable clinic number');
  await page.evaluate(() => {
    window.__bookingSubmitCount = 0;
    window.addEventListener('likar:booking_submitted', () => { window.__bookingSubmitCount += 1; });
    const form = document.querySelector('[data-appointment-form]');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => window.__bookingSubmitCount === 1), 'valid booking handoff was not exactly once');
  assert(await booking.locator('button[type="submit"]').isDisabled(), 'booking submit was not locked during handoff');

  await page.goto(`${base}/ru/`, { waitUntil: 'networkidle' });
  assert((await page.getAttribute('html', 'lang')) === 'ru', 'Russian page language missing');
  assert(await page.locator('link[rel="alternate"][hreflang="uk"]').count(), 'Russian page Ukrainian hreflang missing');
  assert(await page.locator('link[rel="alternate"][hreflang="ru"]').count(), 'Russian page Russian hreflang missing');
  assert(await page.locator('img[src*="clinic-doctor"], img[src*="doctor-hero"]').count() === 0, 'unsupported doctor imagery remains on Russian home');
  await page.setViewportSize({ width: 390, height: 800 });
  const ruMenu = page.locator('.menu-toggle');
  await ruMenu.click();
  assert(await page.locator('#site-nav').isVisible(), 'Russian mobile menu failed to open');
  await page.setViewportSize({ width: 1280, height: 800 });
  assert((await ruMenu.getAttribute('aria-expanded')) === 'false', 'Russian menu aria-expanded stayed true at desktop breakpoint');
  assert(!(await page.locator('body').evaluate((element) => element.classList.contains('menu-open'))), 'Russian body stayed locked at desktop breakpoint');
  assert(!(await page.locator('#site-nav').evaluate((element) => element.classList.contains('is-open'))), 'Russian mobile nav state stayed open at desktop breakpoint');
  await page.setViewportSize({ width: 390, height: 800 });
  await ruMenu.click();
  await page.keyboard.press('Escape');
  assert(!(await page.locator('#site-nav').isVisible()), 'Russian mobile menu failed to close on Escape');
  assert(await ruMenu.evaluate((element) => element === document.activeElement), 'Russian menu focus was not restored');

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 800 });
  const ukMenu = page.locator('.menu-toggle');
  await ukMenu.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  assert((await ukMenu.getAttribute('aria-expanded')) === 'false', 'Ukrainian menu aria-expanded stayed true at desktop breakpoint');
  assert(!(await page.locator('body').evaluate((element) => element.classList.contains('menu-open'))), 'Ukrainian body stayed locked at desktop breakpoint');
  assert(!(await page.locator('#site-nav').evaluate((element) => element.classList.contains('is-open'))), 'Ukrainian mobile nav state stayed open at desktop breakpoint');

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const value = JSON.parse(node.textContent || '{}');
      return Array.isArray(value) ? value : [value];
    }),
  );
  assert(schemas.some((value) => value['@type'] === 'MedicalClinic'), 'MedicalClinic JSON-LD missing');
  assert(!schemas.some((value) => ['ItemList', 'ProfilePage'].includes(value['@type'])), 'stale aggregator schema found');
  await page.close();

  console.log(`Clinic browser QA passed at ${widths.join(', ')}px: semantics, responsive grids, menu keyboard behavior, content guardrails, booking validation, bilingual routes, schema, console, and overflow checks pass.`);
} finally {
  await browser.close();
}
