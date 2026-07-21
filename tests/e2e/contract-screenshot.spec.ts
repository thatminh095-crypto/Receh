import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const CONTRACT_TX = 'd83626adf97e4227e5c45e48733bca17a1f2872da6a78261b07e4cdc962277f1';
const CONTRACT_ID = 'CDNZX5D3WXVXMCBFZYCEB5SSRM5VHB2UZ55PKH55KSSOIJKCAACK6KUW';
const SHOTS = path.resolve(__dirname, '../../../screen-shot');
mkdirSync(SHOTS, { recursive: true });

test('capture contract tx on stellar.expert', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto(`https://stellar.expert/explorer/testnet/tx/${CONTRACT_TX}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);
  await page.screenshot({
    path: path.join(SHOTS, '11-contract-tx.jpg'),
    type: 'jpeg',
    quality: 85,
  });

  await page.goto(`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);
  await page.screenshot({
    path: path.join(SHOTS, '12-contract-explorer.jpg'),
    type: 'jpeg',
    quality: 85,
  });

  await browser.close();
  expect(true).toBe(true);
});