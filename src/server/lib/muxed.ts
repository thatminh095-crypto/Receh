import { Account, MuxedAccount, StrKey } from '@stellar/stellar-sdk';

/**
 * Encode a contributor index (numeric) into a muxed account address (SEP-23 / MuxedAccount).
 * The vault pool's G-address is the base; the contributor id becomes the muxed ID, giving
 * per-contributor attribution of round-ups that all land on one shared vault account.
 */
export function createMuxedAddress(gAddress: string, contributorId: bigint): string {
  if (!StrKey.isValidEd25519PublicKey(gAddress)) {
    throw new Error(`Invalid Stellar public key: ${gAddress}`);
  }
  const muxed = new MuxedAccount(new Account(gAddress, '0'), contributorId.toString());
  return muxed.accountId();
}

/**
 * Decode a muxed M-address back to { gAddress, muxedId }.
 */
export function decodeMuxedAddress(mAddress: string): { gAddress: string; muxedId: bigint } {
  const muxed = MuxedAccount.fromAddress(mAddress, '0');
  return {
    gAddress: muxed.baseAccount().accountId(),
    muxedId: BigInt(muxed.id()),
  };
}

/**
 * Build a SEP-7 pay URI that routes a single round-up into the shared DeFindex vault.
 */
export function buildSep7PayUri(params: {
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  memo: string;
  memoType?: string;
  msg?: string;
}): string {
  const { destination, amount, assetCode, assetIssuer, memo, memoType = 'text', msg } = params;
  const base = 'web+stellar:pay';
  const q = new URLSearchParams({
    destination,
    amount,
    asset_code: assetCode,
    asset_issuer: assetIssuer,
    memo,
    memo_type: memoType,
    network_passphrase: 'Test SDF Network ; September 2015',
  });
  if (msg) q.set('msg', msg);
  return `${base}?${q.toString()}`;
}

/**
 * Derive a deterministic numeric muxed id from a uuid (first 16 hex chars).
 */
export function muxedIdFromUuid(id: string): bigint {
  return BigInt(`0x${id.replace(/-/g, '').slice(0, 16)}`);
}
