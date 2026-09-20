-- Push milestones: what the database asks the Edge Function to send, and when.
-- (net.http_post is stubbed to record calls in net.calls.)
\set ON_ERROR_STOP on

-- Without push configured, timers must still work and nothing must be sent (and nothing may raise).
delete from private_config;
select t.new_timer('No push config', 1800) as j0 \gset
select (t.act((:'j0'::jsonb->>'id')::uuid, (:'j0'::jsonb->>'control_token')::uuid, 'start')).status as s0 \gset
select t.check('start works with push unconfigured', :'s0' = 'running');
select t.check('...and sends nothing', (select count(*) from net.calls) = 0);

insert into private_config values ('functions_url', 'https://x.supabase.co/functions/v1/'), ('push_secret', 's3cret');
truncate net.calls;

-- A full 30-minute round with 5 minutes of extra time.
select t.new_timer('Full round', 1800, 300) as j \gset
select (:'j'::jsonb->>'id')::uuid as tid, (:'j'::jsonb->>'control_token')::uuid as tok \gset
select (t.act(:'tid', :'tok', 'start')).id is not null as _ \gset
select t.check('start sends exactly one "start"', t.pushes() = 'start');
select t.check('push goes to <functions_url>/send-timer-push with the shared secret', (select url = 'https://x.supabase.co/functions/v1/send-timer-push' and headers->>'x-push-secret' = 's3cret' and body->>'timer_id' = :'tid' from net.calls limit 1));
select t.check('push body carries ONLY an event name (no free text)', (select (select array_agg(k order by k) from jsonb_object_keys(body) k) = array['event','timer_id'] from net.calls limit 1));

select t.warp(:'tid', 5 * 60);  select check_timer_alerts(); select check_timer_alerts();
select t.check('nothing fires at 5 minutes in', t.pushes() = 'start');
select t.warp(:'tid', 16 * 60); select check_timer_alerts(); select check_timer_alerts();
select t.warp(:'tid', 21 * 60); select check_timer_alerts(); select check_timer_alerts();
select t.warp(:'tid', 26 * 60); select check_timer_alerts(); select check_timer_alerts();
select t.warp(:'tid', 31 * 60); select check_timer_alerts(); select check_timer_alerts();
select t.check('15-in, 10-left, 5-left, extra time: each fires exactly once, in order (job run twice each time)', t.pushes() = 'start,fifteen,ten,five,extra', t.pushes());
select t.warp(:'tid', 36 * 60); select check_timer_alerts(); select check_timer_alerts();
select t.check('time_up fires once and the timer is finalized by the job', t.pushes() = 'start,fifteen,ten,five,extra,time_up' and (select status = 'ended' and running_since is null and notified_end from timers where id = :'tid'), t.pushes());
select check_timer_alerts();
select t.check('an ended timer sends nothing more', t.pushes() = 'start,fifteen,ten,five,extra,time_up');

-- The judge's screen and the once-a-minute job racing at time's up must not both send it.
truncate net.calls;
select t.new_timer('Race', 600) as jr \gset
select (:'jr'::jsonb->>'id')::uuid as rid, (:'jr'::jsonb->>'control_token')::uuid as rtok \gset
select (t.act(:'rid', :'rtok', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'rid', 700);
select (t.act(:'rid', :'rtok', 'finalize')).id is not null as _ \gset
select check_timer_alerts();
select (t.act(:'rid', :'rtok', 'finalize')).id is not null as _ \gset
select t.check('finalize (screen) + job never double-send time_up', t.pushes() = 'time_up', t.pushes());

-- Finalizing slightly early is allowed (a screen's clock can lead by a second); much earlier is not.
select t.new_timer('Slack', 600) as js \gset
select (:'js'::jsonb->>'id')::uuid as sid, (:'js'::jsonb->>'control_token')::uuid as stok \gset
select (t.act(:'sid', :'stok', 'start')).id is not null as _ \gset
select t.warp(:'sid', 598.9);
select t.check('finalize 1.1s early is accepted', (t.act(:'sid', :'stok', 'finalize')).status = 'ended');
select t.new_timer('Slack2', 600) as js2 \gset
select (:'js2'::jsonb->>'id')::uuid as s2id, (:'js2'::jsonb->>'control_token')::uuid as s2tok \gset
select (t.act(:'s2id', :'s2tok', 'start')).id is not null as _ \gset
select t.warp(:'s2id', 590);
select t.check('finalize 10s early is refused (stays running)', (t.act(:'s2id', :'s2tok', 'finalize')).status = 'running');

-- Short rounds do not get nonsense alerts.
truncate net.calls;
select t.new_timer('7 minute round', 420) as j7 \gset
select (:'j7'::jsonb->>'id')::uuid as id7, (:'j7'::jsonb->>'control_token')::uuid as tok7 \gset
select (t.act(:'id7', :'tok7', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'id7', 10);  select check_timer_alerts();
select t.warp(:'id7', 130); select check_timer_alerts();
select t.warp(:'id7', 421); select check_timer_alerts();
select t.check('7-minute round: no "15 in", no "10 left" — just "five" then "time_up"', t.pushes() = 'five,time_up', t.pushes());

truncate net.calls;
select t.new_timer('4 minute round', 240) as j4 \gset
select (:'j4'::jsonb->>'id')::uuid as id4, (:'j4'::jsonb->>'control_token')::uuid as tok4 \gset
select (t.act(:'id4', :'tok4', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'id4', 30); select check_timer_alerts();
select t.check('4-minute round: no "5 minutes remaining" (shorter than the alert)', t.pushes() = '', t.pushes());

-- A 25-minute round: "15 minutes in" would land right on top of "10 left", so only the latter is sent.
truncate net.calls;
select t.new_timer('25 minute round', 1500) as j25 \gset
select (:'j25'::jsonb->>'id')::uuid as id25, (:'j25'::jsonb->>'control_token')::uuid as tok25 \gset
select (t.act(:'id25', :'tok25', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'id25', 16 * 60); select check_timer_alerts();
select t.check('25-minute round: "ten" only (no duplicate "fifteen")', t.pushes() = 'ten', t.pushes());

-- If the job was down and wakes up late, stale alerts are marked done but NOT sent.
truncate net.calls;
select t.new_timer('Late job', 3000) as jl \gset
select (:'jl'::jsonb->>'id')::uuid as lid, (:'jl'::jsonb->>'control_token')::uuid as ltok \gset
select (t.act(:'lid', :'ltok', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'lid', 2600);   -- 400s left: the 10-minute mark passed 200s ago
select check_timer_alerts();
select t.check('a "10 minutes left" that is 200s late is skipped...', t.pushes() = '', t.pushes());
select t.check('...but marked done, and "five" is not yet due', (select notified_10 and not notified_5 from timers where id = :'lid'));
select t.warp(:'lid', 2750); select check_timer_alerts();
select t.check('"five" still fires when its time comes', t.pushes() = 'five', t.pushes());

-- Adding time re-arms alerts that are now in the future again.
truncate net.calls;
select t.new_timer('Re-arm', 3000) as jm \gset
select (:'jm'::jsonb->>'id')::uuid as mid, (:'jm'::jsonb->>'control_token')::uuid as mtok \gset
select (t.act(:'mid', :'mtok', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'mid', 2410); select check_timer_alerts();          -- 590s left -> "ten"
select (t.act(:'mid', :'mtok', 'adjust', 5)).id is not null as _ \gset
select t.check('+5 min after the "10 left" alert re-arms it', (select not notified_10 from timers where id = :'mid'));
update timers set running_since = now() - interval '300 seconds' where id = :'mid';   -- back to 590s left
select check_timer_alerts();
select t.check('...so "ten" fires a second time when the clock gets there again', t.pushes() = 'ten,ten', t.pushes());

-- Only RUNNING timers are checked.
truncate net.calls;
select t.new_timer('Paused', 1800) as jp \gset
select (:'jp'::jsonb->>'id')::uuid as pid, (:'jp'::jsonb->>'control_token')::uuid as ptok \gset
select (t.act(:'pid', :'ptok', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'pid', 1000);
select (t.act(:'pid', :'ptok', 'pause')).id is not null as _ \gset
update timers set accumulated_seconds = 1700 where id = :'pid';     -- would be past several alerts if it were running
select check_timer_alerts();
select t.check('a paused timer never alerts', t.pushes() = '', t.pushes());

-- Timers with a setup phase: alerts count from the END of setup.
truncate net.calls;
select t.new_timer('With setup', 1800, 0, 300) as jw \gset
select (:'jw'::jsonb->>'id')::uuid as wid, (:'jw'::jsonb->>'control_token')::uuid as wtok \gset
select (t.act(:'wid', :'wtok', 'start')).id is not null as _ \gset
truncate net.calls;
select t.warp(:'wid', 16 * 60); select check_timer_alerts();       -- only 11 min of MAIN elapsed
select t.check('setup time is not counted toward "15 minutes in"', t.pushes() = '', t.pushes());
select t.warp(:'wid', 21 * 60); select check_timer_alerts();       -- 16 min of main elapsed
select t.check('...but is once the round proper has run 15 minutes', t.pushes() = 'fifteen', t.pushes());

select t.finish();
