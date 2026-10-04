# Mumbai Broker Map

Find real estate brokers in Mumbai three ways:

- **By building**: search a building or society, drop a pin, and see the brokers around it, nearest first.
- **By area**: pick an area (Andheri, Chembur, Powai…) and see every broker there, most-reviewed first.
- **By commute**: enter your office, how long you'll travel and how. See which localities fit, using morning and evening traffic, and the brokers in each. The top 3 areas are free; the full map is a one-time unlock (₹149 by default) for 7 days.

Each broker shows rating, phone, WhatsApp, Call, Google Maps and a "Check on MahaRERA" button. The output is brokers and areas, never house listings.

Plain JS and Vite, Vercel functions for the commute and payments, Supabase for the broker directory. MIT licensed.

## Run it locally

```bash
npm install
cp .env.example .env      # fill in what you have
npm run dev
```

`npm run dev` also serves the `/api` functions. Set `GOOGLE_ROUTES_KEY=simulate` in `.env` to try Commute Search with made-up travel times (about 2 minutes per km) without spending Google quota.

Without a Google key the site still works: it uses OpenStreetMap for the map and place search.

## Environment variables

| Name | Where | What it is |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | browser | Maps JavaScript + Places key, restricted by website |
| `VITE_GOOGLE_MAP_ID` | browser | Optional Map ID; falls back to `DEMO_MAP_ID` |
| `VITE_SUPABASE_URL` | both | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | both | Supabase publishable key (read-only for visitors) |
| `GOOGLE_ROUTES_KEY` | server | Routes API key for Commute Search. Never sent to the browser. |
| `COMMUTE_DB_SECRET` | server | Random secret; its SHA-256 goes in `supabase/schema.sql` |
| `UNLOCK_SECRET` | server | Random secret that signs unlock tokens |
| `UPI_ID`, `UPI_NAME` | server | Your UPI ID and payee name, for manual UPI payments |
| `ADMIN_PASSWORD` | server | Password for `/admin.html`, where you approve UPI payments |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | server | Razorpay API keys (test keys first); when set, they replace UPI |
| `RAZORPAY_WEBHOOK_SECRET` | server | Secret you set on the Razorpay webhook |
| `COMMUTE_CACHE_HOURS` | server | How long commute results are reused. Default 168 (7 days). |
| `COMMUTE_PRICE_PAISE` | server | Unlock price in paise. Default 14900 (₹149). |

Make random secrets with `openssl rand -hex 32`.

## Google Cloud setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and attach billing. Google needs a card even for free usage.
2. Enable **Maps JavaScript API**, **Places API (New)** and **Routes API**.
3. **Browser key** (`VITE_GOOGLE_MAPS_API_KEY`):
   - Application restrictions: **Websites**. Add `http://localhost:5173/*` and your site, e.g. `https://mumbai-broker-map.vercel.app/*`.
   - API restrictions: Maps JavaScript API and Places API (New) only.
4. **Server key** (`GOOGLE_ROUTES_KEY`), a separate key:
   - Application restrictions: **None** (Vercel's servers have no fixed IP).
   - API restrictions: **Routes API** only.
   - Never put this key in a `VITE_` variable.

## Costs and caps

Google gives free usage every month per SKU: Essentials 10,000, Pro 5,000, Enterprise 1,000.

### Built-in daily caps (enforced by the site)

The site keeps a per-day counter in Supabase and checks it before each billable Google call. When a cap is reached it switches to free OpenStreetMap services (map and search), or tells the visitor to try commute search tomorrow.

| What | Google SKU | Cap per day |
| --- | --- | --- |
| Google map loads | Dynamic Maps (Essentials) | 300 |
| Google place searches | Autocomplete session + Place Details Essentials | 300 |
| Google broker top-up (only when the directory has under 5 brokers within 3 km) | Nearby Search Pro | 150 |
| Commute, car (free preview / paid) | Route Matrix Pro | 160 / 600 elements |
| Commute, two-wheeler (free preview / paid) | Route Matrix Enterprise | 30 / 300 elements |
| Commute, train or metro (free preview / paid) | Route Matrix Essentials | 330 / 1,000 elements |

Two-wheeler costs the most, so the free preview leaves it out. It's included in the paid map.

### Also set Google Cloud quotas as a backstop

In **APIs & Services → [API] → Quotas & system limits**, set per-day limits a little above the caps above:
- **Maps JavaScript API**: map loads per day, 330
- **Places API (New)**: `GetPlaceRequest` per day, 330, and `SearchNearbyRequest` per day, 160
- **Routes API**: `ComputeRouteMatrix` elements per day, 2,000

Add a **budget alert** under Billing → Budgets & alerts so you're emailed if anything is ever charged.

### What one visitor costs (after the free allowance)

| Action | Cost |
| --- | --- |
| Open the site and search a building | about ₹1 (map load + place search). Broker list comes from Supabase: ₹0 |
| Commute search, car + train, 25 areas, not cached | about ₹66 |
| Commute search, all three modes, not cached | about ₹132 |
| Any commute search for an office within ~1 km of one searched in the last 7 days | ₹0 (cached) |

Each commute search sends at most 25 localities × 2 times (morning, evening) × the selected modes. The element count is logged on every search (`"event":"commute"`).

## Payments

### UPI to start (no payment gateway)
Set `UPI_ID` (and optionally `UPI_NAME`) and a long random `ADMIN_PASSWORD`. Buyers scan a UPI QR for the unlock price, add a short reference code to the payment note, and enter the 12-digit UPI transaction ID (UTR). You check it in your UPI app and approve it on `/admin.html`; the buyer's page unlocks automatically. A transaction ID can back only one unlock.

### Razorpay (later)

1. Create a Razorpay account, and use **Test mode** first.
2. Put the test key ID and secret in Vercel as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Settings → Webhooks → Add**: URL `https://YOUR-SITE/api/razorpay-webhook`, events `order.paid` and `payment.captured`, and a secret you also set as `RAZORPAY_WEBHOOK_SECRET`.
4. Redeploy and buy once with a test card.
5. Complete KYC, switch to live keys, and redeploy.

Price: ₹149 by default (`COMMUTE_PRICE_PAISE`). An uncached all-modes search costs Google about ₹132, so ₹149 plus 7-day caching keeps each sale above cost.

How the unlock is protected:
- The server checks Razorpay's signature and the order status before issuing anything.
- The unlock is a token signed with `UNLOCK_SECRET`, tied to one office (a ~1 km grid cell) and valid for 7 days.
- The browser only stores the token. The server checks it on every request and only then returns the full results.

## Supabase setup

1. Create a free project and run `supabase/schema.sql` in the SQL editor. First replace `SERVER_SECRET_SHA256` with the SHA-256 of your `COMMUTE_DB_SECRET`.
2. Load brokers into `public.brokers` (place ID, area, name, address, phone, rating, location).

Visitors can read the broker directory's public columns. Commute cache, rate limits, payments and the daily counters are only reachable through `broker_map_server()`, which checks the server secret.

## Deploy to Vercel

1. Import the GitHub repo. Vercel detects Vite; functions in `/api` deploy automatically.
2. Add the environment variables above, then redeploy.
3. Vercel's free Hobby plan is for non-commercial use. Once you take payments, move the project to a Pro team.

## Project layout

```
index.html              page shell
src/main.js             building, area and commute views; results; bottom sheet
src/data.js             broker directory and daily budget (Supabase)
src/pay.js              Razorpay Checkout and unlock tokens
src/maps/google.js      Google map, place search, nearby top-up
src/maps/osm.js         OpenStreetMap map (fallback)
src/maps/photon.js      OpenStreetMap place search (fallback)
api/commute.js          Commute Search
api/pay/order.js        start an unlock order
api/pay/verify.js       confirm payment, issue unlock token
api/razorpay-webhook.js record paid orders
api/pay/upi.js          UPI payment: start, claim, status
api/admin.js            approve or reject UPI payments
public/admin.html       the payments desk
api/_lib/               shared server code
data/localities.json    56 Mumbai localities with centres
supabase/schema.sql     tables, access rules, server function
```

## License

MIT. See [LICENSE](LICENSE).
