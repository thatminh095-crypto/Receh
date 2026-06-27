/**
 * Round-up math for Receh. Every purchase is rounded UP to the next whole USDC;
 * the difference is the spare-change contribution routed into the shared yield vault.
 */

/** Round a purchase amount up to the next whole USDC. Returns the spare-change delta as a string. */
export function roundUpDelta(purchaseUsdc: string | number, increment = 1): string {
  const amount = typeof purchaseUsdc === 'number' ? purchaseUsdc : Number.parseFloat(purchaseUsdc);
  if (!Number.isFinite(amount) || amount < 0) return '0.00';
  const inc = increment > 0 ? increment : 1;
  const rounded = Math.ceil(amount / inc) * inc;
  const delta = rounded - amount;
  // Avoid floating point dust; clamp tiny residuals to 0.
  const cleaned = Math.round(delta * 100) / 100;
  return cleaned.toFixed(2);
}

/** The total a shopper pays after round-up (purchase + spare change). */
export function roundedTotal(purchaseUsdc: string | number, increment = 1): string {
  const amount = typeof purchaseUsdc === 'number' ? purchaseUsdc : Number.parseFloat(purchaseUsdc);
  if (!Number.isFinite(amount) || amount < 0) return '0.00';
  const delta = Number.parseFloat(roundUpDelta(amount, increment));
  return (amount + delta).toFixed(2);
}

/** Indonesian Rupiah per 1 USDC (demo rate). */
export const IDR_PER_USDC = 16_300;

/** Format a USDC amount as Indonesian Rupiah (Rp). */
export function usdcToIdr(usdcStr: string | number): string {
  const usdc = typeof usdcStr === 'number' ? usdcStr : Number.parseFloat(usdcStr);
  if (!Number.isFinite(usdc)) return 'Rp 0';
  const idr = Math.round(usdc * IDR_PER_USDC);
  return `Rp ${idr.toLocaleString('id-ID')}`;
}

/**
 * Project the value of a vault balance after accruing variable yield for a number of days.
 * Simulates a Blend-style market APY compounded daily (used when the DeFindex SDK is unavailable).
 */
export function projectYield(
  principalUsdc: string | number,
  apyPercent: number,
  days: number,
): {
  yieldUsdc: string;
  balanceUsdc: string;
} {
  const principal =
    typeof principalUsdc === 'number' ? principalUsdc : Number.parseFloat(principalUsdc);
  if (!Number.isFinite(principal) || principal <= 0) {
    return { yieldUsdc: '0.00', balanceUsdc: '0.00' };
  }
  const dailyRate = apyPercent / 100 / 365;
  const balance = principal * (1 + dailyRate) ** Math.max(days, 0);
  const earned = balance - principal;
  return { yieldUsdc: earned.toFixed(4), balanceUsdc: balance.toFixed(4) };
}
