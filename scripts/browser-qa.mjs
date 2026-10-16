import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base=process.env.QA_BASE_URL||'http://127.0.0.1:4321/likar-poruch';
await fs.mkdir('artifacts/qa',{recursive:true});
const browser=await chromium.launch({headless:true});
const viewports=[{name:'mobile-360',width:360,height:800},{name:'tablet-768',width:768,height:900},{name:'desktop-1440',width:1440,height:900}];
try{
 for(const viewport of viewports){
  const page=await browser.newPage({viewport});const errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/`,{waitUntil:'networkidle'});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth))throw new Error(`${viewport.name}: horizontal overflow`);
  if(errors.length)throw new Error(`${viewport.name}: ${errors.join('; ')}`);
  if(!(await page.getByRole('heading',{name:/Здоров’я ближче/}).isVisible()))throw new Error(`${viewport.name}: clinic hero missing`);
  if((await page.locator('a[href^="tel:"]').count())<2)throw new Error(`${viewport.name}: phone links missing`);
  const text=await page.locator('body').innerText();
  for(const banned of ['каталог лікарів','демонстраційні профілі','платного ранжування'])if(text.toLowerCase().includes(banned))throw new Error(`${viewport.name}: stale aggregator copy: ${banned}`);
  await page.screenshot({path:`artifacts/qa/${viewport.name}.png`,fullPage:true});
  if(viewport.width===360){const menu=page.locator('.menu-toggle');if(!(await menu.isVisible()))throw new Error('mobile menu missing');await menu.click();if(!(await page.locator('#site-nav').isVisible()))throw new Error('mobile nav failed');}
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 for(const route of ['/posluhy/','/pro-nas/','/kontakty/','/zhurnal/']){const response=await page.goto(`${base}${route}`,{waitUntil:'networkidle'});if(!response?.ok())throw new Error(`${route}: ${response?.status()}`);if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth))throw new Error(`${route}: horizontal overflow`);}
 await page.goto(`${base}/`,{waitUntil:'networkidle'});
 const schemas=await page.locator('script[type="application/ld+json"]').evaluateAll(nodes=>nodes.flatMap(n=>{const x=JSON.parse(n.textContent||'{}');return Array.isArray(x)?x:[x]}));
 if(!schemas.some(x=>x['@type']==='MedicalClinic'))throw new Error('MedicalClinic JSON-LD missing');
 if(schemas.some(x=>['ItemList','ProfilePage'].includes(x['@type'])))throw new Error('stale aggregator schema found');
 await page.close();
 console.log('Clinic browser QA passed at 360px, 768px, 1280px, and 1440px: navigation, phone CTAs, clinic copy, MedicalClinic schema, console, and overflow checks pass.');
}finally{await browser.close();}
