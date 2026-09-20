-- Timer state machine, driven exactly as the website drives it (through timer_action as anon).
\set ON_ERROR_STOP on

select t.new_timer('  Table 9  ', 1800, 300) as j \gset
select (:'j'::jsonb->>'id')::uuid as tid, (:'j'::jsonb->>'control_token')::uuid as tok, :'j'::jsonb->>'short_code' as code \gset

select t.check('create_timer trims the label', (select label from timers where id = :'tid') = 'Table 9');
select t.check('create_timer returns a 4-character TV code from the safe alphabet', :'code' ~ '^[A-HJKMNP-Z2-9]{4}$', :'code');
select t.check('control token is stored privately and matches', (select control_token = :'tok'::uuid from timer_secrets where timer_id = :'tid'));
select t.check('new timer is idle with nothing accumulated', (select status = 'idle' and accumulated_seconds = 0 and running_since is null from timers where id = :'tid'));
select t.check('rejects a 5-second round', t.as_role_raises('anon', $$select public.create_timer('x','custom',1,0,5,0)$$, 'bad_value'));
select t.check('rejects a 11-hour round', t.as_role_raises('anon', $$select public.create_timer('x','custom',1,0,40000,0)$$, 'bad_value'));
select t.check('rejects round number 0', t.as_role_raises('anon', $$select public.create_timer('x','custom',0,0,600,0)$$, 'bad_value'));
select t.check('rejects negative setup time', t.as_role_raises('anon', $$select public.create_timer('x','custom',1,-5,600,0)$$, 'bad_value'));
select t.check('wrong token is rejected', t.act_raises(:'tid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'start', 'invalid_token'));
select t.check('unknown action is rejected', t.act_raises(:'tid', :'tok', 'nonsense', 'unknown_action'));
select t.check('unknown timer is rejected', t.act_raises('99999999-9999-9999-9999-999999999999', :'tok', 'start', 'invalid_token'));

-- start
select (t.act(:'tid', :'tok', 'start')).status as s \gset
select t.check('start -> running with a server-stamped running_since', :'s' = 'running' and (select running_since is not null from timers where id = :'tid'));
select running_since as rs1 from timers where id = :'tid' \gset
select pg_sleep(0.05);
select t.check('a second start (double tap) is ignored, clock not reset', (t.act(:'tid', :'tok', 'start')).running_since = :'rs1'::timestamptz);

-- pause / resume
select t.warp(:'tid', 600);
select t.check('pause folds ~600s into accumulated and clears running_since', (
  select status = 'paused' and accumulated_seconds between 599 and 602 and running_since is null from t.act(:'tid', :'tok', 'pause') as x));
select t.check('pause again does nothing', (t.act(:'tid', :'tok', 'pause')).status = 'paused');
select (t.act(:'tid', :'tok', 'resume')).id is not null as _ \gset
select t.check('resume runs it again keeping the accumulated time', (select status = 'running' and accumulated_seconds between 599 and 602 and running_since is not null from timers where id = :'tid'));

-- adjust while running: -1 min removes a minute, +5 adds five
update timers set running_since = now() where id = :'tid';
select t.check('adjust -1 removes a minute (660s elapsed)', round((t.act(:'tid', :'tok', 'adjust', -1)).accumulated_seconds) = 660);
select t.check('adjust +5 gives five back (360s elapsed)', round((t.act(:'tid', :'tok', 'adjust', 5)).accumulated_seconds) = 360);
select t.check('adjustments are logged with a readable note', (select adjustments->-1->>'note' = '+5 min' and adjustments->0->>'note' = '-1 min' from timers where id = :'tid'));
select t.check('adjust by 0 / by 2 hours is rejected', t.as_role_raises('anon', format('select public.timer_action(%L,%L,''adjust'',0)', :'tid', :'tok'), 'bad_amount') and t.as_role_raises('anon', format('select public.timer_action(%L,%L,''adjust'',120)', :'tid', :'tok'), 'bad_amount'));
select t.check('adjusting far below zero clamps elapsed at 0', (t.act(:'tid', :'tok', 'adjust', 60)).accumulated_seconds = 0);

-- finalize
select t.check('finalize before time is up leaves it running', (t.act(:'tid', :'tok', 'finalize')).status = 'running');
select t.warp(:'tid', 7200);
select t.check('finalize after time is up ends it and sets notified_end', (select status = 'ended' and notified_end and running_since is null from t.act(:'tid', :'tok', 'finalize') as x));
select t.check('finalize twice is harmless', (t.act(:'tid', :'tok', 'finalize')).status = 'ended');

-- adding time after time is up reopens the clock, PAUSED, with exactly that much left
select (t.act(:'tid', :'tok', 'adjust', 2)).id is not null as _ \gset
select t.check('+2 after the end -> paused', (select status = 'paused' and notified_end = false and running_since is null from timers where id = :'tid'));
select t.check('...with exactly 120s left', (select round(setup_seconds + main_seconds + extra_seconds - accumulated_seconds) = 120 from timers where id = :'tid'));
select (t.act(:'tid', :'tok', 'resume')).id is not null as _ \gset
select t.check('resume after that runs the clock', (select status = 'running' from timers where id = :'tid'));
update timers set status = 'ended', running_since = null where id = :'tid';
select t.check('removing time from an ENDED timer is a no-op', (t.act(:'tid', :'tok', 'adjust', -3)).status = 'ended');

-- removing time that pushes past the end finishes the timer
select (t.act(:'tid', :'tok', 'next_round')).id is not null as _ \gset
select (t.act(:'tid', :'tok', 'start')).id is not null as _ \gset
update timers set accumulated_seconds = 1900, running_since = now() where id = :'tid';   -- 200s of 2100s left
select t.check('adjust -5 with only ~3 min left ends the timer', (select status = 'ended' and notified_end from t.act(:'tid', :'tok', 'adjust', -5) as x));

-- end / next round / round number
select t.new_timer('T2', 1800) as j2 \gset
select (:'j2'::jsonb->>'id')::uuid as tid2, (:'j2'::jsonb->>'control_token')::uuid as tok2 \gset
select t.check('IDLE adjust +5 lengthens the round (used to be a silent no-op)', (t.act(:'tid2', :'tok2', 'adjust', 5)).main_seconds = 2100);
select t.check('IDLE adjust cannot shrink a round below 60s', (t.act(:'tid2', :'tok2', 'adjust', -60)).main_seconds = 60);
select (t.act(:'tid2', :'tok2', 'start')).id is not null as _ \gset
select t.check('end works from running', (t.act(:'tid2', :'tok2', 'end')).status = 'ended');
select t.check('next_round -> idle, round+1, clean slate', (select status = 'idle' and round_number = 2 and accumulated_seconds = 0 and running_since is null and adjustments = '[]'::jsonb and not notified_end from t.act(:'tid2', :'tok2', 'next_round') as x));
select t.check('round_delta -5 clamps at round 1', (t.act(:'tid2', :'tok2', 'round_delta', -5)).round_number = 1);
select t.check('round_delta +3 works', (t.act(:'tid2', :'tok2', 'round_delta', 3)).round_number = 4);
select t.check('round_delta cannot exceed 999', (t.act(:'tid2', :'tok2', 'round_delta', 5000)).round_number = 999);
select t.check('restart works from any state', (t.act(:'tid2', :'tok2', 'restart')).status = 'running');

-- adjustment log is capped
select count(*) as _ from generate_series(1, 25) g where (t.act(:'tid2', :'tok2', 'adjust', 1)).id is not null \gset
select t.check('adjustment log keeps only the newest 20', jsonb_array_length((select adjustments from timers where id = :'tid2')) = 20);

-- TV codes
select short_code as oldcode from timers where id = :'tid2' \gset
select (t.act(:'tid2', :'tok2', 'new_code')).short_code as newcode \gset
select t.check('new_code changes the code', :'oldcode' <> :'newcode' and :'newcode' ~ '^[A-HJKMNP-Z2-9]{4}$');
select t.check('TV codes are unique across timers', (select count(distinct short_code) = count(*) from timers where short_code is not null));

-- server-side stamping: a moving clock is measured by the DB, never supplied by the caller
select t.check('timer_action has no way to pass a timestamp', not exists (
  select 1 from pg_proc p where p.proname = 'timer_action' and pg_get_function_arguments(p.oid) ~* 'timestamp|since'));
select t.check('updated_at moves on every change', (select updated_at > created_at from timers where id = :'tid2'));
select t.finish();
