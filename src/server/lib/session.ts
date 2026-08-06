import { createHmac, randomBytes } from 'node:crypto';
import { env } from '@/server/config/env';

export type SessionPayload = {
  publicKey: string;
  nonce: string;
  issuedAt: number;
};

const enc = (b: Buffer) => b.toString('base64url');
const dec = (s: string) => Buffer.from(s, 'base64url');

function sign(payload: string, secret: string): string {
  return enc(createHmac('sha256', secret).update(payload).digest());
}

function makeKey(): string {
  return randomBytes(32).toString('base64url');
}

const keyCache = new Map<string, string>();

function getKey(): string {
  const cached = keyCache.get(env.SESSION_SECRET);
  if (cached) return cached;
  const fresh = makeKey();
  keyCache.set(env.SESSION_SECRET, fresh);
  return fresh;
}

export async function signSession(
  payload: Omit<SessionPayload, 'issuedAt'> & { issuedAt?: number },
): Promise<string> {
  const full: SessionPayload = { ...payload, issuedAt: payload.issuedAt ?? Date.now() };
  const iv = makeKey();
  const body = enc(Buffer.from(JSON.stringify(full), 'utf-8'));
  const mac = sign(`${iv}.${body}`, getKey());
  return `${iv}.${body}.${mac}`;
}

export async function readSession(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [iv, body, mac] = parts;
  const expected = sign(`${iv}.${body}`, getKey());
  if (expected !== mac) return null;
  try {
    const payload = JSON.parse(dec(body).toString('utf-8')) as SessionPayload;
    if (Date.now() - payload.issuedAt > 1000 * 60 * 60 * 24) return null;
    return payload;
  } catch {
    return null;
  }
}