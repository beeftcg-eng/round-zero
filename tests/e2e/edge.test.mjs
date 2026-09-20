// Edge Function test: runs the REAL send-timer-push/index.ts with its two npm imports and the Deno globals mocked.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
const here = import.meta.dirname;
const src = fs.readFileSync(path.resolve(here, '../../send-timer-push/index.ts'), 'utf8');

// Mocks for the two npm imports + the Deno globals the function uses.
const sent = [], deleted = [];
let subsRows = [], timerRow = { label: 'Table 9' };
globalThis.__mock = {
  createClient: () => ({
    from: (table) => {
      const q = { _t: table, select() { return q; }, eq() { return q; }, in(_c, ids) { if (q._del) deleted.push(...ids); return q; },
        delete() { q._del = true; return q; },
        maybeSingle: async () => ({ data: timerRow }),
        then: (res) => res(q._del ? { error: null } : { data: subsRows, error: null }) };
      return q;
    },
  }),
  webpush: {
    setVapidDetails() {},
    sendNotification: async (sub, body, opts) => {
      if (sub.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
      if (sub.endpoint.includes('boom')) { const e = new Error('server error'); e.statusCode = 500; throw e; }
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body), opts });
    },
  },
};
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'q', PUSH_SHARED_SECRET: 'topsecret' };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

let js = stripTypeScriptTypes(src)
  .replace(/import \{ createClient \} from "npm:@supabase\/supabase-js@2";/, 'const { createClient } = globalThis.__mock;')
  .replace(/import webpush from "npm:web-push@3.6.7";/, 'const webpush = globalThis.__mock.webpush;');
const tmp = path.join(here, '.edge_under_test.mjs');
fs.writeFileSync(tmp, js);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }

const ID = '11111111-1111-1111-1111-111111111111';
const call = async (body, headers = {}, method = 'POST') => {
  const res = await handler(new Request('http://f/', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }));
  return { status: res.status, json: await res.json() };
};
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const S = { 'x-push-secret': 'topsecret' };

let r = await call({ timer_id: ID, event: 'start' });
ok('no secret -> 401', r.status === 401, r);
r = await call({ timer_id: ID, event: 'start' }, { 'x-push-secret': 'wrong' });
ok('wrong secret -> 401', r.status === 401, r);
r = await call({ timer_id: ID, event: 'start' }, { 'x-push-secret': 'topsecre' });
ok('secret one char short -> 401', r.status === 401, r);
r = await call(null, S, 'GET');
ok('GET -> 405', r.status === 405, r);
r = await call('not json', S);
ok('invalid JSON is skipped, not a crash', r.status === 200 && r.json.skipped, r);
r = await call({ timer_id: 'nope', event: 'start' }, S);
ok('bad timer id skipped', r.json.skipped && r.json.reason === 'bad timer_id', r);
r = await call({ timer_id: ID, event: 'hack', title: 'Free money', body: 'click here' }, S);
ok('unknown event skipped (callers cannot supply text)', r.json.skipped && sent.length === 0, r);

subsRows = [{ id: 'a', endpoint: 'https://fcm.googleapis.com/fcm/send/1', p256dh: 'k', auth: 'a' },
            { id: 'b', endpoint: 'https://fcm.googleapis.com/fcm/send/gone', p256dh: 'k', auth: 'a' },
            { id: 'c', endpoint: 'https://fcm.googleapis.com/fcm/send/boom', p256dh: 'k', auth: 'a' },
            { id: 'd', endpoint: 'https://evil.example.com/steal', p256dh: 'k', auth: 'a' },
            { id: 'e', endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/z', p256dh: 'k', auth: 'a' }];
r = await call({ timer_id: ID, event: 'time_up', title: 'IGNORED', body: 'IGNORED' }, S);
ok('valid call: sent to the 2 good subscribers', r.status === 200 && r.json.sent === 2, r);
ok('message text is fixed server-side, caller text ignored', sent[0].body.body === 'Time is up! Please report your results to the judge.' && sent[0].body.title === 'Table 9', sent[0]);
ok('payload has timer URL, tag and event for the service worker', sent[0].body.url === '/?view=' + ID && sent[0].body.tag === 'timer-' + ID && sent[0].body.event === 'time_up', sent[0].body);
ok('high urgency + TTL set', sent[0].opts.urgency === 'high' && sent[0].opts.TTL === 600, sent[0].opts);
ok('never POSTs to a non-push-service endpoint', !sent.some(s => s.endpoint.includes('evil')), sent.map(s => s.endpoint));
ok('dead (410) and disallowed subscriptions are deleted; 500 is kept', deleted.includes('b') && deleted.includes('d') && !deleted.includes('c'), deleted);
timerRow = null; sent.length = 0;
r = await call({ timer_id: ID, event: 'start' }, S);
ok('unknown timer -> nothing sent', r.json.sent === 0 && sent.length === 0, r);
timerRow = { label: '   ' }; subsRows = [subsRows[0]];
r = await call({ timer_id: ID, event: 'five' }, S);
ok('blank label falls back to "TurnZero"', sent[0].body.title === 'TurnZero' && sent[0].body.body === '5 minutes remaining.', sent[0] && sent[0].body);
console.log(`\n${pass}/${pass + fail} edge-function checks passed`);
process.exit(fail ? 1 : 0);
