// Serves the real website files from the repo root, a test config.js, and proxies /rest/v1/* to PostgREST
// (supabase-js adds that prefix; PostgREST itself serves at the root). Same origin => no CORS needed.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

function start(port, apiBase, anonKey) {
  const api = new URL(apiBase);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/rest/v1/')) {
      const p = http.request({ host: api.hostname, port: api.port, path: u.pathname.replace('/rest/v1', '') + u.search, method: req.method, headers: { ...req.headers, host: api.host } },
        r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on('error', () => { res.writeHead(502); res.end(); });
      return req.pipe(p);
    }
    if (u.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.ROUNDTIMER_CONFIG={SUPABASE_URL:'http://127.0.0.1:${port}',SUPABASE_ANON_KEY:'${anonKey}',VAPID_PUBLIC_KEY:''};`);
    }
    const rel = u.pathname === '/' ? '/index.html' : u.pathname;
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, d) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
module.exports = { start };
