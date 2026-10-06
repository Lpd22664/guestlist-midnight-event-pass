import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'] });
await mkdir('evidence/screenshots',{recursive:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});await page.screenshot({path:'evidence/screenshots/desktop-overview.png',fullPage:true});
console.log(await page.title());console.log((await page.locator('body').innerText()).slice(0,1000));
await page.goto('http://127.0.0.1:4173/#wallet',{waitUntil:'networkidle'});await page.locator('.real-qr').waitFor();await page.screenshot({path:'evidence/screenshots/desktop-pass.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'evidence/screenshots/mobile-pass.png',fullPage:true});
await page.goto('http://127.0.0.1:4173/#overview',{waitUntil:'networkidle'});await page.screenshot({path:'evidence/screenshots/mobile-overview.png',fullPage:true});
console.log('Screenshots saved.');
}finally{await browser.close()}
