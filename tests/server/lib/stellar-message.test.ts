// @vitest-environment node
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { verifyFreighterSignature } from '@/server/lib/stellar-message';

describe('verifyFreighterSignature', () => {
  const nonce = 'challenge-nonce-12345678';

  it('accepts a SEP-53 signed nonce', () => {
    const keypair = Keypair.random();
    const digest = createHash('sha256')
      .update(Buffer.from(`Stellar Signed Message:\n${nonce}`, 'utf8'))
      .digest();
    const signedNonce = keypair.sign(digest).toString('base64');

    expect(verifyFreighterSignature(keypair, nonce, signedNonce)).toBe(true);
  });

  it('rejects a signature over the raw nonce', () => {
    const keypair = Keypair.random();
    const signedNonce = keypair.sign(Buffer.from(nonce, 'utf8')).toString('base64');

    expect(verifyFreighterSignature(keypair, nonce, signedNonce)).toBe(false);
  });
});
