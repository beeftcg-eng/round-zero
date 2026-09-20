// App end-to-end test: the REAL app.js and REAL supabase-js run in jsdom against a REAL PostgREST + Postgres.
// (Realtime websockets are not available here, so this also exercises the polling/refetch fallback.)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');            // the website files live at the repo root
const API = process.env.API;                              // PostgREST, started by run.sh
const ANON = process.env.ANON_KEY;
if (!API || !ANON) { console.error('Run this through run.sh (it starts the database and API and sets API / ANON_KEY).'); process.exit(2); }
const SUPA = fs.readFileSync(ROOT + '/vendor/supabase.js', 'utf8');
const APPJS = fs.readFileSync(ROOT + '/app.js', 'utf8');
const QR = fs.readFileSync(ROOT + '/vendor/qrcode.min.js', 'utf8');

const results = []; const problems = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok || !extra ? '' : '   -> ' + extra)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(50); }
  return null;
}
const rest = async (path, opts = {}) => (await fetch(API + path, { ...opts, headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json', ...(opts.headers || {}) } }));
const rpcCall = async (fn, args) => (await rest('/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) })).json();
async function rowOf(id) { return (await (await rest(`/timers?id=eq.${id}&select=*`)).json())[0]; }

function open(url, opts = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented: navigation/.test(e.message)) problems.push(url + ' :: ' + (e.detail || e.message)); });
  vc.on('error', (...a) => { problems.push('console.error :: ' + a.map(String).join(' ').slice(0, 200)); });
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  // Real fetch, with Supabase's /rest/v1 prefix stripped because PostgREST here serves at the root.
  w.fetch = (u, o) => fetch(String(u).replace('/rest/v1', ''), o);
  w.Headers = Headers; w.Request = Request; w.Response = Response;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {} });
  w.confirm = () => true;
  w.eval(QR);
  const origAppend = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = n => { const r = origAppend(n); if (n.tagName === 'SCRIPT') setTimeout(() => n.onload && n.onload(), 0); return r; }; // libs are pre-loaded above
  w.ROUNDTIMER_CONFIG = { SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, VAPID_PUBLIC_KEY: '' };
  if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
  w.localStorage.setItem('tz_tour_seen', '1');
  w.eval(SUPA);
  w.eval(APPJS);
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const text = (w, s) => { const e = $(w, s); return e ? e.textContent.trim() : null; };

(async () => {
  console.log('\n[1] HOME + CREATE');
  let w = open('http://localhost:8080/');
  check('home renders', await waitFor(() => $(w, '.brand')));
  const chips = [...w.document.querySelectorAll('#gameChips .chip')].map(c => c.textContent);
  check('game presets include Magic', chips.some(c => /Magic/.test(c)), chips.join(','));
  const BUILD = (APPJS.match(/APP_VERSION = '([^']*)'/) || [])[1];
  check('footer shows the build number from app.js (' + BUILD + ')', BUILD && w.document.body.textContent.includes('Build: ' + BUILD));
  $(w, '#newLabel').value = 'E2E <img src=x onerror=alert(1)> table';
  $(w, '#createBtn').click();
  const mine = await waitFor(() => { const l = JSON.parse(w.localStorage.getItem('rt_my_timers') || '[]'); return l.length ? l : null; });
  check('timer created and saved on device', mine && mine.length === 1);
  const { id: ID, control_token: TOK } = mine[0];
  const row = await rowOf(ID);
  check('DB row has clamped label + short code', row && row.short_code && row.short_code.length === 4 && row.main_seconds === 3000, JSON.stringify(row && [row.short_code, row.main_seconds]));
  w.close();

  console.log('\n[2] CONTROL PAGE (token in #fragment)');
  w = open(`http://localhost:8080/?control=${ID}#t=${TOK}`);
  check('control page renders clock', await waitFor(() => $(w, '.big-clock')));
  check('clock shows 50:00 before start', text(w, '.big-clock') === '50:00', text(w, '.big-clock'));
  check('label is escaped (no injected <img>)', !$(w, '#app img') && /E2E/.test(text(w, '.event-label')));
  check('tab title set', /TurnZero/.test(w.document.title), w.document.title);
  $(w, '#btnStart').click();
  check('Start -> Pause button appears', await waitFor(() => $(w, '#btnPause')));
  let r = await rowOf(ID);
  check('DB: running, server-stamped running_since', r.status === 'running' && r.running_since, r.status);
  await sleep(2300);
  const t1 = text(w, '.big-clock'); 
  check('clock counting down (49:5x)', /^49:5\d$/.test(t1), t1);
  check('server clock offset applied (clock within 3s of truth)', (() => { const [m, s] = t1.split(':').map(Number); const rem = m * 60 + s; const el = (Date.now() - new Date(r.running_since).getTime()) / 1000; return Math.abs((3000 - el) - rem) <= 3; })());
  // double-tap protection
  $(w, '#btnPause').click(); $(w, '#btnPause') && $(w, '#btnPause').click();
  check('Pause -> Resume appears', await waitFor(() => $(w, '#btnResume')));
  r = await rowOf(ID);
  check('DB: paused with ~2s accumulated', r.status === 'paused' && r.accumulated_seconds > 1.5 && r.accumulated_seconds < 6, r.accumulated_seconds);
  $(w, '#btnResume').click();
  await waitFor(() => $(w, '#btnPause'));
  w.document.querySelector('[data-adj="5"]').click();
  await waitFor(async () => true); await sleep(600);
  r = await rowOf(ID);
  check('adjust +5 min logged and elapsed reduced', r.adjustments.length === 1 && r.adjustments[0].note === '+5 min' && r.accumulated_seconds < 1, JSON.stringify(r.adjustments) + ' acc=' + r.accumulated_seconds);
  check('adjustment log shown on page', /\+5 min/.test(text(w, '.card:has(.log-row)') || w.document.body.textContent));
  $(w, '#btnEnd').click();
  check('End -> Next round + status ended', await waitFor(() => $(w, '#btnNextRound') && !$(w, '#btnPause')));
  w.document.querySelector('[data-adj="2"]') || 0;
  w.document.querySelectorAll('[data-adj]').forEach(b => { if (b.dataset.adj === '1') b.click(); });
  await sleep(800); r = await rowOf(ID);
  check('adding time after end reopens clock PAUSED', r.status === 'paused', r.status);

  console.log('\n[3] PENALTIES (private, private table, escaped)');
  $(w, '#openPenaltyForm').click();
  $(w, '#pPlayer').value = 'Zed <b>bold</b>'; $(w, '#pNote').value = '=HYPERLINK("x")';
  $(w, '#savePenaltyBtn').click();
  check('penalty appears in list', await waitFor(() => /Zed/.test(text(w, '#penaltyList') || '')));
  check('penalty text escaped (no <b> element)', !$(w, '#penaltyList b'));
  check('form stays open after save', $(w, '#penaltyForm').style.display === 'block');
  const pens = await rpcCall('list_penalties', { p_id: ID, p_token: TOK });
  check('penalty stored server-side via RPC', Array.isArray(pens) && pens.length === 1 && pens[0].player_name.startsWith('Zed'));
  const pub = await (await rest(`/timers?id=eq.${ID}&select=*`)).json();
  check('penalties NOT present on public row', !('penalties' in pub[0]) && !JSON.stringify(pub).includes('Zed'));
  // form state survives a redraw triggered by another device changing the timer
  $(w, '#pPlayer').value = 'half-typed name'; $(w, '#pPlayer').focus();
  await rpcCall('timer_action', { p_id: ID, p_token: TOK, p_action: 'round_delta', p_amount: 1 });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  check('other-device change arrives (round 2)', await waitFor(() => /Round 2/.test(text(w, '.round-label') || '')));
  check('half-typed penalty form survived the redraw', $(w, '#pPlayer').value === 'half-typed name' && $(w, '#penaltyForm').style.display === 'block', $(w, '#pPlayer') && $(w, '#pPlayer').value);
  w.document.querySelector('[data-del-penalty]').click();
  check('delete penalty empties list', await waitFor(() => /No penalties/.test(text(w, '#penaltyList') || '')));

  console.log('\n[4] NEXT ROUND / RESTART / CONNECTION BANNER');
  $(w, '#btnNextRound').click();
  check('next round -> idle Start button', await waitFor(() => $(w, '#btnStart')));
  await sleep(6300);
  check('"Reconnecting" banner shows when realtime is unavailable', !!$(w, '#connBanner'));
  w.close();

  console.log('\n[5] VIEW PAGE (read-only)');
  w = open(`http://localhost:8080/?view=${ID}`);
  check('view page renders', await waitFor(() => $(w, '.big-clock')));
  check('no control buttons on view page', !$(w, '#btnStart') && !$(w, '#openPenaltyForm') && !/Penalt/.test(w.document.body.textContent));
  check('view page has no injected <img>', !$(w, '#app img'));
  check('view page leaks no token in DOM', !w.document.documentElement.innerHTML.includes(TOK));
  w.close();

  console.log('\n[6] TV CODE + MULTI + BAD LINKS');
  const code = (await rowOf(ID)).short_code;
  w = open(`http://localhost:8080/?tv=${code.toLowerCase()}`);
  check('TV code lookup opens the timer', await waitFor(() => $(w, '.big-clock')));
  w.close();
  w = open('http://localhost:8080/?tv=ZZZZ'); check('unknown TV code -> Code not found', await waitFor(() => /Code not found/.test(w.document.body.textContent))); w.close();
  w = open('http://localhost:8080/?tv=%3Cscript%3E'); check('malformed TV code rejected', await waitFor(() => /Code not found/.test(w.document.body.textContent))); w.close();
  const second = await rpcCall('create_timer', { p_label: 'Second', p_game: 'custom', p_round_number: 1, p_setup_seconds: 0, p_main_seconds: 600, p_extra_seconds: 60 });
  w = open(`http://localhost:8080/?multi=${ID},${second.id},not-a-uuid`);
  check('multi view shows 2 clocks (bad id dropped)', await waitFor(() => w.document.querySelectorAll('.multi-cell').length === 2));
  check('multi clocks populated', /\d\d:\d\d/.test(text(w, '.multi-cell .big-clock')));
  w.close();
  w = open('http://localhost:8080/?view=not-a-uuid'); check('non-UUID view link -> Timer not found', await waitFor(() => /Timer not found/.test(w.document.body.textContent))); w.close();
  w = open(`http://localhost:8080/?control=${ID}#t=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`);
  check('wrong control token -> Invalid control link', await waitFor(() => /Invalid control link/.test(w.document.body.textContent))); 
  check('wrong token gets no controls', !$(w, '#btnStart')); w.close();
  w = open(`http://localhost:8080/?control=${ID}&t=${TOK}`);
  check('old-style ?control=&t= links still work', await waitFor(() => $(w, '#btnStart') || $(w, '#btnResume') || $(w, '#btnPause'))); w.close();

  console.log('\n[7] HOME: paste control link, poisoned localStorage, live status');
  const poisoned = [{ id: '"><img src=x onerror=alert(1)>', control_token: 'x', label: 'evil' }, { id: ID, control_token: TOK, label: 'stale label' }, { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', control_token: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', label: 'deleted timer' }];
  w = open('http://localhost:8080/', { storage: { rt_my_timers: JSON.stringify(poisoned) } });
  await waitFor(() => $(w, '.brand'));
  await waitFor(() => w.document.querySelectorAll('.timer-item').length === 1 && /Round/.test(text(w, '.timer-item .m') || ''));
  check('malformed saved entry never rendered / no injected <img>', !$(w, '#app img'));
  check('deleted timer pruned, live one kept with fresh label + status', w.document.querySelectorAll('.timer-item').length === 1 && /E2E/.test(text(w, '.timer-item .n')) && /Round \d+ · /.test(text(w, '.timer-item .m')), text(w, '.timer-item .n') + ' | ' + text(w, '.timer-item .m'));
  $(w, '#pasteControlLink').value = `http://localhost:8080/?control=${second.id}#t=${second.control_token}`;
  $(w, '#addExistingBtn').click();
  check('pasting a valid control link adds it', await waitFor(() => w.document.querySelectorAll('.timer-item').length === 2));
  $(w, '#pasteControlLink').value = `http://localhost:8080/?control=${second.id}#t=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
  $(w, '#addExistingBtn').click(); await sleep(800);
  check('pasting a WRONG-token link is rejected', w.document.querySelectorAll('.timer-item').length === 2);
  $(w, '#pasteControlLink').value = `http://localhost:8080/?control="><img src=x>&t=zzz`;
  $(w, '#addExistingBtn').click(); await sleep(300);
  check('pasting a malformed link is rejected', w.document.querySelectorAll('.timer-item').length === 2 && !$(w, '#app img'));
  w.close();

  console.log('\n[8] CLIENT NEVER SENDS TIMESTAMPS; SERVER DOES (clock-skew immunity)');
  const src = APPJS;
  check('app.js has no client-side running_since writes', !/running_since\s*:\s*new Date/.test(src) && !/toISOString\(\)/.test(src));
  const badScan = ['javascript:alert(1)', 'https://evil.example/?view=1', 'http://localhost:9999/?view=1'];
  check('scanner only accepts same-origin timer links (source check)', /u\.origin !== window\.location\.origin/.test(src) && /searchParams\.has\('view'\)/.test(src));

  console.log('\n' + '='.repeat(60));
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (problems.length) { console.log('\nUncaught errors / console.error in the app:'); [...new Set(problems)].forEach(p => console.log('  ! ' + p)); }
  else console.log('No uncaught errors or console.error output from the app.');
  process.exit(failed.length || problems.length ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS CRASH', e); process.exit(2); });
