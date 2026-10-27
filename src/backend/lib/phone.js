// Uganda mobile prefixes (the two digits after the 256 country code).
const MTN_PREFIXES = new Set(['76', '77', '78', '39']);
const AIRTEL_PREFIXES = new Set(['70', '74', '75', '20']);

/**
 * Normalise any common Ugandan phone format to 256XXXXXXXXX.
 * Accepts "0772 123 456", "+256 772123456", "772123456", "256772123456".
 * Returns null when the input cannot be a Ugandan number.
 */
export function normalizeUgandanPhone(input) {
  if (input === null || input === undefined) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00256')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length === 9 && /^[2-9]/.test(digits)) digits = `256${digits}`;
  return /^256[0-9]{9}$/.test(digits) ? digits : null;
}

export function detectNetwork(phone) {
  const normalized = normalizeUgandanPhone(phone);
  if (!normalized) return null;
  const prefix = normalized.slice(3, 5);
  if (MTN_PREFIXES.has(prefix)) return 'MTN';
  if (AIRTEL_PREFIXES.has(prefix)) return 'AIRTEL';
  return null;
}

export function maskPhone(phone) {
  const normalized = normalizeUgandanPhone(phone);
  if (!normalized) return '';
  return `+${normalized.slice(0, 5)}•••${normalized.slice(-3)}`;
}
