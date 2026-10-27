import { Router } from 'express';
import { asyncHandler, conflict, notFound } from '../lib/errors.js';
import { presentOrder } from '../lib/present.js';

export function createOrdersRouter({ store, requireUser }) {
  const router = Router();
  router.use(requireUser);

  const loadOwnOrder = async (req) => {
    const order = await store.getOrder(req.params.id);
    // Same response for "missing" and "not yours" so order ids can't be probed.
    if (!order || order.customer_id !== req.user.id) throw notFound('Order not found');
    return order;
  };

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const orders = await store.listOrdersForCustomer(req.user.id);
      res.set('Cache-Control', 'no-store').json({ orders: orders.map(presentOrder) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const order = await loadOwnOrder(req);
      res.set('Cache-Control', 'no-store').json({ order: presentOrder(order) });
    }),
  );

  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      const order = await loadOwnOrder(req);
      if (order.status !== 'pending_payment') {
        throw conflict('Only orders awaiting payment can be cancelled');
      }
      const updated = await store.cancelPendingOrder(order.id);
      res.json({ order: presentOrder(updated) });
    }),
  );

  return router;
}
