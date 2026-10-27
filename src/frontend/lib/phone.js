const MTN_PREFIXES = ['76', '77', '78', '39'];
const AIRTEL_PREFIXES = ['70', '74', '75', '20'];

/** Digits after +256, e.g. "772123456", from whatever the user typed. */
export function localDigits(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('256')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

export function toInternational(input) {
  const digits = localDigits(input);
  return digits.length === 9 ? `256${digits}` : null;
}

export function detectNetwork(input) {
  const prefix = localDigits(input).slice(0, 2);
  if (MTN_PREFIXES.includes(prefix)) return 'MTN';
  if (AIRTEL_PREFIXES.includes(prefix)) return 'AIRTEL';
  return null;
}

export function formatLocal(input) {
  const d = localDigits(input);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(' ');
}
