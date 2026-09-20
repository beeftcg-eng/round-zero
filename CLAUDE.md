# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TurnZero (some older files still say "Round Timer") is a shared round timer for TCG events. A judge creates a timer and gets a private control link; players open a read-only view link/QR code and see the clock update live. There are no accounts anywhere. It is a **static site + Supabase backend**, with no build step, no package manager, and no linter. The local folder is not a git repo; the deployed site comes from the public GitHub repo `beeftcg-eng/round-zero` (which holds only the website files, not `sql/`, `send-timer-push/` or `SETUP.md`).

`SETUP.md` is the upgrade/deployment guide, with the required ordering. Read it rather than duplicating steps here.

## Running / deploying

- Serve the folder root with any static server (e.g. `python3 -m http.server`). Pages use absolute paths (`/app.js`, `/config.js`, `/sw.js`, `/vendor/...`), so it must be served from the site root. It needs a live Supabase project with the SQL applied to do anything.
- Website files: `index.html`, `app.js`, `sw.js`, `manifest.json`, `privacy.html`, icons, `vendor/`, plus `config.js`. `config.js` is per-deployment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`, optional `DONATION_URL`): never overwrite the repo's copy, and never echo its values.
- Bump `APP_VERSION` in `app.js` on each release (shown in the home-screen footer, used to confirm a deploy landed; the tests and `live/check-live.js` read it from there). Bump `VERSION` in `sw.js` whenever `vendor/` or icons change, because those are cached cache-first until then.
- `vercel.json` sets security headers (nosniff, X-Frame-Options DENY, `frame-ancestors 'none'`, no-referrer, camera limited to self), redirects dev-only paths to `/`, and registers a daily cron for `api/keepalive.js` (keeps a free Supabase project from pausing). `.vercelignore` also excludes dev files. **Vercel serves every file in the repo**, so any new non-website file or folder must be added to both `.vercelignore` and the `redirects` in `vercel.json`. `.github/workflows/keepalive.yml` is a backup ping; `.github/workflows/tests.yml` runs the suite in CI.
- `vendor/` holds pinned copies of supabase-js (2.116.0), qrcodejs and jsQR; `index.html` documents the versions. To upgrade one, download the UMD build into `vendor/` and bump `sw.js` `VERSION`.
- `index.html` carries a strict Content-Security-Policy (`script-src 'self'`, no inline scripts; `connect-src` allows `*.supabase.co`). Don't add inline `<script>` or inline `on*=` handlers; put code in `app.js`. A custom Supabase domain must be added to `connect-src`.
- `_old/` (local only, git-ignored) holds pre-2.0 files for reference.

## Architecture

**Client (`app.js`)** is one IIFE: customize/install/tour UI, shared helpers, then pages, with **routing at the very end** (so all `const`s are initialised). Routing is by query string: `?control=<id>#t=<token>` (token may also be `&t=` in old links), `?view=<id>`, `?multi=<id>,...` (max 4), `?tv=<CODE>`, otherwise home. Pages render by assigning template-literal HTML to `#app`; every interpolated value must go through `escapeHtml`/`escapeAttr` (or be a validated UUID via `isUuid`). QR/jsQR libraries are lazy-loaded with `loadScript`.

**Timer model is timestamp-based.** A row has `accumulated_seconds` plus `running_since` (start of the current run segment); elapsed = accumulated + (now − running_since); `getPhaseInfo` maps that onto `setup → main → extra → ended`. **All timestamps are written by the database** (`clock_timestamp()`), never by the browser. The client only needs the offset between its clock and the server's, from the `server_time()` RPC (`syncServerTime`, `nowMs()`). Use `nowMs()`, not `Date.now()`, for timer math.

**Security model (the important part).**
- `timers` is publicly readable (needed for sharing and Realtime) and **not writable by anyone** through the API. It holds nothing secret.
- Secrets live in private tables with RLS and no policies: `timer_secrets` (control tokens), `timer_penalties`, `private_config`, and `timer_push_subscriptions`.
- Every write is a `security definer` RPC that checks the control token: `timer_action(id, token, action, amount)` (start, restart, pause, resume, end, next_round, finalize, adjust, round_delta, new_code), `create_timer`, `verify_control`, the penalty RPCs (`list/add/delete/clear_penalties`), and push RPCs (`push_subscribe/unsubscribe/status`). Internal helpers are prefixed `_` and revoked from `anon`. When adding a feature that writes data, add an RPC that checks the token; never re-open table policies.
- The judge's other devices learn that penalties changed via `timers.penalties_rev`, which the penalty RPCs bump.

**Live sync:** `watchTimers(ids, onRow)` combines Realtime `postgres_changes` with refetch on reconnect / tab wake-up, a 15 s poll while Realtime is down, and a 2-minute safety poll. Pages skip redrawing when only alert flags changed (`rowSig`), and the control page preserves a half-typed penalty form across redraws. Rows older than what's held (`updated_at`) are ignored.

**Alerts.** Sounds: `makeAlertTracker()` fires chimes as the clock *crosses* a mark (never replayed by redraws, skipped if >3 s late). Push: `_process_timer()` (SQL) sends milestone alerts (15 in, 10/5 left, extra time, time's up) and finalizes an expired timer; it is row-locked and called both by the once-a-minute `check_timer_alerts()` cron job and by the control page's `finalize` action, so an alert is never sent twice. Timers untouched for 30 days are deleted by a daily cron job.

**Push pipeline:** SQL `_send_push()` → `net.http_post` to the Edge Function (`send-timer-push/index.ts`, Deno) with an `x-push-secret` header and only an **event name** → the function builds the fixed message text, sends to subscribers (endpoint host allowlist, dead subs removed) → `sw.js` shows it (`renotify`, click focuses/opens the right timer). URL and secret are stored in `private_config` (set via `sql/03_push_config.sql`); the function must be deployed with JWT verification **off** and the same `PUSH_SHARED_SECRET`.

**Per-device state** is in `localStorage` (all wrapped in try/catch): `rt_my_timers` (saved timers incl. tokens, max 30, validated on read), `tz_color_theme`, `tz_clock_style`, `tz_clock_size`, `tz_quiet_mode`, `tz_tour_seen`.

## SQL migrations

`sql/01_setup_or_upgrade.sql` (idempotent; additive; works on fresh or old databases and migrates old tokens/penalties), then `sql/02_lock_down.sql` (drops the old public columns/policies; run only after the new site is live), then `sql/03_push_config.sql` (fill in placeholders first). A fresh project runs 01 then 02. When changing functions, edit 01 (it uses `create or replace`) and re-run it.

## Testing

`cd tests && npm install && npm test` (Node 22+, podman or docker) starts throw-away Postgres + PostgREST containers and runs: SQL suites (security, timer logic, alerts, penalties/push/cleanup), an upgrade-from-v1 test (`tests/fixtures/` holds the original schema and seed data), the app end-to-end in jsdom with real `supabase-js`, and the Edge Function's real source with mocked imports. `--browser` adds real Chrome (CSP, service worker, offline, QR). `tests/live/check-live.js` verifies the DEPLOYED site and Supabase project (read-only; `--write` adds a lifecycle test that creates one "ZZ live check" timer). Read `tests/README.md` for the helpers. When you change SQL, `app.js`, `sw.js` or the Edge Function, run the suite, and add a check for the behaviour you changed (and watch it fail once before trusting it). Not covered: real push delivery, Safari/iOS, the camera scanner, real Realtime websockets.

## Gotchas

- Presets are `GAME_PRESETS` in `app.js`. The times are convenient defaults and have not been checked against current official tournament rules; judges can always use Custom. Verify before adding more games.
- `main_seconds` has a DB minimum of 10 s (UI minimum is 1 min) so a short test round can be made by editing the row.
- `SETUP.md` in `_old/` contained a plaintext VAPID private key; the current one does not. Don't put secrets in docs.
