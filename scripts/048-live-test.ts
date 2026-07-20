/**
 * Live test for Receh — drives 55 real wallet connects with REAL Freighter popup each.
 * Then monitors API for 5 minutes and takes dashboard screenshots.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';

import {
  approveOnce,
  cleanup,
  getExtensionId,
  launchWithFreighter,
  onboardFreighter,
} from '../../../../shared/freighter/freighter-fixture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHOTS = resolve(
  __dirname,
  '../../../../screen-shot',
);
mkdirSync(SHOTS, { recursive: true });

const BASE_URL = 'https://receh-gamma.vercel.app';
const TOTAL = Number.parseInt(process.env.ITERATIONS ?? '55', 10);
const RUN_START = Date.now();
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_PATH = `/tmp/048-live-test/run-${ts}.json`;
const FINAL_PATH = `/tmp/048-live-test/final-${ts}.json`;
mkdirSync('/tmp/048-live-test', { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function friendbot(addr: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ok = await friendbotOnce(addr, 60_000);
    if (ok) return true;
    console.error(`[friendbot] attempt ${attempt} failed for ${addr.slice(0, 8)}…`);
    await sleep(1500);
  }
  return false;
}

function friendbotOnce(addr: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const url = `https://friendbot.stellar.org?addr=${addr}`;
    const proc = spawn('curl', ['-fsS', '--max-time', String(Math.floor(timeoutMs / 1000)), url]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('exit', (code) => {
      if (code === 0) resolveP(true);
      else {
        console.error(`[friendbot] exit=${code} addr=${addr} stderr=${stderr.slice(0, 200)}`);
        resolveP(false);
      }
    });
    proc.on('error', (e) => {
      console.error(`[friendbot] err=${e.message}`);
      resolveP(false);
    });
  });
}

async function fetchStats(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${BASE_URL}/api/stats`);
    const j = (await r.json()) as { ok?: boolean; data?: Record<string, unknown> };
    return j.ok && j.data ? j.data : null;
  } catch {
    return null;
  }
}

async function fetchContractsStats(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${BASE_URL}/api/contracts/stats`);
    const j = (await r.json()) as { ok?: boolean; data?: Record<string, unknown> };
    return j.ok && j.data ? j.data : null;
  } catch {
    return null;
  }
}

async function importAccountViaFreighter(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  secret: string,
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/index.html#/account/import`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    const field = page.locator('input[name=privateKey]');
    if (!(await field.isVisible({ timeout: 8_000 }).catch(() => false))) {
      // Maybe locked — try unlock first
      const pw = page.locator('#password-input, input[name=password], input[type=password]').first();
      if (await pw.isVisible().catch(() => false)) {
        await pw.fill('Sup3rSecret!Test123');
        const submit = page.getByRole('button', { name: /unlock|log ?in|confirm/i }).first();
        if (await submit.count().catch(() => 0)) await submit.click().catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        await page.waitForTimeout(2000);
        await page.goto(`chrome-extension://${extensionId}/index.html#/account/import`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForTimeout(2000);
      }
    }
    const field2 = page.locator('input[name=privateKey]');
    if (!(await field2.isVisible({ timeout: 8_000 }).catch(() => false))) {
      console.error('[importAccount] privateKey field not visible');
      return false;
    }
    await field2.fill(secret);
    await page.locator('input[name=password]').fill('Sup3rSecret!Test123');
    await page.locator('input[name=authorization]').check({ force: true });
    await page.locator('[data-testid=import-account-button]').click();
    await page.waitForTimeout(3000);
    return true;
  } catch (e) {
    console.error(`[importAccount] err=${(e as Error).message}`);
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeStrayExtPages(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
): Promise<void> {
  const prefix = `chrome-extension://${extensionId}`;
  for (const p of context.pages()) {
    if (!p.isClosed() && p.url().startsWith(prefix)) await p.close().catch(() => {});
  }
}

async function capturePopupScreenshot(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  iterNum: number,
): Promise<string | null> {
  const APPROVE_TESTIDS = [
    'grant-access-connect-button',
    'grant-access-connect-anyway-button',
    'sign-message-approve-button',
    'sign-transaction-sign',
    'sign-auth-entry-approve-button',
  ];
  const prefix = `chrome-extension://${extensionId}`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      if (!p.url().startsWith(prefix)) continue;
      for (const tid of APPROVE_TESTIDS) {
        const loc = p.locator(`[data-testid=${tid}]`);
        if ((await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))) {
          await p.waitForTimeout(600);
          const path = resolve(SHOTS, `freighter-popup-iter-${iterNum}.jpg`);
          await p.screenshot({ path, type: 'jpeg', quality: 85 }).catch(() => {});
          return path;
        }
      }
    }
    await sleep(150);
  }
  return null;
}

async function isAccountChipVisible(
  context: import('@playwright/test').BrowserContext,
): Promise<boolean> {
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    if (!p.url().startsWith(BASE_URL)) continue;
    const chip = p.getByTestId('account-chip');
    if ((await chip.count()) > 0 && (await chip.first().isVisible().catch(() => false))) {
      return true;
    }
  }
  return false;
}

interface IterRecord {
  iter: number;
  publicKey: string;
  shortKey: string;
  funded: boolean;
  imported: boolean;
  popupScreenshot: string | null;
  connectSuccess: boolean;
  durationMs: number;
  error?: string;
}

async function runIteration(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  iterNum: number,
  page: import('@playwright/test').Page,
): Promise<IterRecord> {
  const t0 = Date.now();
  const kp = Keypair.random();
  const secret = kp.secret();
  const publicKey = kp.publicKey();
  const shortKey = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
  const rec: IterRecord = {
    iter: iterNum,
    publicKey,
    shortKey,
    funded: false,
    imported: false,
    popupScreenshot: null,
    connectSuccess: false,
    durationMs: 0,
  };

  try {
    rec.funded = await friendbot(publicKey);
    if (!rec.funded) {
      rec.error = 'friendbot failed';
      rec.durationMs = Date.now() - t0;
      return rec;
    }

    rec.imported = await importAccountViaFreighter(context, extensionId, secret);
    if (!rec.imported) {
      rec.error = 'import failed';
      rec.durationMs = Date.now() - t0;
      return rec;
    }

    await closeStrayExtPages(context, extensionId);

    await context.clearCookies().catch(() => {});
    await page.context().clearPermissions().catch(() => {});

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);

    const connectBtn = page.getByTestId('connect-btn');
    let btnVisible = await connectBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!btnVisible) {
      // Already connected — try logout via DELETE /api/auth/me then reload
      await page.request.delete(`${BASE_URL}/api/auth/me`).catch(() => {});
      await page.waitForTimeout(500);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2500);
      btnVisible = await connectBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    }
    if (!btnVisible) {
      rec.error = 'connect-btn not visible';
      rec.durationMs = Date.now() - t0;
      return rec;
    }

    await connectBtn.click({ timeout: 5_000 }).catch(() => {});

    // Capture popup screenshot at iterations 1, 25, 55
    if (iterNum === 1 || iterNum === 25 || iterNum === 55) {
      const shot = await capturePopupScreenshot(context, extensionId, iterNum);
      rec.popupScreenshot = shot;
    }

    // Rapidly approve popups until account-chip appears or timeout
    const deadline = Date.now() + 90_000;
    let popupApproves = 0;
    while (Date.now() < deadline) {
      const chipNow = await page
        .getByTestId('account-chip')
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (chipNow) break;
      try {
        await approveOnce(context, { timeout: 4_000 });
        popupApproves++;
        console.log(`[iter ${iterNum}] approve #${popupApproves} ok`);
      } catch (e) {
        console.log(`[iter ${iterNum}] approve timeout: ${(e as Error).message}`);
        await sleep(300);
      }
    }

    // Wait for connect completion
    const connected = await page
      .getByTestId('account-chip')
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    rec.connectSuccess = connected;
    if (!connected) {
      // Try waiting a bit more
      await page.waitForTimeout(2000);
      const chipRetry = await page
        .getByTestId('account-chip')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      rec.connectSuccess = chipRetry;
      if (!chipRetry && !rec.error) rec.error = 'account-chip not visible after connect';
    }
  } catch (e) {
    rec.error = (e as Error).message;
  } finally {
    rec.durationMs = Date.now() - t0;
  }
  return rec;
}

async function pollUntil(): Promise<boolean> {
  return false;
}

async function main() {
  const phaseAT0 = Date.now();
  console.log(`[048-live] start iter=${TOTAL}`);
  const launched = await launchWithFreighter(chromium);
  const context = launched.context;
  const extensionId = launched.extensionId;
  const userDataDir = launched.userDataDir;
  console.log(`[048-live] extId=${extensionId}`);

  await onboardFreighter(context);
  console.log('[048-live] onboarded');

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[page]', msg.text());
  });

  const iterRecords: IterRecord[] = [];
  const checkpoints: Array<{ at: string; stats: unknown; contracts: unknown }> = [];
  const popShotIter = [1, 25, 55];

  for (let i = 1; i <= TOTAL; i++) {
    const rec = await runIteration(context, extensionId, i, page);
    iterRecords.push(rec);
    const tag = rec.connectSuccess ? 'OK' : 'FAIL';
    console.log(
      `[iter ${i.toString().padStart(2, '0')}/${TOTAL}] ${tag} ${rec.shortKey} funded=${rec.funded} imported=${rec.imported} err=${rec.error ?? '-'} t=${rec.durationMs}ms`,
    );

    const cpMarkers = [10, 25, 35, 55];
    if (cpMarkers.includes(i)) {
      const stats = await fetchStats();
      const contracts = await fetchContractsStats();
      checkpoints.push({ at: `t+${i}`, stats, contracts });
      console.log(`[cp t+${i}] stats=${JSON.stringify(stats)} contracts=${JSON.stringify(contracts)}`);
      writeFileSync(
        LOG_PATH,
        JSON.stringify({ iterRecords, checkpoints, startedAt: new Date(phaseAT0).toISOString() }, null, 2),
      );
    }
  }

  await cleanup(context, userDataDir);

  const phaseADuration = Date.now() - phaseAT0;
  const succeeded = iterRecords.filter((r) => r.connectSuccess).length;
  const failed = iterRecords.length - succeeded;

  console.log(`[048-live] Phase A done. succeeded=${succeeded}/${TOTAL} dur=${(phaseADuration / 1000).toFixed(1)}s`);

  // Phase B - monitor
  const phaseBT0 = Date.now();
  console.log('[048-live] Phase B monitor 5min');
  const polls: Array<{ t: string; stats: unknown; contracts: unknown }> = [];
  for (let p = 0; p < 10; p++) {
    const stats = await fetchStats();
    const contracts = await fetchContractsStats();
    polls.push({ t: `t+${p * 30}s`, stats, contracts });
    console.log(`[poll ${p + 1}/10] stats=${JSON.stringify(stats)} contracts=${JSON.stringify(contracts)}`);
    if (p < 9) await sleep(30_000);
  }
  const phaseBDuration = Date.now() - phaseBT0;
  console.log(`[048-live] Phase B done. dur=${(phaseBDuration / 1000).toFixed(1)}s`);

  // Phase C - dashboard screenshots
  const phaseCT0 = Date.now();
  console.log('[048-live] Phase C screenshots');
  const launched2 = await launchWithFreighter(chromium);
  const context2 = launched2.context;
  const extensionId2 = launched2.extensionId;
  const userDataDir2 = launched2.userDataDir;
  await onboardFreighter(context2);
  const page2 = await context2.newPage();
  await page2.goto(`${BASE_URL}/stats`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page2.waitForTimeout(3000);
  const dashPath = resolve(SHOTS, 'dashboard-after-population.jpg');
  await page2.screenshot({ path: dashPath, fullPage: true, type: 'jpeg', quality: 85 }).catch(() => {});
  await page2.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page2.waitForTimeout(3000);
  const landPath = resolve(SHOTS, 'landing-after-population.jpg');
  await page2.screenshot({ path: landPath, fullPage: true, type: 'jpeg', quality: 85 }).catch(() => {});
  await cleanup(context2, userDataDir2);
  console.log(`[048-live] Phase C done. dash=${dashPath} land=${landPath}`);
  const phaseCDuration = Date.now() - phaseCT0;

  // Final stats
  const finalStats = (await fetchStats()) ?? {};
  const finalContracts = (await fetchContractsStats()) ?? {};

  const baseline = {
    contributors: 2,
    roundUps: 2,
    proposals: 3,
    votes: 2,
    grantsDisbursed: 2,
    poolTotalUsdc: '1.84',
    memberCount: 0,
  };

  const result = {
    phaseA: {
      iterationsAttempted: TOTAL,
      iterationsSucceeded: succeeded,
      iterationsFailed: failed,
      popupScreenshots: popShotIter
        .filter((n) => iterRecords.find((r) => r.iter === n)?.popupScreenshot)
        .map((n) => `screen-shot/freighter-popup-iter-${n}.jpg`),
      durationMs: phaseADuration,
    },
    checkpoints,
    phaseB: {
      polls,
      durationMs: phaseBDuration,
    },
    phaseC: {
      dashboardScreenshot: 'projects/048-community-impact-round-up-yield-pool/screen-shot/dashboard-after-population.jpg',
      landingScreenshot: 'projects/048-community-impact-round-up-yield-pool/screen-shot/landing-after-population.jpg',
    },
    deltas: {
      contributorsBefore: baseline.contributors,
      contributorsAfter: Number((finalStats as Record<string, unknown>).contributors ?? 0),
      contributorsDelta:
        Number((finalStats as Record<string, unknown>).contributors ?? 0) - baseline.contributors,
      memberCountBefore: baseline.memberCount,
      memberCountAfter: Number((finalContracts as Record<string, unknown>).memberCount ?? 0),
      memberCountDelta:
        Number((finalContracts as Record<string, unknown>).memberCount ?? 0) - baseline.memberCount,
      poolTotalUsdcBefore: baseline.poolTotalUsdc,
      poolTotalUsdcAfter: String((finalStats as Record<string, unknown>).poolTotalUsdc ?? '0'),
    },
    wallClockMinutes: Math.round((Date.now() - RUN_START) / 60000),
    notes: `Iterated ${TOTAL} wallet connects with real Freighter popup. ${succeeded} succeeded. friendbot=${iterRecords.filter((r) => r.funded).length}/${TOTAL}. import=${iterRecords.filter((r) => r.imported).length}/${TOTAL}.`,
    iterRecords,
  };

  writeFileSync(FINAL_PATH, JSON.stringify(result, null, 2));
  console.log(`[048-live] final saved to ${FINAL_PATH}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});