# Chula

Chula is a food surplus marketplace for Kampala, similar to Too Good To Go. Bakeries, cafés and restaurants in Ntinda, Kololo, Bugolobi and Nakasero list their end-of-day "surprise bags" at a discount. Customers find them on a map, pay with MTN MoMo or Airtel Money, and collect them with a 6-digit pickup code.

Store staff don't need a dashboard. They text Chula on WhatsApp ("Listed 5 bags today at 7000 UGX", "Token 482910"), and a Gemini-powered agent updates stock and confirms pickups.

```
supabase/
  migrations/001_initial_schema.sql  schema, enums, RLS, payment/redemption functions
  seed.sql                           8 demo merchants and bags across the 4 districts
src/backend/                         Node.js 20 + Express API
  server.js                          app setup (CORS, JSON with raw body for signatures)
  routes/payments.js                 POST /api/payments/stk-push, POST /api/payments/webhook
  routes/whatsapp.js                 WhatsApp Cloud API webhook + local simulator
  routes/bags.js, routes/orders.js   map data and the customer's orders
  services/                          Flutterwave, Gemini, merchant agent, WhatsApp client
  store/                             Supabase store + in-memory store (same semantics)
  tests/                             node:test unit and end-to-end flow tests
src/frontend/                        React + Vite + Tailwind CSS + shadcn/ui
  App.jsx                            routing and Supabase auth state
  components/MapView.jsx             Leaflet map, green = available, red = sold out
  components/CheckoutModal.jsx       1-tap Mobile Money checkout (STK push + approval wait)
  components/ActiveTokenCard.jsx     live pickup code, pickup window countdown, directions map
docker/                              Dockerfile (node:20-alpine), docker-compose.yml, nginx.conf
```

## Run it locally

You need Node.js 20.19 or newer.

```bash
npm install
cp .env.example .env     # optional: everything works with it empty
npm run dev
```

- Web app: http://localhost:5317
- API: http://localhost:4310/api/health

`npm run dev` checks ports 4310 and 5317 first. If an earlier dev server is still holding them, it tells you so and exits. Run `npm run stop` to free both ports, then `npm run dev` again.

With no keys configured, Chula runs in **demo mode**:

| Integration | Without keys | With keys |
| --- | --- | --- |
| Data | Seeded in-memory store (resets on restart) | Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |
| Payments | Simulated prompt that auto-approves after 4s and posts a signed webhook to the real handler. Numbers ending in `0000` are declined. | Flutterwave Mobile Money Uganda (`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`) |
| WhatsApp parsing | Built-in rule parser | Gemini (`GEMINI_API_KEY`), with the rule parser as fallback |
| WhatsApp replies | Logged, plus the in-app simulator at `/merchant` | WhatsApp Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) |
| Customer sign-in | Per-device guest identity | Supabase email magic link / code (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) |

### Try the full loop

1. Open http://localhost:5317, pick a green marker or a bag in the list, and tap **Reserve**.
2. Enter any MTN (077/078/076) or Airtel (070/074/075) number and pay. The demo prompt approves after a few seconds and you land on your pickup code.
3. Open **Merchant WhatsApp** (`/merchant`), choose the same store, and send `Token` followed by your 6-digit code. The order page flips to **Collected**.
4. In the same chat, send `Listed 5 bags of rolex at 7000 UGX` and watch the new bag appear on the map.

### Tests

```bash
npm test
```

This runs unit tests (30/70 split, phone and network detection, message parsing, webhook signatures) and an end-to-end HTTP flow: STK push, signed webhook, stock decrement, token issue, replay idempotency, WhatsApp listing, and one-time token redemption.

## Supabase setup

1. Create a Supabase project, then apply the schema with either:
   - `supabase link --project-ref <ref> && supabase db push`, or
   - paste `supabase/migrations/001_initial_schema.sql` (and optionally `supabase/seed.sql`) into the SQL editor.
2. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` for the API, and `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the web app.
3. Under Authentication > URL configuration, add your web app URL as a redirect URL.
4. Link store staff to a merchant so their WhatsApp number is recognised:

   ```sql
   update profiles
      set role = 'merchant_staff',
          merchant_id = '<merchant uuid>',
          phone_number = '256772100101'
    where id = '<auth user uuid>';
   ```

   As a fallback, messages from a merchant's `momo_payout_number` are also accepted.

### Data model highlights

- **Server-side pricing.** A `BEFORE INSERT` trigger on `orders` sets the price, the 30% `platform_commission`, the 70% `merchant_payout_amount` and the `merchant_id` from the bag, so clients can't choose their own price.
- **`confirm_order_payment()`** runs only as the service role. It is idempotent, row-locks the bag so concurrent payments can't oversell, recomputes the split, and issues a cryptographically random 6-digit `pickup_token` that is unique among uncollected orders. If stock ran out before the payment cleared, it reports `needs_refund` and the API refunds through Flutterwave.
- **`redeem_pickup_token()`** only matches tokens for the merchant's own store and works once.
- **RLS.** Anyone can read active bags and the public merchant columns (payout numbers are column-restricted). Customers can create and read only their own orders. Merchant staff manage only their own store's bags and see its orders. Customers can't change their own role.
- **`surplus_bags.description_embedding`** is a `vector(768)` (pgvector) column filled from Gemini embeddings, with an HNSW index and a `match_surplus_bags()` search function.
- **`run_housekeeping()`**, which the API calls every 5 minutes, expires past bags and cancels unpaid orders after 30 minutes.

## Payments (Flutterwave)

- `POST /api/payments/stk-push` with `{ bagId, quantity, phone, network? }` creates a pending order and calls `POST /v3/charges?type=mobile_money_uganda`. The network is auto-detected from the number when omitted. If Flutterwave asks for a hosted authorisation step, the response includes `payment.redirectUrl`.
- `POST /api/payments/webhook` checks `verif-hash` (or the HMAC `flutterwave-signature`) against `FLUTTERWAVE_SECRET_HASH`. It never trusts the webhook body: it re-fetches the transaction from `GET /v3/transactions/:id/verify` and checks the reference, the UGX currency and the amount before confirming. Replays are safe.

Set the webhook URL in the Flutterwave dashboard to `https://<api-host>/api/payments/webhook`.

## WhatsApp agent

1. In Meta for Developers, add the WhatsApp product and get a permanent `WHATSAPP_TOKEN` and the `WHATSAPP_PHONE_NUMBER_ID`.
2. Set the webhook callback to `https://<api-host>/api/whatsapp/webhook`, use your `WHATSAPP_VERIFY_TOKEN`, and subscribe to `messages`.
3. Set `WHATSAPP_APP_SECRET` so every webhook's `X-Hub-Signature-256` is verified. Production refuses unsigned webhooks.

The agent handles these messages:

| Message | Effect |
| --- | --- |
| `Listed 5 bags today at 7000 UGX` | Creates or updates today's bag with quantity 5 at UGX 7,000 |
| `8 bags of bread at 5k, was 15k, pickup 6-8pm` | Sets title, discount and original price, and the 18:00–20:00 window |
| `Token 482910` | Verifies the code for this store and marks the order collected |
| `Sold out` | Hides today's listings; existing reservations stay valid |
| `Status` | Today's stock, pickups, and payout so far |

Bare 6-digit codes skip the model. Gemini output is schema-constrained and validated, and a token Gemini returns must appear in the original message.

## Docker

```bash
docker compose --env-file .env -f docker/docker-compose.yml up --build
```

- Web app (nginx serving the Vite build and proxying `/api`): http://localhost:8317
- API: http://localhost:4310

The backend image is `node:20-alpine` and runs as the non-root `node` user. The compose file keeps demo fallbacks on so it starts without keys. For a real deployment, set `ALLOW_IN_MEMORY_STORE=false` and `ALLOW_SIMULATED_PAYMENTS=false`. The API then refuses to start without Supabase, Flutterwave, and webhook secrets.

## Configuration reference

All variables are documented in [`.env.example`](.env.example). The required production keys are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`, `GEMINI_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_APP_SECRET`.
