import { createHash } from 'node:crypto';
import type { Keypair } from '@stellar/stellar-sdk';

const signedMessagePrefix = Buffer.from('Stellar Signed Message:\n', 'utf8');

export function verifyFreighterSignature(
  keypair: Keypair,
  nonce: string,
  signedNonce: string,
): boolean {
  const digest = createHash('sha256')
    .update(Buffer.concat([signedMessagePrefix, Buffer.from(nonce, 'utf8')]))
    .digest();

  return keypair.verify(digest, Buffer.from(signedNonce, 'base64'));
}
