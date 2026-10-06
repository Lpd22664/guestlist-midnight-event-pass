import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', timeout:30000, fullyParallel:false, workers:1,
  reporter:[['list'],['json',{outputFile:'evidence/e2e-results.json'}]],
  use:{baseURL:process.env.GUESTLIST_TEST_URL??'http://127.0.0.1:4173',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1050}}},{name:'phone',use:{viewport:{width:390,height:844}}}],
  webServer:process.env.GUESTLIST_TEST_URL?undefined:{command:'npm run dev',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
});
