-- Round Timer — schema
-- Run once in a NEW, separate Supabase project's SQL Editor.
-- This is completely independent of any other project's database.

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists timers (
  id uuid primary key default gen_random_uuid(),           -- public id, safe to share (view link / QR)
  control_token uuid not null default gen_random_uuid(),   -- secret, only the judge/TO gets this
  label text not null default '',
  game text not null default 'custom',
  round_number int not null default 1,
  setup_seconds int not null default 0,
  main_seconds int not null default 1800,
  extra_seconds int not null default 0,
  status text not null default 'idle',              -- idle | running | paused | ended
  accumulated_seconds numeric not null default 0,   -- total seconds elapsed across all run segments so far
  running_since timestamptz,                         -- when the current run segment started; null if not running
  adjustments jsonb not null default '[]'::jsonb,    -- log: [{at, delta_seconds, note}]
  penalties jsonb not null default '[]'::jsonb,      -- log: [{id, at, round, table_number, player_name, penalty, note}]
                                                       -- persists for the whole event — never cleared by "Next round"
  notified_15 boolean not null default false,   -- 15 minutes into the round
  notified_10 boolean not null default false,   -- 10 minutes remaining
  notified_5 boolean not null default false,    -- 5 minutes remaining
  notified_end boolean not null default false,  -- time's up
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per device that opted in to push alerts for a specific timer.
-- No accounts involved — subscriptions are tied to the timer itself, since
-- that's the only "identity" that exists in this app.
create table if not exists timer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  timer_id uuid references timers(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- No accounts exist in this app at all. Protection works differently here:
-- anyone can READ any timer (that's the point — it's meant to be shared),
-- but WRITES are only meaningful if the caller also knows the matching
-- control_token, which the app always includes in its update queries
-- (e.g. `where id = X and control_token = Y`). Without the right token,
-- an update simply matches zero rows and does nothing. Because control
-- tokens are random UUIDs, this is safe as long as you don't share a
-- control link publicly — only share view links or QR codes with players.
alter table timers enable row level security;
drop policy if exists "timers public read" on timers;
create policy "timers public read" on timers for select using (true);
drop policy if exists "timers public insert" on timers;
create policy "timers public insert" on timers for insert with check (true);
drop policy if exists "timers public update" on timers;
create policy "timers public update" on timers for update using (true);

alter table timer_push_subscriptions enable row level security;
drop policy if exists "timer push public insert" on timer_push_subscriptions;
create policy "timer push public insert" on timer_push_subscriptions for insert with check (true);
drop policy if exists "timer push public select" on timer_push_subscriptions;
create policy "timer push public select" on timer_push_subscriptions for select using (true);
drop policy if exists "timer push public delete" on timer_push_subscriptions;
create policy "timer push public delete" on timer_push_subscriptions for delete using (true);

-- Enables live sync: players' screens update the instant a judge starts,
-- pauses, or adjusts a timer, with no manual refresh.
alter publication supabase_realtime add table timers;

-- ============================================================
-- Scheduled push alerts — checks every running timer once a minute and
-- fires a push notification at each milestone: 15 minutes into the round,
-- 10 minutes remaining, 5 minutes remaining, and time's up. Each milestone
-- only ever fires once per round thanks to the notified_* flags, which get
-- reset to false whenever a round (re)starts.
--
-- IMPORTANT: after deploying the send-timer-push Edge Function (see
-- SETUP.md), replace both placeholders below with your real values before
-- running this part of the script.
-- ============================================================
create or replace function public.check_timer_alerts()
returns void as $$
declare
  rec record;
  elapsed numeric;
  main_elapsed numeric;
  remaining_in_main numeric;
  total_seconds numeric;
begin
  for rec in select * from timers where status = 'running' and running_since is not null loop
    elapsed := rec.accumulated_seconds + extract(epoch from (now() - rec.running_since));
    total_seconds := rec.setup_seconds + rec.main_seconds + rec.extra_seconds;

    if elapsed >= rec.setup_seconds then
      main_elapsed := elapsed - rec.setup_seconds;
      remaining_in_main := rec.main_seconds - main_elapsed;

      if not rec.notified_15 and main_elapsed >= 900 then
        perform net.http_post(
          url := 'YOUR_FUNCTION_URL/send-timer-push',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR_SERVICE_ROLE_KEY_HERE'),
          body := jsonb_build_object('timer_id', rec.id, 'title', coalesce(nullif(rec.label,''),'TurnZero'), 'body', '15 minutes into the round.')
        );
        update timers set notified_15 = true where id = rec.id;
      end if;

      if not rec.notified_10 and remaining_in_main <= 600 and remaining_in_main > 0 then
        perform net.http_post(
          url := 'YOUR_FUNCTION_URL/send-timer-push',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR_SERVICE_ROLE_KEY_HERE'),
          body := jsonb_build_object('timer_id', rec.id, 'title', coalesce(nullif(rec.label,''),'TurnZero'), 'body', '10 minutes remaining.')
        );
        update timers set notified_10 = true where id = rec.id;
      end if;

      if not rec.notified_5 and remaining_in_main <= 300 and remaining_in_main > 0 then
        perform net.http_post(
          url := 'YOUR_FUNCTION_URL/send-timer-push',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR_SERVICE_ROLE_KEY_HERE'),
          body := jsonb_build_object('timer_id', rec.id, 'title', coalesce(nullif(rec.label,''),'TurnZero'), 'body', '5 minutes remaining.')
        );
        update timers set notified_5 = true where id = rec.id;
      end if;
    end if;

    if not rec.notified_end and elapsed >= total_seconds then
      perform net.http_post(
        url := 'YOUR_FUNCTION_URL/send-timer-push',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer YOUR_SERVICE_ROLE_KEY_HERE'),
        body := jsonb_build_object('timer_id', rec.id, 'title', coalesce(nullif(rec.label,''),'TurnZero'), 'body', 'Time is up! Please report your results to the judge.')
      );
      -- Also finalizes the timer server-side, as a safety net in case the
      -- judge's control tab was closed and never marked it ended itself.
      update timers set notified_end = true, status = 'ended', running_since = null where id = rec.id;
    end if;
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'check-timer-alerts') then
    perform cron.unschedule('check-timer-alerts');
  end if;
end $$;

select cron.schedule('check-timer-alerts', '* * * * *', $$select public.check_timer_alerts();$$);
