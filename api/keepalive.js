// Vercel Cron target (see vercel.json): once a day it makes a couple of tiny requests to
// Supabase so a free-tier project is never idle long enough to be auto-paused.
// Both values come from config.js, which is already public, so there is nothing to configure.
const fs = require('fs');
const path = require('path');

function readConfig() {
  const src = fs.readFileSync(path.join(process.cwd(), 'config.js'), 'utf8');
  const get = (key) => (src.match(new RegExp(key + ":\\s*'([^']*)'")) || [])[1];
  return { url: get('SUPABASE_URL'), key: get('SUPABASE_ANON_KEY') };
}

module.exports = async (req, res) => {
  try {
    const { url, key } = readConfig();
    if (!url || !key) throw new Error('config.js is missing SUPABASE_URL or SUPABASE_ANON_KEY');
    const headers = { apikey: key, Authorization: 'Bearer ' + key };
    const [rpc, read] = await Promise.all([
      fetch(url + '/rest/v1/rpc/server_time', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(url + '/rest/v1/timers?select=id&limit=1', { headers }),
    ]);
    const ok = rpc.ok && read.ok;
    // Cached for 10 minutes at the edge so a stranger hammering this URL can't turn it into load on Supabase.
    if (ok) res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(ok ? 200 : 502).json({ ok, supabase_rpc: rpc.status, supabase_read: read.status, at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
