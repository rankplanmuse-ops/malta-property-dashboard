# Malta Property Dashboard (standalone)

Public, browser-only version of the Malta Property Dashboard: long lets in
Malta and Gozo (2 bedrooms and up, posted 2026, no maisonettes, no ground
floor), cheapest first, with Yay / Maybe / Nay verdicts.

- Intended live site: https://rankplanmuse-ops.github.io/malta-property-dashboard/
  (repo creation is a one-time manual step, see HOSTING.md)
- Browsing works without an account. Guest verdicts save on the device.
- With the Supabase backend connected (see SETUP.md), users can create an
  account with email and password or Google, and their verdicts follow
  them across devices.
- Listings data: `listings-data.js` (embedded copy) and `public.listings`
  in Supabase (seeded from `supabase/seed.sql`), both generated from the
  crawl dataset by `tools/generate.py`.

Files: `index.html`, `styles.css`, `app.js`, `config.js` (public Supabase
URL and anon key only), `supabase/schema.sql`, `supabase/seed.sql`.
