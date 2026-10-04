# PRD: Mumbai Broker Map

**Owner:** Heet Sanghvi (Product) · **Status:** Live, v1 · **Link:** [mumbai-broker-map.vercel.app](https://mumbai-broker-map.vercel.app)

## 1. Problem

Buying or renting a home in Mumbai almost always goes through a local broker. Buyers find them by word of mouth or by walking into whichever office is nearest. They can't easily see:

- which brokers actually work around the building they want,
- how other customers rate them,
- whether the broker is registered with MahaRERA.

Listing portals answer "which flats are for sale?", not "who should I call about this building?".

## 2. Users

| Persona | Job to be done |
|---|---|
| **Building-first buyer** | "I know the society I want. Who are the brokers around it?" |
| **Area-first buyer** | "I'm looking in Powai or Chembur. Who are the best-reviewed brokers there?" |
| **Commute-first buyer** | "My office is in BKC and I'll travel 40 minutes max. Which areas fit, and who do I call there?" |

## 3. Key insight

People search by **place**, not by broker name. So every entry point starts from a place and ends at a short, ranked list of people to call.

## 4. Solution (v1 scope)

| Entry point | What the user does | What they get |
|---|---|---|
| **By building** | Search a building, drop a pin | Brokers within 1, 2 or 3 km, nearest first |
| **By area** | Pick one of 52 areas | Every broker there, most-reviewed first |
| **By commute** | Enter office, max time and travel modes | Areas that fit, using morning and evening traffic, plus their brokers |

Every broker card: rating, review count, distance, **Call**, **WhatsApp**, **Google Maps** and **Check on MahaRERA**.

## 5. Out of scope (and why)

| Cut | Reason |
|---|---|
| House listings | Crowded market, and it would turn a neutral directory into a portal |
| Broker sign-up, claims or "verified" badges | Needs a sales and ops team; v1 tests demand from buyers first |
| Accounts and logins | Friction before value; nothing needs saving yet |
| Native app | The web works on every phone and ships in days |

## 6. Business model

- **Free:** building search, area search, and the top 3 commute areas.
- **Paid:** the full commute map, **₹149 one-time for 7 days**.
- **Why ₹149:** an uncached all-mode commute search costs about **₹132** in Google Routes calls. ₹149 covers cost on the worst case; cached repeat searches are almost pure margin.

## 7. Guardrails

| Risk | Guardrail |
|---|---|
| A traffic spike creates a large Google bill | Every billable call checks a daily cap first; over the cap, the map falls back to OpenStreetMap or asks the user to try tomorrow |
| Free users drain the commute budget | 5 free commute searches per day per visitor, top 3 results only |
| Repeat searches cost money every time | Commute results are reused for 7 days per ~1 km office cell and travel mode |
| Buyers trust a bad broker | One-tap MahaRERA check on every card; the product shows ratings, it doesn't endorse |

## 8. Success metrics

These are the metrics I set for v1. Numbers will be added once there's enough traffic to read them.

| Type | Metric |
|---|---|
| **North star** | Broker contacts per week (taps on Call or WhatsApp) |
| Activation | % of visitors who run at least one search |
| Engagement | Searches per visitor; % using the commute tab |
| Monetisation | Free-to-paid conversion on commute; revenue per paid unlock vs Google cost |
| Quality | Share of searches that return 5+ brokers |

## 9. Data

1,500+ brokers across 52 Mumbai areas, each with location, area (by PIN code), rating and reviews.

## 10. Roadmap

1. Online payments (Razorpay) to replace the manual UPI approval desk.
2. More areas and brokers.
3. Basic analytics to read the metrics above.
4. Test demand for a broker-side product (claims, featured listings) once buyer usage is proven.

## 11. Open questions

- Will buyers pay for commute insight, or is it a free hook?
- Do brokers want to be found here enough to pay for it later?
