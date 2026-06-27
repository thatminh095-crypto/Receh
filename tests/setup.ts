import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

if (!process.env.DRIZZLE_DATABASE_URL)
  process.env.DRIZZLE_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/receh_test';
if (!process.env.VAULT_SECRET_KEY)
  process.env.VAULT_SECRET_KEY = 'SCZANGBA5AKIA7XKPXPXZF765VQXBHV4MHXJSRDTMTTTFVT5UIBEUZP';
if (!process.env.VAULT_ADDRESS)
  process.env.VAULT_ADDRESS = 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
if (!process.env.SESSION_SECRET)
  process.env.SESSION_SECRET = 'receh-test-session-secret-minimum-32chars-ok';

expect.extend(matchers);

// jsdom matchMedia mock
const listeners = new Set<(e: MediaQueryListEvent) => void>();
window.matchMedia = (query: string): MediaQueryList => {
  const mql = {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (event: string, cb: EventListenerOrEventListenerObject) => {
      if (event === 'change') listeners.add(cb as (e: MediaQueryListEvent) => void);
    },
    removeEventListener: (event: string, cb: EventListenerOrEventListenerObject) => {
      if (event === 'change') listeners.delete(cb as (e: MediaQueryListEvent) => void);
    },
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  return mql;
};
