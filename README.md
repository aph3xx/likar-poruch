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

`npm test` builds the static site and verifies metadata, one H1 per page, Ukrainian language metadata, canonical URLs, and internal links. Browser QA checks 360, 768, 1280, and 1440 pixel layouts, mobile navigation, phone CTAs, MedicalClinic structured data, browser errors, stale directory language, and horizontal overflow.

## Content management

1. Open [Pages CMS](https://pagescms.org/).
2. Sign in with GitHub and select `aph3xx/likar-poruch`.
3. Edit **Налаштування медичного центру** or **Статті**.
4. Save. Pages CMS commits the JSON content change to GitHub.
5. GitHub Actions validates and deploys the new version.

Site-wide details are stored in `src/data/site.json`; journal content is in `src/data/articles.json`. The CMS schema is defined in `.pages.yml`.

## Site structure

- homepage focused on the medical practice and phone booking
- services for family medicine, endocrinology, and on-site rapid diagnostics
- about, contacts, privacy, and educational articles
- clinic phone number and address available throughout the site

## SEO and accessibility

- per-route titles, descriptions, canonical and social metadata
- Ukrainian language and hreflang declarations
- MedicalClinic, WebSite, FAQ, MedicalWebPage, Article, and breadcrumb JSON-LD
- XML sitemap, RSS, robots.txt, manifest, and security.txt
- semantic headings, keyboard navigation, visible focus states, and responsive static HTML

## Medical notice

Information on the site is educational and does not replace a consultation. For a life-threatening emergency in Ukraine, call 103 or 112.
