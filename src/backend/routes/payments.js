import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { presentOrder } from '../lib/present.js';

export function createPaymentsRouter({ paymentService, requireUser, logger }) {
  const router = Router();

  /**
   * POST /api/payments/stk-push
   * Body: { bagId, quantity, phone, network? }
   * Creates a pending order priced server-side and sends an MTN MoMo /
   * Airtel Money approval prompt to the customer's phone via Flutterwave.
   */
  router.post(
    '/stk-push',
    requireUser,
    asyncHandler(async (req, res) => {
      const { bagId, quantity, phone, network } = req.body ?? {};
      if (!bagId || typeof bagId !== 'string') throw badRequest('bagId is required');
      if (!phone) throw badRequest('phone is required');

      const { order, payment } = await paymentService.initiateStkPush({
        user: req.user,
        bagId,
        quantity: quantity ?? 1,
        phone,
        network,
      });
      res.status(201).json({ order: presentOrder(order), payment });
    }),
  );

  /**
   * POST /api/payments/webhook
   * Flutterwave charge.completed webhook. The signature is checked against
   * the raw body, the transaction is re-verified with Flutterwave, and the
   * order is confirmed atomically (stock decrement, 30/70 split, token).
   */
  router.post('/webhook', async (req, res) => {
    try {
      const result = await paymentService.handleWebhook({ rawBody: req.rawBody, headers: req.headers });
      res.status(200).json(result);
    } catch (error) {
      if (error.status === 401 || error.status === 400) {
        logger.warn('Rejected payment webhook', { reason: error.message });
        return res.status(error.status).json({ error: error.message });
      }
      logger.error('Payment webhook processing failed', error);
      // Non-2xx makes Flutterwave retry; confirmation is idempotent.
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  return router;
}
