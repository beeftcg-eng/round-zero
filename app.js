// TurnZero — client app. Loaded by index.html (kept as an external file so the
// page's Content-Security-Policy can forbid inline scripts entirely).
(function(){
  'use strict';
  const CFG = window.ROUNDTIMER_CONFIG || {};
  const SUPABASE_URL = CFG.SUPABASE_URL || 'YOUR_SUPABASE_URL';
  const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
  const VAPID_PUBLIC_KEY = CFG.VAPID_PUBLIC_KEY || '';
  const DONATION_URL = CFG.DONATION_URL || '';
  const APP_VERSION = '2.0.1'; // bumped each time this file is updated — check the home screen footer to confirm a deploy actually landed

  // ---------- Per-device customization (no accounts here, so this lives in localStorage) ----------
  const COLOR_THEMES = {
    default:  { label: 'Default (Purple/Teal)', setup:'#5b8def', main:'#34d399', extra:'#f5b942', ended:'#f5455c' },
    ocean:    { label: 'Ocean',                 setup:'#38bdf8', main:'#22d3ee', extra:'#fbbf24', ended:'#f87171' },
    forest:   { label: 'Forest',                setup:'#4ade80', main:'#84cc16', extra:'#facc15', ended:'#f87171' },
    sunset:   { label: 'Sunset',                 setup:'#fb923c', main:'#f472b6', extra:'#fbbf24', ended:'#ef4444' },
    contrast: { label: 'High Contrast',          setup:'#ffffff', main:'#ffff00', extra:'#ff9900', ended:'#ff2020' }
  };
  function getSavedColorTheme(){ try{ return localStorage.getItem('tz_color_theme') || 'default'; }catch(e){ return 'default'; } }
  function applyColorTheme(key){
    const t = COLOR_THEMES[key] || COLOR_THEMES.default;
    const s = document.documentElement.style;
    s.setProperty('--setup', t.setup);
    s.setProperty('--main', t.main);
    s.setProperty('--extra', t.extra);
    s.setProperty('--ended', t.ended);
    try{ localStorage.setItem('tz_color_theme', key); }catch(e){}
  }
  function getSavedClockStyle(){ try{ return localStorage.getItem('tz_clock_style') || 'digits'; }catch(e){ return 'digits'; } }
  function applyClockStyle(style){
    document.body.classList.toggle('tz-style-bar', style === 'bar');
    try{ localStorage.setItem('tz_clock_style', style); }catch(e){}
  }
  function getSavedClockSize(){ try{ return localStorage.getItem('tz_clock_size') || 'normal'; }catch(e){ return 'normal'; } }
  function applyClockSize(size){
    document.body.classList.toggle('tz-size-large', size === 'large');
    try{ localStorage.setItem('tz_clock_size', size); }catch(e){}
  }
  function getSavedQuietMode(){ try{ return localStorage.getItem('tz_quiet_mode') === '1'; }catch(e){ return false; } }
  function setSavedQuietMode(on){ try{ localStorage.setItem('tz_quiet_mode', on?'1':'0'); }catch(e){} }
  function getPhaseTotal(timer, phase){
    if(phase==='setup') return timer.setup_seconds || 1;
    if(phase==='main') return timer.main_seconds || 1;
    if(phase==='extra') return timer.extra_seconds || 1;
    return 1;
  }
  function updateClockBar(elementId, timer, info){
    const el = document.getElementById(elementId);
    if(!el) return;
    const total = getPhaseTotal(timer, info.phase);
    const pct = total>0 ? Math.max(0, Math.min(100, ((total-info.remaining)/total)*100)) : 0;
    el.style.width = pct + '%';
    el.style.color = `var(--${info.phase==='idle'?'setup':info.phase})`;
  }
  function openCustomizeModal(){
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    const currentTheme = getSavedColorTheme();
    const currentStyle = getSavedClockStyle();
    const currentSize = getSavedClockSize();
    const currentQuiet = getSavedQuietMode();
    overlay.innerHTML = `
      <div class="tour-card" style="text-align:left;max-width:380px;">
        <h2 style="margin-bottom:14px;text-align:center;">🎨 Customize</h2>
        <div style="font-size:12px;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Color theme</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
          ${Object.entries(COLOR_THEMES).map(([key,t])=>`
            <button type="button" class="btn ${key===currentTheme?'btn-primary':'btn-secondary'}" data-theme="${key}" style="font-size:12px;padding:8px 12px;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.main};margin-right:6px;"></span>${t.label}
            </button>`).join('')}
        </div>
        <div style="font-size:12px;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Clock style</div>
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button type="button" class="btn ${currentStyle==='digits'?'btn-primary':'btn-secondary'}" data-style="digits" style="flex:1;font-size:13px;">Digits only</button>
          <button type="button" class="btn ${currentStyle==='bar'?'btn-primary':'btn-secondary'}" data-style="bar" style="flex:1;font-size:13px;">Digits + bar</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Clock size</div>
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button type="button" class="btn ${currentSize==='normal'?'btn-primary':'btn-secondary'}" data-size="normal" style="flex:1;font-size:13px;">Normal</button>
          <button type="button" class="btn ${currentSize==='large'?'btn-primary':'btn-secondary'}" data-size="large" style="flex:1;font-size:13px;">Large</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Sound</div>
        <div style="display:flex;gap:8px;margin-bottom:6px;">
          <button type="button" class="btn ${!currentQuiet?'btn-primary':'btn-secondary'}" data-quiet="0" style="flex:1;font-size:13px;">All alerts</button>
          <button type="button" class="btn ${currentQuiet?'btn-primary':'btn-secondary'}" data-quiet="1" style="flex:1;font-size:13px;">Quiet mode</button>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:20px;">Quiet mode mutes the 15/10/5-minute chimes — the time's-up alarm always plays.</div>
        <button class="btn btn-secondary" id="closeCustomize" style="width:100%;">Done</button>
        ${DONATION_URL ? `<div style="text-align:center;margin-top:14px;"><a href="${escapeAttr(DONATION_URL)}" target="_blank" rel="noopener" style="color:var(--text-dim);font-size:12px;text-decoration:underline;">💛 Support this project</a></div>` : ''}
      </div>`;
    document.body.appendChild(overlay);
    overlay.onclick = (e)=>{ if(e.target===overlay) overlay.remove(); };
    overlay.querySelector('#closeCustomize').onclick = ()=>overlay.remove();
    overlay.querySelectorAll('[data-theme]').forEach(btn=>{
      btn.onclick = ()=>{ applyColorTheme(btn.dataset.theme); overlay.remove(); openCustomizeModal(); };
    });
    overlay.querySelectorAll('[data-style]').forEach(btn=>{
      btn.onclick = ()=>{ applyClockStyle(btn.dataset.style); overlay.remove(); openCustomizeModal(); };
    });
    overlay.querySelectorAll('[data-size]').forEach(btn=>{
      btn.onclick = ()=>{ applyClockSize(btn.dataset.size); overlay.remove(); openCustomizeModal(); };
    });
    overlay.querySelectorAll('[data-quiet]').forEach(btn=>{
      btn.onclick = ()=>{ setSavedQuietMode(btn.dataset.quiet==='1'); overlay.remove(); openCustomizeModal(); };
    });
  }
  applyColorTheme(getSavedColorTheme());
  applyClockStyle(getSavedClockStyle());
  applyClockSize(getSavedClockSize());

  // ---------- Install prompt ----------
  let deferredInstallPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  async function handleInstallClick(){
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if(choice && choice.outcome === 'accepted') showToast('Installed!');
    } else {
      // No programmatic prompt available (Safari/iOS, or a browser that
      // doesn't support it) — fall back to manual instructions.
      openManualInstallGuide();
    }
  }
  function openManualInstallGuide(){
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.innerHTML = `
      <div class="tour-card" style="text-align:left;">
        <h2 style="text-align:center;margin-bottom:14px;">📲 Install TurnZero</h2>
        ${isIOS ? `
          <ol style="line-height:1.8;padding-left:20px;">
            <li>Open this page in <strong>Safari</strong> (not Chrome — installing only works from Safari on iOS).</li>
            <li>Tap the Share button (square with an arrow up).</li>
            <li>Scroll down and tap "Add to Home Screen."</li>
            <li>Tap "Add" in the top right.</li>
          </ol>
        ` : `
          <ol style="line-height:1.8;padding-left:20px;">
            <li>Look for an install icon in your browser's address bar, or open the browser's menu.</li>
            <li>Look for "Install app" or "Add to Home screen."</li>
            <li>Confirm to install.</li>
          </ol>
        `}
        <button class="btn btn-secondary" id="closeManualGuide" style="width:100%;margin-top:6px;">Got it</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.onclick = (e)=>{ if(e.target===overlay) overlay.remove(); };
    overlay.querySelector('#closeManualGuide').onclick = ()=>overlay.remove();
  }


  const configured = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 15;
  const app = document.getElementById('app');

  if(!configured){
    app.innerHTML = `
      <div class="wrap">
        <div class="card">
          <h2>⚙️ One setup step</h2>
          <p style="color:var(--text-dim);line-height:1.6;">This app needs a free Supabase project. Follow <code>SETUP.md</code>, then edit <code>config.js</code> with your Project URL and anon key, and reload.</p>
        </div>
      </div>`;
    return;
  }
  if(!window.supabase || !window.supabase.createClient){
    app.innerHTML = `<div class="wrap"><div class="error-box"><div class="big">Couldn't load the app</div><div class="sub">A required file didn't load. Check your connection and reload.</div></div></div>`;
    return;
  }

  // No accounts and no sessions here — don't let the library store anything or take locks.
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(s){ return typeof s === 'string' && UUID_RE.test(s); }
  function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

  // Only the columns viewers are meant to see (secrets no longer exist on this table at all).
  const TIMER_COLS = 'id,label,game,round_number,setup_seconds,main_seconds,extra_seconds,status,accumulated_seconds,running_since,adjustments,short_code,penalties_rev,updated_at';

  // Calls a database function and never throws: resolves to { data } or { error }.
  async function rpc(name, args){
    try{
      const { data, error } = await supabase.rpc(name, args);
      return error ? { error } : { data };
    }catch(e){ return { error: e }; }
  }
  function errorText(error){
    const m = String((error && (error.message || error.code)) || '');
    if(m.includes('invalid_token')) return 'This control link is no longer valid';
    if(m.includes('too_many')) return 'Too many requests — wait a moment and try again';
    return 'Could not update — check your connection';
  }

  // ---------- Clock ----------
  // Every timestamp is written by the SERVER (running_since etc.), so all that's needed here
  // is how far this device's clock is from the server's, for displaying the countdown.
  // The server_time() function replaces the old HTTP Date-header trick, which browsers block cross-origin.
  let serverTimeOffsetMs = 0;
  async function syncServerTime(samples){
    let best = null;
    for(let i=0;i<(samples || 3);i++){
      const t0 = Date.now();
      const { data, error } = await rpc('server_time');
      const t1 = Date.now();
      if(error || !data) continue;
      const serverMs = new Date(data).getTime();
      if(isNaN(serverMs)) continue;
      const rtt = t1 - t0;
      const offset = serverMs - (t0 + rtt/2); // the server read its clock about halfway through the round trip
      if(!best || rtt < best.rtt) best = { rtt, offset };
    }
    if(best) serverTimeOffsetMs = best.offset;
  }
  function nowMs(){ return Date.now() + serverTimeOffsetMs; }

  // ---------- Push notifications ----------
  function urlBase64ToUint8Array(base64String){
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
    const rawData = atob(base64);
    const arr = new Uint8Array(rawData.length);
    for(let i=0;i<rawData.length;i++) arr[i] = rawData.charCodeAt(i);
    return arr;
  }
  async function getPushEndpoint(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      return sub ? sub.endpoint : null;
    }catch(e){ return null; }
  }
  async function isSubscribedToTimer(timerId){
    const endpoint = await getPushEndpoint();
    if(!endpoint) return false;
    const { data } = await rpc('push_status', { p_timer_id: timerId, p_endpoint: endpoint });
    return data === true;
  }
  async function subscribeToTimerPush(timerId){
    if(!VAPID_PUBLIC_KEY){ showToast("Push isn't configured for this deployment"); return false; }
    if(!('serviceWorker' in navigator) || !('PushManager' in window)){ showToast("Push notifications aren't supported in this browser"); return false; }
    try{
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){ showToast('Notification permission was denied'); return false; }
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await rpc('push_subscribe', { p_timer_id: timerId, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
      if(error){ showToast('Could not save subscription'); return false; }
      return true;
    }catch(e){ console.error(e); showToast('Could not enable push notifications'); return false; }
  }
  async function unsubscribeFromTimerPush(timerId){
    const endpoint = await getPushEndpoint();
    if(!endpoint) return true;
    const { error } = await rpc('push_unsubscribe', { p_timer_id: timerId, p_endpoint: endpoint });
    return !error;
  }
  // Shared by the control and view pages: turns alerts on for this timer, or off if already on.
  async function togglePush(timerId, currentlyOn){
    if(currentlyOn){
      if(!confirm('Turn off alerts for this timer on this device?')) return currentlyOn;
      const ok = await unsubscribeFromTimerPush(timerId);
      if(ok) showToast('Alerts turned off for this timer'); else showToast('Could not turn alerts off');
      return ok ? false : true;
    }
    const ok = await subscribeToTimerPush(timerId);
    if(ok) showToast("You'll get alerts at 15 min in, 10/5 min left, and time's up");
    return ok;
  }

  // ---------- Small utilities ----------
  const GAME_PRESETS = {
    riftbound:  { label: 'Riftbound',           main: 50*60, extra: 0 },
    onepiece:   { label: 'One Piece Card Game', main: 30*60, extra: 5*60 },
    yugioh:     { label: 'Yu-Gi-Oh!',           main: 50*60, extra: 0 },
    pokemon_bo1:{ label: 'Pokémon (Bo1)',       main: 30*60, extra: 10*60 },
    pokemon_bo3:{ label: 'Pokémon (Bo3)',       main: 50*60, extra: 10*60 },
    mtg:        { label: 'Magic: The Gathering', main: 50*60, extra: 0 },
    custom:     { label: 'Custom',              main: 30*60, extra: 0 }
  };

  function uid(){
    try{ const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); }
    catch(e){ return Math.random().toString(36).slice(2,10); }
  }
  function showToast(msg){
    document.querySelectorAll('.toast').forEach(t=>t.remove());
    const t = document.createElement('div');
    t.className='toast'; t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 2400);
  }
  function copyText(str){
    try{ navigator.clipboard.writeText(str); return true; }
    catch(e){
      try{
        const ta=document.createElement('textarea'); ta.value=str; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true;
      }catch(e2){ return false; }
    }
  }
  function fmtTime(totalSeconds){
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(totalSeconds/3600);
    const m = Math.floor((totalSeconds%3600)/60);
    const s = totalSeconds%60;
    const mm = String(m).padStart(2,'0'), ss = String(s).padStart(2,'0');
    return h>0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function baseUrl(){
    return window.location.origin + window.location.pathname;
  }
  // The control token goes after the # so it is never sent to any server (not in request
  // logs, not in Referer headers). Older links that carry it as &t=... still work.
  function controlUrl(id, token){ return `${baseUrl()}?control=${id}#t=${token}`; }
  function viewUrl(id){ return `${baseUrl()}?view=${id}`; }
  function parseControlLink(text){
    try{
      const u = new URL(String(text).trim());
      const id = u.searchParams.get('control');
      let token = u.searchParams.get('t');
      if(!token && u.hash) token = new URLSearchParams(u.hash.replace(/^#/, '')).get('t');
      if(isUuid(id) && isUuid(token)) return { id, token };
    }catch(e){}
    return null;
  }

  // Loads a bundled library only when a page actually needs it.
  const scriptPromises = {};
  function loadScript(src){
    if(!scriptPromises[src]){
      scriptPromises[src] = new Promise((resolve, reject)=>{
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        s.onerror = ()=>{ delete scriptPromises[src]; reject(new Error('failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[src];
  }

  // Keeps the screen on while a timer page is open (TVs, phones on a table, the judge's tablet).
  let wakeWanted = false, wakeLock = null;
  async function requestWakeLock(){
    try{
      if(!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      if(wakeLock && !wakeLock.released) return;
      wakeLock = await navigator.wakeLock.request('screen');
    }catch(e){}
  }
  function keepScreenAwake(){
    wakeWanted = true;
    requestWakeLock();
  }
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible'){
      if(wakeWanted) requestWakeLock();
      syncServerTime();
    }
  });

  function toggleFullscreen(){
    const d = document, el = d.documentElement;
    if(d.fullscreenElement || d.webkitFullscreenElement){
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if(p && p.catch) p.catch(()=>{});
    }
  }
  function fullscreenBtnHtml(id){
    return (document.fullscreenEnabled || document.webkitFullscreenEnabled)
      ? `<button class="mini-btn" id="${id}">⛶ Fullscreen</button>` : '';
  }

  // ---------- Connection banner ----------
  let connTimer = null;
  function setConnState(ok){
    clearTimeout(connTimer);
    if(ok){
      const el = document.getElementById('connBanner');
      if(el) el.remove();
      return;
    }
    // Only show it if the connection stays down for a few seconds — brief blips are normal.
    connTimer = setTimeout(()=>{
      if(document.getElementById('connBanner')) return;
      const d = document.createElement('div');
      d.id = 'connBanner'; d.className = 'conn-banner';
      d.textContent = 'Reconnecting… the clock keeps counting, but changes may be delayed';
      document.body.appendChild(d);
    }, 6000);
  }

  // Keeps one or more timer rows live. Realtime delivers changes instantly; on top of that it
  //  - refetches whenever realtime (re)connects, and when the tab/phone wakes up (a sleeping phone
  //    silently loses its connection, which used to leave the screen showing stale state),
  //  - polls every 15s while realtime is down, and every 2 minutes as a safety net regardless.
  function watchTimers(ids, onRow){
    let connected = false;
    async function refetch(){
      try{
        const { data, error } = await supabase.from('timers').select(TIMER_COLS).in('id', ids);
        if(!error && data){ data.forEach(onRow); return true; }
      }catch(e){}
      return false;
    }
    const filter = ids.length === 1 ? `id=eq.${ids[0]}` : `id=in.(${ids.join(',')})`;
    supabase.channel('watch-' + uid())
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'timers', filter }, payload=>{
        if(payload && payload.new) onRow(payload.new);
      })
      .subscribe(status=>{
        if(status === 'SUBSCRIBED'){ connected = true; setConnState(true); refetch(); }
        else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){ connected = false; setConnState(false); }
      });
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') refetch(); });
    setInterval(()=>{ if(document.visibilityState === 'visible' && !connected) refetch(); }, 15000);
    setInterval(()=>{ if(document.visibilityState === 'visible') refetch(); }, 120000);
    return { refetch };
  }

  // Chimes fire as the clock CROSSES a mark, so a redraw or a server update can never replay one,
  // and a phone that wakes up late doesn't play stale chimes (anything >3s late is skipped).
  function makeAlertTracker(){
    let prevRem = null, prevPhase = null;
    return function check(info){
      const phase = info.phase, rem = info.remaining;
      if(prevPhase !== null && prevRem !== null){
        if(phase === 'main' && prevPhase === 'main'){
          const marks = [300];
          for(let m=900; m<prevRem; m+=900) marks.push(m);
          for(const m of marks){
            if(prevRem > m && rem <= m && (m - rem) <= 3){ playAlert(m === 300 ? 'five' : 'fifteen'); break; }
          }
        }
        if(phase === 'extra' && prevPhase === 'main') playAlert('extra');
        if(phase === 'ended' && (prevPhase === 'main' || prevPhase === 'extra') && prevRem <= 3) playAlert('ended');
      }
      prevRem = rem; prevPhase = phase;
    };
  }

  function phaseText(p, short){
    if(short){
      return { idle:'Not started', setup:'Setup', main:'In progress', extra:'Extra time', ended:'Conduct end-of-round procedures' }[p] || p;
    }
    return { idle:'Not started', setup:'Setup time', main:'Round in progress', extra:'Extra time', ended:'Conduct end-of-round procedures' }[p] || p;
  }
  function statusText(s){
    return { idle:'Not started', running:'Running', paused:'Paused', ended:'Ended' }[s] || s;
  }
  // Shows the time left in the browser tab, so a judge with several tabs open can see it at a glance.
  function setTabTitle(timer, info){
    const label = (timer.label || 'Timer');
    document.title = (timer.status === 'running' || timer.status === 'paused')
      ? `${fmtTime(info.remaining)} · ${label} — TurnZero` : `${label} — TurnZero`;
  }

  // ---------- Local "my timers" list (per-device, no account needed) ----------
  function getMyTimers(){
    try{
      const list = JSON.parse(localStorage.getItem('rt_my_timers')||'[]');
      // Anything that isn't a well-formed pair of IDs is dropped, so nothing odd can ever reach the page.
      return Array.isArray(list) ? list.filter(t=>t && isUuid(t.id) && isUuid(t.control_token)) : [];
    }catch(e){ return []; }
  }
  function saveMyTimers(list){
    try{ localStorage.setItem('rt_my_timers', JSON.stringify(list)); }catch(e){}
  }
  function addMyTimer(entry){
    const list = getMyTimers().filter(t=>t.id !== entry.id);
    list.unshift({ id: entry.id, control_token: entry.control_token, label: String(entry.label || '') });
    saveMyTimers(list.slice(0,30));
  }
  function removeMyTimer(id){
    saveMyTimers(getMyTimers().filter(t=>t.id!==id));
  }

  // ---------- Timer math (all derived from timestamps — no drift, no server ticking needed) ----------
  function getElapsedSeconds(timer){
    let e = Number(timer.accumulated_seconds) || 0;
    if(timer.status === 'running' && timer.running_since){
      e += (nowMs() - new Date(timer.running_since).getTime())/1000;
    }
    return Math.max(0, e);
  }
  function getPhaseInfo(timer){
    if(timer.status === 'ended') return { phase:'ended', remaining:0 };
    if(timer.status === 'idle') return { phase:'idle', remaining: timer.setup_seconds || timer.main_seconds };
    const elapsed = getElapsedSeconds(timer);
    if(elapsed < timer.setup_seconds) return { phase:'setup', remaining: timer.setup_seconds - elapsed };
    const mainElapsed = elapsed - timer.setup_seconds;
    if(mainElapsed < timer.main_seconds) return { phase:'main', remaining: timer.main_seconds - mainElapsed };
    const extraElapsed = mainElapsed - timer.main_seconds;
    if(timer.extra_seconds > 0 && extraElapsed < timer.extra_seconds) return { phase:'extra', remaining: timer.extra_seconds - extraElapsed };
    return { phase:'ended', remaining:0 };
  }

  // ---------- Sound ----------
  let audioCtx = null;
  let soundOn = false;
  function unlockAudio(){
    if(!audioCtx){
      try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){}
    }
    soundOn = !!audioCtx;
  }
  function beep(freq, dur, delay){
    delay = delay||0;
    setTimeout(()=>{
      if(!audioCtx) return;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.frequency.value = freq; osc.type='sine'; gain.gain.value=0.25;
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); setTimeout(()=>osc.stop(), dur);
    }, delay);
  }
  function playAlert(kind){
    // Time's up also vibrates (phones only, and only once the user has tapped the page).
    if(kind === 'ended' && navigator.vibrate){ try{ navigator.vibrate([300,150,300,150,600]); }catch(e){} }
    if(!soundOn) return;
    if(kind !== 'ended' && getSavedQuietMode()) return; // quiet mode mutes milestone chimes, never the final alarm
    if(kind==='fifteen'){ beep(660,150,0); beep(660,150,220); }
    else if(kind==='five'){ beep(880,180,0); beep(880,180,250); beep(880,180,500); }
    else if(kind==='extra'){ beep(520,450,0); }
    else if(kind==='ended'){ beep(220,650,0); beep(220,650,700); }
  }
  function renderSoundBtn(){
    const b = document.createElement('button');
    b.className = 'sound-btn' + (soundOn?' on':'');
    b.textContent = soundOn ? '🔊 Sound on' : '🔈 Enable sound';
    b.onclick = ()=>{ unlockAudio(); renderSoundBtn(); showToast(soundOn?'Sound enabled':'Could not enable sound'); };
    const old = document.querySelector('.sound-btn');
    if(old) old.remove();
    document.body.appendChild(b);
  }

  async function renderTvCodePage(code){
    if(!/^[A-Z0-9]{4}$/.test(code)){
      app.innerHTML = `<div class="wrap"><div class="error-box">
        <div class="big">Code not found</div>
        <div class="sub">Codes are 4 characters, e.g. 7K3M.</div>
        <div style="margin-top:20px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div>
      </div></div>`;
      return;
    }
    app.innerHTML = `<div class="center-wrap"><div class="sub">Looking up ${escapeHtml(code)}…</div></div>`;
    try{
      const { data, error } = await supabase.from('timers').select('id').eq('short_code', code).maybeSingle();
      if(error || !data){
        app.innerHTML = `<div class="wrap"><div class="error-box">
          <div class="big">Code not found</div>
          <div class="sub">Double-check the code with the judge — it's 4 characters, e.g. 7K3M.</div>
          <div style="margin-top:20px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div>
        </div></div>`;
        return;
      }
      renderViewPage(data.id);
    }catch(e){
      app.innerHTML = `<div class="wrap"><div class="error-box"><div class="big">Something went wrong</div></div></div>`;
    }
  }

  // ============================================================
  // HOME
  // ============================================================
  const TOUR_STEPS = [
    {
      title: 'Welcome to TurnZero 👋',
      body: "A shared round timer for TCG events. No accounts, no sign-in for anyone — just links. Here's a quick tour."
    },
    {
      title: 'Create a timer',
      body: 'Pick a game preset (or set a custom time), add a setup period if you need one, and tap Create. This one timer covers the whole event, not just one round.'
    },
    {
      title: 'Share it once',
      body: 'You get a private control link (yours only — don\'t share it) and a view link + QR code for players. Tap "Next round" between rounds and the same link just keeps working — no re-sharing needed.'
    },
    {
      title: 'Players just watch',
      body: 'They scan the QR code, or use the "📷 Scan QR" button right on this home screen — no app to install, no link to type in.'
    },
    {
      title: 'More when you need it',
      body: 'Pause and adjust time mid-round, log penalties that stick around for the whole event, run up to 4 tables on one screen, and turn on push alerts for 15/10/5-minute and time\'s-up notifications.'
    },
    {
      title: "You're set 🎉",
      body: "That's everything. Jump in and create your first timer."
    }
  ];

  let tourShown = false;
  function maybeShowTour(){
    if(tourShown) return;
    let seen = false;
    try{ seen = localStorage.getItem('tz_tour_seen') === '1'; }catch(e){}
    if(seen) return;
    tourShown = true;

    let step = 0;
    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    // A close button that always exists, independent of anything below —
    // so there's always a way out even if something else goes wrong.
    overlay.innerHTML = `<button id="tourCloseX" style="position:absolute;top:16px;right:16px;background:none;border:none;color:var(--text-dim);font-size:22px;cursor:pointer;line-height:1;">✕</button><div id="tourCardHolder"></div>`;
    document.body.appendChild(overlay);

    function finish(){
      overlay.remove();
      try{ localStorage.setItem('tz_tour_seen', '1'); }catch(e){}
    }
    overlay.querySelector('#tourCloseX').onclick = finish;
    overlay.onclick = (e)=>{ if(e.target===overlay) finish(); };

    function dotsHtml(){
      let out = '';
      for(let i=0;i<TOUR_STEPS.length;i++){
        const active = i===step;
        out += '<div class="tour-dot' + (active?' active':'') + '" style="width:' + (active?18:6) + 'px;"></div>';
      }
      return out;
    }

    function draw(){
      try{
        const s = TOUR_STEPS[step];
        const isLast = step === TOUR_STEPS.length-1;
        const backOrSkipHtml = step>0
          ? '<button class="btn btn-secondary" id="tourBack" style="flex:1;">Back</button>'
          : '<button class="btn btn-secondary" id="tourSkip" style="flex:1;">Skip</button>';
        const holder = overlay.querySelector('#tourCardHolder');
        holder.innerHTML = `
          <div class="tour-card">
            <div class="tour-dots">${dotsHtml()}</div>
            <h2 style="margin-bottom:10px;">${escapeHtml(s.title)}</h2>
            <div class="sub" style="font-size:14px;line-height:1.6;margin-bottom:22px;">${escapeHtml(s.body)}</div>
            <div class="btn-row" style="justify-content:center;">
              ${backOrSkipHtml}
              <button class="btn btn-primary" id="tourNext" style="flex:1;">${isLast?'Get started':'Next'}</button>
            </div>
          </div>`;
        const backOrSkip = overlay.querySelector('#tourBack') || overlay.querySelector('#tourSkip');
        backOrSkip.onclick = ()=>{ if(step>0){ step--; draw(); } else { finish(); } };
        overlay.querySelector('#tourNext').onclick = ()=>{ if(isLast){ finish(); } else { step++; draw(); } };
      }catch(e){
        console.error('Tour render error:', e);
        finish(); // never leave the user stuck behind a broken overlay
      }
    }
    draw();
  }

  function renderHome(){
    document.title = 'TurnZero — TCG Round Timer';
    renderSoundBtn();
    const mine = getMyTimers();
    app.innerHTML = `
      <div class="wrap">
        <div class="home-hero">
          <div class="brand">⏱ TurnZero</div>
          <div class="sub">Shared round timers for TCG events — no login needed.</div>
        </div>

        <button class="btn btn-primary" id="scanQrBtn" style="width:100%;margin-bottom:20px;font-size:16px;padding:16px;">📷 Scan QR to view a timer</button>

        <div class="card">
          <h2 style="margin-top:0;">New timer</h2>
          <div class="field"><label>Table / event label</label><input id="newLabel" maxlength="80" placeholder="e.g. Table 3, Feature Match"/></div>
          <div class="field">
            <label>Game</label>
            <div class="chip-row" id="gameChips">
              ${Object.entries(GAME_PRESETS).map(([k,g])=>`<button class="chip" data-game="${k}">${escapeHtml(g.label)}</button>`).join('')}
            </div>
          </div>
          <div class="row2" id="customTimeFields" style="display:none;">
            <div class="field"><label>Main minutes</label><input id="customMain" type="number" min="1" max="600" value="30"/></div>
            <div class="field"><label>Extra minutes</label><input id="customExtra" type="number" min="0" max="120" value="0"/></div>
          </div>
          <div class="row2">
            <div class="field"><label>Setup time (minutes, optional)</label><input id="setupMinutes" type="number" min="0" max="240" value="0"/></div>
            <div class="field"><label>Round number</label><input id="roundNumber" type="number" min="1" max="999" value="1"/></div>
          </div>
          <button class="btn btn-primary" id="createBtn" style="width:100%;">Create timer</button>
        </div>

        <div class="card">
          <h2 style="margin-top:0;">Have a control link already?</h2>
          <div class="field"><input id="pasteControlLink" placeholder="Paste a control link to add it to this device"/></div>
          <button class="btn btn-secondary" id="addExistingBtn">Add to my timers</button>
        </div>

        <div class="section-label">Your timers on this device</div>
        ${mine.length > 1 ? `<div class="sub" style="text-align:left;margin-bottom:8px;">Check up to 4 to view together on one screen (e.g. on a store TV).</div>` : ''}
        <div id="myTimersList">
          ${mine.length ? mine.map(renderMyTimerRow).join('') : `<div style="color:var(--text-dim);font-size:13px;">None yet — create one above.</div>`}
        </div>
        ${mine.length > 1 ? `<button class="btn btn-primary" id="viewCombinedBtn" style="width:100%;margin-top:8px;">View selected together</button>` : ''}
        ${!isStandalone ? `<button class="btn btn-secondary" id="installAppBtn" style="width:100%;margin-top:20px;">📲 Install this app on your device</button>` : ''}
        ${DONATION_URL ? `<div style="text-align:center;margin-top:20px;"><a href="${escapeAttr(DONATION_URL)}" target="_blank" rel="noopener" style="color:var(--text-dim);font-size:12px;text-decoration:underline;">💛 Support this project</a></div>` : ''}
        <div style="text-align:center;margin-top:${DONATION_URL ? '10' : '24'}px;color:var(--text-dim);font-size:11px;">Build: ${escapeHtml(APP_VERSION)} · <a href="/privacy.html" style="color:var(--text-dim);">Privacy</a></div>
      </div>
    `;

    document.querySelectorAll('[data-multi-select]').forEach(cb=>{
      cb.onchange = ()=>{
        const checked = document.querySelectorAll('[data-multi-select]:checked');
        if(checked.length > 4){ cb.checked = false; showToast('You can combine up to 4 timers at once'); }
      };
    });
    const combinedBtn = document.getElementById('viewCombinedBtn');
    if(combinedBtn) combinedBtn.onclick = ()=>{
      const ids = Array.from(document.querySelectorAll('[data-multi-select]:checked')).map(cb=>cb.dataset.multiSelect);
      if(ids.length === 0){ showToast('Select at least one timer'); return; }
      window.location.href = `${baseUrl()}?multi=${ids.join(',')}`;
    };

    let selectedGame = 'riftbound';
    function selectGame(g){
      selectedGame = g;
      document.querySelectorAll('#gameChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.game===g));
      document.getElementById('customTimeFields').style.display = g==='custom' ? 'grid' : 'none';
    }
    document.querySelectorAll('#gameChips .chip').forEach(c=>c.onclick=()=>selectGame(c.dataset.game));
    selectGame('riftbound');

    document.getElementById('scanQrBtn').onclick = openQrScanner;
    const installBtn = document.getElementById('installAppBtn');
    if(installBtn) installBtn.onclick = handleInstallClick;

    document.getElementById('createBtn').onclick = async ()=>{
      const label = (document.getElementById('newLabel').value.trim() || GAME_PRESETS[selectedGame].label).slice(0,80);
      const setupMin = clamp(parseFloat(document.getElementById('setupMinutes').value) || 0, 0, 240);
      const roundNum = clamp(parseInt(document.getElementById('roundNumber').value,10) || 1, 1, 999);
      let mainSec, extraSec;
      if(selectedGame === 'custom'){
        mainSec = clamp(parseFloat(document.getElementById('customMain').value) || 30, 1, 600) * 60;
        extraSec = clamp(parseFloat(document.getElementById('customExtra').value) || 0, 0, 120) * 60;
      } else {
        mainSec = GAME_PRESETS[selectedGame].main;
        extraSec = GAME_PRESETS[selectedGame].extra;
      }
      const btn = document.getElementById('createBtn');
      btn.disabled = true; btn.textContent = 'Creating…';
      const { data, error } = await rpc('create_timer', {
        p_label: label, p_game: selectedGame, p_round_number: roundNum,
        p_setup_seconds: Math.round(setupMin*60), p_main_seconds: Math.round(mainSec), p_extra_seconds: Math.round(extraSec)
      });
      if(error || !data || !isUuid(data.id) || !isUuid(data.control_token)){
        showToast(errorText(error).replace('Could not update', 'Could not create timer'));
        btn.disabled = false; btn.textContent = 'Create timer';
        return;
      }
      addMyTimer({ id: data.id, control_token: data.control_token, label });
      window.location.href = controlUrl(data.id, data.control_token);
    };

    document.getElementById('addExistingBtn').onclick = async ()=>{
      const parsed = parseControlLink(document.getElementById('pasteControlLink').value);
      if(!parsed){ showToast("That doesn't look like a control link"); return; }
      const check = await rpc('verify_control', { p_id: parsed.id, p_token: parsed.token });
      if(check.error){ showToast('Could not check that link — check your connection'); return; }
      if(check.data !== true){ showToast("That control link doesn't match any timer"); return; }
      let label = 'Added timer';
      try{
        const { data } = await supabase.from('timers').select('label').eq('id', parsed.id).maybeSingle();
        if(data && data.label) label = data.label;
      }catch(e){}
      addMyTimer({ id: parsed.id, control_token: parsed.token, label });
      showToast('Added');
      renderHome();
    };

    document.querySelectorAll('[data-remove-mine]').forEach(b=>{
      b.onclick = ()=>{ removeMyTimer(b.dataset.removeMine); renderHome(); };
    });

    refreshMyTimers(mine);
    maybeShowTour();
  }

  // Fills in the live name/status of the saved timers, and forgets ones that no longer exist
  // (timers are deleted after 30 days idle). Never removes anything if the lookup itself failed.
  async function refreshMyTimers(mine){
    if(!mine.length) return;
    try{
      const { data, error } = await supabase.from('timers').select('id,label,status,round_number').in('id', mine.map(t=>t.id));
      if(error || !data) return;
      const byId = {};
      data.forEach(r=>{ byId[r.id] = r; });
      const kept = mine.filter(t=>byId[t.id]).map(t=>({ id: t.id, control_token: t.control_token, label: byId[t.id].label || t.label }));
      if(kept.length !== mine.length){ saveMyTimers(kept); renderHome(); return; }
      saveMyTimers(kept);
      mine.forEach(t=>{
        const row = document.querySelector(`[data-row="${t.id}"]`);
        const r = byId[t.id];
        if(!row || !r) return;
        row.querySelector('.n').textContent = r.label || 'Timer';
        row.querySelector('.m').textContent = `Round ${r.round_number} · ${statusText(r.status)}`;
      });
    }catch(e){}
  }

  function renderMyTimerRow(t){
    return `
      <div class="timer-item" data-row="${escapeAttr(t.id)}">
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="checkbox" data-multi-select="${escapeAttr(t.id)}" aria-label="Include in combined view" style="width:20px;height:20px;flex:none;"/>
          <div>
            <div class="n">${escapeHtml(t.label||'Timer')}</div>
            <div class="m">Control link saved on this device</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <a class="mini-btn" href="${escapeAttr(controlUrl(t.id, t.control_token))}">Open</a>
          <button class="mini-btn" data-remove-mine="${escapeAttr(t.id)}">Remove</button>
        </div>
      </div>`;
  }

  // ---------- QR scanner (players: point camera at a judge's QR code) ----------
  // Only links back to this site's own timer views are followed. A QR code can contain anything
  // (other websites, javascript: URLs), and the scanner must never act on those.
  function timerLinkFromQr(text){
    try{
      const u = new URL(String(text));
      if(u.origin !== window.location.origin) return null;
      if(u.searchParams.has('view') || u.searchParams.has('multi') || u.searchParams.has('tv')) return u;
    }catch(e){}
    return null;
  }
  async function openQrScanner(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      showToast('Camera access isn\'t supported in this browser'); return;
    }
    try{ await loadScript('/vendor/jsQR.js'); }
    catch(e){ showToast('QR scanning library failed to load — check your connection and reload the page'); return; }
    if(!window.jsQR){ showToast('QR scanning library failed to load — check your connection and reload the page'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = `
      <div class="scan-video-wrap">
        <video id="scanVideo" playsinline autoplay muted></video>
        <div class="scan-frame"></div>
      </div>
      <div class="scan-footer">
        <div class="scan-status" id="scanStatus">Point your camera at the judge's QR code</div>
        <button class="btn btn-secondary" id="scanCancelBtn">Cancel</button>
      </div>`;
    document.body.appendChild(overlay);

    let stream = null;
    let stopped = false;
    const statusEl = overlay.querySelector('#scanStatus');
    const video = overlay.querySelector('#scanVideo');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function stop(){
      stopped = true;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', stop);
      if(stream) stream.getTracks().forEach(t=>t.stop());
      overlay.remove();
    }
    function onKey(e){ if(e.key === 'Escape') stop(); }
    document.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', stop);
    overlay.querySelector('#scanCancelBtn').onclick = stop;

    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if(stopped){ stream.getTracks().forEach(t=>t.stop()); return; }
      video.srcObject = stream;
      await video.play();
    }catch(e){
      statusEl.textContent = 'Could not access the camera — check your browser permissions.';
      return;
    }

    let lastScan = 0, badUntil = 0;
    function tick(now){
      if(stopped) return;
      // ~8 scans a second on a downscaled frame is plenty for a QR code and keeps phones cool.
      if(now - lastScan >= 120 && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth){
        lastScan = now;
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if(code && code.data){
          const link = timerLinkFromQr(code.data);
          if(link){
            statusEl.textContent = 'Found it — opening…';
            stop();
            window.location.href = link.toString();
            return;
          }
          if(now > badUntil){
            statusEl.textContent = "That QR code isn't a TurnZero timer — keep looking";
            badUntil = now + 2500;
            setTimeout(()=>{ if(!stopped) statusEl.textContent = "Point your camera at the judge's QR code"; }, 2500);
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // Same escaping, used when interpolating into an HTML attribute.
  function escapeAttr(s){
    return escapeHtml(s);
  }
  // ============================================================
  // CONTROL PAGE (judge / store owner)
  // ============================================================
  function controlMessagePage(title, message){
    app.innerHTML = `<div class="wrap"><div class="error-box">
      <div class="big">${escapeHtml(title)}</div>
      <div class="sub">${escapeHtml(message)}</div>
      <div style="margin-top:20px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div>
    </div></div>`;
  }

  async function renderControlPage(id, token){
    keepScreenAwake();
    renderSoundBtn();
    if(!isUuid(id) || !isUuid(token)){
      controlMessagePage('Invalid control link', "This link doesn't match any timer, or the control token is wrong.");
      return;
    }
    app.innerHTML = `<div class="center-wrap"><div class="sub">Loading…</div></div>`;

    const check = await rpc('verify_control', { p_id: id, p_token: token });
    if(check.error){ controlMessagePage("Couldn't reach the server", 'Check your connection and reload the page.'); return; }
    if(check.data !== true){
      controlMessagePage('Invalid control link', "This link doesn't match any timer, or the control token is wrong.");
      return;
    }
    const { data: timer, error } = await supabase.from('timers').select(TIMER_COLS).eq('id', id).maybeSingle();
    if(error || !timer){
      controlMessagePage('Timer not found', 'This timer may have been deleted after 30 days without use.');
      return;
    }
    addMyTimer({ id: timer.id, control_token: token, label: timer.label });

    let current = timer;
    let pushSubscribed = await isSubscribedToTimer(timer.id);
    let busy = false;
    let sig = '';
    let qrNode = null;
    let penalties = [];
    let penaltiesState = 'loading';   // loading | ok | error
    let penaltiesRev = timer.penalties_rev;
    let lastFinalizeAt = 0;
    const tracker = makeAlertTracker();

    // Only redraw when something the screen shows has changed. The server also updates the row
    // just to flip alert flags, and redrawing on those used to wipe a judge's half-typed penalty.
    function rowSig(r){
      const lastAdj = (r.adjustments || []).slice(-1)[0];
      return [r.status, r.running_since, r.accumulated_seconds, r.round_number, r.label, r.setup_seconds,
        r.main_seconds, r.extra_seconds, r.short_code, (r.adjustments || []).length, lastAdj ? lastAdj.at : ''].join('|');
    }
    function applyRow(row){
      if(!row || row.id !== id) return;
      if(current.updated_at && row.updated_at && new Date(row.updated_at) < new Date(current.updated_at)) return; // stale
      current = row;
      if(row.penalties_rev !== penaltiesRev){ penaltiesRev = row.penalties_rev; loadPenalties(); }
      const s = rowSig(row);
      if(s !== sig){ sig = s; draw(); }
    }

    // Every change is one server call that checks the token and stamps the time with the server's clock.
    async function act(action, amount, quiet){
      if(busy) return false;
      busy = true;
      if(!quiet) app.classList.add('is-busy');
      try{
        const { data, error } = await rpc('timer_action', { p_id: id, p_token: token, p_action: action, p_amount: amount || 0 });
        const row = Array.isArray(data) ? data[0] : data;
        if(error || !row){ if(!quiet) showToast(errorText(error)); return false; }
        applyRow(row);
        return true;
      } finally {
        busy = false;
        app.classList.remove('is-busy');
      }
    }

    async function loadPenalties(){
      const { data, error } = await rpc('list_penalties', { p_id: id, p_token: token });
      if(error){ penaltiesState = 'error'; }
      else { penalties = data || []; penaltiesState = 'ok'; }
      renderPenaltyList();
    }

    function penaltyListHtml(){
      if(penaltiesState === 'loading') return `<div style="color:var(--text-dim);font-size:13px;">Loading…</div>`;
      if(penaltiesState === 'error') return `<div style="color:var(--text-dim);font-size:13px;">Couldn't load penalties. <button class="mini-btn" id="retryPenalties">Retry</button></div>`;
      if(!penalties.length) return `<div style="color:var(--text-dim);font-size:13px;">No penalties logged yet.</div>`;
      return `
        <div class="btn-row" style="margin-bottom:6px;">
          <button class="mini-btn" id="copyPenalties">Copy list</button>
          <button class="mini-btn" id="csvPenalties">Download CSV</button>
          <button class="mini-btn" id="clearPenalties">Clear all</button>
        </div>
        ${penalties.slice().reverse().map(p=>`
          <div class="log-row" style="flex-direction:column;align-items:flex-start;gap:2px;padding:10px 0;">
            <div style="display:flex;justify-content:space-between;width:100%;">
              <span style="color:var(--text);font-weight:600;">Round ${escapeHtml(p.round == null ? '—' : p.round)} · Table ${escapeHtml(p.table_number||'—')} · ${escapeHtml(p.player_name||'Unknown player')}</span>
              <button class="mini-btn" data-del-penalty="${escapeAttr(p.id)}" aria-label="Delete this penalty" style="padding:4px 8px;">✕</button>
            </div>
            <div>${escapeHtml(p.penalty)}${p.note ? ' — '+escapeHtml(p.note) : ''}</div>
            <div style="font-size:11px;">${escapeHtml(new Date(p.at).toLocaleString())}</div>
          </div>`).join('')}`;
    }
    function penaltiesText(){
      return penalties.map(p=>`Round ${p.round == null ? '?' : p.round} | Table ${p.table_number || '-'} | ${p.player_name} | ${p.penalty}${p.note ? ' | ' + p.note : ''} | ${new Date(p.at).toLocaleString()}`).join('\n');
    }
    function penaltiesCsv(){
      // A leading ' stops spreadsheets treating a cell as a formula if a note starts with = + - or @.
      const cell = v=>{ let s = String(v == null ? '' : v); if(/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const rows = [['Time','Round','Table','Player','Penalty','Notes']].concat(
        penalties.map(p=>[new Date(p.at).toLocaleString(), p.round, p.table_number, p.player_name, p.penalty, p.note]));
      return rows.map(r=>r.map(cell).join(',')).join('\r\n');
    }
    function renderPenaltyList(){
      const el = document.getElementById('penaltyList');
      if(!el) return;
      el.innerHTML = penaltyListHtml();
      const retry = document.getElementById('retryPenalties');
      if(retry) retry.onclick = ()=>{ penaltiesState = 'loading'; renderPenaltyList(); loadPenalties(); };
      const copyBtn = document.getElementById('copyPenalties');
      if(copyBtn) copyBtn.onclick = ()=>{ showToast(copyText(penaltiesText()) ? 'Penalty list copied' : 'Could not copy'); };
      const csvBtn = document.getElementById('csvPenalties');
      if(csvBtn) csvBtn.onclick = ()=>{
        const blob = new Blob(['﻿' + penaltiesCsv()], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'penalties-' + ((current.label || 'timer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'timer') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
      };
      const clearBtn = document.getElementById('clearPenalties');
      if(clearBtn) clearBtn.onclick = async ()=>{
        if(!confirm(`Delete ALL ${penalties.length} penalty records for this event? This can't be undone.`)) return;
        const { error } = await rpc('clear_penalties', { p_id: id, p_token: token });
        if(error){ showToast(errorText(error)); return; }
        showToast('Penalties cleared');
        loadPenalties();
      };
      el.querySelectorAll('[data-del-penalty]').forEach(b=>{
        b.onclick = async ()=>{
          if(!confirm('Delete this penalty entry?')) return;
          const { error } = await rpc('delete_penalty', { p_id: id, p_token: token, p_penalty_id: b.dataset.delPenalty });
          if(error){ showToast(errorText(error)); return; }
          loadPenalties();
        };
      });
    }

    const FORM_FIELDS = ['pRound','pTable','pPlayer','pPenalty','pNote'];
    function captureFormState(){
      const f = document.getElementById('penaltyForm');
      if(!f) return null;
      const ae = document.activeElement;
      const inForm = !!(ae && ae.id && f.contains(ae));
      return {
        open: f.style.display !== 'none',
        vals: FORM_FIELDS.map(i=>{ const e = document.getElementById(i); return e ? e.value : null; }),
        focusId: inForm ? ae.id : null,
        sel: inForm && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null
      };
    }
    function restoreFormState(s){
      if(!s) return;
      const f = document.getElementById('penaltyForm');
      if(!f) return;
      f.style.display = s.open ? 'block' : 'none';
      FORM_FIELDS.forEach((fid, n)=>{ const e = document.getElementById(fid); if(e && s.vals[n] != null) e.value = s.vals[n]; });
      if(s.focusId){
        const e = document.getElementById(s.focusId);
        if(e){ e.focus(); if(s.sel && e.setSelectionRange){ try{ e.setSelectionRange(s.sel[0], s.sel[1]); }catch(_){} } }
      }
    }

    // The QR code is built once and moved into each redraw, instead of regenerated every time.
    function mountQr(url){
      const holder = document.getElementById('qrHolder');
      if(!holder) return;
      if(!qrNode){
        const tmp = document.createElement('div');
        try{ new QRCode(tmp, { text: url, width:180, height:180 }); qrNode = tmp; }catch(e){ return; }
      }
      holder.appendChild(qrNode);
    }

    function draw(){
      const formState = captureFormState();
      const info = getPhaseInfo(current);
      const shareUrl = viewUrl(current.id);
      app.innerHTML = `
        <div class="center-wrap">
          <div class="round-label">Round ${current.round_number||1}</div>
          <div class="event-label">${escapeHtml(current.label||'Timer')}</div>
          <div class="phase-badge ${info.phase}">${phaseText(info.phase)}</div>
          <div class="big-clock ${info.phase}">${fmtTime(info.remaining)}</div>
          <div class="clock-bar-track"><div class="clock-bar-fill" id="clockBarCtrl"></div></div>
          <div style="margin-top:10px;"><button class="mini-btn" id="btnCustomize">🎨 Customize</button></div>

          <div class="btn-row" style="justify-content:center;margin:16px 0;">
            ${current.status==='idle' ? `<button class="btn btn-primary" id="btnStart">▶ Start</button>` : ''}
            ${current.status==='running' ? `<button class="btn btn-secondary" id="btnPause">⏸ Pause</button>` : ''}
            ${current.status==='paused' ? `<button class="btn btn-primary" id="btnResume">▶ Resume</button>` : ''}
            ${(current.status==='running'||current.status==='paused') ? `<button class="btn btn-danger" id="btnEnd">■ End</button>` : ''}
            ${current.status!=='idle' ? `<button class="btn btn-primary" id="btnNextRound">Next round →</button>` : ''}
          </div>

          <div class="adjust-row">
            <button class="adjust-btn" data-adj="-5">−5 min</button>
            <button class="adjust-btn" data-adj="-1">−1 min</button>
            <button class="adjust-btn" data-adj="1">+1 min</button>
            <button class="adjust-btn" data-adj="5">+5 min</button>
          </div>
          ${current.status==='idle' ? `<div class="hint" style="margin-top:-6px;">Before the round starts, these change the round length.</div>` : ''}
          ${current.status==='ended' ? `<div class="hint" style="margin-top:-6px;">Adding time reopens the clock, paused — press Resume when ready.</div>` : ''}

          <div class="btn-row" style="justify-content:center;margin-bottom:6px;">
            <button class="mini-btn" id="roundMinus">Round −</button>
            <button class="mini-btn" id="roundPlus">Round +</button>
            ${current.status!=='idle' ? `<button class="mini-btn" id="btnRestart">Restart this round</button>` : ''}
            <button class="mini-btn" id="btnPushToggle">${pushSubscribed ? '🔔 Alerts on for this timer' : '🔔 Get alerts for this timer'}</button>
          </div>

          <div class="card" style="text-align:center;margin-top:22px;">
            <div class="section-label" style="text-align:center;">Share with players</div>
            <div class="share-box">
              <div style="font-size:12px;color:var(--text-dim);">View link (read-only — no controls)</div>
              <div class="share-link">${escapeHtml(shareUrl)}</div>
              <div class="btn-row" style="justify-content:center;">
                <button class="mini-btn" id="copyShareBtn">Copy link</button>
                ${fullscreenBtnHtml('btnFullscreenCtrl')}
              </div>
              <div id="qrHolder"></div>
            </div>
          </div>

          <div class="card" style="text-align:center;margin-top:14px;">
            <div class="section-label" style="text-align:center;">📺 Cast to a TV</div>
            <div class="share-box">
              ${current.short_code ? `
                <div style="font-size:12px;color:var(--text-dim);">On the TV's browser, go to ${escapeHtml(window.location.host)} and enter this code:</div>
                <div class="tv-code">${escapeHtml(current.short_code)}</div>
                <div class="btn-row" style="justify-content:center;margin-top:10px;">
                  <button class="mini-btn" id="copyCodeBtn">Copy code</button>
                  <button class="mini-btn" id="tryCastBtn">🎬 Try direct casting</button>
                </div>
                <div class="hint" style="margin-top:10px;">Direct casting works with Chromecast in Chrome, when supported — otherwise, typing the code on the TV's browser always works.</div>
              ` : `
                <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px;">This timer was created before TV codes existed.</div>
                <button class="btn btn-secondary" id="genCodeBtn">Generate a TV code</button>
              `}
            </div>
          </div>

          <div class="card" style="text-align:center;margin-top:14px;">
            <div class="section-label" style="text-align:center;">🔑 Your control link</div>
            <div class="hint">Keep this private — anyone with it can run this timer. Copy it to open the timer on a second device.</div>
            <div class="btn-row" style="justify-content:center;margin-top:10px;">
              <button class="mini-btn" id="copyControlBtn">Copy control link</button>
            </div>
          </div>

          ${(current.adjustments||[]).length ? `
            <div class="section-label">Adjustment log</div>
            <div class="card">
              ${current.adjustments.slice().reverse().map(a=>`
                <div class="log-row"><span>${escapeHtml(new Date(a.at).toLocaleTimeString())}</span><span>${escapeHtml(a.note)}</span></div>
              `).join('')}
            </div>` : ''}

          <div class="section-label">Penalties this event</div>
          <div class="card" style="text-align:left;">
            <button class="btn btn-secondary" id="openPenaltyForm" style="width:100%;margin-bottom:14px;">🚩 Log a penalty</button>
            <div id="penaltyForm" style="display:none;margin-bottom:14px;">
              <div class="row2">
                <div class="field"><label>Round</label><input id="pRound" type="number" min="1" max="999" value="${current.round_number||1}"/></div>
                <div class="field"><label>Table number</label><input id="pTable" maxlength="20" placeholder="e.g. 12"/></div>
              </div>
              <div class="field"><label>Player name</label><input id="pPlayer" maxlength="80" placeholder="Player being penalized"/></div>
              <div class="field">
                <label>Penalty</label>
                <select id="pPenalty">
                  <option>Warning</option>
                  <option>Game Loss</option>
                  <option>Match Loss</option>
                  <option>Disqualification</option>
                  <option>Other</option>
                </select>
              </div>
              <div class="field"><label>Infraction / notes</label><input id="pNote" maxlength="500" placeholder="What happened"/></div>
              <button class="btn btn-primary" id="savePenaltyBtn" style="width:100%;">Save penalty</button>
            </div>
            <div id="penaltyList">${penaltyListHtml()}</div>
          </div>

          <div style="margin-top:20px;"><a class="mini-btn" href="${baseUrl()}">← All timers</a></div>
        </div>
      `;

      loadScript('/vendor/qrcode.min.js').then(()=>mountQr(shareUrl)).catch(()=>{});
      renderPenaltyList();
      restoreFormState(formState);
      updateClockBar('clockBarCtrl', current, info);
      setTabTitle(current, info);

      document.getElementById('btnCustomize').onclick = openCustomizeModal;
      document.getElementById('copyShareBtn').onclick = ()=>{
        const ok = copyText(shareUrl);
        showToast(ok?'Link copied':'Could not copy — select manually');
      };
      const fsBtn = document.getElementById('btnFullscreenCtrl'); if(fsBtn) fsBtn.onclick = toggleFullscreen;
      document.getElementById('copyControlBtn').onclick = ()=>{
        showToast(copyText(controlUrl(id, token)) ? 'Control link copied — keep it private' : 'Could not copy');
      };
      const copyCodeBtn = document.getElementById('copyCodeBtn');
      if(copyCodeBtn) copyCodeBtn.onclick = ()=>{
        const ok = copyText(current.short_code);
        showToast(ok?'Code copied':'Could not copy — write it down');
      };
      const tryCastBtn = document.getElementById('tryCastBtn');
      if(tryCastBtn) tryCastBtn.onclick = async ()=>{
        if(!('PresentationRequest' in window)){
          showToast("Direct casting isn't supported in this browser — use the code above instead");
          return;
        }
        try{
          const request = new PresentationRequest([shareUrl]);
          await request.start();
          showToast('Casting started');
        }catch(e){
          showToast("Couldn't start casting — use the code above instead");
        }
      };
      const genCodeBtn = document.getElementById('genCodeBtn');
      if(genCodeBtn) genCodeBtn.onclick = async ()=>{
        genCodeBtn.disabled = true; genCodeBtn.textContent = 'Generating…';
        const ok = await act('new_code');
        if(ok) showToast('Code generated');
        else{ genCodeBtn.disabled = false; genCodeBtn.textContent = 'Generate a TV code'; }
      };
      const s = document.getElementById('btnStart'); if(s) s.onclick = ()=>act('start');
      const p = document.getElementById('btnPause'); if(p) p.onclick = ()=>act('pause');
      const r = document.getElementById('btnResume'); if(r) r.onclick = ()=>act('resume');
      const e = document.getElementById('btnEnd'); if(e) e.onclick = ()=>{ if(confirm('End this timer?')) act('end'); };
      const nr = document.getElementById('btnNextRound');
      if(nr) nr.onclick = ()=>{
        if(current.status !== 'ended' && !confirm('This round hasn\'t ended yet — start the next round anyway?')) return;
        act('next_round');
      };
      const restart = document.getElementById('btnRestart'); if(restart) restart.onclick = ()=>{ if(confirm('Restart the clock for this round?')) act('restart'); };
      document.getElementById('roundMinus').onclick = ()=>act('round_delta', -1);
      document.getElementById('roundPlus').onclick = ()=>act('round_delta', 1);
      document.querySelectorAll('[data-adj]').forEach(b=>b.onclick=()=>act('adjust', parseFloat(b.dataset.adj)));
      document.getElementById('btnPushToggle').onclick = async ()=>{
        const next = await togglePush(current.id, pushSubscribed);
        if(next !== pushSubscribed){ pushSubscribed = next; draw(); }
      };

      document.getElementById('openPenaltyForm').onclick = ()=>{
        const f = document.getElementById('penaltyForm');
        f.style.display = f.style.display==='none' ? 'block' : 'none';
      };
      document.getElementById('savePenaltyBtn').onclick = async ()=>{
        const btn = document.getElementById('savePenaltyBtn');
        const round = clamp(parseInt(document.getElementById('pRound').value,10) || current.round_number || 1, 1, 999);
        const table_number = document.getElementById('pTable').value.trim();
        const player_name = document.getElementById('pPlayer').value.trim();
        const penalty = document.getElementById('pPenalty').value;
        const note = document.getElementById('pNote').value.trim();
        if(!player_name){ showToast("Enter the player's name"); return; }
        btn.disabled = true;
        const { error } = await rpc('add_penalty', { p_id: id, p_token: token, p_round: round, p_table: table_number, p_player: player_name, p_penalty: penalty, p_note: note });
        btn.disabled = false;
        if(error){ showToast(errorText(error)); return; }
        ['pTable','pPlayer','pNote'].forEach(fid=>{ document.getElementById(fid).value = ''; });
        showToast('Penalty logged');
        loadPenalties();
      };
    }

    function tick(){
      const info = getPhaseInfo(current);
      // Update just the clock + badge in place for a smooth countdown, full redraw only on state changes.
      const clockEl = document.querySelector('.big-clock');
      const badgeEl = document.querySelector('.phase-badge');
      if(clockEl){ clockEl.textContent = fmtTime(info.remaining); clockEl.className = 'big-clock ' + info.phase; }
      if(badgeEl){ badgeEl.textContent = phaseText(info.phase); badgeEl.className = 'phase-badge ' + info.phase; }
      updateClockBar('clockBarCtrl', current, info);
      setTabTitle(current, info);
      tracker(info);

      // Time ran out locally: ask the server to finalize (it re-checks with its own clock, sends the
      // one "time's up" alert, and the once-a-minute job would do the same within a minute anyway).
      if(current.status === 'running' && info.phase === 'ended' && !busy && Date.now() - lastFinalizeAt > 3000){
        lastFinalizeAt = Date.now();
        act('finalize', 0, true);
      }
    }

    sig = rowSig(current);
    draw();
    loadPenalties();
    setInterval(tick, 1000);
    watchTimers([id], applyRow);
  }

  // ============================================================
  // VIEW PAGE (players / spectators — read only)
  // ============================================================
  async function renderViewPage(id){
    keepScreenAwake();
    renderSoundBtn();
    if(!isUuid(id)){
      app.innerHTML = `<div class="wrap"><div class="error-box">
        <div class="big">Timer not found</div>
        <div class="sub">This link doesn't match any timer.</div>
        <div style="margin-top:20px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div>
      </div></div>`;
      return;
    }
    app.innerHTML = `<div class="center-wrap"><div class="sub">Loading…</div></div>`;

    const { data: timer, error } = await supabase.from('timers').select(TIMER_COLS).eq('id', id).maybeSingle();
    if(error || !timer){
      app.innerHTML = `<div class="wrap"><div class="error-box">
        <div class="big">Timer not found</div>
        <div class="sub">${error ? "Couldn't reach the server — check your connection and reload." : "This link doesn't match any timer."}</div>
        <div style="margin-top:20px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div>
      </div></div>`;
      return;
    }

    let current = timer;
    let pushSubscribed = await isSubscribedToTimer(timer.id);
    let sig = '';
    const tracker = makeAlertTracker();

    function rowSig(r){
      return [r.status, r.running_since, r.accumulated_seconds, r.round_number, r.label,
        r.setup_seconds, r.main_seconds, r.extra_seconds].join('|');
    }
    function applyRow(row){
      if(!row || row.id !== id) return;
      if(current.updated_at && row.updated_at && new Date(row.updated_at) < new Date(current.updated_at)) return; // stale
      current = row;
      const s = rowSig(row);
      if(s !== sig){ sig = s; draw(); }
    }

    function draw(){
      const info = getPhaseInfo(current);
      app.innerHTML = `
        <div class="center-wrap view-mode">
          <div class="round-label">Round ${current.round_number||1}</div>
          <div class="event-label">${escapeHtml(current.label||'Timer')}</div>
          <div class="phase-badge ${info.phase}">${phaseText(info.phase)}</div>
          <div class="big-clock ${info.phase}">${fmtTime(info.remaining)}</div>
          <div class="clock-bar-track"><div class="clock-bar-fill" id="clockBarView"></div></div>
          ${info.phase==='ended' ? `<div class="report-banner">📝 Time's up — please report your results to the judge</div>` : ''}
          <div class="btn-row" style="justify-content:center;margin-top:14px;">
            <button class="mini-btn" id="btnPushToggleView">${pushSubscribed ? '🔔 Alerts on for this timer' : '🔔 Get alerts for this timer'}</button>
            <button class="mini-btn" id="btnCustomizeView">🎨 Customize</button>
            ${fullscreenBtnHtml('btnFullscreenView')}
          </div>
        </div>`;
      document.getElementById('btnPushToggleView').onclick = async ()=>{
        const next = await togglePush(current.id, pushSubscribed);
        if(next !== pushSubscribed){ pushSubscribed = next; draw(); }
      };
      document.getElementById('btnCustomizeView').onclick = openCustomizeModal;
      const fs = document.getElementById('btnFullscreenView'); if(fs) fs.onclick = toggleFullscreen;
      updateClockBar('clockBarView', current, info);
      setTabTitle(current, info);
    }

    function tick(){
      const info = getPhaseInfo(current);
      const clockEl = document.querySelector('.big-clock');
      const badgeEl = document.querySelector('.phase-badge');
      if(clockEl){ clockEl.textContent = fmtTime(info.remaining); clockEl.className='big-clock '+info.phase; }
      if(badgeEl){ badgeEl.textContent = phaseText(info.phase); badgeEl.className='phase-badge '+info.phase; }
      updateClockBar('clockBarView', current, info);
      setTabTitle(current, info);
      tracker(info);
      // The clock reaching zero on this screen is enough to show the "report your results" banner,
      // even if the server hasn't flipped the status yet.
      if(info.phase === 'ended' && !document.querySelector('.report-banner')) draw();
    }

    sig = rowSig(current);
    draw();
    setInterval(tick, 1000);
    watchTimers([id], applyRow);
  }

  // ============================================================
  // MULTI-VIEW (up to 4 timers on one screen — for a store running
  // several events at once, e.g. on a TV or a shared spectator screen)
  // ============================================================
  async function renderMultiPage(ids){
    keepScreenAwake();
    renderSoundBtn();
    if(ids.length === 0){
      app.innerHTML = `<div class="wrap"><div class="error-box"><div class="big">No timers selected</div>
        <div style="margin-top:16px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div></div></div>`;
      return;
    }
    app.innerHTML = `<div class="center-wrap"><div class="sub">Loading…</div></div>`;

    const { data, error } = await supabase.from('timers').select(TIMER_COLS).in('id', ids);
    if(error || !data || data.length === 0){
      app.innerHTML = `<div class="wrap"><div class="error-box"><div class="big">Couldn't load those timers</div>
        <div style="margin-top:16px;"><a class="btn btn-secondary" href="${baseUrl()}">Go home</a></div></div></div>`;
      return;
    }
    // Preserve the order the caller requested, in case it matters to them.
    const timers = ids.map(tid => data.find(t=>t.id===tid)).filter(Boolean);
    const liveIds = timers.map(t=>t.id);
    const stateById = {};
    const trackers = {};
    timers.forEach(t => { stateById[t.id] = t; trackers[t.id] = makeAlertTracker(); });

    function drawAll(){
      app.innerHTML = `<div class="multi-grid count-${timers.length}">
        ${timers.map(t => `
          <div class="multi-cell" id="cell-${t.id}">
            <div class="round-label">Round ${stateById[t.id].round_number||1}</div>
            <div class="event-label">${escapeHtml(stateById[t.id].label||'Timer')}</div>
            <div class="phase-badge idle" id="badge-${t.id}"></div>
            <div class="big-clock" id="clock-${t.id}"></div>
            <div class="clock-bar-track"><div class="clock-bar-fill" id="bar-${t.id}"></div></div>
          </div>`).join('')}
      </div>
      <div class="btn-row" style="justify-content:center;padding:14px;">
        <button class="mini-btn" id="btnCustomizeMulti">🎨 Customize</button>
        ${fullscreenBtnHtml('btnFullscreenMulti')}
      </div>`;
      timers.forEach(t => tickOne(t.id));
      document.getElementById('btnCustomizeMulti').onclick = openCustomizeModal;
      const fs = document.getElementById('btnFullscreenMulti'); if(fs) fs.onclick = toggleFullscreen;
      document.title = 'TurnZero — ' + timers.length + (timers.length === 1 ? ' timer' : ' timers');
    }

    function tickOne(tid){
      const info = getPhaseInfo(stateById[tid]);
      const clockEl = document.getElementById('clock-'+tid);
      const badgeEl = document.getElementById('badge-'+tid);
      if(clockEl){ clockEl.textContent = fmtTime(info.remaining); clockEl.className = 'big-clock ' + info.phase; }
      if(badgeEl){ badgeEl.textContent = phaseText(info.phase, true); badgeEl.className = 'phase-badge ' + info.phase; }
      updateClockBar('bar-'+tid, stateById[tid], info);
      trackers[tid](info);
    }

    function applyRow(row){
      if(!row || !stateById[row.id]) return;
      const old = stateById[row.id];
      if(old.updated_at && row.updated_at && new Date(row.updated_at) < new Date(old.updated_at)) return; // stale
      stateById[row.id] = row;
      if(row.label !== old.label || row.round_number !== old.round_number) drawAll();
      else tickOne(row.id);
    }

    drawAll();
    setInterval(()=>timers.forEach(t=>tickOne(t.id)), 1000);
    watchTimers(liveIds, applyRow);
  }

  // ============================================================
  // ROUTING (runs last, once everything above is defined)
  // ============================================================
  const params = new URLSearchParams(window.location.search);
  (async ()=>{
    await syncServerTime(1);            // one quick sample so the first screen is right...
    syncServerTime(3);                  // ...then refine in the background
    setInterval(syncServerTime, 5*60*1000); // re-check periodically for screens left open a long time
    if(params.has('control')){
      const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
      renderControlPage(params.get('control'), params.get('t') || hashToken || '');
    } else if(params.has('multi')){
      renderMultiPage(params.get('multi').split(',').map(s=>s.trim()).filter(isUuid).slice(0,4));
    } else if(params.has('view')){
      renderViewPage(params.get('view'));
    } else if(params.has('tv')){
      renderTvCodePage(params.get('tv').trim().toUpperCase());
    } else {
      renderHome();
    }
  })();
})();
