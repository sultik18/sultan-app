# Sultan

A personal app for spending, reminders and ideas. It installs on the iPhone home screen as a web app (PWA) with its own icon and works offline.

- **Spending:** log expenses in CHF, see them in USD, with weekly/monthly summaries, two budgets and category analysis.
- **To-do:** reminders with lists, dates, times, flags, priorities and photos.
- **Ideas:** an idea diary (Claude chat per idea comes in a later update).

Data lives in Supabase (one `docs` table plus a private `photos` bucket) behind email sign-in and row-level security.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app UI |
| `shim.js` | Sign-in, sync, offline cache and photo storage on Supabase |
| `config.js` | Supabase project URL and publishable key (public by design) |
| `sw.js` | Service worker: offline app shell, fonts and viewed photos |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icon |
| `supabase/schema.sql` | Database setup, run once in the Supabase SQL Editor |

## One-time setup

1. Supabase → **SQL Editor** → paste `supabase/schema.sql` → **Run**.
2. Supabase → **Authentication → Sign In / Providers → Email**: turn **Confirm email** off (it's a one-person app).
3. GitHub → repo **Settings → Pages**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**.
4. Open https://sultik18.github.io/sultan-app/ and create your account.
5. Supabase → **Authentication → Sign In / Providers**: turn **Allow new users to sign up** off, so nobody else can register.
6. On the iPhone: open the link in Safari → Share → **Add to Home Screen**.
