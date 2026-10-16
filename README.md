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

`npm test` builds the static site and verifies metadata, one H1 per page, Ukrainian language metadata, canonical URLs, hreflang, sitemap, robots, and internal links. Browser QA checks 360, 768, 1280, and 1440 pixel layouts, mobile navigation, appointment-form validation, phone CTAs, MedicalClinic structured data, browser errors, and horizontal overflow.

## Content management

1. Open [Pages CMS](https://pagescms.org/).
2. Sign in with GitHub and select `aph3xx/likar-poruch`.
3. Edit **Налаштування медичного центру**, **Медичні послуги**, or **Статті**.
4. Save. Pages CMS commits the JSON content change to GitHub.
5. GitHub stores the authoritative commit. Production is deployed separately to the private SUR host.

Site-wide details are stored in `src/data/site.json`, services in `src/data/services.json`, and journal content in `src/data/articles.json`. The CMS schema is defined in `.pages.yml`.

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

### Task pull requests and mandatory integration lane

Pushing a branch named `task/**` starts CI and the `Open task pull request` workflow. The workflow creates or reuses a pull request into `main`, but never queues or performs a merge. A merger card may integrate the exact task commit only after an explicit independent reviewer PASS bound to that commit and tree; the merger card must name that review as its parent. The source branch is deleted only as part of that deliberate merger integration.

Required repository settings:

- Actions workflow permissions allow the workflow to create pull requests but do not grant it repository contents write access or merge authority.
- Pull-request auto-merge is not used for task branches. Squash merging and head-branch deletion remain available to the merger when the mandatory lane has passed.
- `main` requires a pull request, requires the `build` status check with strict branch updates, enforces protection for administrators, and rejects force pushes and branch deletion.

Automation does not bypass conflicts, failing checks, branch protection, or the reviewer-to-merger lane. Non-task branches and pull requests from forks are not opened by this workflow. Task-branch CI does not deploy or publish; production and release publication remain separate verified operations owned by the merger from clean `main`.

## Production deployment

Production is the Tailscale-only URL `https://sur.kyiv.ua/likar-poruch/`, served from `/home/sgdt1a/.local/share/likar-poruch-site`. GitHub Pages is not the production target and is not published automatically by this repository.

Release only a clean `main` commit that already exists at `origin/main`:

```bash
npm run deploy:sur
```

The deployment command builds with `PUBLIC_SITE_URL=https://sur.kyiv.ua`, runs the release gates, atomically replaces the allowlisted static artifact, records the commit in `release.json`, and verifies the artifact through the real SUR gateway. Read `AGENTS.md` before making or releasing changes.

## Site structure

- homepage focused on the medical practice and appointment conversion
- accessible Ukrainian appointment form with a privacy-preserving local draft and phone handoff
- services for family medicine, endocrinology, and on-site rapid diagnostics
- Ukrainian landing, services, contacts, and booking routes for search visibility in Ukraine
- about, contacts, privacy, and educational articles
- clinic phone number and address available throughout the site
- privacy-safe PostHog funnel tracking, activated only when `PUBLIC_POSTHOG_KEY` is configured

## SEO and accessibility

- per-route titles, descriptions, canonical and social metadata
- Ukrainian and x-default hreflang declarations with self-referencing canonicals
- Ukraine and Kyiv-focused service language without keyword stuffing
- MedicalClinic, WebSite, FAQ, MedicalWebPage, Article, and breadcrumb JSON-LD
- XML sitemap, RSS, robots.txt, manifest, and security.txt
- semantic headings, keyboard navigation, visible focus states, and responsive static HTML

## Medical notice

Information on the site is educational and does not replace a consultation. For a life-threatening emergency in Ukraine, call 103 or 112.
