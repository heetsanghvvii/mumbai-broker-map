# Mumbai Broker Map: notes for Claude

Live: https://mumbai-broker-map.vercel.app · Repo: github.com/heetsanghvvii/mumbai-broker-map (public, MIT)

Owner: Heet. Wants short, plain answers that lead with the next action, and wants Claude to do the work itself (only account/password/payment steps go to him).

## What it is
A free, open-source map for Mumbai home buyers:
- **By building**: search a building, see brokers around it (1/2/3 km circle, nearest first).
- **By area**: pick one of 52 areas, see every broker there.
- **By commute**: office + max time + modes → which localities fit (Google Routes, morning and evening traffic). Top 3 free; full map is a ₹149 unlock for 7 days (Razorpay).

No brokers are contacted or onboarded; there is no claim or verified flow. Decided by Heet.

## Stack
- Vite + plain JS (`src/`), the real site's styles in `src/style.css`.
- Vercel functions in `api/` (Web `Request`/`Response` handlers: `export async function POST(request)`). Files under `api/_lib/` are shared code, not endpoints.
- Supabase project `ftffxrduhlstjhzbxmob` (shared with Heet's One More Round project; ours are `brokers`, `broker_areas`, `broker_map_*`). Schema: `supabase/schema.sql`.
- Vercel project `prj_EyC47kpCVXlKm25JGQEIAYMXmwsp` (team `heet-san-projects`). The repo is **not** git-linked, so pushes don't deploy. Deploy with the Vercel connector: `create_deployment` with `gitSource {type: github, org: heetsanghvvii, repo: mumbai-broker-map, ref: main}` and `target: production`.

## Run locally
```bash
npm install
cp .env.example .env   # values: see "Secrets" below
npm run dev            # serves the site and /api on :5173
```
`GOOGLE_ROUTES_KEY=simulate` in `.env` fakes Routes responses for UI work (dev only; never set it on Vercel).

## Secrets
Never commit them. They live in Vercel project env vars (production + preview): `VITE_GOOGLE_MAPS_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_ROUTES_KEY`, `COMMUTE_DB_SECRET`, `UNLOCK_SECRET`. Heet's Mac has a full `.env`. Sensitive Vercel vars can't be read back; if a cloud session needs them, ask Heet to add them to the cloud environment's settings.
- `COMMUTE_DB_SECRET`'s SHA-256 is hard-coded in `public.broker_map_server_ok()`; rotate both together.
- The browser Maps key is restricted by website; the Routes key is server-only and restricted to Routes API.

## Cost guardrails (keep them)
- Every billable Google call asks Supabase first (`broker_map_take` for map/search/nearby; `budget` action for Routes). Over the cap → OpenStreetMap fallback or "try tomorrow".
- Google Cloud quota editing is greyed out on this account, so these in-app caps are the real limit.
- Commute results cache 7 days per ~1 km office cell and mode (`COMMUTE_CACHE_HOURS`). Free tier: 5 searches/IP/day, top 3 only, no two-wheeler (Enterprise SKU).
- Uncached all-mode commute search ≈ ₹132 at Google; price is ₹149 (`COMMUTE_PRICE_PAISE`).

## Data
`public.brokers` holds 1,515 brokers (1,504 with locations) from a Clay export of Google Maps listings, with area by PIN code. Heet accepted that storing this Google data breaks Google's terms (risk: key suspension). Places results fetched live in the browser are never stored.

## Open items
1. Payments run on manual UPI (`UPI_ID` + `ADMIN_PASSWORD`, approve at `/admin.html`) until Razorpay. Razorpay later: needs Heet's account and test keys → set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, webhook URL `/api/razorpay-webhook` (events `order.paid`, `payment.captured`). Until then the unlock button says payments open soon.
2. Vercel Hobby is non-commercial; move to Pro before taking payments.
3. Budget alert in Google Cloud Billing (Heet).
4. One more area's broker list is coming from Heet; import it the same way (place_id, area by PIN, name, address, phone, whatsapp, rating, reviews, lat/lng from Places `location`).
5. One More Round (same Supabase project) has security-advisor warnings: 45 SECURITY DEFINER functions callable by anon. Not this product's code; ask before touching.

## Checks before shipping
- `npx vite build` passes.
- `npm run dev`, then test: building search (`?q=Hiranandani Gardens Powai` shows 38 brokers within 1 km), area select, commute tab with `GOOGLE_ROUTES_KEY=simulate`.
- Clear test rows from `broker_map_commute_cache`, `broker_map_rate`, `broker_map_usage`, `broker_map_payments` after tests that write them (simulated times must never stay in the cache).
