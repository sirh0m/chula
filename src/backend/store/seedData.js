// Mirrors supabase/seed.sql so the in-memory store and a fresh Supabase
// project show the same Kampala merchants.
export const SEED_MERCHANTS = [
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e01', name: 'Mama Rose Bakery', district: 'Ntinda', address: 'Ntinda Shopping Complex, Ntinda Rd', latitude: 0.35425, longitude: 32.61468, momo_payout_number: '256772100101', payout_network: 'MTN' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e02', name: 'Ntinda Fresh Juice Hub', district: 'Ntinda', address: 'Kigoowa Rd, opp. Capital Shoppers', latitude: 0.3581, longitude: 32.61902, momo_payout_number: '256701100202', payout_network: 'AIRTEL' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e03', name: 'Kololo Hill Café', district: 'Kololo', address: 'Prince Charles Dr, Kololo', latitude: 0.33302, longitude: 32.59401, momo_payout_number: '256782100303', payout_network: 'MTN' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e04', name: 'Acacia Sushi & Grill', district: 'Kololo', address: 'Acacia Ave, Kololo', latitude: 0.33851, longitude: 32.58912, momo_payout_number: '256752100404', payout_network: 'AIRTEL' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e05', name: 'Bugolobi Market Kitchen', district: 'Bugolobi', address: 'Bugolobi Market, Luthuli Ave', latitude: 0.3178, longitude: 32.61622, momo_payout_number: '256772100505', payout_network: 'MTN' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e06', name: 'Village Mall Deli', district: 'Bugolobi', address: 'Village Mall, Spring Rd', latitude: 0.32112, longitude: 32.61345, momo_payout_number: '256742100606', payout_network: 'AIRTEL' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e07', name: 'Nakasero Garden Bistro', district: 'Nakasero', address: 'Nakasero Rd, near Market', latitude: 0.31905, longitude: 32.57958, momo_payout_number: '256762100707', payout_network: 'MTN' },
  { id: '6f1c2a4e-1d3b-4a8e-9b51-0a1f2c3d4e08', name: 'Kampala Road Pâtisserie', district: 'Nakasero', address: 'Kampala Rd, Nakasero', latitude: 0.31352, longitude: 32.58071, momo_payout_number: '256702100808', payout_network: 'AIRTEL' },
];

const MIN = 60 * 1000;

export const SEED_BAGS = [
  { merchantIndex: 0, title: 'Bakery Surprise Bag', description: "Today's unsold bread, mandazi, and cakes.", original_price: 21000, discount_price: 7000, quantity_available: 6, startIn: 60, endIn: 180 },
  { merchantIndex: 1, title: 'Fresh Juice & Fruit Box', description: 'Two juices plus a cut-fruit bowl from the day.', original_price: 15000, discount_price: 5000, quantity_available: 4, startIn: 30, endIn: 120 },
  { merchantIndex: 2, title: 'Café Pastry & Sandwich Bag', description: 'Croissants, muffins and a deli sandwich.', original_price: 30000, discount_price: 10000, quantity_available: 3, startIn: 120, endIn: 240 },
  { merchantIndex: 3, title: 'Sushi Platter Rescue', description: 'Assorted rolls made today, packed to go.', original_price: 60000, discount_price: 18000, quantity_available: 0, startIn: 60, endIn: 120 },
  { merchantIndex: 4, title: 'Local Lunch Bag', description: 'Matoke, beans, greens and a protein of the day.', original_price: 18000, discount_price: 6000, quantity_available: 8, startIn: 15, endIn: 120 },
  { merchantIndex: 5, title: 'Deli Grocery Bag', description: 'Yoghurt, cheese, salads and ready meals near best-by.', original_price: 45000, discount_price: 15000, quantity_available: 5, startIn: 60, endIn: 300 },
  { merchantIndex: 6, title: 'Bistro Dinner Box', description: "A main and a side from tonight's menu.", original_price: 36000, discount_price: 12000, quantity_available: 2, startIn: 180, endIn: 300 },
  { merchantIndex: 7, title: 'Pâtisserie Sweet Bag', description: 'Éclairs, tarts and cookies from the display.', original_price: 27000, discount_price: 9000, quantity_available: 0, startIn: 60, endIn: 180 },
].map((bag) => ({ ...bag, startOffsetMs: bag.startIn * MIN, endOffsetMs: bag.endIn * MIN }));
