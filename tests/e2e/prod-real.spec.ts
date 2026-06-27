import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import {
  approveOnce,
  cleanup,
  getExtensionId,
  launchWithFreighter,
  onboardFreighter,
} from '../../../../../../monthly/shared/freighter/freighter-fixture';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://receh-gamma.vercel.app';
const DEPLOYER_HEAD = 'GBL5';
const DEPLOYER_TAIL = 'IE47';

const SHOTS = path.resolve(__dirname, '../../../screen-shot');
mkdirSync(SHOTS, { recursive: true });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS, name), type: 'jpeg', quality: 85 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const captured = new Set<string>();

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let userDataDir: string;

async function isOnboarded(): Promise<boolean> {
  const id = getExtensionId(context);
  const probe = await context.newPage();
  try {
    await probe.goto(`chrome-extension://${id}/index.html#/`, { waitUntil: 'domcontentloaded' });
    await probe.waitForTimeout(2500);
    const welcome = await probe
      .getByRole('button', { name: /I already have a wallet/i })
      .isVisible()
      .catch(() => false);
    const netSelector = await probe
      .locator('[data-testid=network-selector-open]')
      .isVisible()
      .catch(() => false);
    return !welcome && netSelector;
  } finally {
    await probe.close().catch(() => {});
  }
}

async function closeStrayExtensionPages(): Promise<void> {
  const id = getExtensionId(context);
  const prefix = `chrome-extension://${id}`;
  for (const p of context.pages()) {
    if (!p.isClosed() && p.url().startsWith(prefix)) await p.close().catch(() => {});
  }
}

async function ensureOnboarded(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await onboardFreighter(context);
    if (await isOnboarded()) {
      await closeStrayExtensionPages();
      return;
    }
  }
  throw new Error('Freighter onboarding did not complete after 3 attempts');
}

test.beforeAll(async () => {
  const launched = await launchWithFreighter(chromium);
  context = launched.context;
  userDataDir = launched.userDataDir;
  await ensureOnboarded();
});

test.afterAll(async () => {
  if (context) await cleanup(context, userDataDir);
});

const APPROVAL_ROUTES = ['grant-access', 'sign-message', 'sign-transaction', 'sign-auth-entry'];

function findApprovalPopup(): Page | null {
  const prefix = `chrome-extension://${getExtensionId(context)}`;
  for (const p of context.pages()) {
    if (p.isClosed() || !p.url().startsWith(prefix)) continue;
    if (APPROVAL_ROUTES.some((route) => p.url().includes(route))) return p;
  }
  return null;
}

const APPROVE_SELECTOR =
  '[data-testid=grant-access-connect-button], [data-testid=sign-message-approve-button], [data-testid=sign-transaction-sign], [data-testid=sign-auth-entry-approve-button]';

async function snapPopup(popup: Page, grantName: string, signName: string): Promise<void> {
  const url = popup.url();
  const want = url.includes('grant-access')
    ? grantName
    : /sign-message|sign-transaction|sign-auth/.test(url)
      ? signName
      : null;
  if (!want || captured.has(want)) return;
  await popup
    .locator(APPROVE_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: 4_000 })
    .catch(() => {});
  await popup.waitForTimeout(400);
  const ok = await popup
    .screenshot({ path: path.join(SHOTS, want), type: 'jpeg', quality: 85 })
    .then(() => true)
    .catch(() => false);
  if (ok) captured.add(want);
}

async function waitForPopup(ms: number): Promise<Page | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const popup = findApprovalPopup();
    if (popup) return popup;
    await sleep(100);
  }
  return null;
}

async function rapidApproveUntil(
  done: () => Promise<boolean>,
  ms: number,
  grantName: string,
  signName: string,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await done()) return true;
    const popup = await waitForPopup(8_000);
    if (popup) await snapPopup(popup, grantName, signName);
    await approveOnce(context, { timeout: 3500 }).catch(() => {});
    await sleep(200);
  }
  return done();
}

function isConnected(page: Page): Promise<boolean> {
  return page
    .getByTestId('account-chip')
    .isVisible()
    .catch(() => false);
}

async function connectWallet(page: Page): Promise<void> {
  const done = () => isConnected(page);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await done()) break;
    if (attempt > 0)
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const btn = page.getByTestId('connect-btn');
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    await btn.click();
    if (
      await rapidApproveUntil(done, 50_000, '02-connect-popup.jpg', '03-sign-challenge-popup.jpg')
    )
      break;
  }
  await expect(page.getByTestId('account-chip')).toBeVisible({ timeout: 20_000 });
}

async function assertConnected(page: Page): Promise<void> {
  const chip = page.getByTestId('account-chip');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const chipText = (await chip.textContent())?.trim() ?? '';
  expect(chipText).toContain(DEPLOYER_HEAD);
  expect(chipText).toContain(DEPLOYER_TAIL);
}

async function ensureOpenProposal(page: Page): Promise<void> {
  const list = page.getByTestId('proposal-list');
  const votingCount = await list.locator('[data-testid=proposal-card]').filter({ hasText: 'voting' }).count();
  if (votingCount > 0) return;
  const payload = {
    title: 'Solar lamps for fishing village',
    organization: 'Kampung Nelayan cooperative',
    description: 'Solar lanterns for night-launch fishing boats and after-dark study for kids.',
    payoutAddress: 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47',
    requestedUsdc: '0.50',
    votingClosesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  };
  const statsRes = await page.request.get(`${BASE_URL}/api/vault`).catch(() => null);
  const statsJson = statsRes ? await statsRes.json() : null;
  const vaultId = statsJson?.data?.vaultId;
  if (!vaultId) throw new Error('vault not initialised on prod');
  const create = await page.request.post(`${BASE_URL}/api/proposals`, {
    data: { ...payload, vaultId },
  });
  if (!create.ok()) {
    console.error('proposal create status', create.status(), await create.text());
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('proposal-list')).toBeVisible({ timeout: 30_000 });
}

async function createRoundUp(page: Page): Promise<{ contribution: string }> {
  const input = page.getByTestId('input-purchase');
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill('4.30');
  const startTotal = (await page.getByTestId('pool-total').innerText()).trim();
  const btn = page.getByTestId('roundup-btn');
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click();
  await expect
    .poll(
      async () =>
        Number.parseFloat(
          (await page.getByTestId('pool-total').innerText()).replace(/[^0-9.]/g, ''),
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(Number.parseFloat(startTotal.replace(/[^0-9.]/g, '')));
  return { contribution: '0.70' };
}

async function castVote(page: Page): Promise<void> {
  const card = page.locator('[data-testid=proposal-card]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const voteBtn = card.getByTestId('vote-btn');
  if ((await voteBtn.count()) === 0) return;
  await voteBtn.click();
  await expect(page.getByText(/vote cast/i).first()).toBeVisible({ timeout: 20_000 });
}

async function triggerDisburse(page: Page): Promise<string> {
  const btn = page.getByTestId('close-window-btn');
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click();
  await expect(page.getByTestId('disburse-banner')).toBeVisible({ timeout: 60_000 });
  const banner = page.getByTestId('disburse-banner');
  const text = (await banner.textContent()) ?? '';
  const match = text.match(/tx:\s*([0-9a-f]{64})/i);
  if (!match) throw new Error(`disburse banner missing tx hash: ${text}`);
  return match[1];
}

test('real Freighter: connect + round-up + vote + disburse on-chain grant', async () => {
  test.setTimeout(540_000);
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-landing.jpg');

  await connectWallet(page);
  await assertConnected(page);
  await shot(page, '04-connected.jpg');

  await ensureOpenProposal(page);
  await shot(page, '05-core-flow.jpg');

  await createRoundUp(page);
  await castVote(page);
  await shot(page, '06-after-vote.jpg');

  const txHash = await triggerDisburse(page);
  await shot(page, '07-disbursed-tx.jpg');

  await page.goto(`https://stellar.expert/explorer/testnet/tx/${txHash}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3_000);
  await shot(page, '08-stellar-expert.jpg');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pool-total')).toBeVisible({ timeout: 30_000 });
  await shot(page, '09-final-stats.jpg');

  console.log('CORE_FLOW_TX=' + txHash);
  expect(txHash).toMatch(/^[0-9a-f]{64}$/);
});

test('mobile landing renders', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '10-mobile.jpg');
});