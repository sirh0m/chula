import { parseUgxAmount } from '../lib/money.js';
import { parseClockTime } from '../lib/time.js';

export const INTENTS = ['list_bags', 'redeem_token', 'mark_sold_out', 'status', 'help', 'unknown'];

const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*k?`;
const CLOCK = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?`;

const emptyResult = (intent) => ({
  intent,
  quantity: null,
  discount_price: null,
  original_price: null,
  title: null,
  pickup_start: null,
  pickup_end: null,
  token: null,
});

const toHHMM = ({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/**
 * Pull a 6-digit pickup token out of a message such as "Token 482910",
 * "code: 482 910" or a bare "482910". Returns null when there is none.
 */
export function extractToken(text) {
  const clean = String(text ?? '').trim();
  const bare = clean.match(/^#?\s*(\d{3})[\s-]?(\d{3})\s*\.?$/);
  if (bare) return bare[1] + bare[2];
  const keyed = clean.match(
    /\b(?:token|code|pin|redeem|verify|collect(?:ed|ing|ion)?|pick(?:ed)?\s*up)\b\D{0,20}?(?<!\d)(\d{3})[\s-]?(\d{3})(?!\d)/i,
  );
  return keyed ? keyed[1] + keyed[2] : null;
}

function titleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseWindow(text) {
  const match = text.match(
    new RegExp(String.raw`(?<![\d,])(${CLOCK})\s*(?:-|–|to|until|till|and)\s*(${CLOCK})(?![\d,])`, 'i'),
  );
  if (!match) return { start: null, end: null, consumed: null };

  let rawStart = match[1].trim();
  const rawEnd = match[2].trim();
  const endMeridiem = rawEnd.match(/(am|pm)$/i)?.[1];
  if (endMeridiem && !/(am|pm)$/i.test(rawStart)) rawStart = `${rawStart}${endMeridiem}`;

  const assumeAfternoon = (raw) => {
    const parsed = parseClockTime(raw);
    if (!parsed) return null;
    // "6-8" from a shop owner almost always means the evening.
    if (!/(am|pm)$/i.test(raw) && !/[:.]/.test(raw) && parsed.hour >= 1 && parsed.hour <= 9) parsed.hour += 12;
    return parsed;
  };

  const start = assumeAfternoon(rawStart);
  const end = assumeAfternoon(rawEnd);
  if (!start || !end) return { start: null, end: null, consumed: null };
  return { start: toHHMM(start), end: toHHMM(end), consumed: match[0] };
}

/**
 * Deterministic parser for merchant WhatsApp messages. Used as the fast
 * path for tokens and as the fallback whenever Gemini is unavailable.
 */
export function parseMerchantMessage(text) {
  const original = String(text ?? '').normalize('NFKC');
  const lower = original.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return emptyResult('unknown');

  const token = extractToken(original);
  if (token) return { ...emptyResult('redeem_token'), token };

  if (/^(help|hi|hello|hey|menu|start|commands|\?)[.!]*$/.test(lower)) return emptyResult('help');

  if (/\b(sold\s*out|all gone|finished|no more( bags)?|out of stock|stop listing|close (the )?listing)\b/.test(lower)) {
    return emptyResult('mark_sold_out');
  }

  if (/\b(status|summary|report|sales|how many (orders|bags)|orders today)\b/.test(lower)) {
    return emptyResult('status');
  }

  let working = lower;
  const window = parseWindow(working);
  if (window.consumed) working = working.replace(window.consumed, ' ');

  let originalPrice = null;
  const originalMatch = working.match(
    new RegExp(String.raw`\b(?:was|worth|value(?:d)?(?: at)?|originally|normally|retail(?:s)?(?: at)?)\s*(?:ugx|shs?\.?)?\s*(${AMOUNT})`),
  );
  if (originalMatch) {
    originalPrice = parseUgxAmount(originalMatch[1]);
    working = working.replace(originalMatch[0], ' ');
  }

  let quantity = null;
  const quantityMatch =
    working.match(/(?<![\d,])(\d{1,3})\s*(?:x\s*)?(?:[a-z'&-]+\s+){0,3}?(?:bags?|boxes?|packs?|packets?|portions?|plates?|meals?)\b/) ||
    working.match(/\b(?:list(?:ed)?|add(?:ed)?|post(?:ed)?|have|got|selling)\s+(\d{1,3})\b(?!\s*(?:k\b|,\d|\d|ugx|shs?|\/=))/);
  if (quantityMatch) {
    quantity = Number(quantityMatch[1]);
    working = working.replace(quantityMatch[0], ' ');
  }

  let discountPrice = null;
  const pricePatterns = [
    new RegExp(String.raw`\b(?:ugx|shs?\.?)\s*(${AMOUNT})`),
    new RegExp(String.raw`(${AMOUNT})\s*(?:ugx|shs?|shillings|\/=|\/-)`),
    new RegExp(String.raw`(?:\bat|\bfor|@|\beach|\bprice|\bcosts?)\s*(${AMOUNT})`),
  ];
  for (const pattern of pricePatterns) {
    const match = working.match(pattern);
    const amount = match ? parseUgxAmount(match[1]) : null;
    if (amount) {
      discountPrice = amount;
      break;
    }
  }

  let title = null;
  const titleMatch = lower.match(/\b(?:bags?|boxes?|packs?) of ([a-z][a-z &'-]{2,40}?)(?=\s+(?:at|for|@|from|pickup|ugx|was|worth)\b|[,.!]|$)/);
  if (titleMatch) title = `${titleCase(titleMatch[1])} Bag`;

  if (quantity !== null || (discountPrice !== null && /\b(list|add|post|bags?|selling)\b/.test(lower))) {
    return {
      ...emptyResult('list_bags'),
      quantity,
      discount_price: discountPrice,
      original_price: originalPrice,
      title,
      pickup_start: window.start,
      pickup_end: window.end,
    };
  }

  return emptyResult('unknown');
}
