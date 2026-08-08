/** Convert a USDC amount in "stroops" (1e7) to a human-readable string */
export function stroopsToUsdc(stroops: string | bigint): string {
  const n = BigInt(stroops);
  const whole = n / 10_000_000n;
  const frac = n % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, '0').replace(/0+$/, '')}`;
}

/** Convert USDC decimal string to stroops bigint */
export function usdcToStroops(usdc: string): bigint {
  const [whole, frac = ''] = usdc.split('.');
  const fracPadded = frac.padEnd(7, '0').slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
}

/** Approximate VND per 1 USDC (demo rate). */
export const VND_PER_USDC = 26_000;

/** Format Vietnamese dong from a USDC amount (1 USDC ~ 26,000 VND demo rate). */
export function usdcToVnd(usdcStr: string): string {
  const usdc = Number.parseFloat(usdcStr);
  if (Number.isNaN(usdc)) return '0 ₫';
  const vnd = Math.round(usdc * VND_PER_USDC);
  return `${vnd.toLocaleString('vi-VN')} ₫`;
}
