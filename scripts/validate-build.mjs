import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.VALIDATE_BUILD_ROOT || 'dist');
const basePath = '/likar-poruch';
const siteOrigin = (process.env.PUBLIC_SITE_URL || 'https://sur.kyiv.ua').replace(/\/$/, '');
const approvedSocialImagePaths = new Set([
  `${basePath}/brand/logo-horizontal.svg`,
]);
const errors = [];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) files.push(full);
  }
}

function routeFor(file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (rel === 'index.html') return `${basePath}/`;
  if (rel === '404.html') return `${basePath}/404/`;
  if (rel.endsWith('/index.html')) return `${basePath}/${rel.slice(0, -10)}/`.replace(/\/{2,}/g, '/');
  return `${basePath}/${rel}`.replace(/\/{2,}/g, '/');
}

function attr(html, name, value) {
  const match = html.match(new RegExp(`<meta[^>]+${name}="${value}"[^>]+content="([^"]*)"`, 'i'));
  return match?.[1] || '';
}

walk(root);
const existing = new Set(files.map(routeFor));
const titles = new Map();
const descriptions = new Map();

function metaContent(html, attribute, value) {
  return html.match(new RegExp(`<meta[^>]+${attribute}="${value}"[^>]+content="([^"]*)"`, 'i'))?.[1] || '';
}

function validateHomepageSocialImage() {
  const homepage = files.find((file) => routeFor(file) === `${basePath}/`);
  if (!homepage) {
    errors.push('homepage: generated page is missing');
    return;
  }
  const html = fs.readFileSync(homepage, 'utf8');
  const image = metaContent(html, 'property', 'og:image');
  let imageUrl;
  try { imageUrl = new URL(image); } catch { /* reported below */ }
  let configuredOrigin;
  try { configuredOrigin = new URL(siteOrigin).origin; } catch { /* reported below */ }
  if (!imageUrl || imageUrl.origin !== configuredOrigin || !approvedSocialImagePaths.has(imageUrl.pathname)) {
    errors.push(`homepage: og:image must use an approved brand asset (received ${image || 'missing'})`);
    return;
  }
  const pathname = imageUrl.pathname;
  const asset = path.join(root, pathname.slice(`${basePath}/`.length));
  if (!fs.existsSync(asset)) errors.push(`homepage: approved og:image asset is missing ${pathname}`);
}

validateHomepageSocialImage();

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).split(path.sep).join('/');
  const route = routeFor(file);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '';
  const description = attr(html, 'name', 'description');
  const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] || '';
  const robots = attr(html, 'name', 'robots');
  const canonicalCount = (html.match(/rel="canonical"/gi) || []).length;
  const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
  const pageErrors = [
    [h1Count === 1, 'exactly one H1'],
    [/<html[^>]+lang="uk"/i.test(html), 'html lang=uk'],
    [title.length >= 10, 'non-empty title'],
    [description.length >= 40, 'meta description'],
    [canonical === `${siteOrigin}${route}`, 'canonical matches route and origin'],
    [canonicalCount === 1, 'exactly one canonical'],
    [html.includes(`hreflang="uk"`) && html.includes(`hreflang="x-default"`), 'Ukrainian hreflang'],
    [!/<link[^>]+hreflang="(?!uk|x-default)[^"]+"/i.test(html), 'only Ukrainian hreflang'],
    [robots.includes('noindex') ? route === `${basePath}/privacy/` || route === `${basePath}/404/` : true, 'noindex only on intentional pages'],
    [route !== `${basePath}/privacy/` || (robots.includes('noindex') && robots.includes('nofollow')), 'privacy route must remain noindex, nofollow']
  ];
  for (const [ok, label] of pageErrors) if (!ok) errors.push(`${rel}: ${label}`);
  if (title) titles.set(title, [...(titles.get(title) || []), route]);
  if (description) descriptions.set(description, [...(descriptions.get(description) || []), route]);

  for (const match of html.matchAll(/href="([^\"]*)"/g)) {
    const originalHref = match[1];
    const hrefWithoutQuery = originalHref.split(/[?#]/)[0];
    let href = hrefWithoutQuery;
    if (!href.startsWith('/') && !/^https?:\/\//i.test(href) && !href.startsWith('//')) continue;
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
      let absolute;
      try { absolute = new URL(href, siteOrigin); } catch { continue; }
      if (absolute.origin !== new URL(siteOrigin).origin) continue;
      href = absolute.pathname;
    }
    if (href.startsWith('/') && href !== basePath && !href.startsWith(`${basePath}/`)) {
      errors.push(`${rel}: internal link escapes configured base ${originalHref}`);
      continue;
    }
    if (/\.(svg|webp|png|jpg|xml|json|webmanifest|txt|css|js|ico)$/i.test(href)) continue;
    if (href === '/') href = `${basePath}/`;
    else if (!href.startsWith(`${basePath}/`)) href = `${basePath}${href}`;
    if (!href.endsWith('/')) href += '/';
    if (!existing.has(href)) errors.push(`${rel}: broken internal link ${originalHref}`);
  }

  for (const script of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(script[1]); } catch { errors.push(`${rel}: malformed JSON-LD`); }
  }
}

for (const [title, routes] of titles) if (routes.length > 1) errors.push(`duplicate title on ${routes.join(', ')}: ${title}`);
for (const [, routes] of descriptions) if (routes.length > 1) errors.push(`duplicate description on ${routes.join(', ')}`);

const sitemapPath = fs.existsSync(path.join(root, 'sitemap-0.xml')) ? 'sitemap-0.xml' : 'sitemap-index.xml';
const sitemap = fs.readFileSync(path.join(root, sitemapPath), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!sitemapUrls.length) errors.push(`${sitemapPath}: contains no URLs`);
for (const url of sitemapUrls) {
  if (!url.startsWith(siteOrigin + basePath) || !url.endsWith('/')) errors.push(`${sitemapPath}: invalid canonical URL ${url}`);
  const route = url.startsWith(siteOrigin) ? url.slice(siteOrigin.length) : '';
  if (route.includes('/ru/') || route === `${basePath}/privacy/` || route === `${basePath}/404/`) errors.push(`${sitemapPath}: contains non-indexable URL ${url}`);
  if (!existing.has(route)) errors.push(`${sitemapPath}: URL has no generated page ${url}`);
  else {
    const page = files.find((file) => routeFor(file) === route);
    const html = fs.readFileSync(page, 'utf8');
    if (/name="robots"[^>]+content="[^"]*noindex/i.test(html)) errors.push(`${sitemapPath}: URL has noindex page ${url}`);
  }
}

const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${siteOrigin}${basePath}/sitemap-index.xml`)) errors.push('robots.txt: sitemap URL does not match configured origin/base');
if (robots.includes('/ru/')) errors.push('robots.txt: contains retired Russian URL');

const rssPath = path.join(root, 'rss.xml');
if (!fs.existsSync(rssPath)) errors.push('rss.xml: generated feed is missing');
else {
  const rss = fs.readFileSync(rssPath, 'utf8');
  const expectedFeedBase = `${siteOrigin}${basePath}/`;
  const channelLink = rss.match(/<channel>[\s\S]*?<link>([^<]+)<\/link>/)?.[1] || '';
  if (channelLink !== expectedFeedBase) errors.push('rss.xml: channel link must match configured origin/base');
  const items = [...rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<guid[^>]*>([^<]+)<\/guid>[\s\S]*?<\/item>/g)];
  if (!items.length) errors.push('rss.xml: contains no items');
  for (const [, link, guid] of items) {
    if (!link.startsWith(expectedFeedBase) || !guid.startsWith(expectedFeedBase)) errors.push('rss.xml: item URLs must remain under configured origin/base');
    if (link !== guid) errors.push('rss.xml: item link and GUID must match');
  }
}

if (!fs.existsSync(path.join(root, 'manifest.json'))) errors.push('manifest.json: generated manifest is missing');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Validated ${files.length} HTML pages: unique Ukrainian metadata, JSON-LD, canonical-only sitemap, robots, and internal links pass.`);