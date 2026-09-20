-- What the PUBLIC (anon) role can and cannot touch after 01 + 02.
\set ON_ERROR_STOP on
select t.new_timer('Sec test', 1800) as j \gset
select (:'j'::jsonb->>'id')::uuid as tid, (:'j'::jsonb->>'control_token')::uuid as tok \gset

select t.check('timers is publicly readable (sharing needs it)', t.as_role_value('anon', 'select count(*)::text from timers')::int >= 1);
select t.check('timers has NO control_token column', not exists (select 1 from information_schema.columns where table_name = 'timers' and column_name = 'control_token'));
select t.check('timers has NO penalties column', not exists (select 1 from information_schema.columns where table_name = 'timers' and column_name = 'penalties'));

-- private tables: no access for either public role
select t.check('anon cannot read ' || tbl, t.as_role_raises('anon', 'select * from ' || tbl, 'permission denied'))
from unnest(array['timer_secrets','timer_penalties','private_config','timer_push_subscriptions']) tbl;
select t.check('authenticated cannot read ' || tbl, t.as_role_raises('authenticated', 'select * from ' || tbl, 'permission denied'))
from unnest(array['timer_secrets','timer_penalties','private_config','timer_push_subscriptions']) tbl;
select t.check('row-level security is enabled on ' || c.relname, c.relrowsecurity)
from pg_class c where c.relname in ('timers','timer_secrets','timer_penalties','private_config','timer_push_subscriptions') and c.relkind = 'r';

-- direct writes to timers
select t.check('anon cannot UPDATE timers directly', t.as_role_raises('anon', $$update timers set label = 'hacked'$$, 'permission denied'));
select t.check('anon cannot INSERT into timers directly', t.as_role_raises('anon', $$insert into timers (label) values ('x')$$, 'permission denied'));
select t.check('anon cannot DELETE from timers', t.as_role_raises('anon', 'delete from timers', 'permission denied'));
select t.check('anon cannot TRUNCATE timers', t.as_role_raises('anon', 'truncate timers', 'permission denied'));
select t.check('authenticated cannot UPDATE timers directly', t.as_role_raises('authenticated', $$update timers set label = 'hacked'$$, 'permission denied'));
select t.check('label was not changed by any of the attempts', (select label from timers where id = :'tid') = 'Sec test');

-- internal functions
select t.check('anon cannot call ' || f, t.as_role_raises('anon', 'select public.' || f, 'permission denied'))
from unnest(array[
  format('_process_timer(%L)', :'tid'), format('_send_push(%L, ''start'')', :'tid'), format('_check_token(%L, %L)', :'tid', :'tok'),
  '_new_short_code()', 'check_timer_alerts()', 'cleanup_old_timers()', '_append_log(''[]''::jsonb, ''{}''::jsonb)']) f;

-- the public API surface is exactly what the site needs
select t.check('anon CAN call server_time()', t.as_role_value('anon', 'select public.server_time()::text') is not null);
select t.check('verify_control is true for the right token', t.as_role_value('anon', format('select public.verify_control(%L, %L)::text', :'tid', :'tok')) = 'true');
select t.check('verify_control is false for a wrong token', t.as_role_value('anon', format('select public.verify_control(%L, %L)::text', :'tid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) = 'false');
select t.check('verify_control is false for a NULL token', t.as_role_value('anon', format('select coalesce(public.verify_control(%L, null)::text, ''false'')', :'tid')) = 'false');
select t.check('list_penalties needs the token', t.as_role_raises('anon', format('select * from public.list_penalties(%L, %L)', :'tid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'invalid_token'));
select t.check('a token for timer A does not work on timer B', (
  with b as (select t.new_timer('B', 600) j) select t.act_raises(:'tid', (b.j->>'control_token')::uuid, 'start', 'invalid_token') from b));
select t.check('push_subscribe rejects non-push-service endpoints', t.as_role_raises('anon', format('select public.push_subscribe(%L, ''https://evil.example.com/x'', ''k'', ''a'')', :'tid'), 'bad_subscription'));
select t.check('push_subscribe rejects http endpoints', t.as_role_raises('anon', format('select public.push_subscribe(%L, ''http://fcm.googleapis.com/x'', ''k'', ''a'')', :'tid'), 'bad_subscription'));
select t.check('push_subscribe rejects look-alike hosts', t.as_role_raises('anon', format('select public.push_subscribe(%L, ''https://fcm.googleapis.com.evil.com/x'', ''k'', ''a'')', :'tid'), 'bad_subscription'));

-- the once-a-minute and daily jobs are scheduled
select t.check('alert job is scheduled every minute', exists (select 1 from cron.job where jobname = 'check-timer-alerts' and schedule = '* * * * *'));
select t.check('cleanup job is scheduled daily', exists (select 1 from cron.job where jobname = 'cleanup-old-timers'));
select t.check('timers is in the realtime publication', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'timers'));
select t.finish();
