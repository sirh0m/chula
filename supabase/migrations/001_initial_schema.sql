-- =====================================================================
-- Chula: food surplus marketplace for Kampala
-- 001_initial_schema.sql
--
-- Money is stored as whole Uganda Shillings (UGX has no minor unit).
-- All timestamps are timestamptz; Kampala is UTC+3 (EAT) year-round.
-- =====================================================================

create schema if not exists extensions;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('customer', 'merchant_staff', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kampala_district as enum ('Ntinda', 'Kololo', 'Bugolobi', 'Nakasero');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payout_network as enum ('MTN', 'AIRTEL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bag_status as enum ('active', 'sold_out', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending_payment', 'paid', 'collected', 'cancelled', 'refunded');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------
create table if not exists public.merchants (
  id                 uuid primary key default extensions.uuid_generate_v4(),
  name               text not null check (char_length(name) between 2 and 120),
  district           public.kampala_district not null,
  address            text,
  latitude           double precision not null check (latitude between -90 and 90),
  longitude          double precision not null check (longitude between -180 and 180),
  momo_payout_number text not null check (momo_payout_number ~ '^256[0-9]{9}$'),
  payout_network     public.payout_network not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists merchants_district_idx on public.merchants (district) where is_active;
create index if not exists merchants_payout_number_idx on public.merchants (momo_payout_number);

drop trigger if exists merchants_touch_updated_at on public.merchants;
create trigger merchants_touch_updated_at
  before update on public.merchants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  phone_number text unique check (phone_number ~ '^256[0-9]{9}$'),
  role         public.user_role not null default 'customer',
  -- Set for merchant_staff only: the store this staff member operates.
  merchant_id  uuid references public.merchants (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_staff_has_merchant
    check (role <> 'merchant_staff' or merchant_id is not null)
);

create index if not exists profiles_merchant_idx on public.profiles (merchant_id) where merchant_id is not null;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile row whenever a Supabase auth user signs up.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(new.phone, new.raw_user_meta_data ->> 'phone_number', ''), '\D', '', 'g');
begin
  insert into public.profiles (id, full_name, phone_number)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_phone ~ '^256[0-9]{9}$' then v_phone else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Prevent customers from promoting themselves via the profiles update policy.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
     and (new.role is distinct from old.role or new.merchant_id is distinct from old.merchant_id) then
    raise exception 'Only admins can change role or merchant assignment' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ---------------------------------------------------------------------
-- RLS helper functions (security definer to avoid policy recursion)
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_merchant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select merchant_id from public.profiles
  where id = auth.uid() and role = 'merchant_staff';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------
-- surplus_bags
-- ---------------------------------------------------------------------
create table if not exists public.surplus_bags (
  id                   uuid primary key default extensions.uuid_generate_v4(),
  merchant_id          uuid not null references public.merchants (id) on delete cascade,
  title                text not null check (char_length(title) between 2 and 120),
  description          text,
  original_price       integer not null check (original_price > 0),
  discount_price       integer not null check (discount_price > 0),
  quantity_available   integer not null default 0 check (quantity_available >= 0),
  pickup_start_time    timestamptz not null,
  pickup_end_time      timestamptz not null,
  status               public.bag_status not null default 'active',
  -- 768-dim Gemini embedding of title + description, for semantic search.
  description_embedding extensions.vector(768),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint surplus_bags_discount_le_original check (discount_price <= original_price),
  constraint surplus_bags_window_valid check (pickup_end_time > pickup_start_time)
);

create index if not exists surplus_bags_merchant_idx on public.surplus_bags (merchant_id);
create index if not exists surplus_bags_active_idx on public.surplus_bags (status, pickup_end_time);
create index if not exists surplus_bags_embedding_idx
  on public.surplus_bags using hnsw (description_embedding extensions.vector_cosine_ops);

drop trigger if exists surplus_bags_touch_updated_at on public.surplus_bags;
create trigger surplus_bags_touch_updated_at
  before update on public.surplus_bags
  for each row execute function public.touch_updated_at();

-- Keep status consistent with stock when merchants edit quantities directly.
create or replace function public.sync_bag_status()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'expired' then
    if new.quantity_available = 0 then
      new.status := 'sold_out';
    elsif new.status = 'sold_out' and new.quantity_available > 0 then
      new.status := 'active';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists surplus_bags_sync_status on public.surplus_bags;
create trigger surplus_bags_sync_status
  before insert or update of quantity_available, status on public.surplus_bags
  for each row execute function public.sync_bag_status();

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id                     uuid primary key default extensions.uuid_generate_v4(),
  customer_id            uuid not null references public.profiles (id) on delete restrict,
  bag_id                 uuid not null references public.surplus_bags (id) on delete restrict,
  merchant_id            uuid not null references public.merchants (id) on delete restrict,
  quantity               smallint not null default 1 check (quantity between 1 and 5),
  status                 public.order_status not null default 'pending_payment',
  amount_paid            integer not null check (amount_paid > 0),
  platform_commission    integer not null check (platform_commission >= 0),
  merchant_payout_amount integer not null check (merchant_payout_amount >= 0),
  pickup_token           char(6) check (pickup_token ~ '^[0-9]{6}$'),
  flw_transaction_ref    text unique,
  flw_transaction_id     text,
  payer_phone            text check (payer_phone ~ '^256[0-9]{9}$'),
  payment_network        public.payout_network,
  paid_at                timestamptz,
  collected_at           timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint orders_split_balances check (platform_commission + merchant_payout_amount = amount_paid),
  constraint orders_paid_has_token check (status not in ('paid', 'collected') or pickup_token is not null)
);

-- A token must be unambiguous while it can still be redeemed. Collected
-- orders release their code back into the 1,000,000-code space.
create unique index if not exists orders_live_pickup_token_uidx
  on public.orders (pickup_token) where status = 'paid';

create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_merchant_idx on public.orders (merchant_id, status);
create index if not exists orders_bag_idx on public.orders (bag_id);

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- Server-side pricing: clients can never choose their own price or split.
create or replace function public.prepare_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag public.surplus_bags%rowtype;
begin
  select * into v_bag from public.surplus_bags where id = new.bag_id;
  if not found then
    raise exception 'Bag % not found', new.bag_id using errcode = 'P0002';
  end if;
  if v_bag.status <> 'active' or v_bag.pickup_end_time <= now() then
    raise exception 'This bag is no longer available' using errcode = 'P0001';
  end if;
  if new.quantity > v_bag.quantity_available then
    raise exception 'Only % bag(s) left', v_bag.quantity_available using errcode = 'P0001';
  end if;

  new.merchant_id            := v_bag.merchant_id;
  new.amount_paid            := v_bag.discount_price * new.quantity;
  new.platform_commission    := round(new.amount_paid * 0.30)::integer;
  new.merchant_payout_amount := new.amount_paid - new.platform_commission;
  new.status                 := 'pending_payment';
  new.pickup_token           := null;
  new.paid_at                := null;
  new.collected_at           := null;
  return new;
end;
$$;

drop trigger if exists orders_prepare on public.orders;
create trigger orders_prepare
  before insert on public.orders
  for each row execute function public.prepare_order();

-- ---------------------------------------------------------------------
-- Payment confirmation (called by the backend after a verified webhook)
--   * idempotent: replays return the existing result
--   * row-locks the bag so concurrent payments cannot oversell
--   * issues a cryptographically random 6-digit pickup token
-- ---------------------------------------------------------------------
create or replace function public.confirm_order_payment(
  p_order_id           uuid,
  p_flw_transaction_id text,
  p_amount             integer
)
returns table (
  order_id     uuid,
  status       public.order_status,
  pickup_token text,
  needs_refund boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order    public.orders%rowtype;
  v_bag      public.surplus_bags%rowtype;
  v_token    text;
  v_attempts integer := 0;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id using errcode = 'P0002';
  end if;

  if v_order.status <> 'pending_payment' then
    return query select v_order.id, v_order.status, v_order.pickup_token::text, false;
    return;
  end if;

  if p_amount < v_order.amount_paid then
    raise exception 'Paid amount % is less than order total %', p_amount, v_order.amount_paid
      using errcode = 'P0001';
  end if;

  select * into v_bag from public.surplus_bags b where b.id = v_order.bag_id for update;

  if v_bag.quantity_available < v_order.quantity
     or v_bag.status = 'expired'
     or v_bag.pickup_end_time <= now() then
    update public.orders o
       set status = 'cancelled', cancelled_at = now(), flw_transaction_id = p_flw_transaction_id
     where o.id = v_order.id;
    return query select v_order.id, 'cancelled'::public.order_status, null::text, true;
    return;
  end if;

  update public.surplus_bags b
     set quantity_available = b.quantity_available - v_order.quantity
   where b.id = v_bag.id;

  loop
    v_attempts := v_attempts + 1;
    v_token := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    begin
      update public.orders o
         set status = 'paid',
             paid_at = now(),
             pickup_token = v_token,
             flw_transaction_id = p_flw_transaction_id,
             platform_commission = round(v_order.amount_paid * 0.30)::integer,
             merchant_payout_amount = v_order.amount_paid - round(v_order.amount_paid * 0.30)::integer
       where o.id = v_order.id;
      exit;
    exception when unique_violation then
      if v_attempts >= 25 then
        raise exception 'Could not allocate a unique pickup token';
      end if;
    end;
  end loop;

  return query select v_order.id, 'paid'::public.order_status, v_token, false;
end;
$$;

-- ---------------------------------------------------------------------
-- Pickup redemption (called by the WhatsApp agent for merchant staff)
-- ---------------------------------------------------------------------
create or replace function public.redeem_pickup_token(
  p_merchant_id uuid,
  p_token       text
)
returns table (
  outcome       text,
  order_id      uuid,
  quantity      smallint,
  bag_title     text,
  customer_name text,
  collected_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_token !~ '^[0-9]{6}$' then
    return query select 'invalid_format'::text, null::uuid, null::smallint, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_order
    from public.orders o
   where o.merchant_id = p_merchant_id and o.pickup_token = p_token
   order by (o.status = 'paid') desc, o.created_at desc
   limit 1
   for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::smallint, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_order.status = 'collected' then
    return query
      select 'already_collected'::text, v_order.id, v_order.quantity, b.title, p.full_name, v_order.collected_at
        from public.surplus_bags b
        left join public.profiles p on p.id = v_order.customer_id
       where b.id = v_order.bag_id;
    return;
  end if;

  if v_order.status <> 'paid' then
    return query select 'not_paid'::text, v_order.id, v_order.quantity, null::text, null::text, null::timestamptz;
    return;
  end if;

  update public.orders o set status = 'collected', collected_at = now() where o.id = v_order.id;

  return query
    select 'collected'::text, v_order.id, v_order.quantity, b.title, p.full_name, now()
      from public.surplus_bags b
      left join public.profiles p on p.id = v_order.customer_id
     where b.id = v_order.bag_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Housekeeping: expire past bags and abandon stale unpaid orders.
-- Run every few minutes (the backend does this; pg_cron also works).
-- ---------------------------------------------------------------------
create or replace function public.run_housekeeping(p_pending_timeout interval default interval '30 minutes')
returns table (expired_bags integer, cancelled_orders integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bags   integer;
  v_orders integer;
begin
  update public.surplus_bags
     set status = 'expired'
   where status in ('active', 'sold_out') and pickup_end_time < now();
  get diagnostics v_bags = row_count;

  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where status = 'pending_payment' and created_at < now() - p_pending_timeout;
  get diagnostics v_orders = row_count;

  return query select v_bags, v_orders;
end;
$$;

-- Semantic bag search over Gemini embeddings.
create or replace function public.match_surplus_bags(
  p_query_embedding extensions.vector(768),
  p_match_count     integer default 10
)
returns table (bag_id uuid, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select b.id, 1 - (b.description_embedding <=> p_query_embedding)
    from public.surplus_bags b
   where b.status = 'active' and b.description_embedding is not null
   order by b.description_embedding <=> p_query_embedding
   limit least(greatest(p_match_count, 1), 50);
$$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke all on function public.confirm_order_payment(uuid, text, integer) from public;
revoke all on function public.redeem_pickup_token(uuid, text) from public;
revoke all on function public.run_housekeeping(interval) from public;

-- Supabase's default privileges grant EXECUTE to anon/authenticated
-- explicitly, so revoking from PUBLIC alone is not enough.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.confirm_order_payment(uuid, text, integer) from anon, authenticated;
    revoke execute on function public.redeem_pickup_token(uuid, text) from anon, authenticated;
    revoke execute on function public.run_housekeeping(interval) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.confirm_order_payment(uuid, text, integer) to service_role;
    grant execute on function public.redeem_pickup_token(uuid, text) to service_role;
    grant execute on function public.run_housekeeping(interval) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.merchants    enable row level security;
alter table public.surplus_bags enable row level security;
alter table public.orders       enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- merchants -----------------------------------------------------------
drop policy if exists "merchants: public read active" on public.merchants;
create policy "merchants: public read active" on public.merchants
  for select to anon, authenticated
  using (is_active or id = public.current_merchant_id() or public.is_admin());

drop policy if exists "merchants: staff update own" on public.merchants;
create policy "merchants: staff update own" on public.merchants
  for update to authenticated
  using (id = public.current_merchant_id() or public.is_admin())
  with check (id = public.current_merchant_id() or public.is_admin());

drop policy if exists "merchants: admin insert" on public.merchants;
create policy "merchants: admin insert" on public.merchants
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "merchants: admin delete" on public.merchants;
create policy "merchants: admin delete" on public.merchants
  for delete to authenticated
  using (public.is_admin());

-- Payout numbers are private: expose only the public columns to clients.
revoke select on public.merchants from anon, authenticated;
grant select (id, name, district, address, latitude, longitude, is_active, created_at, updated_at)
  on public.merchants to anon, authenticated;
grant update (name, address, latitude, longitude, momo_payout_number, payout_network, is_active)
  on public.merchants to authenticated;

-- surplus_bags --------------------------------------------------------
drop policy if exists "bags: public read active" on public.surplus_bags;
create policy "bags: public read active" on public.surplus_bags
  for select to anon, authenticated
  using (
    (status = 'active' and exists (
      select 1 from public.merchants m where m.id = merchant_id and m.is_active
    ))
    or merchant_id = public.current_merchant_id()
    or public.is_admin()
  );

drop policy if exists "bags: staff insert own" on public.surplus_bags;
create policy "bags: staff insert own" on public.surplus_bags
  for insert to authenticated
  with check (merchant_id = public.current_merchant_id() or public.is_admin());

drop policy if exists "bags: staff update own" on public.surplus_bags;
create policy "bags: staff update own" on public.surplus_bags
  for update to authenticated
  using (merchant_id = public.current_merchant_id() or public.is_admin())
  with check (merchant_id = public.current_merchant_id() or public.is_admin());

drop policy if exists "bags: staff delete own" on public.surplus_bags;
create policy "bags: staff delete own" on public.surplus_bags
  for delete to authenticated
  using (merchant_id = public.current_merchant_id() or public.is_admin());

-- orders --------------------------------------------------------------
drop policy if exists "orders: customer read own" on public.orders;
create policy "orders: customer read own" on public.orders
  for select to authenticated
  using (
    customer_id = auth.uid()
    or merchant_id = public.current_merchant_id()
    or public.is_admin()
  );

drop policy if exists "orders: customer create own" on public.orders;
create policy "orders: customer create own" on public.orders
  for insert to authenticated
  with check (customer_id = auth.uid());

-- Clients may only cancel their own unpaid orders; every other status
-- transition goes through the security-definer functions above.
drop policy if exists "orders: customer cancel unpaid" on public.orders;
create policy "orders: customer cancel unpaid" on public.orders
  for update to authenticated
  using (customer_id = auth.uid() and status = 'pending_payment')
  with check (customer_id = auth.uid() and status in ('pending_payment', 'cancelled'));

revoke update on public.orders from anon, authenticated;
grant update (status, cancelled_at) on public.orders to authenticated;
