-- The same database after step 2 (02_lock_down.sql).
\set ON_ERROR_STOP on
select t.check('control_token and penalties are gone from the public table', not exists (select 1 from information_schema.columns where table_name = 'timers' and column_name in ('control_token', 'penalties')));
select t.check('timer made by the old site AFTER step 1 was swept up by step 2', t.as_role_value('anon', $$select public.verify_control('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd')::text$$) = 'true');
select t.check('penalty written by the old site AFTER step 1 was swept up too (now 3)', t.as_role_value('anon', $$select count(*)::text from public.list_penalties('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$) = '3');
select t.check('original control links still work', t.as_role_value('anon', $$select public.verify_control('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$$) = 'true'
  and t.as_role_value('anon', $$select public.verify_control('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc')::text$$) = 'true');
select t.check('old short code preserved', (select short_code = 'ABCD' from timers where id = '11111111-1111-1111-1111-111111111111'));
select t.check('running state survived the migration', (select status = 'running' from timers where id = '22222222-2222-2222-2222-222222222222'));
select t.check('old open policies are gone', not exists (select 1 from pg_policies where tablename = 'timers' and policyname in ('timers public insert', 'timers public update'))
  and not exists (select 1 from pg_policies where tablename = 'timer_push_subscriptions'));
select t.check('old public write is now denied', t.as_role_raises('anon', $$update timers set label = 'x'$$, 'permission denied') and t.as_role_raises('anon', $$insert into timers (label) values ('x')$$, 'permission denied'));
select t.check('old public read of subscriptions is denied', t.as_role_raises('anon', 'select * from timer_push_subscriptions', 'permission denied'));
select t.check('existing push subscription survived', exists (select 1 from timer_push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/legacy-device'));
select t.check('old single-column unique on endpoint is gone (device can follow 2 timers)', not exists (select 1 from pg_constraint where conname = 'timer_push_subscriptions_endpoint_key'));
select t.check('penalty text survived intact', (select player_name = 'Late Entry' and note = 'added by old site after step 1' from timer_penalties where id = 'p3'));
select t.check('new site works on the migrated database', (t.act('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'pause')).status = 'paused');
select t.finish();
