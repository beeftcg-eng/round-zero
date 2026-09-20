-- Per-database stand-ins for the Supabase pieces that plain Postgres lacks.
-- Default privileges mimic Supabase (anon/authenticated can use everything new in `public`),
-- so the tests prove our REVOKEs are what protect the private objects.
create publication supabase_realtime;
create schema cron;
create table cron.job (jobid serial, jobname text, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create schema net;
create table net.calls (id serial, url text, headers jsonb, body jsonb);   -- records every "push" the database would send
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id::bigint $$;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
