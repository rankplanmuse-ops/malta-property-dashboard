# Backend setup (one time, about 10 minutes)

The site works without a backend for browsing and on-device (guest) verdicts.
Accounts, cross-device verdicts and Google login switch on once a Supabase
project is connected. Everything below is done in browser dashboards; no
secrets are committed to this repo.

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard and sign in (the Rankplan account).
2. New project: name `malta-dashboard`, region `eu-central-1` (Frankfurt),
   Free plan. Save the database password in a password manager.
3. Wait until the project status is Healthy.

## 2. Create the tables and load the listings

1. In the project, open SQL Editor.
2. Paste the full contents of `supabase/schema.sql` and Run.
3. Paste the full contents of `supabase/seed.sql` and Run.
   (This loads all 95 listings into `public.listings`.)
4. Check: Table Editor should show 95 rows in `listings`, 0 in `verdicts`.

## 3. Connect the site

1. In the project: Settings, API. Copy the Project URL and the anon
   (public) key. The anon key is safe to publish; never copy the
   service-role key into this repo.
2. Paste both into `config.js` in this repo and push. The site picks them
   up on the next load and the Profile page switches from guest mode to
   real accounts.

## 4. Auth settings

1. Authentication, URL Configuration:
   - Site URL: `https://rankplanmuse-ops.github.io/malta-property-dashboard/`
   - Add the same URL under Redirect URLs, plus
     `http://localhost:8000/` if you test locally.
2. Authentication, Providers, Email: enabled by default. For instant
   sign-up during testing, "Confirm email" can be turned off; leave it on
   for real use.

## 5. Google login

Google sign-in needs an OAuth client from Google Cloud Console:

1. Go to https://console.cloud.google.com/apis/credentials (sign in with
   the account that should own the app, e.g. rankplanmuse@gmail.com).
2. Create a project (or reuse one), then Credentials, Create credentials,
   OAuth client ID, type: Web application. If asked, configure the consent
   screen first (External, app name "Malta Property Dashboard").
3. Authorized redirect URI (exactly this, with your project ref):
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
4. Create, then copy the Client ID and Client secret.
5. In Supabase: Authentication, Providers, Google: enable it and paste the
   Client ID and Client secret. Save.
6. Reload the site and use "Continue with Google" in Profile.

## 6. Daily listing updates (later)

New listings from the MaltaPark and Rentola crawls can be appended by
re-running `python3 tools/generate.py` (it rebuilds `supabase/seed.sql`
from the crawl dataset; the seed uses upserts, so re-running it in the SQL
editor is safe) and pushing the refreshed `listings-data.js`.
