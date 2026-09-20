-- Test helpers (loaded in front of every suite).
create schema if not exists t;
drop table if exists t.results;
create table t.results (name text, ok boolean, detail text);

create or replace function t.check(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $$
begin
  insert into t.results values (p_name, coalesce(p_ok, false), p_detail);
  raise notice '%  %', case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end,
    p_name || case when coalesce(p_ok, false) then '' else '   -> ' || coalesce(p_detail, '') end;
end $$;

create or replace function t.finish() returns void language plpgsql as $$
declare f int; n int;
begin
  select count(*) filter (where not ok), count(*) into f, n from t.results;
  raise notice '% / % SQL checks passed', n - f, n;
  if f > 0 then raise exception '% SQL check(s) failed', f; end if;
end $$;

-- Runs a statement as a role; true only if it RAISES an error whose message matches the pattern.
create or replace function t.as_role_raises(p_role text, p_sql text, p_pattern text default '.*') returns boolean
language plpgsql as $$
declare msg text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    execute 'reset role';
    return false;
  exception when others then
    get stacked diagnostics msg = message_text;
    execute 'reset role';
    return msg ~ p_pattern;
  end;
end $$;

-- Runs a one-value query as a role and returns it as text.
create or replace function t.as_role_value(p_role text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  execute p_sql into v;
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- Calls the public timer_action exactly as the website does (as the anon role).
create or replace function t.act(p_id uuid, p_tok uuid, p_action text, p_amount numeric default 0) returns timers
language plpgsql as $$
declare r timers;
begin
  execute 'set local role anon';
  select * into r from public.timer_action(p_id, p_tok, p_action, p_amount);
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $$;

create or replace function t.act_raises(p_id uuid, p_tok uuid, p_action text, p_pattern text) returns boolean
language plpgsql as $$
begin
  return t.as_role_raises('anon', format('select public.timer_action(%L, %L, %L)', p_id, p_tok, p_action), p_pattern);
end $$;

-- Creates a timer as the website would and returns {id, control_token, short_code}.
create or replace function t.new_timer(p_label text, p_main int, p_extra int default 0, p_setup int default 0) returns jsonb
language plpgsql as $$
begin
  return t.as_role_value('anon', format('select public.create_timer(%L, ''custom'', 1, %s, %s, %s)::text', p_label, p_setup, p_main, p_extra))::jsonb;
end $$;

-- Pretends the timer has been running for N seconds (rewinds running_since; the accumulated part is untouched).
create or replace function t.warp(p_id uuid, p_seconds numeric) returns void language sql as $$
  update timers set running_since = now() - make_interval(secs => p_seconds) where id = p_id;
$$;

-- Push events the database has "sent", in order.
create or replace function t.pushes() returns text language sql as $$
  select coalesce(string_agg(body->>'event', ',' order by id), '') from net.calls;
$$;
