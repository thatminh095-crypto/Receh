import { describe, expect, it } from 'vitest';
import {
  buildSep7PayUri,
  createMuxedAddress,
  decodeMuxedAddress,
  muxedIdFromUuid,
} from '@/server/lib/muxed';

const G = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

describe('createMuxedAddress', () => {
  it('encodes a G-address + contributor id into an M-address', () => {
    const m = createMuxedAddress(G, 7n);
    expect(m.startsWith('M')).toBe(true);
  });

  it('round-trips through decodeMuxedAddress', () => {
    const m = createMuxedAddress(G, 99n);
    const { gAddress, muxedId } = decodeMuxedAddress(m);
    expect(gAddress).toBe(G);
    expect(muxedId).toBe(99n);
  });

  it('throws on an invalid public key', () => {
    expect(() => createMuxedAddress('not-a-key', 1n)).toThrow();
  });
});

describe('buildSep7PayUri', () => {
  it('builds a web+stellar:pay URI with all params', () => {
    const uri = buildSep7PayUri({
      destination: G,
      amount: '0.70',
      assetCode: 'USDC',
      assetIssuer: G,
      memo: 'RECEH:abcd1234',
      msg: 'round-up',
    });
    expect(uri.startsWith('web+stellar:pay?')).toBe(true);
    expect(uri).toContain('amount=0.70');
    expect(uri).toContain('asset_code=USDC');
    expect(uri).toContain('memo_type=text');
    expect(uri).toContain('msg=round-up');
    expect(uri).toContain('network_passphrase=');
  });

  it('honours a custom memoType and omits msg when absent', () => {
    const uri = buildSep7PayUri({
      destination: G,
      amount: '1',
      assetCode: 'USDC',
      assetIssuer: G,
      memo: '42',
      memoType: 'id',
    });
    expect(uri).toContain('memo_type=id');
    expect(uri).not.toContain('msg=');
  });
});

describe('muxedIdFromUuid', () => {
  it('derives a stable bigint from a uuid', () => {
    const id = muxedIdFromUuid('abcdef12-3456-7890-abcd-ef1234567890');
    expect(typeof id).toBe('bigint');
    expect(id).toBeGreaterThan(0n);
  });
});
