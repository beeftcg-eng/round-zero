# TurnZero tests

```
cd tests
npm install
npm test                # SQL + upgrade + app + Edge Function      (~30 s)
npm run test:browser    # ...plus real Chrome (set CHROME_PATH, or CHROME_URL to attach to a running one)
npm run test:live       # read-only checks of your DEPLOYED site and Supabase project
node live/check-live.js --write     # ...plus a short lifecycle test that creates one "ZZ live check" timer
```

Needs Node 22+ and podman or docker. `npm test` starts a throw-away Postgres and PostgREST in containers and removes
them afterwards. It never contacts your real Supabase project. CI runs the same thing on every push
(`.github/workflows/tests.yml`).

## What is covered

| Suite | What it proves |
|---|---|
| `sql/10_security` | The public role can read `timers` and do nothing else: no secrets, no direct writes, no internal functions, no bad push endpoints |
| `sql/20_timer_logic` | The timer state machine, driven through `timer_action` exactly as the site drives it |
| `sql/30_alerts` | Every push milestone fires once, in order; short rounds, late jobs, re-arming after added time, no double time's-up |
| `sql/40_penalties_push_cleanup` | Penalties, push subscriptions, the creation rate limit and the 30-day cleanup |
| `sql/50a`, `50b` | Upgrading a real v1 database (with data): old control links, penalties and subscriptions survive both steps |
| `e2e/app.test.js` | The real `app.js` + real `supabase-js` in jsdom against real PostgREST + Postgres: create, run, pause, adjust, penalties, view/TV/multi pages, XSS attempts |
| `e2e/edge.test.mjs` | The real Edge Function source: authentication, fixed messages, dead-subscription cleanup |
| `browser/chrome.test.js` | Real Chrome: CSP, service worker, offline loading, QR code, live clock |
| `live/check-live.js` | Your deployed site: headers, unpublished files, lock-down, Edge Function authentication |

## What is NOT covered (test these by hand after big changes)

Real push delivery to a phone, Safari/iOS, the camera QR scanner, and real Supabase Realtime (the browser tests
exercise the polling fallback instead; `live/check-live.js` does not open a websocket either).

## Adding a test

SQL suites are plain psql scripts that call `t.check('name', <boolean>)`; look at `sql/00_helpers.sql` for the helpers
(`t.act` calls the public API as the anonymous role, `t.warp` fast-forwards a running timer, `t.pushes()` lists what the
database asked the Edge Function to send). A suite must end with `select t.finish();`. A good test is one you have seen fail:
break the thing on purpose, confirm the suite goes red, then restore it.
