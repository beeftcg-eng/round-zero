# TurnZero

A shared round timer for TCG events. A judge creates a timer and gets a private control link; players open a
read-only view link (or scan a QR code, or type a 4-character code on a TV) and watch the clock live.
No accounts, nothing to install. Optional push alerts at 15 min in, 10 / 5 min left, extra time and time's up.

Static website + [Supabase](https://supabase.com) (database, realtime, one Edge Function), hosted on Vercel.

| Folder / file | What it is |
|---|---|
| `index.html`, `app.js`, `sw.js`, `manifest.json`, `vendor/`, icons | The website (`config.js` holds the per-deployment Supabase settings) |
| `api/keepalive.js`, `vercel.json` | Security headers and a daily ping that stops a free Supabase project from pausing |
| `sql/` | Database setup and upgrade scripts (run in the Supabase SQL Editor, in order) |
| `send-timer-push/` | The Edge Function that delivers push notifications |
| `tests/` | The test suite — `cd tests && npm install && npm test` (needs Node 22+ and podman or docker) |
| `SETUP.md` | Step-by-step setup and upgrade guide |
| `CLAUDE.md` | Architecture notes (also useful for humans) |

`sql/`, `tests/`, `send-timer-push/` and the docs live in this repo but are **not** published on the website
(see `.vercelignore` and the redirects in `vercel.json`).
