import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { parseUgxAmount, splitPayment } from '../lib/money.js';
import { detectNetwork, normalizeUgandanPhone } from '../lib/phone.js';
import { kampalaParts, kampalaTimeToday, parseClockTime } from '../lib/time.js';
import { extractToken, parseMerchantMessage } from '../services/messageParser.js';
import { verifyFlutterwaveSignature } from '../services/flutterwave.js';
import { verifyMetaSignature } from '../services/whatsappClient.js';

test('splitPayment gives 30% to the platform and 70% to the merchant in whole UGX', () => {
  assert.deepEqual(splitPayment(7000), { amount: 7000, platformCommission: 2100, merchantPayoutAmount: 4900 });
  const odd = splitPayment(7001);
  assert.equal(odd.platformCommission + odd.merchantPayoutAmount, 7001);
  assert.throws(() => splitPayment(0), RangeError);
  assert.throws(() => splitPayment(10.5), RangeError);
});

test('parseUgxAmount understands shorthand', () => {
  assert.equal(parseUgxAmount('7000'), 7000);
  assert.equal(parseUgxAmount('7,000'), 7000);
  assert.equal(parseUgxAmount('7k'), 7000);
  assert.equal(parseUgxAmount('7.5k'), 7500);
  assert.equal(parseUgxAmount('abc'), null);
});

test('Ugandan phone numbers normalise to 256XXXXXXXXX and map to a network', () => {
  assert.equal(normalizeUgandanPhone('0772 123 456'), '256772123456');
  assert.equal(normalizeUgandanPhone('+256 772-123-456'), '256772123456');
  assert.equal(normalizeUgandanPhone('772123456'), '256772123456');
  assert.equal(normalizeUgandanPhone('12345'), null);
  assert.equal(detectNetwork('0772123456'), 'MTN');
  assert.equal(detectNetwork('0701123456'), 'AIRTEL');
  assert.equal(detectNetwork('0751123456'), 'AIRTEL');
  assert.equal(detectNetwork('0712123456'), null);
});

test('Kampala time helpers are UTC+3', () => {
  const d = kampalaTimeToday(18, 30, new Date('2026-03-10T09:00:00Z'));
  assert.equal(d.toISOString(), '2026-03-10T15:30:00.000Z');
  assert.equal(kampalaParts(new Date('2026-03-10T22:30:00Z')).day, 11);
  assert.deepEqual(parseClockTime('6pm'), { hour: 18, minute: 0 });
  assert.deepEqual(parseClockTime('18:45'), { hour: 18, minute: 45 });
  assert.equal(parseClockTime('25:00'), null);
});

test('extractToken finds 6-digit pickup codes', () => {
  assert.equal(extractToken('Token 482910'), '482910');
  assert.equal(extractToken('token: 482 910'), '482910');
  assert.equal(extractToken('482910'), '482910');
  assert.equal(extractToken('Customer here with code 482-910'), '482910');
  assert.equal(extractToken('Listed 5 bags today at 7000 UGX'), null);
  assert.equal(extractToken('Token 4829101'), null);
});

test('rule parser reads the canonical listing message', () => {
  const parsed = parseMerchantMessage('Listed 5 bags today at 7000 UGX');
  assert.equal(parsed.intent, 'list_bags');
  assert.equal(parsed.quantity, 5);
  assert.equal(parsed.discount_price, 7000);
  assert.equal(parsed.original_price, null);
});

test('rule parser reads titles, original prices, shorthand and windows', () => {
  const parsed = parseMerchantMessage('8 bags of bread at 5k, was 15k, pickup 6-8pm');
  assert.equal(parsed.intent, 'list_bags');
  assert.equal(parsed.quantity, 8);
  assert.equal(parsed.discount_price, 5000);
  assert.equal(parsed.original_price, 15000);
  assert.equal(parsed.title, 'Bread Bag');
  assert.equal(parsed.pickup_start, '18:00');
  assert.equal(parsed.pickup_end, '20:00');

  const shs = parseMerchantMessage('We have 3 boxes for shs 12,000 from 17:30 to 19:00');
  assert.equal(shs.quantity, 3);
  assert.equal(shs.discount_price, 12000);
  assert.equal(shs.pickup_start, '17:30');
  assert.equal(shs.pickup_end, '19:00');
});

test('rule parser recognises the other intents', () => {
  assert.equal(parseMerchantMessage('Token 482910').intent, 'redeem_token');
  assert.equal(parseMerchantMessage('All sold out!').intent, 'mark_sold_out');
  assert.equal(parseMerchantMessage('status').intent, 'status');
  assert.equal(parseMerchantMessage('hello').intent, 'help');
  assert.equal(parseMerchantMessage('what is the weather').intent, 'unknown');
});

test('Flutterwave webhook signatures are verified', () => {
  const rawBody = Buffer.from('{"event":"charge.completed"}');
  assert.ok(verifyFlutterwaveSignature({ rawBody, headers: { 'verif-hash': 'secret' }, secretHash: 'secret' }));
  assert.ok(!verifyFlutterwaveSignature({ rawBody, headers: { 'verif-hash': 'nope' }, secretHash: 'secret' }));
  const hmac = createHmac('sha256', 'secret').update(rawBody).digest('base64');
  assert.ok(verifyFlutterwaveSignature({ rawBody, headers: { 'flutterwave-signature': hmac }, secretHash: 'secret' }));
  assert.ok(!verifyFlutterwaveSignature({ rawBody, headers: {}, secretHash: 'secret' }));
});

test('Meta webhook signatures are verified', () => {
  const rawBody = Buffer.from('{"entry":[]}');
  const sig = `sha256=${createHmac('sha256', 'app-secret').update(rawBody).digest('hex')}`;
  assert.ok(verifyMetaSignature({ rawBody, signatureHeader: sig, appSecret: 'app-secret' }));
  assert.ok(!verifyMetaSignature({ rawBody, signatureHeader: 'sha256=00', appSecret: 'app-secret' }));
});
