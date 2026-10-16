# Лікар Поруч

A Ukrainian-first, SEO-ready doctor discovery prototype built with Astro and managed through Pages CMS.

## Local development

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run check
npm test
```

`npm test` builds the site and verifies every generated HTML page has one H1, Ukrainian language metadata, a title, description, canonical URL, and working internal links. With a preview server running on port 4321, `npm run qa:browser` checks the 360, 768, 1280, and 1440 pixel layouts, mobile navigation, filtering, the demo booking form, structured data, browser errors, and horizontal overflow.

## Content management

1. Open [Pages CMS](https://pagescms.org/).
2. Sign in with GitHub and select `aph3xx/likar-poruch`.
3. Edit **Налаштування сайту**, **Лікарі**, or **Статті**.
4. Save. Pages CMS commits the JSON content change to GitHub.
5. GitHub Actions validates and deploys the new version.

The CMS schema lives in `.pages.yml`. Site-wide text is in `src/data/site.json`, doctor content is in `src/data/doctors.json`, and journal content is in `src/data/articles.json`. Astro content collections in `src/content.config.ts` validate doctor and article records during every check and build.

## SEO implementation

- per-route titles, descriptions, canonicals, Open Graph, and Twitter metadata
- `uk` language and hreflang
- organization, website, physician/profile, medical page, article, item list, FAQ, and breadcrumb JSON-LD
- XML sitemap and RSS feed
- crawlable specialty, city, doctor, and article routes
- robots.txt, manifest, security.txt, semantic headings, and internal linking
- static HTML, one small local script per interactive surface, and an optimized local WebP hero

## Important

This is a demonstration. Doctor names, experience, availability, and appointment forms are fictional and must not be presented as real medical listings without verification.
