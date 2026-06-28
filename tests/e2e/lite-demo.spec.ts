import { chromium, test } from '@playwright/test';

test('lite-demo', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: '/tmp/demo-recordings', size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  await page.goto(process.env.PLAYWRIGHT_BASE_URL!);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screen-shot/lite-landing.jpg', type: 'jpeg', quality: 85 });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL + '/stats').catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screen-shot/lite-stats.jpg', type: 'jpeg', quality: 85 });
  await page.close();
  await ctx.close();
  await browser.close();
});