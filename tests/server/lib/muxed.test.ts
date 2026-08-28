import { describe, expect, it } from 'vitest';
import { createMuxedAddress, decodeMuxedAddress, muxedIdFromUuid } from '@/server/lib/muxed';

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

describe('muxedIdFromUuid', () => {
  it('derives a stable bigint from a uuid', () => {
    const id = muxedIdFromUuid('abcdef12-3456-7890-abcd-ef1234567890');
    expect(typeof id).toBe('bigint');
    expect(id).toBeGreaterThan(0n);
  });
});
