import { randomInt, randomUUID } from 'node:crypto';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { splitPayment } from '../lib/money.js';
import { SEED_BAGS, SEED_MERCHANTS } from './seedData.js';

const PUBLIC_MERCHANT_FIELDS = ['id', 'name', 'district', 'address', 'latitude', 'longitude'];

function pick(obj, fields) {
  return Object.fromEntries(fields.map((field) => [field, obj[field]]));
}

/**
 * In-process implementation of the Chula data layer. It reproduces the
 * guarantees of the Postgres functions in 001_initial_schema.sql
 * (server-side pricing, no overselling, idempotent payment confirmation,
 * unique live pickup tokens). Every mutating method is synchronous between
 * reads and writes, so Node's single thread makes each one atomic.
 */
export function createMemoryStore({ seed = true, now = () => new Date() } = {}) {
  const merchants = new Map();
  const bags = new Map();
  const orders = new Map();
  const profiles = new Map();

  const nowIso = () => now().toISOString();

  if (seed) {
    const base = now().getTime();
    for (const merchant of SEED_MERCHANTS) {
      merchants.set(merchant.id, { ...merchant, is_active: true, created_at: nowIso(), updated_at: nowIso() });
      profiles.set(`staff-${merchant.id}`, {
        id: `staff-${merchant.id}`,
        full_name: `${merchant.name} staff`,
        phone_number: merchant.momo_payout_number,
        role: 'merchant_staff',
        merchant_id: merchant.id,
      });
    }
    for (const seedBag of SEED_BAGS) {
      const merchant = SEED_MERCHANTS[seedBag.merchantIndex];
      const id = randomUUID();
      bags.set(id, {
        id,
        merchant_id: merchant.id,
        title: seedBag.title,
        description: seedBag.description,
        original_price: seedBag.original_price,
        discount_price: seedBag.discount_price,
        quantity_available: seedBag.quantity_available,
        pickup_start_time: new Date(base + seedBag.startOffsetMs).toISOString(),
        pickup_end_time: new Date(base + seedBag.endOffsetMs).toISOString(),
        status: seedBag.quantity_available > 0 ? 'active' : 'sold_out',
        description_embedding: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  }

  const publicMerchant = (merchantId) => {
    const merchant = merchants.get(merchantId);
    return merchant ? pick(merchant, PUBLIC_MERCHANT_FIELDS) : null;
  };

  const publicBag = (bag) => {
    const { description_embedding: _embedding, ...rest } = bag;
    return { ...rest, merchant: publicMerchant(bag.merchant_id) };
  };

  const richOrder = (order) => {
    const bag = bags.get(order.bag_id);
    return {
      ...order,
      bag: bag
        ? pick(bag, ['id', 'title', 'description', 'pickup_start_time', 'pickup_end_time', 'discount_price', 'original_price'])
        : null,
      merchant: publicMerchant(order.merchant_id),
    };
  };

  const syncStatus = (bag) => {
    if (bag.status === 'expired') return;
    if (bag.quantity_available === 0) bag.status = 'sold_out';
    else if (bag.status === 'sold_out') bag.status = 'active';
  };

  const touch = (row) => {
    row.updated_at = nowIso();
  };

  return {
    kind: 'memory',

    async ensureProfile({ id, fullName = null, phoneNumber = null }) {
      if (!profiles.has(id)) {
        profiles.set(id, { id, full_name: fullName, phone_number: phoneNumber, role: 'customer', merchant_id: null });
      }
      return profiles.get(id);
    },

    async listMerchants() {
      return [...merchants.values()].filter((m) => m.is_active).map((m) => pick(m, PUBLIC_MERCHANT_FIELDS));
    },

    async listMerchantContacts() {
      return [...merchants.values()]
        .filter((m) => m.is_active)
        .map((m) => ({ ...pick(m, PUBLIC_MERCHANT_FIELDS), phone: m.momo_payout_number }));
    },

    async listBags({ district } = {}) {
      const current = now();
      return [...bags.values()]
        .filter((bag) => ['active', 'sold_out'].includes(bag.status))
        .filter((bag) => new Date(bag.pickup_end_time) > current)
        .filter((bag) => merchants.get(bag.merchant_id)?.is_active)
        .filter((bag) => !district || merchants.get(bag.merchant_id)?.district === district)
        .sort((a, b) => new Date(a.pickup_start_time) - new Date(b.pickup_start_time))
        .map(publicBag);
    },

    async getBag(id) {
      const bag = bags.get(id);
      return bag ? publicBag(bag) : null;
    },

    async createOrder({ id = randomUUID(), customerId, bagId, quantity, payerPhone, paymentNetwork, txRef }) {
      const bag = bags.get(bagId);
      if (!bag) throw notFound('That bag no longer exists');
      if (bag.status !== 'active' || new Date(bag.pickup_end_time) <= now()) {
        throw conflict('This bag is no longer available');
      }
      if (quantity > bag.quantity_available) {
        throw conflict(`Only ${bag.quantity_available} bag(s) left`);
      }
      const split = splitPayment(bag.discount_price * quantity);
      const order = {
        id,
        customer_id: customerId,
        bag_id: bag.id,
        merchant_id: bag.merchant_id,
        quantity,
        status: 'pending_payment',
        amount_paid: split.amount,
        platform_commission: split.platformCommission,
        merchant_payout_amount: split.merchantPayoutAmount,
        pickup_token: null,
        flw_transaction_ref: txRef,
        flw_transaction_id: null,
        payer_phone: payerPhone,
        payment_network: paymentNetwork,
        paid_at: null,
        collected_at: null,
        cancelled_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      orders.set(id, order);
      return richOrder(order);
    },

    async getOrder(id) {
      const order = orders.get(id);
      return order ? richOrder(order) : null;
    },

    async getOrderByTxRef(txRef) {
      const order = [...orders.values()].find((o) => o.flw_transaction_ref === txRef);
      return order ? richOrder(order) : null;
    },

    async listOrdersForCustomer(customerId) {
      return [...orders.values()]
        .filter((o) => o.customer_id === customerId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(richOrder);
    },

    async cancelPendingOrder(id) {
      const order = orders.get(id);
      if (!order) throw notFound('Order not found');
      if (order.status === 'pending_payment') {
        order.status = 'cancelled';
        order.cancelled_at = nowIso();
        touch(order);
      }
      return richOrder(order);
    },

    async confirmPayment({ orderId, flwTransactionId, amount }) {
      const order = orders.get(orderId);
      if (!order) throw notFound(`Order ${orderId} not found`);
      if (order.status !== 'pending_payment') {
        return { order_id: order.id, status: order.status, pickup_token: order.pickup_token, needs_refund: false };
      }
      if (amount < order.amount_paid) {
        throw badRequest(`Paid amount ${amount} is less than order total ${order.amount_paid}`);
      }
      const bag = bags.get(order.bag_id);
      if (
        !bag ||
        bag.quantity_available < order.quantity ||
        bag.status === 'expired' ||
        new Date(bag.pickup_end_time) <= now()
      ) {
        order.status = 'cancelled';
        order.cancelled_at = nowIso();
        order.flw_transaction_id = flwTransactionId;
        touch(order);
        return { order_id: order.id, status: 'cancelled', pickup_token: null, needs_refund: true };
      }

      bag.quantity_available -= order.quantity;
      syncStatus(bag);
      touch(bag);

      const live = new Set([...orders.values()].filter((o) => o.status === 'paid').map((o) => o.pickup_token));
      let token;
      do {
        token = String(randomInt(0, 1_000_000)).padStart(6, '0');
      } while (live.has(token));

      const split = splitPayment(order.amount_paid);
      order.platform_commission = split.platformCommission;
      order.merchant_payout_amount = split.merchantPayoutAmount;
      order.status = 'paid';
      order.paid_at = nowIso();
      order.pickup_token = token;
      order.flw_transaction_id = flwTransactionId;
      touch(order);
      return { order_id: order.id, status: 'paid', pickup_token: token, needs_refund: false };
    },

    async markOrderRefunded(orderId) {
      const order = orders.get(orderId);
      if (!order) throw notFound('Order not found');
      order.status = 'refunded';
      touch(order);
      return richOrder(order);
    },

    async redeemPickupToken({ merchantId, token }) {
      if (!/^\d{6}$/.test(token)) return { outcome: 'invalid_format' };
      const candidates = [...orders.values()]
        .filter((o) => o.merchant_id === merchantId && o.pickup_token === token)
        .sort(
          (a, b) =>
            Number(b.status === 'paid') - Number(a.status === 'paid') ||
            new Date(b.created_at) - new Date(a.created_at),
        );
      const order = candidates[0];
      if (!order) return { outcome: 'not_found' };
      const bag = bags.get(order.bag_id);
      const customer = profiles.get(order.customer_id);
      const details = {
        order_id: order.id,
        quantity: order.quantity,
        bag_title: bag?.title ?? null,
        customer_name: customer?.full_name ?? null,
      };
      if (order.status === 'collected') {
        return { outcome: 'already_collected', ...details, collected_at: order.collected_at };
      }
      if (order.status !== 'paid') return { outcome: 'not_paid', order_id: order.id, quantity: order.quantity };
      order.status = 'collected';
      order.collected_at = nowIso();
      touch(order);
      return { outcome: 'collected', ...details, collected_at: order.collected_at };
    },

    async findMerchantForPhone(phone) {
      const staff = [...profiles.values()].find((p) => p.role === 'merchant_staff' && p.phone_number === phone);
      const merchant = staff ? merchants.get(staff.merchant_id) : [...merchants.values()].find((m) => m.momo_payout_number === phone);
      return merchant && merchant.is_active ? { ...merchant } : null;
    },

    async listMerchantBagsToday(merchantId) {
      const current = now();
      return [...bags.values()]
        .filter((bag) => bag.merchant_id === merchantId && new Date(bag.pickup_end_time) > current && bag.status !== 'expired')
        .map(publicBag);
    },

    async countMerchantOrders(merchantId, sinceIso) {
      const since = new Date(sinceIso);
      const relevant = [...orders.values()].filter((o) => o.merchant_id === merchantId && new Date(o.created_at) >= since);
      return {
        paid: relevant.filter((o) => o.status === 'paid').length,
        collected: relevant.filter((o) => o.status === 'collected').length,
        payout: relevant
          .filter((o) => ['paid', 'collected'].includes(o.status))
          .reduce((sum, o) => sum + o.merchant_payout_amount, 0),
      };
    },

    async upsertTodayBag({ merchantId, title, description = null, quantity, discountPrice, originalPrice, pickupStart, pickupEnd, embedding = null }) {
      const current = now();
      const existing = [...bags.values()].find(
        (bag) =>
          bag.merchant_id === merchantId &&
          bag.status !== 'expired' &&
          new Date(bag.pickup_end_time) > current &&
          bag.title.toLowerCase() === title.toLowerCase(),
      );
      const fields = {
        title,
        original_price: originalPrice,
        discount_price: discountPrice,
        quantity_available: quantity,
        pickup_start_time: pickupStart.toISOString(),
        pickup_end_time: pickupEnd.toISOString(),
        status: quantity > 0 ? 'active' : 'sold_out',
      };
      if (description) fields.description = description;
      if (embedding) fields.description_embedding = embedding;

      if (existing) {
        Object.assign(existing, fields);
        syncStatus(existing);
        touch(existing);
        return { bag: publicBag(existing), created: false };
      }
      const id = randomUUID();
      const bag = {
        id,
        merchant_id: merchantId,
        description: description ?? null,
        description_embedding: embedding,
        created_at: nowIso(),
        updated_at: nowIso(),
        ...fields,
      };
      syncStatus(bag);
      bags.set(id, bag);
      return { bag: publicBag(bag), created: true };
    },

    async markMerchantBagsSoldOut(merchantId) {
      const current = now();
      let count = 0;
      for (const bag of bags.values()) {
        if (bag.merchant_id === merchantId && bag.status === 'active' && new Date(bag.pickup_end_time) > current) {
          bag.quantity_available = 0;
          bag.status = 'sold_out';
          touch(bag);
          count += 1;
        }
      }
      return count;
    },

    async runHousekeeping({ pendingTimeoutMinutes = 30 } = {}) {
      const current = now();
      let expiredBags = 0;
      let cancelledOrders = 0;
      for (const bag of bags.values()) {
        if (['active', 'sold_out'].includes(bag.status) && new Date(bag.pickup_end_time) < current) {
          bag.status = 'expired';
          touch(bag);
          expiredBags += 1;
        }
      }
      const cutoff = current.getTime() - pendingTimeoutMinutes * 60 * 1000;
      for (const order of orders.values()) {
        if (order.status === 'pending_payment' && new Date(order.created_at).getTime() < cutoff) {
          order.status = 'cancelled';
          order.cancelled_at = nowIso();
          touch(order);
          cancelledOrders += 1;
        }
      }
      return { expired_bags: expiredBags, cancelled_orders: cancelledOrders };
    },
  };
}
