-- Penalties (judge-only), push subscriptions, rate limits and the 30-day cleanup.
\set ON_ERROR_STOP on
select t.new_timer('Penalty test', 1800) as j \gset
select (:'j'::jsonb->>'id')::uuid as tid, (:'j'::jsonb->>'control_token')::uuid as tok \gset
select t.new_timer('Other timer', 1800) as jo \gset
select (:'jo'::jsonb->>'id')::uuid as oid, (:'jo'::jsonb->>'control_token')::uuid as otok \gset
select penalties_rev as rev0 from timers where id = :'tid' \gset

-- add / list
select t.as_role_value('anon', format($$select (public.add_penalty(%L, %L, 2, ' 12 ', '  Sam  ', 'Game Loss', 'slow play')).id$$, :'tid', :'tok')) as pid \gset
select t.check('add_penalty returns an id', length(:'pid') > 10);
select t.check('list_penalties returns it, trimmed', t.as_role_value('anon', format($$select (select player_name || '|' || table_number || '|' || round from public.list_penalties(%L, %L))$$, :'tid', :'tok')) = 'Sam|12|2');
select t.check('blank player name rejected', t.as_role_raises('anon', format($$select public.add_penalty(%L, %L, 1, '1', '   ', 'Warning', '')$$, :'tid', :'tok'), 'player_required'));
select t.check('wrong token cannot add', t.as_role_raises('anon', format($$select public.add_penalty(%L, %L, 1, '1', 'X', 'Warning', '')$$, :'tid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'invalid_token'));
select t.check('wrong token cannot list', t.as_role_raises('anon', format('select * from public.list_penalties(%L, %L)', :'tid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'invalid_token'));
select t.check('another timer''s token cannot list these penalties', t.as_role_raises('anon', format('select * from public.list_penalties(%L, %L)', :'tid', :'otok'), 'invalid_token'));
select t.check('overlong note is truncated to 500 chars', t.as_role_value('anon', format($$select length((public.add_penalty(%L, %L, 1, '1', 'Long', 'Warning', repeat('x', 900))).note)::text$$, :'tid', :'tok')) = '500');
select t.as_role_value('anon', format('select public.delete_penalty(%L, %L, %L)::text', :'oid', :'otok', :'pid')) as _ \gset
select t.check('another timer''s token cannot delete this penalty', exists (select 1 from timer_penalties where id = :'pid'));
select t.as_role_value('anon', format('select public.delete_penalty(%L, %L, %L)::text', :'tid', :'tok', :'pid')) as _ \gset
select t.check('delete_penalty removes it', not exists (select 1 from timer_penalties where id = :'pid'));
select t.as_role_value('anon', format('select public.clear_penalties(%L, %L)::text', :'tid', :'tok')) as _ \gset
select t.check('clear_penalties removes all of them', (select count(*) from timer_penalties where timer_id = :'tid') = 0);
select t.check('every penalty change bumped penalties_rev (add, add, delete, clear = 4)', (select penalties_rev - :rev0 = 4 from timers where id = :'tid'), (select (penalties_rev - :rev0)::text from timers where id = :'tid'));
select t.check('penalties are removed with their timer (cascade)', (select count(*) from pg_constraint where conrelid = 'timer_penalties'::regclass and confdeltype = 'c') = 1);

-- push subscriptions
select t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://fcm.googleapis.com/fcm/send/abc', 'key', 'auth')::text$$, :'tid')) as _ \gset
select t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://fcm.googleapis.com/fcm/send/abc', 'key2', 'auth2')::text$$, :'tid')) as _ \gset
select t.check('re-subscribing the same device to the same timer updates, not duplicates', (select count(*) = 1 and max(p256dh) = 'key2' from timer_push_subscriptions where timer_id = :'tid'));
select t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://fcm.googleapis.com/fcm/send/abc', 'key', 'auth')::text$$, :'oid')) as _ \gset
select t.check('one device can follow TWO timers (old schema silently dropped the first)', (select count(*) = 2 from timer_push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'));
select t.check('Firefox endpoints accepted', t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://updates.push.services.mozilla.com/wpush/v2/xyz', 'k', 'a')::text$$, :'tid')) is not null);
select t.check('Safari endpoints accepted', t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://web.push.apple.com/QAbc', 'k', 'a')::text$$, :'tid')) is not null);
select t.check('subscribing to an unknown timer fails', t.as_role_raises('anon', $$select public.push_subscribe('99999999-9999-9999-9999-999999999999', 'https://fcm.googleapis.com/fcm/send/z', 'k', 'a')$$, 'not_found'));
select t.check('absurdly long endpoint rejected', t.as_role_raises('anon', format($$select public.push_subscribe(%L, 'https://fcm.googleapis.com/' || repeat('a', 1200), 'k', 'a')$$, :'tid'), 'bad_subscription'));
select t.check('push_status is true for the subscribed device', t.as_role_value('anon', format($$select public.push_status(%L, 'https://fcm.googleapis.com/fcm/send/abc')::text$$, :'tid')) = 'true');
select t.as_role_value('anon', format($$select public.push_unsubscribe(%L, 'https://fcm.googleapis.com/fcm/send/abc')::text$$, :'tid')) as _ \gset
select t.check('unsubscribe removes only that timer for that device', t.as_role_value('anon', format($$select public.push_status(%L, 'https://fcm.googleapis.com/fcm/send/abc')::text$$, :'tid')) = 'false'
  and t.as_role_value('anon', format($$select public.push_status(%L, 'https://fcm.googleapis.com/fcm/send/abc')::text$$, :'oid')) = 'true');

-- 30-day cleanup
select t.new_timer('Stale idle', 600) as js \gset
select (:'js'::jsonb->>'id')::uuid as stale, (:'js'::jsonb->>'control_token')::uuid as stok \gset
select t.new_timer('Stale but running', 600) as jr \gset
select (:'jr'::jsonb->>'id')::uuid as runid, (:'jr'::jsonb->>'control_token')::uuid as rtok \gset
select (t.act(:'runid', :'rtok', 'start')).id is not null as _ \gset
select t.as_role_value('anon', format($$select (public.add_penalty(%L, %L, 1, '1', 'Old', 'Warning', '')).id$$, :'stale', :'stok')) as _ \gset
select t.as_role_value('anon', format($$select public.push_subscribe(%L, 'https://fcm.googleapis.com/fcm/send/stale', 'k', 'a')::text$$, :'stale')) as _ \gset
alter table timers disable trigger timers_touch_updated_at;
update timers set updated_at = now() - interval '40 days' where id in (:'stale', :'runid');
alter table timers enable trigger timers_touch_updated_at;
select cleanup_old_timers();
select t.check('40-day-old idle timer is deleted', not exists (select 1 from timers where id = :'stale'));
select t.check('...with its secret, penalties and subscriptions', not exists (select 1 from timer_secrets where timer_id = :'stale') and not exists (select 1 from timer_penalties where timer_id = :'stale') and not exists (select 1 from timer_push_subscriptions where timer_id = :'stale'));
select t.check('a RUNNING timer is never cleaned up, even if old', exists (select 1 from timers where id = :'runid'));
select t.check('recent timers are kept', exists (select 1 from timers where id = :'tid'));

-- rate limit on creation (rows are removed afterwards so later suites are unaffected)
do $$
begin
  for i in 1..140 loop
    begin
      perform t.new_timer('rate-limit probe', 600);
    exception when others then
      exit;   -- the limit was reached, which is what we want
    end;
  end loop;
end $$;
select t.check('creating >120 timers in a minute is refused', t.as_role_raises('anon', $$select public.create_timer('x','custom',1,0,600,0)$$, 'too_many_requests'));
delete from timers where label = 'rate-limit probe';
select t.check('...and works again once the burst is over', t.as_role_value('anon', $$select public.create_timer('after burst','custom',1,0,600,0)::text$$) is not null);
select t.finish();
