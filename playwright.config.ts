import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',webServer:{command:'npm run dev -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},use:{viewport:{width:1440,height:1000},launchOptions:{executablePath:process.env.OPSD_BROWSER_EXECUTABLE}},timeout:30000});
