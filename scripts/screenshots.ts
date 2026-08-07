/**
 * Capture demo screenshots for Receh. Requires the dev server running on PORT (default 3001)
 * with seeded data. Outputs JPEGs to ../screen-shot.
 */
import { chromium, devices } from '@playwright/test';

const PORT = process.env.PORT ?? '3001';
const BASE = `http://localhost:${PORT}`;
const OUT = '../screen-shot';

async function main() {
  const browser = await chromium.launch();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();

  // 01 landing (hero + thermometer)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="pool-total"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-landing.jpg`, type: 'jpeg', quality: 85 });

  // 02 main (full page: widget, feed, vault, proposals)
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${OUT}/02-main.jpg`,
    type: 'jpeg',
    quality: 85,
    fullPage: true,
  });

  // 03 action: round-up widget with a contribution previewed
  await page.getByTestId('input-purchase').fill('7.35');
  await page.waitForTimeout(300);
  await page.getByTestId('roundup-btn').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-action.jpg`, type: 'jpeg', quality: 85 });

  // 04 detail: route the round-up -> vault grows + feed updates
  await page.getByTestId('roundup-btn').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('live-feed').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${OUT}/04-detail.jpg`,
    type: 'jpeg',
    quality: 85,
    fullPage: true,
  });

  // 05 success / WOW: close the voting window -> contract disburses grant from the vault.
  await page.getByTestId('close-window-btn').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.getByTestId('close-window-btn').click();
  await page.waitForTimeout(2000);
  await page
    .getByTestId('disburse-banner')
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${OUT}/05-success.jpg`,
    type: 'jpeg',
    quality: 85,
    fullPage: true,
  });
  await ctx.close();

  // 06 mobile 375px
  const mctx = await browser.newContext({
    ...devices['iPhone 12'],
    viewport: { width: 375, height: 812 },
  });
  const mpage = await mctx.newPage();
  await mpage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await mpage.waitForSelector('[data-testid="pool-total"]');
  await mpage.waitForTimeout(700);
  await mpage.screenshot({
    path: `${OUT}/06-mobile.jpg`,
    type: 'jpeg',
    quality: 85,
    fullPage: true,
  });
  await mctx.close();

  // 07 empty state
  const ectx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const epage = await ectx.newPage();
  await epage.goto(`${BASE}/?empty=1`, { waitUntil: 'domcontentloaded' });
  await epage.waitForSelector('[data-testid="empty-state"]', { timeout: 10000 });
  await epage.waitForTimeout(500);
  await epage.screenshot({ path: `${OUT}/07-empty-state.jpg`, type: 'jpeg', quality: 85 });
  await ectx.close();

  await browser.close();
  console.log('[screenshots] done');
}

main().catch((e) => {
  console.error('[screenshots] failed:', e);
  process.exit(1);
});
