import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { createApp } from '../server.js';
import { createSimulatedMobileMoney } from '../services/flutterwave.js';
import { createMemoryStore } from '../store/memoryStore.js';

const config = loadConfig({
  NODE_ENV: 'test',
  SIMULATED_PAYMENT_DELAY_MS: '20',
  ENABLE_WHATSAPP_SIMULATOR: 'true',
});
const logger = createLogger('silent');

let server;
let baseUrl;
let store;
const customer = randomUUID();
const MERCHANT_PHONE = '256772100101'; // Mama Rose Bakery (seed)

const api = async (path, { method = 'GET', body, user = customer, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { 'X-Chula-Demo-User': user } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const waitFor = async (fn, timeoutMs = 2000) => {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 15));
  }
};

before(async () => {
  store = createMemoryStore();
  const provider = createSimulatedMobileMoney({ delayMs: 20, secretHash: config.flutterwave.secretHash, logger });
  const { app } = createApp({ config, logger, store, provider, embedder: null });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('health reports demo modes', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body.modes, { data: 'memory', payments: 'simulated', ai: 'rules', whatsapp: 'log-only' });
});

test('bags list includes active and sold-out bags with public merchant info only', async () => {
  const { body } = await api('/api/bags');
  assert.ok(body.bags.length >= 8);
  assert.ok(body.bags.some((b) => b.status === 'sold_out'));
  assert.ok(body.bags.every((b) => b.merchant && b.merchant.momo_payout_number === undefined));
  const ntinda = await api('/api/bags?district=Ntinda');
  assert.ok(ntinda.body.bags.every((b) => b.merchant.district === 'Ntinda'));
  assert.equal((await api('/api/bags?district=Gulu')).status, 400);
});

test('checkout requires a session and a valid phone', async () => {
  const { body: { bags } } = await api('/api/bags');
  const bag = bags.find((b) => b.status === 'active');
  assert.equal((await api('/api/payments/stk-push', { method: 'POST', user: null, body: { bagId: bag.id, phone: '0772123456' } })).status, 401);
  assert.equal((await api('/api/payments/stk-push', { method: 'POST', body: { bagId: bag.id, phone: '123' } })).status, 400);
  const sold = bags.find((b) => b.status === 'sold_out');
  assert.equal((await api('/api/payments/stk-push', { method: 'POST', body: { bagId: sold.id, phone: '0772123456' } })).status, 409);
});

let paidOrder;

test('STK push -> signed webhook -> paid order with 30/70 split and 6-digit token', async () => {
  const { body: { bags } } = await api('/api/bags');
  const bag = bags.find((b) => b.merchant.name === 'Mama Rose Bakery');
  const before = bag.quantity_available;

  const push = await api('/api/payments/stk-push', {
    method: 'POST',
    body: { bagId: bag.id, quantity: 2, phone: '0772 555 111' },
  });
  assert.equal(push.status, 201);
  assert.equal(push.body.order.status, 'pending_payment');
  assert.equal(push.body.order.amount_paid, bag.discount_price * 2);
  assert.equal(push.body.order.payment_network, 'MTN');
  assert.equal(push.body.order.pickup_token, null);

  const order = await waitFor(async () => {
    const { body } = await api(`/api/orders/${push.body.order.id}`);
    return body.order.status === 'paid' ? body.order : null;
  });
  assert.match(order.pickup_token, /^\d{6}$/);

  const internal = await store.getOrder(order.id);
  assert.equal(internal.platform_commission, Math.round(internal.amount_paid * 0.3));
  assert.equal(internal.platform_commission + internal.merchant_payout_amount, internal.amount_paid);

  const after = (await api(`/api/bags/${bag.id}`)).body.bag;
  assert.equal(after.quantity_available, before - 2);

  const otherUser = await api(`/api/orders/${order.id}`, { user: randomUUID() });
  assert.equal(otherUser.status, 404);
  paidOrder = order;
});

test('declined Mobile Money prompts cancel the order', async () => {
  const { body: { bags } } = await api('/api/bags');
  const bag = bags.find((b) => b.status === 'active' && b.quantity_available > 0);
  const push = await api('/api/payments/stk-push', { method: 'POST', body: { bagId: bag.id, phone: '0772110000' } });
  const order = await waitFor(async () => {
    const { body } = await api(`/api/orders/${push.body.order.id}`);
    return body.order.status === 'cancelled' ? body.order : null;
  });
  assert.equal(order.pickup_token, null);
});

test('webhook rejects bad signatures and replays are idempotent', async () => {
  const bad = await api('/api/payments/webhook', {
    method: 'POST',
    user: null,
    headers: { 'verif-hash': 'wrong' },
    body: { event: 'charge.completed', data: { id: 1, tx_ref: 'x' } },
  });
  assert.equal(bad.status, 401);

  const internal = await store.getOrder(paidOrder.id);
  const replay = await api('/api/payments/webhook', {
    method: 'POST',
    user: null,
    headers: { 'verif-hash': config.flutterwave.secretHash },
    body: { event: 'charge.completed', data: { id: internal.flw_transaction_id, tx_ref: internal.flw_transaction_ref } },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'paid');
  const again = await store.getOrder(paidOrder.id);
  assert.equal(again.pickup_token, internal.pickup_token);
});

test('WhatsApp agent lists bags from a merchant message', async () => {
  const res = await api('/api/whatsapp/simulate', {
    method: 'POST',
    user: null,
    body: { from: MERCHANT_PHONE, text: 'Listed 5 bags of rolex at 7000 UGX' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.intent, 'list_bags');
  assert.match(res.body.reply, /5 x Rolex Bag/);
  const { body: { bags } } = await api('/api/bags');
  const listed = bags.find((b) => b.title === 'Rolex Bag');
  assert.equal(listed.quantity_available, 5);
  assert.equal(listed.discount_price, 7000);
  assert.equal(listed.status, 'active');
});

test('WhatsApp agent redeems tokens only once and only for the right store', async () => {
  const wrongStore = await api('/api/whatsapp/simulate', {
    method: 'POST',
    user: null,
    body: { from: '256701100202', text: `Token ${paidOrder.pickup_token}` },
  });
  assert.equal(wrongStore.body.intent, 'redeem_token');
  assert.match(wrongStore.body.reply, /No paid order/);

  const ok = await api('/api/whatsapp/simulate', {
    method: 'POST',
    user: null,
    body: { from: MERCHANT_PHONE, text: `Token ${paidOrder.pickup_token}` },
  });
  assert.match(ok.body.reply, /verified/);
  const { body } = await api(`/api/orders/${paidOrder.id}`);
  assert.equal(body.order.status, 'collected');

  const twice = await api('/api/whatsapp/simulate', {
    method: 'POST',
    user: null,
    body: { from: MERCHANT_PHONE, text: `Token ${paidOrder.pickup_token}` },
  });
  assert.match(twice.body.reply, /already collected/);
});

test('unknown numbers are told they are not linked to a store', async () => {
  const res = await api('/api/whatsapp/simulate', {
    method: 'POST',
    user: null,
    body: { from: '256779999999', text: 'Listed 5 bags' },
  });
  assert.equal(res.body.intent, 'unregistered');
});

test('WhatsApp webhook verification handshake', async () => {
  const ok = await fetch(`${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${config.whatsapp.verifyToken}&hub.challenge=abc123`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'abc123');
  const bad = await fetch(`${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`);
  assert.equal(bad.status, 403);
});
