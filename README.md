# Mumbai Broker Map

Search a building or society in Mumbai, drop a pin, and see the real estate agencies closest to it, nearest first.

- Building search with Google Places Autocomplete, limited to Mumbai
- Shows the 1 km circle around the building, or widens to 2 km or 3 km when fewer than 5 brokers are inside
- Each broker shows name, address and distance. Tap a broker to see phone, rating, Call and WhatsApp.
- Numbered markers match the numbered list, nearest first; tapping either one highlights both
- Full-screen map with a draggable results sheet on phones and a floating panel on desktop
- "Claim your profile" link for brokers, pointing to a Google Form
- Works on phones first; follows light and dark mode
- No backend. Plain JS and Vite. MIT licensed.

Listings come from Google Maps. Buyers should verify any agent on [MahaRERA](https://maharera.maharashtra.gov.in).

## Run it locally

```bash
npm install
cp .env.example .env      # then paste your key into .env
npm run dev
```

With no key in `.env`, the site runs in **preview mode**: a free OpenStreetMap base map with sample buildings and made-up brokers. That's useful for working on the design without spending any API quota.

## Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | yes | Browser key from Google Cloud |
| `VITE_GOOGLE_MAP_ID` | no | Map ID (vector, JavaScript). Falls back to `DEMO_MAP_ID`. |
| `VITE_CLAIM_FORM_URL` | no | Your Google Form link for brokers |

The key ends up in the browser bundle. Every Maps JavaScript key does, which is why the restrictions below matter.

## Google Cloud setup (one time)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com) and attach a billing account. Google needs a card on file even for free usage.
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. **Credentials → Create credentials → API key**, then edit the key:
   - **Application restrictions → Websites (HTTP referrers)**. Add:
     - `http://localhost:5173/*`
     - `https://YOUR-PROJECT.vercel.app/*`
     - any custom domain, e.g. `https://yourdomain.com/*`
   - **API restrictions → Restrict key** to Maps JavaScript API and Places API (New) only.
4. Optional: **Google Maps Platform → Map management → Create Map ID** (JavaScript, Vector), then put it in `VITE_GOOGLE_MAP_ID`.

## Stay inside the free tier: set daily caps

Google gives free monthly usage per SKU: Essentials 10,000, Pro 5,000, Enterprise 1,000. Set caps in **APIs & Services → [API] → Quotas & system limits** so usage can never go past them.

| What the site calls | SKU | Free / month | Daily cap to set |
| --- | --- | --- | --- |
| Map loads (Maps JavaScript API) | Dynamic Maps, Essentials | 10,000 | **330 map loads/day** |
| Building search suggestions | Autocomplete, session | free when the session ends in a Place Details call | (covered by the line below) |
| Pin location after picking a suggestion (`location`, `displayName`) | Place Details Essentials | 10,000 | **330 requests/day** |
| Brokers near the pin | Nearby Search **Pro** | 5,000 | **160 requests/day** |
| Phone + rating when a buyer taps a card | Place Details **Enterprise** | 1,000 | **33 requests/day** |

In Places API (New), set the per-day limits for `SearchNearbyRequest` and `GetPlaceRequest`. Also set a **budget alert** (Billing → Budgets & alerts) of ₹100 so you hear about it if anything slips.

Why the design looks like this:

- **One nearby search per building, not three.** The site asks for the 20 nearest agencies within 3 km, ranked by distance, then picks 1, 2 or 3 km in the browser. That's the same result as retrying at bigger distances, for a third of the calls.
- **Phone and rating load on tap.** Asking for them in the nearby search moves every search into the Enterprise tier (1,000 free a month). Loading them per card keeps searches in Pro (5,000 free).

## Google terms

Nothing from Google Places is stored or cached. Results live in page memory only and disappear on reload. The URL keeps only the searched text (`?q=`) so links can be shared.

## Deploy to Vercel

1. Import the GitHub repo in Vercel. The framework is detected as Vite, the build command is `npm run build` and the output folder is `dist`.
2. **Settings → Environment Variables**: add `VITE_GOOGLE_MAPS_API_KEY` (and the optional two), then redeploy.
3. Add the `*.vercel.app` URL to the key's HTTP referrer list.

## Broker claim form

Create a Google Form with these fields, then put its link in `VITE_CLAIM_FORM_URL`:

1. Full name (short answer, required)
2. Agency name (short answer)
3. MahaRERA agent registration number (short answer, required; format `A5xxxxxxxxxx`)
4. WhatsApp number (short answer, required)
5. Localities you serve (paragraph, required)
6. Google Maps link to your office (short answer)

## Project layout

```
index.html            page shell
src/main.js           search, results, cards
src/geo.js            distance, radius choice, WhatsApp number check
src/maps/google.js    Google Maps + Places (New)
src/maps/preview.js   keyless preview with sample data
src/maps/markers.js   marker elements shared by both maps
src/style.css         all styles, light + dark
```

## License

MIT. See [LICENSE](LICENSE).
