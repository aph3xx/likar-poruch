import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const siteOrigin = (process.env.PUBLIC_SITE_URL || 'https://aph3xx.github.io').replace(/\/$/, '');
const files = [];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.name.endsWith('.html'))files.push(full);}}
walk(root);
const errors=[];
const existing=new Set();
function routeFor(file){let rel=path.relative(root,file).split(path.sep).join('/');if(rel==='index.html')return '/likar-poruch/';if(rel.endsWith('/index.html'))return '/likar-poruch/'+rel.slice(0,-10)+'/';return '/likar-poruch/'+rel;}
for(const file of files)existing.add(routeFor(file).replace(/\/+/g,'/'));
for(const file of files){const html=fs.readFileSync(file,'utf8');const rel=path.relative(root,file);const expectedLang=rel.startsWith(`ru${path.sep}`)?'ru':'uk';const checks=[
  [(html.match(/<h1(?:\s|>)/gi)||[]).length===1,'exactly one H1'],
  [new RegExp(`<html[^>]+lang="${expectedLang}"`,'i').test(html),`html lang=${expectedLang}`],
  [/<title>[^<]{10,}<\/title>/i.test(html),'non-empty title'],
  [/<meta[^>]+name="description"[^>]+content="[^"]{40,}"/i.test(html),'meta description'],
  [html.includes(`rel="canonical" href="${siteOrigin}/likar-poruch/`),'canonical']
];for(const [ok,label] of checks)if(!ok)errors.push(`${rel}: missing ${label}`);
  for(const match of html.matchAll(/href="(\/likar-poruch\/[^"]*)"/g)){let href=match[1].split(/[?#]/)[0];if(/\.(svg|webp|xml|webmanifest|txt|css|js)$/i.test(href))continue;if(!href.endsWith('/'))href+='/';if(!existing.has(href))errors.push(`${rel}: broken internal link ${match[1]}`);}
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`Validated ${files.length} HTML pages: metadata, one H1, canonicals, language, and internal links pass.`);
