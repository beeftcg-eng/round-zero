// Real-Chrome test: CSP, fonts-free rendering, service worker + offline shell, QR code, live clock.
// Launches Chrome itself (CHROME_PATH, default "google-chrome"), or connects to a running one (CHROME_URL=http://127.0.0.1:9222).
const puppeteer = require('puppeteer-core');
const { start } = require('./server');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = Number(process.env.SITE_PORT || 8091);
const B = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (n, ok, extra) => { results.push(!!ok); console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (ok || extra === undefined ? '' : '  -> ' + extra)); };

(async () => {
  if (!process.env.API || !process.env.ANON_KEY) { console.error('Run this through run.sh --browser.'); process.exit(2); }
  const server = await start(PORT, process.env.API, process.env.ANON_KEY);
  const viewport = { width: 430, height: 900, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const browser = process.env.CHROME_URL
    ? await puppeteer.connect({ browserURL: process.env.CHROME_URL, defaultViewport: viewport })
    : await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'], defaultViewport: viewport });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const violations = [], errors = [], consoleMsgs = [];
  page.on('console', m => { const t = m.text(); consoleMsgs.push(t); if (/CSPV|Content Security Policy|Refused to/i.test(t)) violations.push(t); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('tz_tour_seen', '1');
    document.addEventListener('securitypolicyviolation', e => console.log('CSPV ' + e.violatedDirective + ' ' + e.blockedURI));
  });
  page.on('dialog', d => d.accept());
  const shots = process.env.SHOTS;   // optional directory for screenshots
  const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
  try {
    console.log('[home]');
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    check('home renders', !!(await page.$('.brand')));
    check('no CSP violations on home', violations.length === 0, violations.join(' | '));
    await shot('home');

    console.log('[create -> control]');
    await page.type('#newLabel', 'Browser test');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#createBtn')]);
    const url = page.url();
    check('control link keeps the token in the #fragment', /\?control=[0-9a-f-]{36}#t=[0-9a-f-]{36}$/.test(url), url);
    await page.waitForSelector('.big-clock');
    check('clock shows 50:00', (await page.$eval('.big-clock', e => e.textContent)) === '50:00');
    await page.waitForSelector('#qrHolder img, #qrHolder canvas', { timeout: 5000 }).catch(() => {});
    check('QR code renders (lazy-loaded library + data: image allowed by CSP)', !!(await page.$('#qrHolder img, #qrHolder canvas')));
    await page.click('#btnStart'); await page.waitForSelector('#btnPause'); await sleep(2200);
    const clock = await page.$eval('.big-clock', e => e.textContent);
    check('clock counts down', /^49:5\d$/.test(clock), clock);
    check('tab title shows the time left', /^49:5\d · Browser test/.test(await page.title()), await page.title());
    check('no CSP violations on the control page', violations.length === 0, violations.join(' | '));
    await shot('control');

    console.log('[service worker + offline]');
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 1500));
      const keys = await caches.keys(); const c = keys.length ? await (await caches.open(keys[0])).keys() : [];
      return { active: !!reg.active, keys, cached: c.map(r => new URL(r.url).pathname) };
    });
    check('service worker is active', sw.active);
    check('app shell and vendor libraries are precached', ['/app.js', '/index.html', '/config.js', '/badge-96.png', '/vendor/supabase.js', '/vendor/qrcode.min.js', '/vendor/jsQR.js'].every(p => sw.cached.includes(p)), sw.cached.join(','));
    await page.goto(B + '/', { waitUntil: 'networkidle2' });
    await page.setOfflineMode(true);
    await page.goto(B + '/?view=00000000-0000-0000-0000-000000000000', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
    check('offline: the page still loads from the service worker (not the browser error page)', await page.evaluate(() => !!document.querySelector('#app') && document.querySelector('#app').innerHTML.length > 0));
    await page.setOfflineMode(false);

    console.log('[view page + security]');
    const id = url.match(/control=([0-9a-f-]{36})/)[1];
    await page.goto(`${B}/?view=${id}`, { waitUntil: 'networkidle2' }); await page.waitForSelector('.big-clock');
    check('view page has no control UI', !(await page.$('#btnStart, #btnPause, #openPenaltyForm')));
    const injected = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.body.appendChild(s); return !!window.__pwned; });
    check('CSP blocks an injected inline <script>', injected === false);
    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
    const bad = consoleMsgs.filter(t => /error/i.test(t) && !/WebSocket|realtime|net::ERR|Failed to load resource|CSPV/i.test(t));
    check('no unexpected console errors', bad.length === 0, bad.join(' | '));
    const appViolations = violations.filter(v => !/script-src-elem.*inline|inline/i.test(v));
    check('nothing but the deliberate inline-script probe triggered the CSP', appViolations.length === 0, appViolations.join(' | '));
  } finally {
    await ctx.close().catch(() => {});
    if (process.env.CHROME_URL) await browser.disconnect(); else await browser.close();
    server.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} browser checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('BROWSER TEST ERROR', e); process.exit(2); });
