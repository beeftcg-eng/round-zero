-- Data as the ORIGINAL (v1) site would have left it: tokens and penalties on the public row.
alter table timers add column if not exists short_code text unique;   -- the live v1 database had this column (added by hand)
insert into timers (id, label, control_token, short_code, round_number, penalties) values
  ('11111111-1111-1111-1111-111111111111', 'Old table 1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ABCD', 3,
   '[{"id":"p1","at":"2026-09-01T10:00:00Z","round":2,"table_number":"5","player_name":"Alex","penalty":"Warning","note":"slow play"},
     {"id":"p2","at":"2026-09-01T11:00:00Z","round":3,"table_number":"7","player_name":"Sam","penalty":"Game Loss","note":""}]'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'Old table 2 (no code, no penalties)', 'cccccccc-cccc-cccc-cccc-cccccccccccc', null, 1, '[]'::jsonb);
insert into timer_push_subscriptions (timer_id, endpoint, p256dh, auth)
  values ('11111111-1111-1111-1111-111111111111', 'https://fcm.googleapis.com/fcm/send/legacy-device', 'k', 'a');
