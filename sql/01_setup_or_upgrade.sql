-- TurnZero — step 1 of 2: set up (fresh project) or upgrade (existing project)
--
-- Safe to run more than once. Safe to run on a project that already has the
-- old schema: it only ADDS things, so the currently deployed site keeps
-- working until you run 02_lock_down.sql.
--
-- What this creates:
--   * private tables the public API can never read (control tokens, penalties, config)
--   * server-side functions (RPCs) that do every write, checking the control
--     token and using the SERVER clock for all timestamps
--   * the once-a-minute alert job and a daily cleanup job

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ============================================================
-- Public table: everything a viewer is allowed to see
-- ============================================================
create table if not exists timers (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  game text not null default 'custom',
  round_number int not null default 1,
  setup_seconds int not null default 0,
  main_seconds int not null default 1800,
  extra_seconds int not null default 0,
  status text not null default 'idle',              -- idle | running | paused | ended
  accumulated_seconds numeric not null default 0,   -- seconds elapsed across all finished run segments
  running_since timestamptz,                        -- start of the current run segment (server clock); null if not running
  adjustments jsonb not null default '[]'::jsonb,   -- last 20 time adjustments: [{at, delta_seconds, note}]
  notified_15 boolean not null default false,
  notified_10 boolean not null default false,
  notified_5 boolean not null default false,
  notified_end boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Columns added after the first release (no-ops if already present).
alter table timers add column if not exists short_code text;                          -- 4-char code for TV screens
alter table timers add column if not exists notified_extra boolean not null default false;
alter table timers add column if not exists penalties_rev int not null default 0;     -- bumps whenever penalties change, so the judge's other devices know to refetch

create unique index if not exists timers_short_code_uq on timers (short_code) where short_code is not null;

-- Sanity limits. NOT VALID = enforced for new/changed rows, existing rows are not re-checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timers_sane_values') then
    alter table timers add constraint timers_sane_values check (
      status in ('idle','running','paused','ended')
      and round_number between 1 and 999
      and setup_seconds between 0 and 14400
      and main_seconds between 10 and 36000
      and extra_seconds between 0 and 7200
      and accumulated_seconds >= 0
      and char_length(label) <= 80
    ) not valid;
  end if;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists timers_touch_updated_at on timers;
create trigger timers_touch_updated_at before update on timers
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Private tables: no policies at all, so the public API cannot touch them.
-- Only the functions below (which run as the database owner) can.
-- ============================================================
create table if not exists timer_secrets (
  timer_id uuid primary key references timers(id) on delete cascade,
  control_token uuid not null default gen_random_uuid()
);

create table if not exists timer_penalties (
  id text primary key default gen_random_uuid()::text,
  timer_id uuid not null references timers(id) on delete cascade,
  at timestamptz not null default now(),
  round int,
  table_number text not null default '',
  player_name text not null default '',
  penalty text not null default '',
  note text not null default ''
);
create index if not exists timer_penalties_timer_idx on timer_penalties (timer_id, at);

create table if not exists private_config (
  key text primary key,
  value text not null
);

create table if not exists timer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  timer_id uuid references timers(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
-- One row per (timer, device). The old schema had endpoint alone as unique, which
-- meant subscribing to a second timer silently moved the device off the first.
create unique index if not exists timer_push_timer_endpoint_uq on timer_push_subscriptions (timer_id, endpoint);

alter table timer_secrets enable row level security;
alter table timer_penalties enable row level security;
alter table private_config enable row level security;
revoke all on timer_secrets, timer_penalties, private_config from anon, authenticated;

-- Copy existing control tokens and penalties into the private tables, so every
-- control link people already have keeps working. Only runs on an old-style database.
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

-- Every timer must have a secret row (covers timers created by the old site after this ran).
insert into timer_secrets (timer_id)
select id from timers where not exists (select 1 from timer_secrets s where s.timer_id = timers.id);

-- ============================================================
-- Realtime + read access. Anyone can READ a timer (that is the point: sharing).
-- Nobody can write it directly — see 02_lock_down.sql.
-- ============================================================
alter table timers enable row level security;
drop policy if exists "timers public read" on timers;
create policy "timers public read" on timers for select using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'timers') then
    alter publication supabase_realtime add table timers;
  end if;
end $$;

-- ============================================================
-- Internal helpers (not callable from the public API)
-- ============================================================
create or replace function public._check_token(p_id uuid, p_token uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_token is not null and exists (
    select 1 from timer_secrets where timer_id = p_id and control_token = p_token
  );
$$;

create or replace function public._new_short_code() returns text
language plpgsql set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I/L: easy to type on a TV remote
  code text;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from timers where short_code = code);
  end loop;
  return code;
end $$;

-- Keeps the newest 20 entries.
create or replace function public._append_log(p_log jsonb, p_entry jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
  from (
    select e, ord
    from jsonb_array_elements(coalesce(p_log, '[]'::jsonb) || jsonb_build_array(p_entry)) with ordinality as x(e, ord)
    order by ord desc
    limit 20
  ) s;
$$;

-- Asks the send-timer-push Edge Function to notify everyone subscribed to a timer.
-- Does nothing (and never raises) until 03_push_config.sql has been filled in and run.
create or replace function public._send_push(p_timer_id uuid, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private_config where key = 'functions_url';
  select value into v_secret from private_config where key = 'push_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/send-timer-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('timer_id', p_timer_id, 'event', p_event)
  );
exception when others then
  raise warning 'send_push failed: %', sqlerrm;
end $$;

-- Sends any milestone alerts a running timer has reached, and finalizes it when
-- time is up. Called by the once-a-minute job and by the judge's screen at time's
-- up. Row-locked, so those two can never both send the same alert.
-- p_slack lets the judge's screen finalize a hair early (its clock may lead ours by a second).
create or replace function public._process_timer(p_id uuid, p_slack numeric default 0) returns timers
language plpgsql security definer set search_path = public as $$
declare
  t timers;
  elapsed numeric;
  total numeric;
  main_elapsed numeric;
  remaining numeric;
  changed boolean := false;
begin
  select * into t from timers where id = p_id for update;
  if not found then
    return null;
  end if;
  if t.status <> 'running' or t.running_since is null then
    return t;
  end if;

  elapsed := t.accumulated_seconds + extract(epoch from (clock_timestamp() - t.running_since));
  total := t.setup_seconds + t.main_seconds + t.extra_seconds;

  if elapsed >= t.setup_seconds then
    main_elapsed := elapsed - t.setup_seconds;
    remaining := t.main_seconds - main_elapsed;

    if remaining > 0 then
      -- "15 minutes in": skipped when it would land within 10 minutes of the "10 remaining" alert.
      if not t.notified_15 and main_elapsed >= 900 then
        if t.main_seconds > 1500 and main_elapsed < 1020 then
          perform _send_push(t.id, 'fifteen');
        end if;
        t.notified_15 := true; changed := true;
      end if;
      -- Late (job outage) or pointless (round shorter than the alert) alerts are marked done but not sent.
      if not t.notified_10 and remaining <= 600 then
        if t.main_seconds > 600 and remaining >= 480 then
          perform _send_push(t.id, 'ten');
        end if;
        t.notified_10 := true; changed := true;
      end if;
      if not t.notified_5 and remaining <= 300 then
        if t.main_seconds > 300 and remaining >= 180 then
          perform _send_push(t.id, 'five');
        end if;
        t.notified_5 := true; changed := true;
      end if;
    elsif t.extra_seconds > 0 and not t.notified_extra then
      if (main_elapsed - t.main_seconds) < 120 and elapsed < total then
        perform _send_push(t.id, 'extra');
      end if;
      t.notified_extra := true; changed := true;
    end if;
  end if;

  if not t.notified_end and elapsed >= total - p_slack then
    perform _send_push(t.id, 'time_up');
    t.notified_end := true;
    t.status := 'ended';
    t.running_since := null;
    changed := true;
  end if;

  if changed then
    update timers
       set notified_15 = t.notified_15, notified_10 = t.notified_10, notified_5 = t.notified_5,
           notified_extra = t.notified_extra, notified_end = t.notified_end,
           status = t.status, running_since = t.running_since
     where id = t.id
    returning * into t;
  end if;
  return t;
end $$;

-- ============================================================
-- Public RPCs — the only way the website writes anything
-- ============================================================

-- Clock reference for every screen (replaces the old HTTP Date-header trick,
-- which browsers block cross-origin).
create or replace function public.server_time() returns timestamptz
language sql as $$ select clock_timestamp(); $$;

create or replace function public.create_timer(
  p_label text, p_game text, p_round_number int,
  p_setup_seconds int, p_main_seconds int, p_extra_seconds int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_code text;
  v_token uuid;
begin
  if p_round_number not between 1 and 999
     or p_setup_seconds not between 0 and 14400
     or p_main_seconds not between 10 and 36000
     or p_extra_seconds not between 0 and 7200 then
    raise exception 'bad_value' using errcode = '22023';
  end if;
  -- Crude global brake against someone scripting thousands of timers.
  if (select count(*) from timers where created_at > now() - interval '1 minute') >= 120 then
    raise exception 'too_many_requests' using errcode = '54000';
  end if;

  for attempt in 1..5 loop
    begin
      insert into timers (label, game, round_number, setup_seconds, main_seconds, extra_seconds, short_code)
      values (left(btrim(coalesce(p_label, '')), 80), left(coalesce(p_game, 'custom'), 30), p_round_number,
              p_setup_seconds, p_main_seconds, p_extra_seconds, _new_short_code())
      returning id, short_code into v_id, v_code;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'could_not_create' using errcode = '55000';
  end if;

  insert into timer_secrets (timer_id) values (v_id)
  on conflict (timer_id) do update set timer_id = excluded.timer_id
  returning control_token into v_token;

  return jsonb_build_object('id', v_id, 'control_token', v_token, 'short_code', v_code);
end $$;

create or replace function public.verify_control(p_id uuid, p_token uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._check_token(p_id, p_token);
$$;

-- One function for every judge action. Every timestamp is the SERVER's clock.
--   start | restart | pause | resume | end | next_round | finalize | new_code
--   adjust      (p_amount = minutes, + adds time, - removes it)
--   round_delta (p_amount = whole number of rounds, + or -)
create or replace function public.timer_action(
  p_id uuid, p_token uuid, p_action text, p_amount numeric default 0
) returns timers
language plpgsql security definer set search_path = public as $$
declare
  t timers;
  elapsed numeric;
  total numeric;
  delta numeric;
  new_acc numeric;
  main_elapsed numeric;
  remaining numeric;
  v_status text;
  v_main int;
  v_code text;
  v_note text;
  v_log jsonb;
begin
  if not _check_token(p_id, p_token) then
    raise exception 'invalid_token' using errcode = '28000';
  end if;

  select * into t from timers where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  total := t.setup_seconds + t.main_seconds + t.extra_seconds;

  case p_action
    when 'start', 'restart' then
      -- 'start' is ignored unless idle, so a double-tap can't reset a running clock.
      if p_action = 'start' and t.status <> 'idle' then
        return t;
      end if;
      update timers
         set status = 'running', accumulated_seconds = 0, running_since = clock_timestamp(),
             notified_15 = false, notified_10 = false, notified_5 = false,
             notified_extra = false, notified_end = false
       where id = p_id returning * into t;
      perform _send_push(p_id, 'start');

    when 'pause' then
      if t.status = 'running' and t.running_since is not null then
        update timers
           set status = 'paused',
               accumulated_seconds = accumulated_seconds + extract(epoch from (clock_timestamp() - running_since)),
               running_since = null
         where id = p_id returning * into t;
      end if;

    when 'resume' then
      if t.status = 'paused' then
        update timers set status = 'running', running_since = clock_timestamp()
         where id = p_id returning * into t;
      end if;

    when 'end' then
      if t.status in ('running', 'paused') then
        update timers set status = 'ended', running_since = null
         where id = p_id returning * into t;
      end if;

    when 'next_round' then
      update timers
         set status = 'idle', accumulated_seconds = 0, running_since = null,
             round_number = least(999, round_number + 1), adjustments = '[]'::jsonb,
             notified_15 = false, notified_10 = false, notified_5 = false,
             notified_extra = false, notified_end = false
       where id = p_id returning * into t;

    when 'finalize' then
      t := _process_timer(p_id, 1.5);

    when 'round_delta' then
      update timers set round_number = greatest(1, least(999, round_number + p_amount::int))
       where id = p_id returning * into t;

    when 'new_code' then
      v_code := _new_short_code();
      update timers set short_code = v_code where id = p_id returning * into t;

    when 'adjust' then
      delta := round(p_amount * 60);           -- seconds; + = more time for the players
      if delta = 0 or abs(delta) > 3600 then
        raise exception 'bad_amount' using errcode = '22023';
      end if;
      v_note := (case when delta > 0 then '+' else '' end) || trim_scale(round(p_amount, 2))::text || ' min';
      v_log := _append_log(t.adjustments, jsonb_build_object(
                 'at', clock_timestamp(), 'delta_seconds', delta, 'note', v_note));

      if t.status = 'idle' then
        -- Nothing is running yet: change the round length itself.
        v_main := greatest(60, t.main_seconds + delta::int);
        update timers set main_seconds = v_main, adjustments = v_log
         where id = p_id returning * into t;

      elsif t.status in ('running', 'paused') then
        elapsed := t.accumulated_seconds;
        if t.status = 'running' and t.running_since is not null then
          elapsed := elapsed + extract(epoch from (clock_timestamp() - t.running_since));
        end if;
        new_acc := greatest(0, elapsed - delta);
        main_elapsed := new_acc - t.setup_seconds;
        remaining := t.main_seconds - main_elapsed;
        v_status := case when new_acc >= total then 'ended' else t.status end;
        update timers
           set accumulated_seconds = new_acc,
               status = v_status,
               running_since = case when v_status = 'running' then clock_timestamp() else null end,
               adjustments = v_log,
               -- If time was added, let alerts that are now in the future fire again.
               notified_15 = notified_15 and main_elapsed >= 900,
               notified_10 = notified_10 and remaining <= 600,
               notified_5 = notified_5 and remaining <= 300,
               notified_extra = notified_extra and remaining <= 0,
               notified_end = (v_status = 'ended')
         where id = p_id returning * into t;

      elsif t.status = 'ended' and delta > 0 then
        -- Time added after time's up (e.g. a deck check): reopen the clock, paused,
        -- with exactly that much time left. The judge presses Resume when ready.
        new_acc := greatest(0, total - delta);
        main_elapsed := new_acc - t.setup_seconds;
        remaining := t.main_seconds - main_elapsed;
        update timers
           set status = 'paused', running_since = null, accumulated_seconds = new_acc, adjustments = v_log,
               notified_15 = main_elapsed >= 900, notified_10 = remaining <= 600, notified_5 = remaining <= 300,
               notified_extra = remaining <= 0, notified_end = false
         where id = p_id returning * into t;
      end if;

    else
      raise exception 'unknown_action' using errcode = '22023';
  end case;

  return t;
end $$;

-- ---------- Penalties (judge-only) ----------
create or replace function public.list_penalties(p_id uuid, p_token uuid) returns setof timer_penalties
language plpgsql security definer set search_path = public as $$
begin
  if not _check_token(p_id, p_token) then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  return query select * from timer_penalties where timer_id = p_id order by at, id;
end $$;

create or replace function public.add_penalty(
  p_id uuid, p_token uuid, p_round int, p_table text, p_player text, p_penalty text, p_note text
) returns timer_penalties
language plpgsql security definer set search_path = public as $$
declare
  r timer_penalties;
begin
  if not _check_token(p_id, p_token) then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  if btrim(coalesce(p_player, '')) = '' then
    raise exception 'player_required' using errcode = '22023';
  end if;
  if (select count(*) from timer_penalties where timer_id = p_id) >= 2000 then
    raise exception 'too_many_penalties' using errcode = '54000';
  end if;
  insert into timer_penalties (timer_id, round, table_number, player_name, penalty, note)
  values (p_id, p_round, left(btrim(coalesce(p_table, '')), 20), left(btrim(p_player), 80),
          left(btrim(coalesce(p_penalty, '')), 40), left(btrim(coalesce(p_note, '')), 500))
  returning * into r;
  update timers set penalties_rev = penalties_rev + 1 where id = p_id;
  return r;
end $$;

create or replace function public.delete_penalty(p_id uuid, p_token uuid, p_penalty_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_token(p_id, p_token) then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  delete from timer_penalties where id = p_penalty_id and timer_id = p_id;
  update timers set penalties_rev = penalties_rev + 1 where id = p_id;
end $$;

create or replace function public.clear_penalties(p_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _check_token(p_id, p_token) then
    raise exception 'invalid_token' using errcode = '28000';
  end if;
  delete from timer_penalties where timer_id = p_id;
  update timers set penalties_rev = penalties_rev + 1 where id = p_id;
end $$;

-- ---------- Push subscriptions ----------
-- The endpoint URL is unguessable, so knowing it is what lets a device manage its own
-- subscription. Endpoints are limited to the real browser push services, so nobody can
-- make the server send requests to arbitrary addresses.
create or replace function public.push_subscribe(p_timer_id uuid, p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from timers where id = p_timer_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if length(coalesce(p_endpoint, '')) > 1000 or length(coalesce(p_p256dh, '')) > 200 or length(coalesce(p_auth, '')) > 100
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'bad_subscription' using errcode = '22023';
  end if;
  if (select count(*) from timer_push_subscriptions where timer_id = p_timer_id) >= 1000 then
    raise exception 'too_many_subscriptions' using errcode = '54000';
  end if;
  insert into timer_push_subscriptions (timer_id, endpoint, p256dh, auth)
  values (p_timer_id, p_endpoint, p_p256dh, p_auth)
  on conflict (timer_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.push_unsubscribe(p_timer_id uuid, p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from timer_push_subscriptions where timer_id = p_timer_id and endpoint = p_endpoint;
$$;

create or replace function public.push_status(p_timer_id uuid, p_endpoint text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from timer_push_subscriptions where timer_id = p_timer_id and endpoint = p_endpoint);
$$;

-- ============================================================
-- Scheduled jobs
-- ============================================================
create or replace function public.check_timer_alerts() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select id from timers where status = 'running' and running_since is not null loop
    perform _process_timer(r.id, 0);
  end loop;
end $$;

-- Timers nobody has touched for 30 days are deleted, along with their penalties and subscriptions.
create or replace function public.cleanup_old_timers() returns void
language sql security definer set search_path = public as $$
  delete from timers where updated_at < now() - interval '30 days' and status <> 'running';
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'check-timer-alerts') then
    perform cron.unschedule('check-timer-alerts');
  end if;
  if exists (select 1 from cron.job where jobname = 'cleanup-old-timers') then
    perform cron.unschedule('cleanup-old-timers');
  end if;
end $$;
select cron.schedule('check-timer-alerts', '* * * * *', $$select public.check_timer_alerts();$$);
select cron.schedule('cleanup-old-timers', '17 3 * * *', $$select public.cleanup_old_timers();$$);

-- ============================================================
-- Permissions: internal helpers are private; the public RPCs are callable by the website.
-- ============================================================
revoke all on function public._check_token(uuid, uuid) from public, anon, authenticated;
revoke all on function public._new_short_code() from public, anon, authenticated;
revoke all on function public._append_log(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._send_push(uuid, text) from public, anon, authenticated;
revoke all on function public._process_timer(uuid, numeric) from public, anon, authenticated;
revoke all on function public.check_timer_alerts() from public, anon, authenticated;
revoke all on function public.cleanup_old_timers() from public, anon, authenticated;

revoke all on function public.server_time() from public;
revoke all on function public.create_timer(text, text, int, int, int, int) from public;
revoke all on function public.verify_control(uuid, uuid) from public;
revoke all on function public.timer_action(uuid, uuid, text, numeric) from public;
revoke all on function public.list_penalties(uuid, uuid) from public;
revoke all on function public.add_penalty(uuid, uuid, int, text, text, text, text) from public;
revoke all on function public.delete_penalty(uuid, uuid, text) from public;
revoke all on function public.clear_penalties(uuid, uuid) from public;
revoke all on function public.push_subscribe(uuid, text, text, text) from public;
revoke all on function public.push_unsubscribe(uuid, text) from public;
revoke all on function public.push_status(uuid, text) from public;

grant execute on function public.server_time() to anon, authenticated;
grant execute on function public.create_timer(text, text, int, int, int, int) to anon, authenticated;
grant execute on function public.verify_control(uuid, uuid) to anon, authenticated;
grant execute on function public.timer_action(uuid, uuid, text, numeric) to anon, authenticated;
grant execute on function public.list_penalties(uuid, uuid) to anon, authenticated;
grant execute on function public.add_penalty(uuid, uuid, int, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_penalty(uuid, uuid, text) to anon, authenticated;
grant execute on function public.clear_penalties(uuid, uuid) to anon, authenticated;
grant execute on function public.push_subscribe(uuid, text, text, text) to anon, authenticated;
grant execute on function public.push_unsubscribe(uuid, text) to anon, authenticated;
grant execute on function public.push_status(uuid, text) to anon, authenticated;
