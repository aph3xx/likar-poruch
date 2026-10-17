import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:4321/likar-poruch";
const resolverRules = process.env.QA_HOST_RESOLVER_RULES;
await fs.mkdir("artifacts/qa", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: resolverRules ? [`--host-resolver-rules=${resolverRules}`] : [],
});
const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "tablet-768", width: 768, height: 900 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const targetWidths = [320, 360, 390, 640, 768, 1024, 1280, 1440];
const interactiveTargetSelector =
  'a[href], button, select, summary, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])';
const findUndersizedTargets = (page) =>
  page.locator(interactiveTargetSelector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const isInlineTextLink =
          element instanceof HTMLAnchorElement &&
          style.display === "inline" &&
          parent &&
          ["P", "LI"].includes(parent.tagName) &&
          parent.textContent?.trim() !== element.textContent?.trim();
        return (
          !isInlineTextLink &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (
          element.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("name") ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 80),
        height: Number(element.getBoundingClientRect().height.toFixed(2)),
      }))
      .filter(({ height }) => height < 44),
  );
const assertNoLocalDraftDeliveryPromises = (copy, context) => {
  const normalized = copy.toLowerCase();
  for (const banned of [
    "sms",
    "адміністратор",
    "администратор",
    "підтверджує запис",
    "підтвердить запис",
    "погодить дату",
    "зв’яжеться з вами",
    "зв'яжеться з вами",
  ]) {
    if (normalized.includes(banned))
      throw new Error(`${context}: local-draft form promises clinic delivery: ${banned}`);
  }
};
const isFirstPartyResource = (url, pageUrl) => {
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
};
const navigateAndAssertResourcesOnce = async (page, url, options = {}) => {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(10_000);
  const pending = new Set();
  const trackRequest = (request) => {
    if (isFirstPartyResource(request.url(), url)) pending.add(request);
  };
  const finishRequest = (request) => pending.delete(request);
  page.on("request", trackRequest);
  page.on("requestfinished", finishRequest);
  page.on("requestfailed", finishRequest);
  try {
    const response = options.reload
      ? await page.reload({ waitUntil: "commit" })
      : await page.goto(url, { waitUntil: "commit" });
    if (!response?.ok()) throw new Error(`${url}: ${response?.status()}`);
    await page.locator("body").waitFor({ state: "attached" });
    await page.waitForFunction(
      () => [...document.images].every((image) => image.complete),
    );
    const deadline = Date.now() + 10_000;
    while (pending.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (pending.size)
      throw new Error(
        `${url}: first-party resources did not complete: ${[...pending]
          .map((request) => request.url())
          .join(", ")}`,
      );
    return response;
  } finally {
    page.off("request", trackRequest);
    page.off("requestfinished", finishRequest);
    page.off("requestfailed", finishRequest);
  }
};
const navigateAndAssertResources = async (page, url, options = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await navigateAndAssertResourcesOnce(page, url, options);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
};
const assertManifest = async (page, pageName) => {
  const manifestResult = await page.locator('link[rel="manifest"]').evaluate(async (link) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(link.href, { signal: controller.signal });
      return { status: response.status, contentType: response.headers.get("content-type") || "" };
    } finally {
      clearTimeout(timeout);
    }
  });
  if (manifestResult.status !== 200)
    throw new Error(`${pageName}: manifest returned ${manifestResult.status}`);
  if (!/^application\/(manifest\+json|json)(?:;|$)/i.test(manifestResult.contentType))
    throw new Error(`${pageName}: manifest MIME is ${manifestResult.contentType || "missing"}`);
};
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await navigateAndAssertResources(page, `${base}/`);
    await assertManifest(page, viewport.name);
    if (
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      )
    )
      throw new Error(`${viewport.name}: horizontal overflow`);
    if (errors.length)
      throw new Error(`${viewport.name}: ${errors.join("; ")}`);
    if (
      !(await page
        .getByRole("heading", { name: /Здоров’я ближче/ })
        .isVisible())
    )
      throw new Error(`${viewport.name}: clinic hero missing`);
    if ((await page.locator('a[href^="tel:"]').count()) < 2)
      throw new Error(`${viewport.name}: phone links missing`);
    const text = await page.locator("body").innerText();
    assertNoLocalDraftDeliveryPromises(text, viewport.name);
    const faqSchema = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => {
      const faq = scripts
        .map((script) => {
          try { return JSON.parse(script.textContent || "{}"); } catch { return null; }
        })
        .find((entry) => entry?.['@type'] === 'FAQPage');
      return faq?.mainEntity || [];
    });
    const faqText = JSON.stringify(faqSchema).toLowerCase();
    assertNoLocalDraftDeliveryPromises(faqText, `${viewport.name}: FAQ JSON-LD`);
    const appointmentFormCopy = await page.locator('.appointment-card').innerText();
    if (!/локальна\s+чернетка/i.test(appointmentFormCopy) || !/не надсилає/i.test(appointmentFormCopy))
      throw new Error(`${viewport.name}: appointment form local-draft disclosure missing`);
    for (const banned of [
      "каталог лікарів",
      "демонстраційні профілі",
      "платного ранжування",
    ])
      if (text.toLowerCase().includes(banned))
        throw new Error(`${viewport.name}: stale aggregator copy: ${banned}`);
    if ((await page.getAttribute("html", "lang")) !== "uk")
      throw new Error(`${viewport.name}: Ukrainian page language missing`);
    if (await page.locator('link[rel="alternate"][hreflang="ru"]').count())
      throw new Error(`${viewport.name}: retired Russian hreflang present`);
    await page.screenshot({
      path: `artifacts/qa/${viewport.name}.png`,
      fullPage: true,
    });
    if (viewport.width === 360) {
      const menu = page.locator(".menu-toggle");
      if (!(await menu.isVisible())) throw new Error("mobile menu missing");
      await menu.focus();
      await menu.click();
      if (!(await page.locator("#site-nav").isVisible()))
        throw new Error("mobile nav failed");
      await page.keyboard.press("Escape");
      if (await page.locator("#site-nav").isVisible())
        throw new Error("mobile nav did not close on Escape");
      if (
        !(await menu.evaluate((element) => element === document.activeElement))
      )
        throw new Error("mobile menu did not restore focus");
      if (!(await page.locator(".mobile-action-bar").isVisible()))
        throw new Error("mobile action bar missing");
    }
    await page.close();
  }
  const consentPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const consentRequests = [];
  consentPage.on("request", (request) =>
    consentRequests.push({
      url: request.url(),
      body: request.postData() || "",
    }),
  );
  await navigateAndAssertResources(consentPage, `${base}/`);
  await consentPage.evaluate(() => localStorage.removeItem("likar-consent-v1"));
  consentRequests.length = 0;
  await navigateAndAssertResources(consentPage, `${base}/`, { reload: true });
  const sdkRequestsBefore = consentRequests.filter(({ url }) =>
    /\/_astro\/module\.[^/]+\.js|posthog\.com/i.test(url),
  );
  if (sdkRequestsBefore.length)
    throw new Error(
      `consent: PostHog SDK/network loaded before consent: ${sdkRequestsBefore.map(({ url }) => url).join(", ")}`,
    );
  const expectAnalytics = process.env.QA_EXPECT_ANALYTICS === "1";
  await consentPage
    .getByRole("button", { name: "Відхилити необов’язкові" })
    .first()
    .click();
  await navigateAndAssertResources(consentPage, `${base}/`, { reload: true });
  await consentPage
    .locator("[data-consent-banner]")
    .waitFor({ state: "hidden" });
  await consentPage.evaluate(() =>
    localStorage.setItem(
      "likar-consent-v1",
      JSON.stringify({
        version: "2026-10-16",
        timestamp: Date.now() + 60_000,
        purposes: { analytics: true },
        action: "accept_all",
      }),
    ),
  );
  await navigateAndAssertResources(consentPage, `${base}/`, { reload: true });
  await consentPage
    .locator("[data-consent-banner]")
    .waitFor({ state: "visible" });
  await consentPage.evaluate(() =>
    localStorage.setItem(
      "likar-consent-v1",
      JSON.stringify({
        version: "2026-10-16",
        timestamp: Date.now(),
        purposes: { analytics: true },
        action: "forged",
      }),
    ),
  );
  await navigateAndAssertResources(consentPage, `${base}/`, { reload: true });
  await consentPage
    .locator("[data-consent-banner]")
    .waitFor({ state: "visible" });
  await consentPage
    .getByRole("button", { name: "Дозволити аналітику" })
    .click();
  if (expectAnalytics) {
    await consentPage.waitForTimeout(1500);
    await consentPage.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("likar:booking_started", {
          detail: {
            name: "SENTINEL_NAME",
            phone: "SENTINEL_PHONE",
            medical: "SENTINEL_MEDICAL",
          },
        }),
      ),
    );
    await consentPage.waitForTimeout(500);
    const sdkRequestsAfter = consentRequests.filter(({ url }) =>
      /\/_astro\/module\.[^/]+\.js/i.test(url),
    );
    const hostRequestsAfter = consentRequests.filter(({ url }) =>
      /posthog\.com/i.test(url),
    );
    if (!sdkRequestsAfter.length)
      throw new Error(
        "consent: PostHog SDK asset did not load after affirmative consent",
      );
    if (!hostRequestsAfter.length)
      throw new Error(
        "consent: PostHog network request did not occur after affirmative consent",
      );
    if (
      consentRequests.some(({ body }) =>
        /SENTINEL_NAME|SENTINEL_PHONE|SENTINEL_MEDICAL/.test(body),
      )
    )
      throw new Error(
        "consent: sentinel form value leaked into analytics payload",
      );
    const requestsBeforeWithdrawal = consentRequests.length;
    await consentPage
      .getByRole("button", { name: "Налаштування приватності" })
      .click();
    await consentPage.locator("[data-consent-analytics]").uncheck();
    await consentPage.getByRole("button", { name: "Зберегти вибір" }).click();
    await consentPage.evaluate(() =>
      window.dispatchEvent(new CustomEvent("likar:booking_started")),
    );
    await consentPage.waitForTimeout(500);
    if (
      consentRequests
        .slice(requestsBeforeWithdrawal)
        .some(({ url }) => /posthog\.com/i.test(url))
    )
      throw new Error("consent: withdrawal generated a PostHog request");
  }
  await consentPage.close();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const retainedRoutes = [
    "/",
    "/posluhy/",
    "/pro-nas/",
    "/kontakty/",
    "/zapys/",
    "/yak-tse-pratsiuie/",
    "/privacy/",
    "/zhurnal/",
    "/zhurnal/yak-obraty-simeinoho-likaria/",
    "/zhurnal/yak-pidhotuvatysia-do-konsultatsii/",
    "/zhurnal/koly-vyklykaty-103/",
    "/zhurnal/dokazova-medytsyna-prostymy-slovamy/",
  ];
  for (const width of targetWidths) {
    await page.setViewportSize({ width, height: width < 640 ? 800 : 900 });
    for (const route of retainedRoutes) {
      await navigateAndAssertResources(page, `${base}${route}`);
      if (
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        )
      )
        throw new Error(`${width}px ${route}: horizontal overflow`);
      const undersizedTargets = await findUndersizedTargets(page);
      if (undersizedTargets.length)
        throw new Error(
          `${width}px ${route}: interactive targets below 44px: ${undersizedTargets.map(({ text, height }) => `${text} (${height}px)`).join(", ")}`,
        );
    }
  }
  await navigateAndAssertResources(page, `${base}/zapys/`);
  const booking = page.locator("[data-appointment-form]");
  if (!(await booking.isVisible())) throw new Error("booking form missing");
  const fields = booking.locator("[data-validate]");
  if ((await fields.count()) !== 3)
    throw new Error("booking form should have exactly three fields");
  const names = await fields.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("name")),
  );
  if (JSON.stringify(names) !== '["name","phone","datetime"]')
    throw new Error(`unexpected booking fields: ${names.join(",")}`);
  await booking.locator('button[type="submit"]').click();
  if (!(await page.locator("[data-error-summary]").isVisible()))
    throw new Error("booking validation summary missing");
  await booking.locator('[name="name"]').fill("Тест Пацієнт");
  await booking.locator('[name="phone"]').fill("+380671234567");
  await booking.locator('[name="datetime"]').fill("2099-01-01T10:30");
  const navigations = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await booking.locator('button[type="submit"]').click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("likar:appointment_request") || "null"),
  );
  if (
    JSON.stringify(saved) !==
    '{"name":"Тест Пацієнт","phone":"+380671234567","datetime":"2099-01-01T10:30"}'
  )
    throw new Error("booking draft values were not stored exactly");
  if (
    !/чернетку збережено/i.test(
      await page.locator("[data-submit-status]").innerText(),
    )
  )
    throw new Error("booking success status missing");
  if (
    requests.some(
      (url) => !url.includes("_astro") && !url.includes("127.0.0.1"),
    )
  )
    throw new Error("booking submit made a network request");
  if (navigations.length) throw new Error("booking submit navigated");
  const denied = await page.evaluate(() => {
    localStorage.removeItem("likar:appointment_request");
    Storage.prototype.setItem = function () {
      throw new DOMException("blocked", "SecurityError");
    };
    return true;
  });
  if (!denied) throw new Error("storage denial setup failed");
  await booking.locator('button[type="submit"]').click();
  if (
    !/не вдалося зберегти/i.test(
      await page.locator("[data-submit-status]").innerText(),
    )
  )
    throw new Error("storage-denied error status missing");
  if (
    await page.evaluate(() =>
      Boolean(localStorage.getItem("likar:appointment_request")),
    )
  )
    throw new Error("storage-denied path wrote a draft");
  await navigateAndAssertResources(page, `${base}/`);
  if (await page.locator('link[rel="alternate"][hreflang="ru"]').count())
    throw new Error("retired Russian hreflang present");
  const schemas = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) =>
      nodes.flatMap((n) => {
        const x = JSON.parse(n.textContent || "{}");
        return Array.isArray(x) ? x : [x];
      }),
    );
  if (!schemas.some((x) => x["@type"] === "MedicalClinic"))
    throw new Error("MedicalClinic JSON-LD missing");
  const homepageClinic = schemas.find((x) => x["@type"] === "MedicalClinic");
  const homepageText = (await page.locator("body").innerText()).toLowerCase();
  for (const stale of ["sms", "адміністратор зв’яжеться", "адміністратор погодить"])
    if (homepageText.includes(stale))
      throw new Error(`booking contract contains stale claim: ${stale}`);
  if (!homepageText.includes("локальн") || !homepageText.includes("зателефонуйте до клініки"))
    throw new Error("local-draft phone handoff copy missing");
  await navigateAndAssertResources(page, `${base}/kontakty/`);
  const contactsClinic = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) =>
    nodes.flatMap((n) => {
      const x = JSON.parse(n.textContent || "{}");
      return Array.isArray(x) ? x : [x];
    }).find((x) => x["@type"] === "MedicalClinic"),
  );
  if (!homepageClinic?.["@id"] || homepageClinic["@id"] !== contactsClinic?.["@id"])
    throw new Error("homepage and contacts MedicalClinic identity mismatch");
  for (const field of ["name", "url", "telephone"])
    if (homepageClinic[field] !== contactsClinic[field])
      throw new Error(`MedicalClinic ${field} mismatch`);
  await navigateAndAssertResources(page, `${base}/`);
  if (schemas.some((x) => ["ItemList", "ProfilePage"].includes(x["@type"])))
    throw new Error("stale aggregator schema found");
  await page.close();
  console.log(
    "Clinic browser QA passed across retained Ukrainian routes at 320, 360, 390, 640, 768, 1024, 1280, and 1440px: 44px standalone targets, consent, booking persistence, navigation, phone CTAs, MedicalClinic schema, console, and overflow checks pass.",
  );
} finally {
  await browser.close();
}
