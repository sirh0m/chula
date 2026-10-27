/** Shape an order for the customer app (never leaks payout or provider internals). */
export function presentOrder(order) {
  if (!order) return null;
  const showToken = ['paid', 'collected'].includes(order.status);
  return {
    id: order.id,
    status: order.status,
    quantity: order.quantity,
    amount_paid: order.amount_paid,
    pickup_token: showToken ? order.pickup_token : null,
    payment_network: order.payment_network,
    payer_phone: order.payer_phone,
    created_at: order.created_at,
    paid_at: order.paid_at,
    collected_at: order.collected_at,
    cancelled_at: order.cancelled_at,
    bag: order.bag,
    merchant: order.merchant,
  };
}
