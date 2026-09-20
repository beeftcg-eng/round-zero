// Post-deploy check of the LIVE site and Supabase project.
//
//   node live/check-live.js            read-only: creates and changes nothing
//   node live/check-live.js --write    also runs a short lifecycle test (creates ONE timer labelled "ZZ live check")
//
//   SITE=https://your-site.vercel.app node live/check-live.js     (defaults to the production URL below)
//
// The Supabase URL and public key are read from ../config.js (both are public by design).
const fs = require('fs'), path = require('path');
const SITE = (process.env.SITE || 'https://turn-zero-nine.vercel.app').replace(/\/$/, '');
const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(__dirname, '../..');
const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const pick = k => (cfg.match(new RegExp(k + ":\\s*'([^']*)'")) || [])[1];
const SUPA = pick('SUPABASE_URL'), KEY = pick('SUPABASE_ANON_KEY');
const APP_VERSION = (fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/APP_VERSION = '([^']*)'/) || [])[1];
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok || x === undefined ? '' : '   -> ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const api = (p, o = {}) => fetch(`${SUPA}/rest/v1${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });
const rpc = async (fn, a) => (await api('/rpc/' + fn, { method: 'POST', body: JSON.stringify(a) })).json();
const NIL = '00000000-0000-0000-0000-000000000000', BAD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

(async () => {
  if (!SUPA || !KEY) { console.error('config.js has no SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(2); }
  console.log(`Checking ${SITE}  (${WRITE ? 'read + write' : 'read-only'})\n`);

  console.log('[website]');
  for (const p of ['/', '/app.js', '/sw.js', '/manifest.json', '/config.js', '/vendor/supabase.js', '/vendor/qrcode.min.js', '/vendor/jsQR.js', '/privacy.html']) {
    const r = await fetch(SITE + p, { redirect: 'manual' }); check(`${p} is served`, r.status === 200, r.status);
  }
  const appjs = await (await fetch(SITE + '/app.js')).text();
  check(`deployed build matches this checkout (${APP_VERSION})`, appjs.includes(`APP_VERSION = '${APP_VERSION}'`));
  const home = await fetch(SITE + '/');
  const h = n => home.headers.get(n) || '';
  check('X-Content-Type-Options: nosniff', /nosniff/i.test(h('x-content-type-options')), h('x-content-type-options'));
  check('X-Frame-Options: DENY (control page cannot be framed)', /deny/i.test(h('x-frame-options')), h('x-frame-options'));
  check("CSP header forbids framing (frame-ancestors 'none')", /frame-ancestors 'none'/.test(h('content-security-policy')), h('content-security-policy'));
  check('Referrer-Policy: no-referrer', /no-referrer/i.test(h('referrer-policy')), h('referrer-policy'));
  check('Permissions-Policy limits the camera to this site', /camera=\(self\)/.test(h('permissions-policy')), h('permissions-policy'));
  check('HSTS present', /max-age=\d+/.test(h('strict-transport-security')));
  check('page CSP (meta) still present', /Content-Security-Policy/.test(await home.text()));
  const sw = await fetch(SITE + '/sw.js');
  check('sw.js is never cached (updates ship immediately)', /no-cache|max-age=0/.test(sw.headers.get('cache-control') || ''), sw.headers.get('cache-control'));
  for (const p of ['/sql/01_setup_or_upgrade.sql', '/sql/02_lock_down.sql', '/tests/run.sh', '/send-timer-push/index.ts', '/SETUP.md', '/CLAUDE.md', '/package.json', '/vercel.json', '/.github/workflows/tests.yml']) {
    const r = await fetch(SITE + p, { redirect: 'manual' });
    check(`${p} is NOT published`, r.status !== 200, r.status);
  }

  console.log('\n[keep-alive]');
  const ka = await fetch(SITE + '/api/keepalive'); const kaj = await ka.json().catch(() => ({}));
  check('/api/keepalive reaches Supabase', ka.status === 200 && kaj.ok === true, JSON.stringify(kaj));

  console.log('\n[database lock-down, as an anonymous attacker]');
  const cols = Object.keys((await (await api('/timers?select=*&limit=1')).json())[0] || {});
  check('public timers row has no control_token / penalties', cols.length > 0 && !cols.includes('control_token') && !cols.includes('penalties'), cols.join(','));
  for (const t of ['timer_secrets', 'timer_penalties', 'private_config', 'timer_push_subscriptions'])
    check(`${t} is unreachable`, [401, 403, 404].includes((await api(`/${t}?select=*`)).status));
  check('direct PATCH on timers is refused', [401, 403].includes((await api(`/timers?id=eq.${NIL}`, { method: 'PATCH', body: '{"label":"x"}' })).status));
  check('direct DELETE on timers is refused', [401, 403].includes((await api(`/timers?id=eq.${NIL}`, { method: 'DELETE' })).status));
  for (const f of ['_process_timer', '_send_push', '_check_token', 'check_timer_alerts', 'cleanup_old_timers'])
    check(`internal function ${f} is unreachable`, [401, 403, 404].includes((await api('/rpc/' + f, { method: 'POST', body: '{}' })).status));
  check('server_time() works', typeof (await rpc('server_time', {})) === 'string');
  check('wrong token is refused by timer_action', (await rpc('timer_action', { p_id: NIL, p_token: BAD, p_action: 'start' })).message === 'invalid_token');
  check('create_timer validates input (no row created)', (await rpc('create_timer', { p_label: 'x', p_game: 'custom', p_round_number: 1, p_setup_seconds: 0, p_main_seconds: 1, p_extra_seconds: 0 })).message === 'bad_value');

  console.log('\n[push Edge Function]');
  for (const [label, headers] of [['no credentials', {}], ['anon key only', { Authorization: 'Bearer ' + KEY }], ['wrong secret', { Authorization: 'Bearer ' + KEY, 'x-push-secret': 'wrong' }]]) {
    const r = await fetch(`${SUPA}/functions/v1/send-timer-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ timer_id: NIL, event: 'start' }) });
    check(`rejects a call with ${label}`, r.status === 401, r.status);
  }
  const spam = await fetch(`${SUPA}/functions/v1/send-timer-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, body: JSON.stringify({ timer_id: NIL, title: 'Free prizes', body: 'click here' }) });
  check('the old "send any text to everyone" trick no longer works', spam.status === 401, spam.status);

  if (WRITE) {
    console.log('\n[lifecycle — creates one timer labelled "ZZ live check"]');
    const t = await rpc('create_timer', { p_label: 'ZZ live check (safe to delete)', p_game: 'custom', p_round_number: 1, p_setup_seconds: 0, p_main_seconds: 10, p_extra_seconds: 0 });
    check('create_timer', !!t.id && !!t.control_token && /^[A-Z0-9]{4}$/.test(t.short_code), JSON.stringify(t));
    const act = (a, n = 0) => rpc('timer_action', { p_id: t.id, p_token: t.control_token, p_action: a, p_amount: n });
    check('start', (await act('start')).status === 'running');
    check('pause', (await act('pause')).status === 'paused');
    check('resume', (await act('resume')).status === 'running');
    const row = async () => (await (await api(`/timers?id=eq.${t.id}&select=status,notified_end`)).json())[0];
    const byCode = await (await api(`/timers?short_code=eq.${t.short_code}&select=id`)).json();
    check('TV code lookup finds it', byCode[0] && byCode[0].id === t.id);
    console.log('  ...waiting for the once-a-minute job to end the unattended 10-second round (up to ~80s)');
    let r; const t0 = Date.now();
    for (let i = 0; i < 45; i++) { await sleep(2000); r = await row(); if (r.status === 'ended') break; }
    check(`server-side job finalized it by itself (${Math.round((Date.now() - t0) / 1000)}s)`, r.status === 'ended' && r.notified_end);
    console.log(`  test timer id (remove with: delete from timers where label like 'ZZ live check%';): ${t.id}`);
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} live checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('LIVE CHECK ERROR', e); process.exit(2); });
