import { describe, expect, it } from 'vitest';
import {
  IDR_PER_USDC,
  projectYield,
  roundedTotal,
  roundUpDelta,
  usdcToIdr,
} from '@/server/lib/roundup';

describe('roundUpDelta', () => {
  it('returns spare change to the next whole USDC', () => {
    expect(roundUpDelta('4.30')).toBe('0.70');
    expect(roundUpDelta(2.65)).toBe('0.35');
    expect(roundUpDelta('6.20')).toBe('0.80');
  });

  it('returns 0 for whole amounts', () => {
    expect(roundUpDelta('5.00')).toBe('0.00');
    expect(roundUpDelta(10)).toBe('0.00');
  });

  it('handles invalid / negative input', () => {
    expect(roundUpDelta('abc')).toBe('0.00');
    expect(roundUpDelta(-3)).toBe('0.00');
  });

  it('supports a custom increment', () => {
    // round up to next 5 USDC
    expect(roundUpDelta('12.00', 5)).toBe('3.00');
    expect(roundUpDelta('12.00', 0)).toBe('0.00'); // invalid increment -> default 1
  });
});

describe('roundedTotal', () => {
  it('equals purchase + spare change', () => {
    expect(roundedTotal('4.30')).toBe('5.00');
    expect(roundedTotal(2.65)).toBe('3.00');
  });
  it('handles invalid input', () => {
    expect(roundedTotal('xyz')).toBe('0.00');
  });
});

describe('usdcToIdr', () => {
  it('converts USDC to rupiah string', () => {
    expect(usdcToIdr(1)).toBe(`Rp ${IDR_PER_USDC.toLocaleString('id-ID')}`);
  });
  it('handles invalid input', () => {
    expect(usdcToIdr('nope')).toBe('Rp 0');
  });
});

describe('projectYield', () => {
  it('accrues positive yield over time', () => {
    const { yieldUsdc, balanceUsdc } = projectYield('100', 8.2, 31);
    expect(Number.parseFloat(yieldUsdc)).toBeGreaterThan(0);
    expect(Number.parseFloat(balanceUsdc)).toBeGreaterThan(100);
  });

  it('returns zero for non-positive principal', () => {
    expect(projectYield('0', 8, 30)).toEqual({ yieldUsdc: '0.00', balanceUsdc: '0.00' });
    expect(projectYield('-5', 8, 30).yieldUsdc).toBe('0.00');
  });

  it('clamps negative days to zero growth', () => {
    const { yieldUsdc } = projectYield('100', 8, -10);
    expect(Number.parseFloat(yieldUsdc)).toBe(0);
  });
});
