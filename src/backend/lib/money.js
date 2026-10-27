export const PLATFORM_COMMISSION_RATE = 0.3;

/**
 * Split a UGX amount into the 30% platform commission and 70% merchant payout.
 * UGX has no minor unit, so both parts are whole shillings and always sum to the total.
 */
export function splitPayment(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`Amount must be a positive whole number of UGX, got ${amount}`);
  }
  const platformCommission = Math.round(amount * PLATFORM_COMMISSION_RATE);
  return {
    amount,
    platformCommission,
    merchantPayoutAmount: amount - platformCommission,
  };
}

export function formatUgx(amount) {
  return `UGX ${Number(amount).toLocaleString('en-US')}`;
}

/**
 * Parse a human price such as "7000", "7,000", "7k", "7.5k" into whole UGX.
 */
export function parseUgxAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).trim().toLowerCase().match(/^([\d,]+(?:\.\d+)?)\s*(k)?$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const amount = Math.round(match[2] ? value * 1000 : value);
  return amount > 0 ? amount : null;
}
