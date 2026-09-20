# TurnZero — Setup & Upgrade Guide

TurnZero is a static website (hosted from your GitHub repo) plus a Supabase
project (database, live updates, one Edge Function for push alerts). There
are no accounts anywhere.

**Two situations — follow the one that fits:**

- **Upgrading an existing deployment** → do [Part A](#part-a--upgrade-your-existing-deployment) in order.
- **Brand-new project** → do [Part B](#part-b--brand-new-project-from-scratch).

Never skip the order in Part A. It is designed so the live site keeps working
until the very last step.

---

## What's in this folder

| Path | Goes where |
|---|---|
| `index.html`, `app.js`, `sw.js`, `manifest.json`, `privacy.html`, icons, `vendor/` | **Your GitHub repo / hosting** (the website) |
| `config.js` | Website too, but **keep the one already in your repo** (yours has your real keys) |
| `sql/01_setup_or_upgrade.sql` | Supabase SQL Editor — step 1 |
| `sql/02_lock_down.sql` | Supabase SQL Editor — step 2 (after the website is live) |
| `sql/03_push_config.sql` | Supabase SQL Editor — push wiring (fill in two values first) |
| `send-timer-push/index.ts` | Supabase Edge Function code |
| `_old/` | Previous versions, kept only for reference. Safe to delete. |

The `sql/` and `send-timer-push/` folders are not part of the website. You can
leave them out of the GitHub repo, or keep them there for reference — they
contain no secrets.

---

## Part A — Upgrade your existing deployment

You need: your Supabase dashboard, and push access to your GitHub repo.
Set aside ~30 minutes and do this when no event is running.

### A1. Run SQL step 1 (adds things; changes nothing that exists)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the **entire** contents of `sql/01_setup_or_upgrade.sql` → **Run**.
3. Expect a success message (possibly with two small result rows from the
   job scheduler). Nothing about your live site changes yet.

If you see `extension "pg_cron" / "pg_net" is not available`: go to
**Database → Extensions**, search for each, switch them on, then run again.
It is safe to run this file repeatedly.

What this did: copied every existing control token and penalty into new
private tables (so **all existing control links keep working**), added the
server functions, and (re)scheduled the alert and cleanup jobs.

### A2. Update the Edge Function

1. **Edge Functions** → open `send-timer-push` → edit the code.
2. Replace everything with the contents of `send-timer-push/index.ts` → **Deploy**.
   Keep the function name **exactly** `send-timer-push`.
3. In the function's settings, turn **OFF "Verify JWT"** (wording varies:
   "Verify JWT with legacy secret" / "Enforce JWT verification"). The
   function now authenticates with its own secret instead, and will refuse
   any request without it.
4. **Edge Functions → Secrets** → add one new secret:
   - Name: `PUSH_SHARED_SECRET`
   - Value: a long random string. Generate one with `openssl rand -hex 32`
     (or any password generator, 40+ characters, letters and numbers only).
   - Keep a copy of it for step A3.
5. Your existing secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT` stay exactly as they are.

Tip: type or paste secrets via a plain-text editor first — stray spaces at
the end were the cause of confusing errors before.

### A3. Connect the database to the function

1. Open `sql/03_push_config.sql` in a text editor.
2. Replace `YOUR-PROJECT-REF` with your project reference (the part before
   `.supabase.co` in your Project URL).
3. Replace `PASTE-YOUR-RANDOM-SECRET` with the **same** secret from A2.
4. Paste into the SQL Editor → **Run**.

The old version of this step had you paste your `service_role` key into a
SQL function. That is no longer needed anywhere — the key is not stored in
your database any more. (You may want to rotate it, see
[Optional hardening](#optional-hardening).)

### A4. Deploy the new website

In a checkout of your GitHub repo:

1. Copy these from this folder into the repo root, replacing what's there:
   `index.html`, `app.js`, `sw.js`, `manifest.json`, `privacy.html`
2. Copy the whole `vendor/` folder (three files) into the repo root.
3. **Do not overwrite the repo's `config.js`.** It holds your real keys and
   your `DONATION_URL`.
4. Commit and push (any message). Vercel/Netlify redeploys automatically.

Or in the GitHub web UI: **Add file → Upload files**, drag in the files and
the `vendor` folder, commit.

Then confirm it landed: open your site, scroll to the bottom of the home
screen — it must show the newest build number (currently **2.0.1**). If it still shows 1.1.1, the deploy
hasn't finished (check your hosting dashboard) or your browser has an old
copy: hard-refresh (Ctrl+Shift+R), or on a phone clear the site's data once.

At this point the site works. The database is still in "transition" mode, so
both the old and new pages work. **Test before locking down** (A5).

### A5. Test (before you lock the database)

On your phone, open the site and go through this list:

- [ ] Home screen loads, footer shows the new build number
- [ ] **Open one of your existing timers** from "Your timers on this device" — it must open (proves old control links survived)
- [ ] Create a new timer (Custom, 12 minutes) → control page opens
- [ ] Press **Start**; on a second device open the view link → same time on both
- [ ] **Pause**, **Resume**, **+1 min** → the second device follows within a second or two
- [ ] Log a penalty → it appears in the list. Open the **view** link: penalties are **not** visible there
- [ ] Tap **🔔 Get alerts** on the second device and allow notifications. About 2 minutes after starting a 12-minute timer you should get "10 minutes remaining." (Alerts are checked once a minute, so allow up to a minute of slack.)

If a push doesn't arrive, see [Troubleshooting](#troubleshooting).

### A6. Run SQL step 2 (the lock-down)

Only after A5 passes:

1. SQL Editor → New query → paste all of `sql/02_lock_down.sql` → **Run**.
2. Repeat the first three checks of A5 once more (home, open a timer,
   start/pause). Anyone with the *old* page still open needs to reload it.

This is the step that makes it secure: control tokens and penalties leave the
public table, and nobody can write to timers except through the token-checked
functions. It can't be undone with a button — if you ever need to go back,
the old site is in your GitHub history and `_old/`, but the data model
differs, so ask for help rather than improvising.

### A7. Clean up

- Tell anyone who bookmarked an old link: still works. Nothing to redo.
- New control links look like `…?control=ID#t=TOKEN` (token after the `#`).
  Old-style `…&t=TOKEN` links keep working too.

---

## Part B — Brand-new project from scratch

1. **Supabase**: New project (give it its own name). Note the Project URL and
   the anon/publishable key (Project Settings → API).
2. **Extensions**: Database → Extensions → enable `pg_cron` and `pg_net`.
3. **SQL Editor**: run `sql/01_setup_or_upgrade.sql`, then
   `sql/02_lock_down.sql` (each one whole, one after the other).
4. **VAPID keys** (only if you want push alerts): generate a pair with
   `npx web-push generate-vapid-keys`. Public key → `config.js`; both keys →
   Edge Function secrets in step 6.
5. **`config.js`**: set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`
   (and optionally `DONATION_URL`).
6. **Push (optional)**: follow A2 and A3 above (secrets: `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` like `mailto:you@example.com`,
   `PUSH_SHARED_SECRET`).
7. **Host** the website files (see the table at the top) on Vercel/Netlify from
   a GitHub repo. It must be served from the site **root**.

The site works without step 6 — you just won't get notifications.

---

## Troubleshooting

**"Could not create timer" / nothing happens** — Step 1 SQL didn't run (the
functions don't exist). Re-run `01`, then hard-refresh the site.

**Site shows the old look / Build 1.1.1** — deploy not finished or stale cache
(A4).

**Push alerts never arrive**
1. Edge Functions → `send-timer-push` → **Logs**. Nothing at all → the database
   isn't calling it: recheck `03_push_config.sql` (URL and secret), and run
   `select * from private_config;` — both rows should exist.
2. Logs show **401 unauthorized** → the secret in `PUSH_SHARED_SECRET` and the
   one in `private_config` differ (trailing space is the usual culprit), or
   Verify JWT is still on.
3. See what the database sent: `select * from net._http_response order by created desc limit 5;`
4. Logs show `sent 0/…` → nobody has subscribed to that timer yet.

**A viewer sees "Reconnecting…"** — their live connection dropped (phone
slept, bad wifi). The clock keeps counting from its timestamps, and the screen
re-syncs on its own when the connection returns or the phone wakes.

**Custom domain**: the page's security policy (in `index.html`) allows
`https://*.supabase.co`. If you ever put Supabase behind your own domain, add
that domain to `connect-src` (and its `wss://` form).

## Security headers, keep-alive and tests (added after 2.0)

- **Security headers** (`vercel.json`): the site cannot be embedded in another page (protects the control page from
  click-hijacking), browsers may not guess file types, no Referer is sent, and the camera is limited to your own
  site. Vercel already adds HSTS.
- **Non-site files are not published.** `sql/`, `tests/`, `send-timer-push/`, this guide and the config files live in
  the repo but are hidden from the website (`.vercelignore` plus redirects in `vercel.json`). If you add a new
  top-level file or folder that is not part of the website, add it to both.
- **Free-tier keep-alive.** A free Supabase project is paused after about a week without use (check Supabase's
  current policy). Two independent pings prevent that: a daily Vercel cron (`api/keepalive.js`, primary) and a
  twice-weekly GitHub Action (`.github/workflows/keepalive.yml`, backup; GitHub disables scheduled workflows in a
  public repo after 60 days without any repo activity). In Vercel you can see the cron under *Settings → Cron Jobs*.
  Neither needs any secrets: they use the public values already in `config.js`. If a project ever does get paused,
  it can be restored from the Supabase dashboard with one click.
- **Tests.** `cd tests && npm install && npm test`, or push to GitHub and look at the *Actions* tab. After every
  deploy, `node tests/live/check-live.js` verifies the live site and database without changing anything.

## Notifications look wrong (Chrome icon)

Notifications carry the TurnZero icon and a monochrome status-bar badge. If yours still show Chrome's icon, the phone
is running an older copy of the service worker: open the site once (it updates itself), then close and reopen it.

## Everyday use

- **Judge / store owner:** create a timer on the home page — you land on the
  control page. The same timer covers the whole event: **Next round** between
  rounds. Your saved timers list is per-browser; use **Copy control link** on
  the control page to open the same timer on a second device
  (paste it under "Have a control link already?").
- **Players:** scan the QR code or open the view link — read-only and live.
  **📷 Scan QR** on the home screen only opens TurnZero timer links.
- **TV / store screen:** type the 4-character code from the control page on
  the TV's browser, or check up to 4 timers and tap **View selected together**.
  Use **⛶ Fullscreen**. Screens stay awake while a timer is open.
- **Adding time:** before a round starts, ±min changes the round length; during
  a round it moves the clock; after time is up, **+min** reopens the clock
  *paused* with that much time on it.
- **Penalties:** judge-only and stored privately (players cannot see them, even
  by inspecting the site). They persist across rounds. **Copy list** /
  **Download CSV** to export, **Clear all** to wipe at the end of the event.
- **Automatic deletion:** timers untouched for 30 days are deleted together
  with their penalties and push subscriptions.

## Optional hardening

- **Rotate your `service_role` key** (Project Settings → API): the old
  `SETUP.md` told you to paste it into a SQL function, so an old copy of that
  function may still hold it. After running step 1 it no longer does, but
  rotating costs nothing. The website and Edge Function don't depend on the
  value you'd be replacing (Edge Functions receive the current key automatically).
- **Rotate the VAPID key pair** if you're concerned the private key in the old
  `SETUP.md` was seen by anyone: generate a new pair, update `config.js`
  (public) and the Edge Function secrets (both). Everyone re-enables alerts once.
- **Alerts are checked once a minute**, so a "10 minutes remaining" push can be
  up to a minute late. Supabase's scheduler supports second-level schedules on
  recent versions, if you want tighter timing: change `'* * * * *'` to `'30 seconds'` in the
  `cron.schedule('check-timer-alerts', …)` line of step 1 and re-run it.

## Cost

Supabase's free tier and Vercel/Netlify's free tier comfortably cover this.
A custom domain (~$10–15/year) is the only real cost, and optional.
