// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_NETWORK = process.env.STELLAR_NETWORK;

async function loadWithNetwork(network: string | undefined) {
  if (network === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = network;
  vi.resetModules();
  return import('@/server/config/stellar');
}

afterEach(() => {
  if (ORIGINAL_NETWORK === undefined) delete process.env.STELLAR_NETWORK;
  else process.env.STELLAR_NETWORK = ORIGINAL_NETWORK;
});

describe('stellar.usdcIssuer', () => {
  it('uses the testnet USDC issuer on testnet', async () => {
    const { stellar } = await loadWithNetwork('testnet');
    expect(stellar.usdcIssuer).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });

  it('uses the real Circle mainnet USDC issuer on public — never the testnet one', async () => {
    const { stellar } = await loadWithNetwork('public');
    expect(stellar.usdcIssuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    expect(stellar.usdcIssuer).not.toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });

  it('falls back to the testnet issuer on futurenet', async () => {
    const { stellar } = await loadWithNetwork('futurenet');
    expect(stellar.usdcIssuer).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });
});
