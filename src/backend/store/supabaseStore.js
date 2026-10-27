import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { HttpError, conflict, notFound } from '../lib/errors.js';

const MERCHANT_PUBLIC = 'id,name,district,address,latitude,longitude';
const BAG_COLUMNS =
  'id,merchant_id,title,description,original_price,discount_price,quantity_available,pickup_start_time,pickup_end_time,status,created_at,updated_at';
const ORDER_COLUMNS = `*,bag:surplus_bags(id,title,description,pickup_start_time,pickup_end_time,discount_price,original_price),merchant:merchants(${MERCHANT_PUBLIC})`;

function raise(error, context) {
  if (!error) return;
  if (error.code === 'P0001') throw conflict(error.message);
  if (error.code === 'P0002') throw notFound(error.message);
  throw new HttpError(500, `Database error while ${context}`, { code: error.code, message: error.message });
}

/**
 * Supabase-backed data layer. Uses the service role key, so it bypasses
 * RLS; every user-scoped query below filters by the authenticated user
 * explicitly, and money/stock transitions go through the security-definer
 * Postgres functions defined in the migration.
 */
export function createSupabaseStore({ url, serviceRoleKey, client } = {}) {
  const supabase =
    client ??
    createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const getOrderBy = async (column, value) => {
    const { data, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq(column, value).maybeSingle();
    raise(error, 'loading order');
    return data;
  };

  return {
    kind: 'supabase',
    client: supabase,

    async verifyAccessToken(accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null, phone: data.user.phone ?? null };
    },

    async ensureProfile({ id, fullName = null, phoneNumber = null }) {
      const { data: existing, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      raise(error, 'loading profile');
      if (existing) return existing;
      const { data, error: insertError } = await supabase
        .from('profiles')
        .upsert({ id, full_name: fullName, phone_number: phoneNumber }, { onConflict: 'id', ignoreDuplicates: true })
        .select('*')
        .maybeSingle();
      raise(insertError, 'creating profile');
      return data;
    },

    async listMerchants() {
      const { data, error } = await supabase.from('merchants').select(MERCHANT_PUBLIC).eq('is_active', true).order('name');
      raise(error, 'listing merchants');
      return data;
    },

    async listMerchantContacts() {
      const { data, error } = await supabase
        .from('merchants')
        .select(`${MERCHANT_PUBLIC},momo_payout_number`)
        .eq('is_active', true)
        .order('name');
      raise(error, 'listing merchant contacts');
      return data.map(({ momo_payout_number: phone, ...merchant }) => ({ ...merchant, phone }));
    },

    async listBags({ district } = {}) {
      let query = supabase
        .from('surplus_bags')
        .select(`${BAG_COLUMNS},merchant:merchants!inner(${MERCHANT_PUBLIC},is_active)`)
        .in('status', ['active', 'sold_out'])
        .gt('pickup_end_time', new Date().toISOString())
        .eq('merchant.is_active', true)
        .order('pickup_start_time', { ascending: true })
        .limit(500);
      if (district) query = query.eq('merchant.district', district);
      const { data, error } = await query;
      raise(error, 'listing bags');
      return data.map(({ merchant: { is_active: _active, ...merchant }, ...bag }) => ({ ...bag, merchant }));
    },

    async getBag(id) {
      const { data, error } = await supabase
        .from('surplus_bags')
        .select(`${BAG_COLUMNS},merchant:merchants(${MERCHANT_PUBLIC})`)
        .eq('id', id)
        .maybeSingle();
      raise(error, 'loading bag');
      return data;
    },

    async createOrder({ id = randomUUID(), customerId, bagId, quantity, payerPhone, paymentNetwork, txRef }) {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          id,
          customer_id: customerId,
          bag_id: bagId,
          quantity,
          payer_phone: payerPhone,
          payment_network: paymentNetwork,
          flw_transaction_ref: txRef,
        })
        .select(ORDER_COLUMNS)
        .single();
      raise(error, 'creating order');
      return data;
    },

    getOrder: (id) => getOrderBy('id', id),

    getOrderByTxRef: (txRef) => getOrderBy('flw_transaction_ref', txRef),

    async listOrdersForCustomer(customerId) {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);
      raise(error, 'listing orders');
      return data;
    },

    async cancelPendingOrder(id) {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending_payment');
      raise(error, 'cancelling order');
      const order = await getOrderBy('id', id);
      if (!order) throw notFound('Order not found');
      return order;
    },

    async confirmPayment({ orderId, flwTransactionId, amount }) {
      const { data, error } = await supabase.rpc('confirm_order_payment', {
        p_order_id: orderId,
        p_flw_transaction_id: String(flwTransactionId),
        p_amount: amount,
      });
      raise(error, 'confirming payment');
      return data[0];
    },

    async markOrderRefunded(orderId) {
      const { error } = await supabase.from('orders').update({ status: 'refunded' }).eq('id', orderId);
      raise(error, 'marking order refunded');
      return getOrderBy('id', orderId);
    },

    async redeemPickupToken({ merchantId, token }) {
      const { data, error } = await supabase.rpc('redeem_pickup_token', { p_merchant_id: merchantId, p_token: token });
      raise(error, 'redeeming pickup token');
      return data[0];
    },

    async findMerchantForPhone(phone) {
      const { data: staff, error } = await supabase
        .from('profiles')
        .select('merchant:merchants(*)')
        .eq('phone_number', phone)
        .eq('role', 'merchant_staff')
        .maybeSingle();
      raise(error, 'looking up merchant staff');
      if (staff?.merchant?.is_active) return staff.merchant;

      const { data: merchants, error: merchantError } = await supabase
        .from('merchants')
        .select('*')
        .eq('momo_payout_number', phone)
        .eq('is_active', true)
        .limit(1);
      raise(merchantError, 'looking up merchant');
      return merchants[0] ?? null;
    },

    async listMerchantBagsToday(merchantId) {
      const { data, error } = await supabase
        .from('surplus_bags')
        .select(BAG_COLUMNS)
        .eq('merchant_id', merchantId)
        .neq('status', 'expired')
        .gt('pickup_end_time', new Date().toISOString())
        .order('pickup_start_time');
      raise(error, 'listing merchant bags');
      return data;
    },

    async countMerchantOrders(merchantId, sinceIso) {
      const { data, error } = await supabase
        .from('orders')
        .select('status,merchant_payout_amount')
        .eq('merchant_id', merchantId)
        .in('status', ['paid', 'collected'])
        .gte('created_at', sinceIso);
      raise(error, 'counting merchant orders');
      return {
        paid: data.filter((o) => o.status === 'paid').length,
        collected: data.filter((o) => o.status === 'collected').length,
        payout: data.reduce((sum, o) => sum + o.merchant_payout_amount, 0),
      };
    },

    async upsertTodayBag({ merchantId, title, description = null, quantity, discountPrice, originalPrice, pickupStart, pickupEnd, embedding = null }) {
      const { data: existing, error } = await supabase
        .from('surplus_bags')
        .select('id')
        .eq('merchant_id', merchantId)
        .neq('status', 'expired')
        .gt('pickup_end_time', new Date().toISOString())
        .ilike('title', title.replace(/[%_]/g, '\\$&'))
        .limit(1);
      raise(error, 'finding existing bag');

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

      if (existing.length) {
        const { data, error: updateError } = await supabase
          .from('surplus_bags')
          .update(fields)
          .eq('id', existing[0].id)
          .select(`${BAG_COLUMNS},merchant:merchants(${MERCHANT_PUBLIC})`)
          .single();
        raise(updateError, 'updating bag');
        return { bag: data, created: false };
      }

      const { data, error: insertError } = await supabase
        .from('surplus_bags')
        .insert({ merchant_id: merchantId, ...fields })
        .select(`${BAG_COLUMNS},merchant:merchants(${MERCHANT_PUBLIC})`)
        .single();
      raise(insertError, 'creating bag');
      return { bag: data, created: true };
    },

    async markMerchantBagsSoldOut(merchantId) {
      const { data, error } = await supabase
        .from('surplus_bags')
        .update({ quantity_available: 0, status: 'sold_out' })
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .gt('pickup_end_time', new Date().toISOString())
        .select('id');
      raise(error, 'marking bags sold out');
      return data.length;
    },

    async runHousekeeping({ pendingTimeoutMinutes = 30 } = {}) {
      const { data, error } = await supabase.rpc('run_housekeeping', {
        p_pending_timeout: `${pendingTimeoutMinutes} minutes`,
      });
      raise(error, 'running housekeeping');
      return data[0];
    },
  };
}
