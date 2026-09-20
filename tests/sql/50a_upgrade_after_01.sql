-- An existing v1 database after step 1 (01_setup_or_upgrade.sql) but BEFORE step 2.
-- The old site must keep working, and every old control link must already work on the new one.
\set ON_ERROR_STOP on
select t.check('old control token copied to the private table', (select control_token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from timer_secrets where timer_id = '11111111-1111-1111-1111-111111111111'));
select t.check('every existing timer got a secret row', (select count(*) from timers) = (select count(*) from timer_secrets));
select t.check('old penalties copied (2) with all fields', (select count(*) = 2 and bool_and(player_name <> '') from timer_penalties where timer_id = '11111111-1111-1111-1111-111111111111')
  and (select note = 'slow play' and table_number = '5' and round = 2 and penalty = 'Warning' from timer_penalties where id = 'p1'));
select t.check('old penalty timestamps preserved', (select at = '2026-09-01T10:00:00Z'::timestamptz from timer_penalties where id = 'p1'));
select t.check('the OLD site still works: legacy columns and open policies untouched', exists (select 1 from information_schema.columns where table_name = 'timers' and column_name = 'control_token')
  and exists (select 1 from pg_policies where tablename = 'timers' and policyname = 'timers public update'));
select t.check('old short code and round number untouched', (select short_code = 'ABCD' and round_number = 3 from timers where id = '11111111-1111-1111-1111-111111111111'));
select t.check('OLD control link verifies on the new API', t.as_role_value('anon', $$select public.verify_control('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text$$) = 'true');
select t.check('old penalties readable with the old token', t.as_role_value('anon', $$select count(*)::text from public.list_penalties('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$) = '2');
select t.check('old timers can be controlled through the new functions', (t.act('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'start')).status = 'running');
select t.check('old push subscription still present', exists (select 1 from timer_push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/legacy-device'));
select t.check('a timer created by the NEW site now works while old columns still exist', t.new_timer('New during transition', 600) is not null);

-- Meanwhile the OLD site keeps creating things (this is what step 2 must sweep up).
insert into timers (id, label, control_token) values ('33333333-3333-3333-3333-333333333333', 'Made by old site after step 1', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
update timers set penalties = penalties || '[{"id":"p3","at":"2026-09-02T09:00:00Z","round":4,"table_number":"1","player_name":"Late Entry","penalty":"Warning","note":"added by old site after step 1"}]'::jsonb
 where id = '11111111-1111-1111-1111-111111111111';
select t.check('(setup) old site wrote a new timer and a new penalty after step 1', (select count(*) from timers where id = '33333333-3333-3333-3333-333333333333') = 1);
select t.finish();
