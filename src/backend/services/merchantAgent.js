import { formatUgx } from '../lib/money.js';
import { normalizeUgandanPhone } from '../lib/phone.js';
import {
  defaultPickupWindow,
  endOfKampalaDay,
  formatKampalaTime,
  formatKampalaWindow,
  kampalaTimeToday,
  parseClockTime,
  startOfKampalaDay,
} from '../lib/time.js';

const DEFAULT_TITLE = 'Surprise Bag';
const MIN_PRICE = 500;
const MAX_PRICE = 1_000_000;
const MAX_QUANTITY = 500;

export const HELP_TEXT = [
  '*Chula merchant assistant*',
  '',
  'List or update today\'s bags:',
  '  "Listed 5 bags today at 7000 UGX"',
  '  "8 bags of bread at 5k, was 15k, pickup 6-8pm"',
  '',
  'Confirm a customer pickup:',
  '  "Token 482910"',
  '',
  'Other commands:',
  '  "Sold out" – hide today\'s bags',
  '  "Status" – today\'s orders and payouts',
].join('\n');

const roundTo = (value, step) => Math.round(value / step) * step;

export function createMerchantAgent({ store, interpreter, embedder = null, logger, now = () => new Date() }) {
  async function listBags(merchant, parsed) {
    const current = now();
    const todays = await store.listMerchantBagsToday(merchant.id);
    const titleWanted = parsed.title?.trim();
    const existing =
      (titleWanted && todays.find((b) => b.title.toLowerCase() === titleWanted.toLowerCase())) ||
      (!titleWanted && todays.length === 1 ? todays[0] : null);

    const quantity = parsed.quantity ?? existing?.quantity_available ?? null;
    if (quantity === null) {
      return 'How many bags are you listing? e.g. "Listed 5 bags today at 7000 UGX"';
    }
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
      return `Please send a quantity between 0 and ${MAX_QUANTITY}.`;
    }

    const discountPrice = parsed.discount_price ?? existing?.discount_price ?? null;
    if (discountPrice === null) {
      return `Got ${quantity} bag(s). What price per bag? e.g. "${quantity} bags at 7000 UGX"`;
    }
    if (discountPrice < MIN_PRICE || discountPrice > MAX_PRICE) {
      return `The bag price should be between ${formatUgx(MIN_PRICE)} and ${formatUgx(MAX_PRICE)}.`;
    }

    let originalPrice = parsed.original_price ?? existing?.original_price ?? roundTo(discountPrice * 3, 500);
    if (originalPrice < discountPrice) originalPrice = discountPrice;

    let window;
    const start = parseClockTime(parsed.pickup_start);
    const end = parseClockTime(parsed.pickup_end);
    if (start && end) {
      window = { start: kampalaTimeToday(start.hour, start.minute, current), end: kampalaTimeToday(end.hour, end.minute, current) };
      if (window.end <= window.start) {
        return 'The pickup window must end after it starts, e.g. "pickup 6-8pm".';
      }
      if (window.end <= current) {
        return `That pickup window (${formatKampalaWindow(window.start, window.end)}) has already passed today. Send a later time.`;
      }
    } else if (existing && new Date(existing.pickup_end_time) > current) {
      window = { start: new Date(existing.pickup_start_time), end: new Date(existing.pickup_end_time) };
    } else {
      window = defaultPickupWindow(current);
    }
    if (window.end > endOfKampalaDay(current)) window.end = endOfKampalaDay(current);

    const title = titleWanted || existing?.title || DEFAULT_TITLE;
    const description = existing?.description ?? `Today's surplus from ${merchant.name}.`;
    const embedding = embedder ? await embedder.embed(`${title}. ${description} ${merchant.name}, ${merchant.district}`) : null;

    const { bag, created } = await store.upsertTodayBag({
      merchantId: merchant.id,
      title,
      description,
      quantity,
      discountPrice,
      originalPrice,
      pickupStart: window.start,
      pickupEnd: window.end,
      embedding,
    });

    logger.info('Bag listed via WhatsApp', { merchantId: merchant.id, bagId: bag.id, created, quantity, discountPrice });

    if (quantity === 0) {
      return `*${title}* is now marked sold out. Customers will see it in red on the map.`;
    }
    return [
      `${created ? 'Listed' : 'Updated'}: *${quantity} x ${title}* at *${formatUgx(discountPrice)}* each (worth ${formatUgx(originalPrice)}).`,
      `Pickup today ${formatKampalaWindow(window.start, window.end)} at ${merchant.name}.`,
      'Customers in Kampala can reserve now. Reply "Sold out" any time to stop sales.',
    ].join('\n');
  }

  async function redeem(merchant, token) {
    if (!token) return 'Send the customer\'s 6-digit code, e.g. "Token 482910".';
    const result = await store.redeemPickupToken({ merchantId: merchant.id, token });
    switch (result?.outcome) {
      case 'collected':
        return [
          `Token *${token}* verified. Hand over *${result.quantity} x ${result.bag_title}*${result.customer_name ? ` to ${result.customer_name}` : ''}.`,
          'Order marked as collected.',
        ].join('\n');
      case 'already_collected':
        return `Token *${token}* was already collected at ${formatKampalaTime(result.collected_at)}. Do not hand over another bag.`;
      case 'not_paid':
        return `Token *${token}* belongs to an order that is not paid. Do not hand over the bag.`;
      case 'invalid_format':
        return 'Pickup codes are exactly 6 digits. Please check and resend.';
      default:
        return `No paid order with token *${token}* at ${merchant.name}. Ask the customer to show the code in their Chula app.`;
    }
  }

  async function soldOut(merchant) {
    const count = await store.markMerchantBagsSoldOut(merchant.id);
    return count
      ? `Done. ${count} listing(s) marked sold out. Existing reservations are still valid for pickup.`
      : 'You have no active listings right now.';
  }

  async function status(merchant) {
    const current = now();
    const [bags, counts] = await Promise.all([
      store.listMerchantBagsToday(merchant.id),
      store.countMerchantOrders(merchant.id, startOfKampalaDay(current).toISOString()),
    ]);
    const lines = [`*${merchant.name} – today*`];
    if (bags.length) {
      for (const bag of bags) {
        lines.push(
          `• ${bag.title}: ${bag.quantity_available} left at ${formatUgx(bag.discount_price)} (${formatKampalaWindow(bag.pickup_start_time, bag.pickup_end_time)})${bag.status === 'sold_out' ? ' – sold out' : ''}`,
        );
      }
    } else {
      lines.push('No listings yet today.');
    }
    lines.push(`Awaiting pickup: ${counts.paid} | Collected: ${counts.collected}`);
    lines.push(`Your payout so far: ${formatUgx(counts.payout)}`);
    return lines.join('\n');
  }

  return {
    async handleMessage({ from, text }) {
      const phone = normalizeUgandanPhone(from);
      const body = String(text ?? '').trim();
      if (!phone) return { reply: null, intent: 'ignored' };

      const merchant = await store.findMerchantForPhone(phone);
      if (!merchant) {
        return {
          intent: 'unregistered',
          reply: 'This WhatsApp number is not linked to a Chula store. Ask your store admin to add you as merchant staff.',
        };
      }
      if (!body) return { intent: 'help', reply: HELP_TEXT, merchantId: merchant.id };

      const parsed = await interpreter.interpret(body, { merchantName: merchant.name, now: now() });
      logger.info('Merchant message interpreted', { merchantId: merchant.id, intent: parsed.intent, source: parsed.source });

      let reply;
      switch (parsed.intent) {
        case 'list_bags':
          reply = await listBags(merchant, parsed);
          break;
        case 'redeem_token':
          reply = await redeem(merchant, parsed.token);
          break;
        case 'mark_sold_out':
          reply = await soldOut(merchant);
          break;
        case 'status':
          reply = await status(merchant);
          break;
        case 'help':
          reply = HELP_TEXT;
          break;
        default:
          reply = `Sorry, I didn't understand that.\n\n${HELP_TEXT}`;
      }
      return { intent: parsed.intent, source: parsed.source, parsed, reply, merchantId: merchant.id };
    },
  };
}
