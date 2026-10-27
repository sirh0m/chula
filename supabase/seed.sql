-- Demo data for local Supabase (`supabase db reset` runs this after migrations).
-- Pickup windows are relative to now() so the map always has live bags.

insert into public.merchants (id, name, district, address, latitude, longitude, momo_payout_number, payout_network, is_active) values
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e01', 'Mama Rose Bakery',        'Ntinda',   'Ntinda Shopping Complex, Ntinda Rd', 0.35425, 32.61468, '256772100101', 'MTN',    true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e02', 'Ntinda Fresh Juice Hub',  'Ntinda',   'Kigoowa Rd, opp. Capital Shoppers',  0.35810, 32.61902, '256701100202', 'AIRTEL', true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e03', 'Kololo Hill Café',        'Kololo',   'Prince Charles Dr, Kololo',          0.33302, 32.59401, '256782100303', 'MTN',    true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e04', 'Acacia Sushi & Grill',    'Kololo',   'Acacia Ave, Kololo',                 0.33851, 32.58912, '256752100404', 'AIRTEL', true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e05', 'Bugolobi Market Kitchen', 'Bugolobi', 'Bugolobi Market, Luthuli Ave',       0.31780, 32.61622, '256772100505', 'MTN',    true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e06', 'Village Mall Deli',       'Bugolobi', 'Village Mall, Spring Rd',            0.32112, 32.61345, '256742100606', 'AIRTEL', true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e07', 'Nakasero Garden Bistro',  'Nakasero', 'Nakasero Rd, near Market',           0.31905, 32.57958, '256762100707', 'MTN',    true),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e08', 'Kampala Road Pâtisserie', 'Nakasero', 'Kampala Rd, Nakasero',               0.31352, 32.58071, '256702100808', 'AIRTEL', true)
on conflict (id) do nothing;

insert into public.surplus_bags (merchant_id, title, description, original_price, discount_price, quantity_available, pickup_start_time, pickup_end_time, status) values
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e01', 'Bakery Surprise Bag',       'Today''s unsold bread, mandazi, and cakes.',            21000,  7000, 6, now() + interval '1 hour',  now() + interval '3 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e02', 'Fresh Juice & Fruit Box',   'Two juices plus a cut-fruit bowl from the day.',        15000,  5000, 4, now() + interval '30 minutes', now() + interval '2 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e03', 'Café Pastry & Sandwich Bag','Croissants, muffins and a deli sandwich.',               30000, 10000, 3, now() + interval '2 hours', now() + interval '4 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e04', 'Sushi Platter Rescue',      'Assorted rolls made today, packed to go.',              60000, 18000, 0, now() + interval '1 hour',  now() + interval '2 hours', 'sold_out'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e05', 'Local Lunch Bag',           'Matoke, beans, greens and a protein of the day.',       18000,  6000, 8, now() + interval '15 minutes', now() + interval '2 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e06', 'Deli Grocery Bag',          'Yoghurt, cheese, salads and ready meals near best-by.', 45000, 15000, 5, now() + interval '1 hour',  now() + interval '5 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e07', 'Bistro Dinner Box',         'A main and a side from tonight''s menu.',               36000, 12000, 2, now() + interval '3 hours', now() + interval '5 hours', 'active'),
  ('6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e08', 'Pâtisserie Sweet Bag',      'Éclairs, tarts and cookies from the display.',          27000,  9000, 0, now() + interval '1 hour',  now() + interval '3 hours', 'sold_out');
