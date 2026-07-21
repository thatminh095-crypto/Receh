import { expect, test } from '@playwright/test';

test('landing renders hero, thermometer and CTAs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('pool-total')).toBeVisible();
  await expect(page.getByTestId('thermometer-fill')).toBeAttached();
  await expect(page.getByTestId('yield-ticker')).toBeVisible();
  await expect(page.getByTestId('cta-roundup')).toBeVisible();
  await expect(page.getByTestId('cta-vote')).toBeVisible();
});

test('round-up widget previews spare change and lists proposals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('input-purchase')).toBeVisible();
  await page.getByTestId('input-purchase').fill('7.35');
  await expect(page.getByTestId('contribution-preview')).toContainText('0.65');
  const cards = page.getByTestId('proposal-card');
  expect(await cards.count()).toBeGreaterThan(0);
});

test('wow moment: rounding up grows the pool total', async ({ page }) => {
  await page.goto('/');
  const startText = await page.getByTestId('pool-total').innerText();
  const start = Number.parseFloat(startText.replace(/[^0-9.]/g, ''));

  await page.getByTestId('input-purchase').fill('3.40');
  await page.getByTestId('roundup-btn').click();

  await expect
    .poll(
      async () =>
        Number.parseFloat(
          (await page.getByTestId('pool-total').innerText()).replace(/[^0-9.]/g, ''),
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(start);
});

test('wow moment: closing the window disburses a grant on-chain', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('close-window-btn').click();
  await expect(page.getByTestId('disburse-banner')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('disburse-banner')).toContainText('tx:');
  const disbursed = page.getByTestId('proposal-status').filter({ hasText: 'disbursed' });
  expect(await disbursed.count()).toBeGreaterThan(0);
});

test('empty state renders when no data', async ({ page }) => {
  await page.goto('/?empty=1');
  await expect(page.getByTestId('empty-state')).toBeVisible();
});
