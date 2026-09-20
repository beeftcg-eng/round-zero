-- TurnZero — step 2 of 2: lock the database down
--
-- Run this AFTER the new website is deployed (see SETUP.md). Once it runs:
--   * control tokens and penalties are no longer stored on the public `timers` table
--   * nobody can write to `timers` directly — every change goes through the
--     token-checked functions created by 01_setup_or_upgrade.sql
--   * nobody can read or delete push subscriptions through the public API
--
-- The OLD version of the website stops working when this runs (it relied on the
-- open policies). Anyone with the old page open needs to reload.
--
-- Safe on a brand-new project too (run it right after step 1). Safe to re-run.

-- 1. Last chance to copy anything the old site wrote after step 1 ran.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'timers' and column_name = 'control_token') then
    execute 'insert into timer_secrets (timer_id, control_token) select id, control_token from timers on conflict (timer_id) do nothing';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'timers' and column_name = 'penalties') then
    execute $q$
      insert into timer_penalties (id, timer_id, at, round, table_number, player_name, penalty, note)
      select coalesce(nullif(p->>'id', ''), gen_random_uuid()::text), t.id,
             coalesce((p->>'at')::timestamptz, now()),
             nullif(p->>'round', '')::int,
             coalesce(p->>'table_number', ''), coalesce(p->>'player_name', ''),
             coalesce(p->>'penalty', ''), coalesce(p->>'note', '')
      from timers t cross join lateral jsonb_array_elements(t.penalties) p
      on conflict (id) do nothing
    $q$;
  end if;
end $$;

insert into timer_secrets (timer_id)
select id from timers where not exists (select 1 from timer_secrets s where s.timer_id = timers.id);

-- 2. Remove the secrets from the public table.
alter table timers drop column if exists control_token;
alter table timers drop column if exists penalties;

-- 3. Public can read timers (needed for sharing + live updates) and nothing else.
drop policy if exists "timers public insert" on timers;
drop policy if exists "timers public update" on timers;
revoke insert, update, delete, truncate on timers from anon, authenticated;
grant select on timers to anon, authenticated;

-- 4. Push subscriptions: no public access at all. The website uses push_subscribe /
--    push_unsubscribe / push_status instead, and the Edge Function uses the service role.
drop policy if exists "timer push public insert" on timer_push_subscriptions;
drop policy if exists "timer push public select" on timer_push_subscriptions;
drop policy if exists "timer push public delete" on timer_push_subscriptions;
alter table timer_push_subscriptions enable row level security;
revoke all on timer_push_subscriptions from anon, authenticated;
alter table timer_push_subscriptions drop constraint if exists timer_push_subscriptions_endpoint_key;
