import { randomUUID } from 'node:crypto';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { splitPayment } from '../lib/money.js';
import { detectNetwork, normalizeUgandanPhone } from '../lib/phone.js';
import { verifyFlutterwaveSignature } from './flutterwave.js';

const MAX_QUANTITY = 5;

export function createPaymentService({ store, provider, config, logger }) {
  async function initiateStkPush({ user, bagId, quantity = 1, phone, network }) {
    const payerPhone = normalizeUgandanPhone(phone);
    if (!payerPhone) throw badRequest('Enter a valid Ugandan mobile number, e.g. 0772 123 456');

    const resolvedNetwork = (network || detectNetwork(payerPhone) || '').toUpperCase();
    if (!['MTN', 'AIRTEL'].includes(resolvedNetwork)) {
      throw badRequest('Choose MTN Mobile Money or Airtel Money for this number');
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
      throw badRequest(`You can reserve between 1 and ${MAX_QUANTITY} bags per order`);
    }

    const bag = await store.getBag(bagId);
    if (!bag) throw notFound('That bag no longer exists');

    await store.ensureProfile({ id: user.id, fullName: user.fullName ?? null });

    const orderId = randomUUID();
    const txRef = `CHULA-${orderId}`;
    const order = await store.createOrder({
      id: orderId,
      customerId: user.id,
      bagId,
      quantity: qty,
      payerPhone,
      paymentNetwork: resolvedNetwork,
      txRef,
    });

    let payment;
    try {
      payment = await provider.initiateMobileMoneyCharge({
        txRef,
        amount: order.amount_paid,
        phone: payerPhone,
        network: resolvedNetwork,
        email: user.email || `${payerPhone}@customers.chula.ug`,
        fullName: user.fullName,
        orderId,
      });
    } catch (error) {
      await store.cancelPendingOrder(orderId).catch((cancelError) =>
        logger.error('Failed to cancel order after STK push error', { orderId, error: cancelError.message }),
      );
      throw error;
    }

    logger.info('STK push initiated', { orderId, txRef, amount: order.amount_paid, network: resolvedNetwork });
    return { order, payment };
  }

  async function handleWebhook({ rawBody, headers }) {
    if (!verifyFlutterwaveSignature({ rawBody, headers, secretHash: config.flutterwave.secretHash })) {
      throw unauthorized('Invalid webhook signature');
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw badRequest('Webhook body is not valid JSON');
    }

    const event = payload.event ?? payload.type ?? null;
    const data = payload.data ?? payload;
    if (event && event !== 'charge.completed') {
      return { handled: false, reason: 'ignored_event', event };
    }

    const txRef = data.tx_ref ?? data.txRef;
    const transactionId = data.id;
    if (!txRef || !transactionId) return { handled: false, reason: 'missing_reference' };

    const order = await store.getOrderByTxRef(txRef);
    if (!order) {
      logger.warn('Webhook for unknown order', { txRef });
      return { handled: false, reason: 'unknown_order' };
    }

    // The webhook body is only a hint: re-fetch the transaction from the provider.
    const transaction = await provider.verifyTransaction(transactionId);
    if (transaction.tx_ref !== txRef) {
      logger.warn('Webhook transaction reference mismatch', { txRef, verified: transaction.tx_ref });
      return { handled: false, reason: 'tx_ref_mismatch' };
    }

    if (transaction.status !== 'successful') {
      if (order.status === 'pending_payment') await store.cancelPendingOrder(order.id);
      logger.info('Payment not successful; order cancelled', { orderId: order.id, status: transaction.status });
      return { handled: true, orderId: order.id, status: 'cancelled', reason: `payment_${transaction.status}` };
    }

    if (transaction.currency !== 'UGX') {
      logger.error('Payment in unexpected currency', { orderId: order.id, currency: transaction.currency });
      return { handled: false, reason: 'currency_mismatch' };
    }

    const paidAmount = Math.round(Number(transaction.amount));
    if (!(paidAmount >= order.amount_paid)) {
      logger.error('Underpayment received', { orderId: order.id, expected: order.amount_paid, paid: paidAmount });
      return { handled: false, reason: 'amount_mismatch' };
    }

    const result = await store.confirmPayment({
      orderId: order.id,
      flwTransactionId: String(transaction.id),
      amount: paidAmount,
    });

    if (result.needs_refund) {
      logger.warn('Stock ran out before payment cleared; refunding', { orderId: order.id });
      try {
        await provider.refundTransaction(transaction.id, paidAmount);
        await store.markOrderRefunded(order.id);
        return { handled: true, orderId: order.id, status: 'refunded' };
      } catch (error) {
        logger.error('Automatic refund failed; manual refund required', { orderId: order.id, error: error.message });
        return { handled: true, orderId: order.id, status: 'cancelled', reason: 'refund_failed' };
      }
    }

    const split = splitPayment(order.amount_paid);
    logger.info('Order paid', {
      orderId: order.id,
      status: result.status,
      amount: split.amount,
      platformCommission: split.platformCommission,
      merchantPayout: split.merchantPayoutAmount,
    });
    return { handled: true, orderId: order.id, status: result.status, split };
  }

  return { initiateStkPush, handleWebhook };
}
