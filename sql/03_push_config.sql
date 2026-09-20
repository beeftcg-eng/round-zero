-- TurnZero — push notification wiring (run once, after deploying the Edge Function)
--
-- 1. Replace YOUR-PROJECT-REF with your Supabase project reference
--    (the part before .supabase.co in your Project URL).
-- 2. Replace PASTE-YOUR-RANDOM-SECRET with a long random string, and use the SAME
--    string as the PUSH_SHARED_SECRET secret on the Edge Function (see SETUP.md).
--    Generate one with:   openssl rand -hex 32
--
-- This replaces the old approach of pasting your service_role key into a SQL
-- function. The service_role key is no longer needed here at all.
-- Re-run this file any time you need to change either value.

insert into private_config (key, value) values
  ('functions_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1'),
  ('push_secret',   'PASTE-YOUR-RANDOM-SECRET')
on conflict (key) do update set value = excluded.value;
