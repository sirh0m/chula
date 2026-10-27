import { createHmac, timingSafeEqual } from 'node:crypto';
import { badGateway, notFound } from '../lib/errors.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Flutterwave sends the dashboard "secret hash" verbatim in `verif-hash`.
 * Newer webhook versions instead send `flutterwave-signature`, a base64
 * HMAC-SHA256 of the raw body keyed with the same secret hash.
 */
export function verifyFlutterwaveSignature({ rawBody, headers, secretHash }) {
  if (!secretHash || !rawBody) return false;
  const verifHash = headers['verif-hash'];
  if (verifHash) return safeEqual(verifHash, secretHash);
  const signature = headers['flutterwave-signature'];
  if (signature) {
    const expected = createHmac('sha256', secretHash).update(rawBody).digest('base64');
    return safeEqual(signature, expected);
  }
  return false;
}

export function createFlutterwaveClient({ secretKey, baseUrl, redirectUrl, fetchImpl = fetch, logger }) {
  async function request(method, path, body) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      logger.error('Flutterwave request failed', { path, error: error.message });
      throw badGateway('Could not reach the Mobile Money provider. Please try again.');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.status !== 'success') {
      logger.warn('Flutterwave returned an error', { path, status: response.status, message: json.message });
      throw badGateway(json.message || `Mobile Money provider returned HTTP ${response.status}`);
    }
    return json;
  }

  return {
    kind: 'flutterwave',

    async initiateMobileMoneyCharge({ txRef, amount, phone, network, email, fullName, orderId }) {
      const json = await request('POST', '/charges?type=mobile_money_uganda', {
        tx_ref: txRef,
        amount,
        currency: 'UGX',
        network,
        email,
        phone_number: phone,
        fullname: fullName || 'Chula customer',
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
        meta: { order_id: orderId, source: 'chula' },
      });
      return {
        status: 'pending',
        providerRef: json.data?.flw_ref ?? null,
        // Some Uganda charges require the customer to authorise on a hosted page.
        redirectUrl: json.meta?.authorization?.redirect ?? null,
        message: json.message || 'Approve the payment prompt on your phone',
      };
    },

    async verifyTransaction(transactionId) {
      const json = await request('GET', `/transactions/${encodeURIComponent(transactionId)}/verify`);
      return json.data;
    },

    async refundTransaction(transactionId, amount) {
      const json = await request('POST', `/transactions/${encodeURIComponent(transactionId)}/refund`, { amount });
      return json.data;
    },
  };
}

/**
 * Local stand-in for Flutterwave used when FLUTTERWAVE_SECRET_KEY is unset.
 * It behaves like the real flow: the charge is "approved" after a delay and
 * a signed charge.completed webhook is delivered to the same handler that
 * production traffic uses. Numbers ending in 0000 simulate a declined prompt.
 */
export function createSimulatedMobileMoney({ delayMs, secretHash, logger }) {
  const transactions = new Map();
  let deliver = null;
  let nextId = 7_000_000 + Math.floor(Math.random() * 1_000_000);

  return {
    kind: 'simulated',

    setWebhookDeliverer(fn) {
      deliver = fn;
    },

    async initiateMobileMoneyCharge({ txRef, amount, phone, network, email, fullName }) {
      const id = nextId++;
      const declined = phone.endsWith('0000');
      const transaction = {
        id,
        tx_ref: txRef,
        flw_ref: `CHULA-SIM-${id}`,
        amount,
        charged_amount: amount,
        currency: 'UGX',
        status: declined ? 'failed' : 'successful',
        payment_type: 'mobilemoneyuganda',
        network,
        created_at: new Date().toISOString(),
        customer: { phone_number: phone, email, name: fullName },
      };
      transactions.set(String(id), transaction);

      const timer = setTimeout(async () => {
        const rawBody = Buffer.from(JSON.stringify({ event: 'charge.completed', data: transaction }));
        try {
          await deliver?.({ rawBody, headers: { 'verif-hash': secretHash, 'content-type': 'application/json' } });
        } catch (error) {
          logger.error('Simulated webhook delivery failed', { txRef, error: error.message });
        }
      }, delayMs);
      timer.unref?.();

      logger.info('Simulated Mobile Money prompt sent', { txRef, network, amount, declined });
      return {
        status: 'pending',
        providerRef: transaction.flw_ref,
        redirectUrl: null,
        message: `Demo mode: the ${network === 'MTN' ? 'MTN MoMo' : 'Airtel Money'} prompt will auto-${declined ? 'decline' : 'approve'} in ${Math.round(delayMs / 1000)}s`,
      };
    },

    async verifyTransaction(transactionId) {
      const transaction = transactions.get(String(transactionId));
      if (!transaction) throw notFound(`Transaction ${transactionId} not found`);
      return transaction;
    },

    async refundTransaction(transactionId, amount) {
      const transaction = transactions.get(String(transactionId));
      if (!transaction) throw notFound(`Transaction ${transactionId} not found`);
      transaction.refunded = amount;
      return { status: 'completed', amount_refunded: amount };
    },
  };
}
