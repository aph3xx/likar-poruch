import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base=process.env.QA_BASE_URL||'http://127.0.0.1:4321/likar-poruch';
const resolverRules=process.env.QA_HOST_RESOLVER_RULES;
await fs.mkdir('artifacts/qa',{recursive:true});
const browser=await chromium.launch({headless:true,args:resolverRules?[`--host-resolver-rules=${resolverRules}`]:[]});
const viewports=[{name:'mobile-360',width:360,height:800},{name:'tablet-768',width:768,height:900},{name:'desktop-1440',width:1440,height:900}];
const targetWidths=[320,360,390,640,768,1024,1280,1440];
const standaloneTargetSelector=['a[href^="tel:"]','a[href^="sms:"]','a.text-link','.breadcrumbs a'].join(',');
const findUndersizedTargets=(page)=>page.locator(standaloneTargetSelector).evaluateAll(elements=>elements
 .map(element=>({text:(element.textContent||'').trim().replace(/\s+/g,' '),height:element.getBoundingClientRect().height}))
 .filter(({height})=>height>0&&height<44));
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
  if(await page.getAttribute('html','lang')!=='uk')throw new Error(`${viewport.name}: Ukrainian page language missing`);
  if(await page.locator('link[rel="alternate"][hreflang="ru"]').count())throw new Error(`${viewport.name}: retired Russian hreflang present`);
  await page.screenshot({path:`artifacts/qa/${viewport.name}.png`,fullPage:true});
  if(viewport.width===360){const menu=page.locator('.menu-toggle');if(!(await menu.isVisible()))throw new Error('mobile menu missing');await menu.click();if(!(await page.locator('#site-nav').isVisible()))throw new Error('mobile nav failed');}
  await page.close();
 }
 const consentPage=await browser.newPage({viewport:{width:1280,height:800}});
 const consentRequests=[];
 consentPage.on('request',request=>consentRequests.push({url:request.url(),body:request.postData()||''}));
 await consentPage.goto(`${base}/`,{waitUntil:'networkidle'});
 await consentPage.evaluate(() => localStorage.removeItem('likar-consent-v1'));
 consentRequests.length=0;
 await consentPage.reload({waitUntil:'networkidle'});
 const sdkRequestsBefore=consentRequests.filter(({url})=>/\/_astro\/module\.[^/]+\.js|posthog\.com/i.test(url));
 if(sdkRequestsBefore.length)throw new Error(`consent: PostHog SDK/network loaded before consent: ${sdkRequestsBefore.map(({url})=>url).join(', ')}`);
 const expectAnalytics=process.env.QA_EXPECT_ANALYTICS==='1';
 await consentPage.getByRole('button',{name:'Відхилити необов’язкові'}).first().click();
 await consentPage.reload({waitUntil:'networkidle'});
 if(await consentPage.locator('[data-consent-banner]').isVisible())throw new Error('consent: reject choice did not persist');
 await consentPage.evaluate(() => localStorage.setItem('likar-consent-v1', JSON.stringify({version:'2026-10-16',timestamp:Date.now()+60_000,purposes:{analytics:true},action:'accept_all'})));
 await consentPage.reload({waitUntil:'networkidle'});
 if(!(await consentPage.locator('[data-consent-banner]').isVisible()))throw new Error('consent: future-dated state was accepted');
 await consentPage.evaluate(() => localStorage.setItem('likar-consent-v1', JSON.stringify({version:'2026-10-16',timestamp:Date.now(),purposes:{analytics:true},action:'forged'})));
 await consentPage.reload({waitUntil:'networkidle'});
 if(!(await consentPage.locator('[data-consent-banner]').isVisible()))throw new Error('consent: malformed action was accepted');
 await consentPage.getByRole('button',{name:'Дозволити аналітику'}).click();
 if(expectAnalytics){
  await consentPage.waitForTimeout(1500);
  await consentPage.evaluate(()=>window.dispatchEvent(new CustomEvent('likar:booking_started',{detail:{name:'SENTINEL_NAME',phone:'SENTINEL_PHONE',medical:'SENTINEL_MEDICAL'}})));
  await consentPage.waitForTimeout(500);
  const sdkRequestsAfter=consentRequests.filter(({url})=>/\/_astro\/module\.[^/]+\.js/i.test(url));
  const hostRequestsAfter=consentRequests.filter(({url})=>/posthog\.com/i.test(url));
  if(!sdkRequestsAfter.length)throw new Error('consent: PostHog SDK asset did not load after affirmative consent');
  if(!hostRequestsAfter.length)throw new Error('consent: PostHog network request did not occur after affirmative consent');
  if(consentRequests.some(({body})=>/SENTINEL_NAME|SENTINEL_PHONE|SENTINEL_MEDICAL/.test(body)))throw new Error('consent: sentinel form value leaked into analytics payload');
  const requestsBeforeWithdrawal=consentRequests.length;
  await consentPage.getByRole('button',{name:'Налаштування приватності'}).click();
  await consentPage.locator('[data-consent-analytics]').uncheck();
  await consentPage.getByRole('button',{name:'Зберегти вибір'}).click();
  await consentPage.evaluate(()=>window.dispatchEvent(new CustomEvent('likar:booking_started')));
  await consentPage.waitForTimeout(500);
  if(consentRequests.slice(requestsBeforeWithdrawal).some(({url})=>/posthog\.com/i.test(url)))throw new Error('consent: withdrawal generated a PostHog request');
}
 await consentPage.close();
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const retainedRoutes=['/','/posluhy/','/pro-nas/','/kontakty/','/zapys/','/yak-tse-pratsiuie/','/privacy/','/zhurnal/','/zhurnal/yak-obraty-simeinoho-likaria/','/zhurnal/yak-pidhotuvatysia-do-konsultatsii/','/zhurnal/koly-vyklykaty-103/','/zhurnal/dokazova-medytsyna-prostymy-slovamy/'];
 for(const width of targetWidths){
  await page.setViewportSize({width,height:width<640?800:900});
  for(const route of retainedRoutes){
   const response=await page.goto(`${base}${route}`,{waitUntil:'networkidle'});
   if(!response?.ok())throw new Error(`${width}px ${route}: ${response?.status()}`);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth))throw new Error(`${width}px ${route}: horizontal overflow`);
   const undersizedTargets=await findUndersizedTargets(page);
   if(undersizedTargets.length)throw new Error(`${width}px ${route}: standalone targets below 44px: ${undersizedTargets.map(({text,height})=>`${text} (${height}px)`).join(', ')}`);
  }
 }
 await page.goto(`${base}/zapys/`,{waitUntil:'networkidle'});
 const booking=page.locator('[data-appointment-form]');
 if(!(await booking.isVisible()))throw new Error('booking form missing');
 const fields=booking.locator('[data-validate]');
 if(await fields.count()!==3)throw new Error('booking form should have exactly three fields');
 const names=await fields.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('name')));
 if(JSON.stringify(names)!=='["name","phone","datetime"]')throw new Error(`unexpected booking fields: ${names.join(',')}`);
 await booking.locator('button[type="submit"]').click();
 if(!(await page.locator('[data-error-summary]').isVisible()))throw new Error('booking validation summary missing');
 await booking.locator('[name="name"]').fill('Тест Пацієнт');
 await booking.locator('[name="phone"]').fill('+380671234567');
 await booking.locator('[name="datetime"]').fill('2099-01-01T10:30');
 const navigations=[]; page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(frame.url())});
 const requests=[]; page.on('request',request=>requests.push(request.url()));
 await booking.locator('button[type="submit"]').click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('likar:appointment_request')||'null'));
 if(JSON.stringify(saved)!=='{"name":"Тест Пацієнт","phone":"+380671234567","datetime":"2099-01-01T10:30"}')throw new Error('booking draft values were not stored exactly');
 if(!/чернетку збережено/i.test(await page.locator('[data-submit-status]').innerText()))throw new Error('booking success status missing');
 if(requests.some(url=>!url.includes('_astro')&&!url.includes('127.0.0.1')))throw new Error('booking submit made a network request');
 if(navigations.length)throw new Error('booking submit navigated');
 const denied=await page.evaluate(()=>{localStorage.removeItem('likar:appointment_request');Storage.prototype.setItem=function(){throw new DOMException('blocked','SecurityError')};return true});
 if(!denied)throw new Error('storage denial setup failed');
 await booking.locator('button[type="submit"]').click();
 if(!/не вдалося зберегти/i.test(await page.locator('[data-submit-status]').innerText()))throw new Error('storage-denied error status missing');
 if(await page.evaluate(()=>Boolean(localStorage.getItem('likar:appointment_request'))))throw new Error('storage-denied path wrote a draft');
 await page.goto(`${base}/`,{waitUntil:'networkidle'});
 if(await page.locator('link[rel="alternate"][hreflang="ru"]').count())throw new Error('retired Russian hreflang present');
 const schemas=await page.locator('script[type="application/ld+json"]').evaluateAll(nodes=>nodes.flatMap(n=>{const x=JSON.parse(n.textContent||'{}');return Array.isArray(x)?x:[x]}));
 if(!schemas.some(x=>x['@type']==='MedicalClinic'))throw new Error('MedicalClinic JSON-LD missing');
 if(schemas.some(x=>['ItemList','ProfilePage'].includes(x['@type'])))throw new Error('stale aggregator schema found');
 await page.close();
 console.log('Clinic browser QA passed at 360px, 768px, 1280px, and 1440px: Ukrainian routes, language metadata, booking validation, navigation, phone CTAs, MedicalClinic schema, console, and overflow checks pass.');
}finally{await browser.close();}
