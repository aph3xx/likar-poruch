# SEO implementation checklist

Scope: conversion of the approved SEO report on task `t_f1276181` into implementation-ready work items. Repository inspection was read-only on 2026-10-16 in `/home/sgdt1a/projects/likar-poruch`. Status labels: **Applicable**, **Already satisfied**, **Conditional/blocked**, or **Not applicable**.

Important evidence boundary: the parent report did not have live HTTP/browser access (Chrome was unavailable). Current conclusions below are based on source files and the checked-in `dist/` output. Deployment status, redirects, Search Console, Rich Results, and Core Web Vitals still require a real-host check.

## Checklist

1. **Confirm and record the Ukrainian-only URL policy.**
   - Affected: route policy, deployment redirects, `src/layouts/BaseLayout.astro`, README, sitemap output.
   - Expected behavior: only Ukrainian routes and Ukrainian user-facing metadata are exposed for indexing; no Russian navigation, copy, `hreflang="ru"`, `og:locale:ru`, or multilingual route set is introduced.
   - Acceptance: policy is documented; `src/pages/` contains no Russian route tree; generated HTML has `lang="uk"`, `hreflang="uk"` and `x-default` only; no Russian URLs occur in sitemap or internal links.
   - Applicability: **Applicable; already satisfied in inspected source/build**, but retain as a release gate. The parent report described four Russian routes, while the current checkout has no `src/pages/ru`, `RussianLayout`, or `site-ru` file and the checked `dist/sitemap-0.xml` has no `/ru/` URLs. This discrepancy must be resolved against the intended release commit before implementation.

2. **Decide legacy `/ru/*` handling using evidence, not assumption.**
   - Affected: private SUR host redirect configuration or static route stubs; Search Console and backlink/indexation evidence.
   - Expected behavior: if legacy Russian URLs have meaningful indexation/backlinks, map each one-to-one to the Ukrainian equivalent with a 301; otherwise return an intentional 404/410 or leave retired, according to the owner decision. Redirects must not be listed in the sitemap.
   - Acceptance: each legacy path has a recorded disposition and live HTTP verification; no blanket redirect; final URLs are Ukrainian and canonical.
   - Applicability: **Conditional/blocked** until historical URL/indexation/backlink evidence and hosting redirect capability are checked. Do not add Russian pages merely to satisfy the old report.

3. **Verify the canonical public origin before deployment.**
   - Affected: `astro.config.mjs:5`, `scripts/validate-build.mjs:5`, deployment environment (`PUBLIC_SITE_URL`).
   - Expected behavior: canonical, Open Graph, JSON-LD, image, robots, RSS, and sitemap URLs use the deployed origin plus `/likar-poruch` base; no fallback host leaks into production.
   - Acceptance: build with the real `PUBLIC_SITE_URL`; inspect representative HTML and generated sitemap/robots; all absolute URLs share the expected origin. Add a CI/build assertion if the deployment contract requires `PUBLIC_SITE_URL`.
   - Applicability: **Applicable; implementation satisfied**. The default Astro origin and validator fallback are the confirmed private SUR origin; deployment still passes `PUBLIC_SITE_URL=https://sur.kyiv.ua` explicitly.

4. **Keep static prerendering and crawlable HTML.**
   - Affected: `astro.config.mjs:8`, all `src/pages/*.astro`, `src/layouts/BaseLayout.astro`.
   - Expected behavior: important route content, title, description, canonical, language, and links exist in generated HTML without depending on client JavaScript.
   - Acceptance: `npm run build`; inspect HTML for `/`, `/posluhy/`, `/kontakty/`, `/zapys/`, `/zhurnal/`, and every article; each has visible content and metadata in `dist/`.
   - Applicability: **Applicable; already satisfied structurally** (`output: 'static'`, Astro templates). Recheck after content/layout changes.

5. **Protect sitemap correctness and canonical-only inclusion.**
   - Affected: `astro.config.mjs:9`, generated `dist/sitemap-index.xml` and `dist/sitemap-0.xml`, `scripts/validate-build.mjs:28-30`.
   - Expected behavior: sitemap contains only canonical, indexable, intended Ukrainian URLs; excludes 404, redirects, private/noindex pages, and retired Russian URLs; URL slash/base/origin policy is consistent.
   - Acceptance: parse sitemap after build; every `<loc>` has the expected origin/base and trailing slash; every URL maps to a generated page with one canonical and indexable robots meta; `/404/` and `/ru/` are absent. Keep the existing `/ru/` assertion and strengthen it to validate all sitemap URLs.
   - Applicability: **Applicable; partly satisfied**. Current sitemap has 12 Ukrainian URLs and no `/ru/`; `privacy/` is included, so owner must decide whether it is a public index target or should receive `noindex` and be removed. The guide requires only canonical URLs, not necessarily only commercial pages.

6. **Verify robots and sitemap discovery on the deployed host.**
   - Affected: `src/pages/robots.txt.ts`, generated `dist/robots.txt`, deployment path.
   - Expected behavior: `User-agent: * / Allow: /` remains permissive for public pages and `Sitemap:` points to the deployed `/likar-poruch/sitemap-index.xml` (or the exact custom-domain path).
   - Acceptance: live `robots.txt` returns 200 text/plain, contains the exact deployed sitemap URL, does not block target routes, and does not expose private content. Confirm `sitemap-index.xml` is live.
   - Applicability: **Applicable; source/build pass, live verification pending**. The production artifact points to the private SUR sitemap at `https://sur.kyiv.ua/likar-poruch/sitemap-index.xml`.

7. **Enforce one canonical, title, description, language, and H1 per indexable page.**
   - Affected: `src/layouts/BaseLayout.astro:21-34`, route frontmatter/props, `scripts/validate-build.mjs:16-26`.
   - Expected behavior: each indexable route has unique Ukrainian title/description, exactly one canonical, `lang="uk"`, one H1, and indexable robots directives unless intentionally excluded.
   - Acceptance: validation checks uniqueness (not only presence), exact-one canonical/H1, `lang=uk`, description length/content, and no accidental noindex on target routes. Validate all journal pages generated from `src/data/articles.json`.
   - Applicability: **Applicable; baseline already present**, but uniqueness and intended indexability need explicit regression checks.

8. **Review and improve high-intent page titles and descriptions without keyword stuffing.**
   - Affected: `src/pages/index.astro:27`, `posluhy.astro:8`, `kontakty.astro:10`, `pro-nas.astro:4`, `zapys.astro`, journal route templates and `src/data/articles.json`.
   - Expected behavior: every title/description describes the actual page and Ukrainian search intent; Kyiv/location claims appear only where truthful; no duplicated or thin metadata.
   - Acceptance: documented title/description inventory for homepage, services, contacts, booking, about, journal index, and each article; all remain Ukrainian, human-readable, and within agreed length targets. The services title currently already includes Kyiv and relevant service terms; change only where evidence supports improvement.
   - Applicability: **Applicable; editorial review required**, not an automatic rewrite.

9. **Keep Ukrainian language and social metadata consistent.**
   - Affected: `src/layouts/BaseLayout.astro:22,26-33`, article/page data, `src/pages/rss.xml.js`.
   - Expected behavior: HTML uses `lang="uk"`; `hreflang="uk"` and `x-default` self-reference the Ukrainian canonical; `og:locale` is `uk_UA`; RSS language remains `uk-UA`; no Russian/English user-facing metadata is added.
   - Acceptance: generated HTML and RSS have only the approved Ukrainian signals; alternate links resolve to existing canonical pages; social image/title/description URLs are absolute and base-aware.
   - Applicability: **Applicable; already satisfied in inspected source**, with post-build regression coverage required.

10. **Validate canonical, image, OG, JSON-LD, RSS, and sitemap URLs against the base path.**
    - Affected: `BaseLayout.astro:7-11,19,32-34`; `index.astro`, contacts, journal templates, RSS route; `astro.config.mjs:6`.
    - Expected behavior: no root-relative production links accidentally bypass `/likar-poruch`; all absolute URLs use `siteOrigin + base`.
    - Acceptance: automated scan flags absolute/root-relative internal URLs that omit `/likar-poruch`; representative HTML, JSON-LD, RSS, sitemap, and manifest all resolve under the deployed base.
    - Applicability: **Applicable; mostly satisfied**. `Breadcrumbs.astro` and `BaseLayout` base-prefix links; audit route-specific constructions such as contacts and RSS after any edits.

11. **Normalize clinic structured data as one truthful entity.**
    - Affected: JSON-LD in `src/pages/index.astro:20-24` and `src/pages/kontakty.astro:6-8`; potentially shared schema helper/data.
    - Expected behavior: homepage and contacts use one stable `MedicalClinic` `@id`, consistent name, URL, telephone, and verified address. Add `sameAs` only for real profiles; do not invent fields.
    - Acceptance: schema parses as valid JSON-LD; entity values match visible page content and `src/data/site.json`; address details and specialties are verified by the owner; no contradictory clinic entities.
    - Applicability: **Applicable; incomplete/needs factual verification**. Current source uses the same `@id` pattern but duplicates schema and hard-codes `вул. Хоральська, 1А`; verify that address, phone, and specialties are real before treating as publishable.

12. **Retain FAQPage only when visible FAQ answers remain rendered.**
    - Affected: `src/pages/index.astro:14-24` and visible FAQ section at lines 59-60.
    - Expected behavior: every FAQ schema question/answer is materially visible to users on the same page and remains Ukrainian.
    - Acceptance: schema question count/text matches rendered `<details>` content; Rich Results Test and schema.org validator parse it; remove FAQ schema if the visible FAQ is removed or materially diverges.
    - Applicability: **Applicable; currently satisfied structurally**, external validation pending. Rich results are not guaranteed.

13. **Validate article structured data against the editorial facts.**
    - Affected: `src/pages/zhurnal/[slug].astro:6-7`, `src/data/articles.json`.
    - Expected behavior: Article/MedicalWebPage schema uses visible title, description, author, reviewer, publication/update dates, Ukrainian `inLanguage`, and valid breadcrumb URLs; no unsupported claims about medical review.
    - Acceptance: every generated article has parseable JSON-LD and matching visible byline/date; reviewer identity/process is confirmed; Rich Results Test/schema.org validation passes or known non-eligibility is documented.
    - Applicability: **Applicable; conditional on factual editorial process**. Current template emits `Медична редакція`; owner must confirm this is truthful.

14. **Use BreadcrumbList only where the visible breadcrumb exists.**
    - Affected: `src/components/Breadcrumbs.astro`, route templates, article schema in `[slug].astro`.
    - Expected behavior: schema hierarchy exactly matches visible Ukrainian breadcrumbs and canonical URLs; no breadcrumb schema is emitted for pages without a visible breadcrumb.
    - Acceptance: inspect each route/schema pair; ensure positions and URLs are correct under `/likar-poruch`; add schemas to other high-value pages only together with visible breadcrumbs.
    - Applicability: **Applicable; article breadcrumbs/schema are present; broader expansion is optional and requires implementation review**.

15. **Preserve crawlable internal linking and improve contextual links.**
    - Affected: `BaseLayout.astro:41-48`, `Breadcrumbs.astro`, homepage, `posluhy.astro`, `kontakty.astro`, `src/pages/zhurnal/index.astro`, `[slug].astro`.
    - Expected behavior: important pages are reachable through `<a href>` links; articles link contextually to relevant services/contact/booking pages; related articles link where useful; anchors are descriptive Ukrainian text rather than repetitive “Читати”.
    - Acceptance: route graph includes homepage → services/contact/booking/journal and article → relevant conversion pages; internal-link validator finds no broken links or base-path omissions; anchor text is reviewed for usefulness.
    - Applicability: **Applicable**. Current navigation and article CTA exist; contextual article-to-service/related-article links are limited and should be reviewed against the editorial plan.

16. **Maintain heading and content quality for target routes.**
    - Affected: route templates and article content in `src/data/articles.json`.
    - Expected behavior: one clear H1 per route, useful original Ukrainian content matching intent, no thin/duplicated pages, no keyword stuffing.
    - Acceptance: `npm test` passes one-H1 check; editorial review confirms each target page answers its intent and has a meaningful body; no Russian, English, or multilingual copy is introduced.
    - Applicability: **Applicable; baseline is already tested**, content-depth review remains human work.

17. **Protect performance and mobile behavior.**
    - Affected: `src/pages/index.astro:37`, image assets in `public/images`, `src/styles/global.css`, `PostHogAnalytics.astro`.
    - Expected behavior: hero retains explicit dimensions and high priority; below-fold images are appropriately lazy-loaded/responsive; JavaScript and analytics do not block rendering or transmit health/patient data; mobile layout has no overflow.
    - Acceptance: run `npm run qa:browser`; run PageSpeed Insights against deployed homepage, services, article, and booking pages; record mobile LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 as UX targets (not ranking guarantees); document any exceptions.
    - Applicability: **Applicable; source has a favorable static baseline and existing browser QA; live PageSpeed evidence pending**.

18. **Check privacy and sensitive-data boundaries for analytics.**
    - Affected: `src/components/PostHogAnalytics.astro`, privacy page, booking form components, deployment environment.
    - Expected behavior: PostHog is optional, non-blocking, and does not collect patient/health data or form contents; privacy copy accurately describes actual behavior.
    - Acceptance: inspect runtime requests with configured/unconfigured `PUBLIC_POSTHOG_KEY`; verify form fields are not sent to analytics; reconcile `src/pages/privacy.astro` with implementation.
    - Applicability: **Applicable; evidence needed**. Parent report explicitly flags PostHog as a verification item; this is SEO-adjacent trust/compliance work, not a reason to add tracking.

19. **Run the repository quality and browser gates after SEO changes.**
    - Affected: `package.json` scripts, `scripts/validate-build.mjs`, `scripts/browser-qa.mjs`, generated `dist/` and `artifacts/qa/`.
    - Expected behavior: build, Astro type/check, metadata/sitemap validation, and browser QA all pass without stale Russian/aggregator signals or broken routes.
    - Acceptance: run `npm run test`, `npm run check`, and `npm run qa:browser`; retain outputs/artifacts. Current QA explicitly checks Ukrainian `lang`, absence of Russian hreflang, clinic schema, route responses, booking validation, console errors, and overflow.
    - Applicability: **Applicable; required implementation gate**. No test execution was performed for this checklist task.

20. **Strengthen automated release assertions for SEO invariants.**
    - Affected: `scripts/validate-build.mjs`; optionally a new script wired into `package.json`.
    - Expected behavior: CI fails on wrong origin, duplicate metadata, non-Ukrainian language/hreflang, sitemap URLs without generated canonical pages, `/ru/` URLs, 404/private pages in sitemap, invalid internal links, or malformed JSON-LD.
    - Acceptance: tests exercise both normal build and failure fixtures/conditions where practical; error messages identify route and invariant; no reliance solely on manual inspection.
    - Applicability: **Applicable; enhancement**. Existing validator covers many invariants but does not verify uniqueness, every sitemap URL mapping, JSON-LD parseability, or exact origin for all artifacts.

21. **Deploy and verify real HTTP behavior.**
    - Affected: deployed host, hosting configuration, robots/sitemap, redirects, all target routes.
    - Expected behavior: target pages return 200; redirects are intentional and one-hop; canonical and language metadata match the final URL; robots/sitemap are accessible; no accidental auth/WAF/challenge blocks Google.
    - Acceptance: from the real public host, record status/redirect chain for `/`, `/posluhy/`, `/kontakty/`, `/zapys/`, `/zhurnal/`, each article, `/robots.txt`, sitemap index, and any retired URLs. This evidence must replace the current “Chrome unavailable” limitation.
    - Applicability: **Applicable; blocked until deployment/public host is available**.

22. **Complete Search Console launch and monitoring.**
    - Affected: Google Search Console property and deployment operations; no repository file necessarily required.
    - Expected behavior: property ownership verified, exact deployed sitemap submitted, key URLs live-tested/requested for indexing, exclusions/canonical selection monitored.
    - Acceptance: retain property/sitemap submission date, URL Inspection results for homepage, services, contacts, booking, journal index, and at least one article; review Page Indexing and canonical-selected reports weekly after launch.
    - Applicability: **Applicable; operational task blocked on owner access and live deployment**. Sitemap submission/requesting indexing does not guarantee inclusion.

23. **Validate rich results and schema externally.**
    - Affected: deployed homepage, contacts, journal index/articles; implementation files listed in items 11–14.
    - Expected behavior: JSON-LD is parseable and reflects visible content; unsupported or untruthful properties are removed.
    - Acceptance: run Google Rich Results Test and schema.org validator on representative deployed pages; record URLs, dates, errors/warnings, and disposition. Do not claim rich-result eligibility merely because schema exists.
    - Applicability: **Applicable; blocked until deployed URLs are available**.

24. **Measure SEO outcomes after launch without promising rankings.**
    - Affected: Search Console reporting and editorial backlog (`src/data/articles.json`).
    - Expected behavior: after 2–4 weeks, compare impressions, clicks, CTR, average position, indexed/excluded URLs by route/query; use results to prioritize content/internal-link improvements.
    - Acceptance: produce a dated baseline and follow-up segmented by homepage, services, contacts/booking, journal index, and articles; investigate “crawled – currently not indexed,” canonical conflicts, and unexpected language URLs.
    - Applicability: **Applicable; post-launch operational task**, not verifiable in the current repository.

25. **Keep external authority/content recommendations Ukrainian-only and evidence-based.**
    - Affected: editorial plan, `src/data/articles.json`, internal-link plan, outreach process.
    - Expected behavior: publish the approved Ukrainian editorial assets and earn relevant, credible links without spam or paid-link schemes; do not introduce Russian, English, or multilingual landing pages merely for SEO.
    - Acceptance: each approved asset has a Ukrainian title/slug/intent, visible content, metadata, and internal-link destination; any external promotion is documented and relevant.
    - Applicability: **Applicable to editorial workflow; implementation locations are content data and CMS**, but outreach outcomes cannot be verified from this repository.

## Unresolved decisions/evidence required

- Confirm whether the parent report was generated from a different commit/worktree: it claims `src/pages/ru/*`, `RussianLayout.astro`, and `src/data/site-ru.json`, but those files and `/ru/` sitemap URLs are absent in the inspected checkout.
- Production hosting is resolved: GitHub Pages is not used; the private SUR host at `https://sur.kyiv.ua/likar-poruch/` determines `PUBLIC_SITE_URL`, robots, canonical, sitemap, and redirect implementation. Live-host verification remains a separate release gate.
- Obtain legacy `/ru/*` traffic/backlink/indexation evidence before choosing 301 versus 404/410.
- Verify the clinic address, phone, specialties, `MedicalClinic` identity, editorial reviewer, and any social profiles before publishing corresponding structured-data claims.
- Obtain live-host access/URLs for HTTP, Search Console, Rich Results, schema.org, PageSpeed, and Core Web Vitals verification.
