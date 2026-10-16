# Лікар Поруч

Ukrainian-first website for a private medical practice serving adults and children. Built with Astro and managed through Pages CMS.

## Local development

```bash
npm install
npm run dev
```

Production verification:

```bash
npm run check
npm test
npm run qa:browser
```

`npm test` builds the static site and verifies metadata, one H1 per page, Ukrainian and Russian language metadata, canonical URLs, and internal links. Browser QA checks 360, 768, 1280, and 1440 pixel layouts, mobile navigation, reciprocal hreflang, appointment-form validation, phone CTAs, MedicalClinic structured data, browser errors, and horizontal overflow.

## Content management

1. Open [Pages CMS](https://pagescms.org/).
2. Sign in with GitHub and select `aph3xx/likar-poruch`.
3. Edit **Налаштування медичного центру**, **Налаштування російської версії**, **Медичні послуги**, or **Статті**.
4. Save. Pages CMS commits the JSON content change to GitHub.
5. GitHub Actions validates and deploys the new version.

Site-wide details are stored in `src/data/site.json`, Russian-language settings in `src/data/site-ru.json`, shared bilingual services in `src/data/services.json`, and journal content in `src/data/articles.json`. The CMS schema is defined in `.pages.yml`.

## AI development workflow

OpenSpec is initialized under `openspec/`, and its Hermes skills are stored in `.hermes/skills/`. Use the matching OpenSpec skill for non-trivial product changes:

1. `openspec-propose` creates a change proposal, design, specs, and tasks.
2. `openspec-apply-change` implements approved tasks.
3. `openspec-update-change` revises planning artifacts when scope changes.
4. `openspec-archive-change` archives a verified implementation.

Useful checks:

```bash
openspec list --json
openspec validate --all --strict
```

The local Hermes profile also has project-scoped automation hooks. They inject concise Git, OpenSpec, and Kanban state into AI turns and run the project quality gate before an AI session finishes after code changes. Both hooks no-op outside this repository. Inspect them with `hermes hooks list` and `hermes hooks doctor`.

## Site structure

- homepage focused on the medical practice and appointment conversion
- accessible Ukrainian appointment form with a privacy-preserving SMS handoff
- services for family medicine, endocrinology, and on-site rapid diagnostics
- Russian landing, services, contacts, and booking routes for Ukrainian search visibility
- about, contacts, privacy, and educational articles
- clinic phone number and address available throughout the site
- privacy-safe PostHog funnel tracking, activated only when `PUBLIC_POSTHOG_KEY` is configured

## SEO and accessibility

- per-route titles, descriptions, canonical and social metadata
- reciprocal Ukrainian and Russian hreflang declarations for localized routes
- Ukraine and Kyiv-focused service language without keyword stuffing
- MedicalClinic, WebSite, FAQ, MedicalWebPage, Article, and breadcrumb JSON-LD
- XML sitemap, RSS, robots.txt, manifest, and security.txt
- semantic headings, keyboard navigation, visible focus states, and responsive static HTML

## Medical notice

Information on the site is educational and does not replace a consultation. For a life-threatening emergency in Ukraine, call 103 or 112.
