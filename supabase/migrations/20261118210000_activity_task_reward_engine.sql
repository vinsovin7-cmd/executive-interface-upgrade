begin;

create table if not exists public.reward_rules (
  event_type text primary key check (event_type in ('task', 'session')),
  asset_code text not null references public.ledger_asset_config(asset_code),
  reward_amount_atomic numeric(78, 0) not null check (reward_amount_atomic > 0),
  daily_cap_atomic numeric(78, 0) not null check (daily_cap_atomic > 0),
  interval_seconds smallint,
  max_gap_seconds smallint,
  updated_at timestamptz not null default now(),
  check (
    (event_type = 'task' and asset_code = 'GRAM' and interval_seconds is null and max_gap_seconds is null)
    or (event_type = 'session' and asset_code = 'TON' and interval_seconds between 1 and 300 and max_gap_seconds >= interval_seconds)
  )
);
alter table public.reward_rules enable row level security;
revoke all on public.reward_rules from public, anon, authenticated;
grant select, insert, update on public.reward_rules to service_role;

insert into public.reward_rules (event_type, asset_code, reward_amount_atomic, daily_cap_atomic, interval_seconds, max_gap_seconds)
values
  ('task', 'GRAM', 10000000, 50000000000, null, null),
  ('session', 'TON', 5000000, 5000000000, 25, 60)
on conflict (event_type) do update set
  asset_code = excluded.asset_code,
  reward_amount_atomic = excluded.reward_amount_atomic,
  daily_cap_atomic = excluded.daily_cap_atomic,
  interval_seconds = excluded.interval_seconds,
  max_gap_seconds = excluded.max_gap_seconds,
  updated_at = now();

create table if not exists public.reward_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null references public.reward_rules(event_type),
  asset_code text not null references public.ledger_asset_config(asset_code),
  event_key text not null check (length(event_key) between 1 and 180),
  amount_atomic numeric(78, 0) not null check (amount_atomic >= 0),
  status text not null check (status in ('credited', 'capped')),
  created_at timestamptz not null default now(),
  unique (user_id, event_type, event_key),
  check ((status = 'credited' and amount_atomic > 0) or (status = 'capped' and amount_atomic = 0))
);
create index if not exists reward_events_user_asset_day_idx on public.reward_events (user_id, asset_code, created_at desc);
alter table public.reward_events enable row level security;
revoke all on public.reward_events from public, anon, authenticated;
grant select on public.reward_events to authenticated;
grant select, insert, update on public.reward_events to service_role;
drop policy if exists reward_events_read_own on public.reward_events;
create policy reward_events_read_own on public.reward_events for select to authenticated using (auth.uid() = user_id);

alter table public.ledger_entries add column if not exists reward_event_id uuid references public.reward_events(id);
create unique index if not exists ledger_entries_reward_event_id_idx
  on public.ledger_entries (reward_event_id) where reward_event_id is not null;

alter table public.activity_sessions add column if not exists last_interaction_at timestamptz;

create table if not exists public.wallet_proof_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.wallet_proof_challenges enable row level security;
revoke all on public.wallet_proof_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.wallet_proof_challenges to service_role;

create or replace function public.queue_available_rewards(p_user_id uuid, p_asset_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.ledger_asset_config%rowtype;
  v_address text;
  v_balance numeric;
  v_amount_atomic numeric;
  v_request_id uuid;
begin
  if p_user_id is null or p_asset_code is null then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_asset_code, 0));

  select * into v_asset from public.ledger_asset_config where asset_code = p_asset_code;
  if not found then return null; end if;
  select address into v_address from public.wallet_bindings
  where user_id = p_user_id and network = 'ton-mainnet' and status = 'verified' and verified_at is not null;
  if not found then return null; end if;

  select coalesce(sum(case
      when entry_type = 'reward' and status = 'verified' then amount
      when entry_type = 'payout' and status in ('pending', 'paid') then -amount
      else 0
    end), 0)
    into v_balance
  from public.ledger_entries
  where user_id = p_user_id and asset_master = p_asset_code;

  v_amount_atomic := floor(greatest(0, v_balance) * pg_catalog.power(10::numeric, v_asset.decimals));
  if v_amount_atomic < v_asset.minimum_withdrawal_atomic then return null; end if;

  select request_id into v_request_id
  from public.queue_withdrawal_request(p_user_id, p_asset_code, v_amount_atomic::text, v_address, gen_random_uuid());
  return v_request_id;
end;
$$;
revoke all on function public.queue_available_rewards(uuid, text) from public, anon, authenticated;
grant execute on function public.queue_available_rewards(uuid, text) to service_role;

create or replace function public.credit_reward_event(p_user_id uuid, p_event_type text, p_event_key text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_existing public.reward_events%rowtype;
  v_day_start timestamptz;
  v_earned_today numeric;
  v_credit numeric;
  v_event_id uuid;
begin
  if p_user_id is null or p_event_type is null or p_event_key is null or length(p_event_key) not between 1 and 180 then
    return 0;
  end if;
  select * into v_rule from public.reward_rules where event_type = p_event_type;
  if not found then return 0; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || v_rule.asset_code, 0));
  select * into v_existing from public.reward_events
  where user_id = p_user_id and event_type = p_event_type and event_key = p_event_key;
  if found then return v_existing.amount_atomic; end if;

  v_day_start := pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  select coalesce(sum(amount_atomic), 0) into v_earned_today
  from public.reward_events
  where user_id = p_user_id and asset_code = v_rule.asset_code
    and status = 'credited' and created_at >= v_day_start;

  v_credit := least(v_rule.reward_amount_atomic, greatest(0, v_rule.daily_cap_atomic - v_earned_today));
  insert into public.reward_events (user_id, event_type, asset_code, event_key, amount_atomic, status)
  values (p_user_id, p_event_type, v_rule.asset_code, p_event_key, v_credit, case when v_credit > 0 then 'credited' else 'capped' end)
  returning id into v_event_id;

  if v_credit > 0 then
    insert into public.ledger_entries (
      user_id, network, asset_master, amount, entry_type, status, verified_at, reward_event_id
    ) values (
      p_user_id,
      'ton-mainnet',
      v_rule.asset_code,
      v_credit / pg_catalog.power(10::numeric, (select decimals from public.ledger_asset_config where asset_code = v_rule.asset_code)),
      'reward',
      'verified',
      now(),
      v_event_id
    );
    perform public.queue_available_rewards(p_user_id, v_rule.asset_code);
  end if;

  return v_credit;
end;
$$;
revoke all on function public.credit_reward_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_reward_event(uuid, text, text) to service_role;

create or replace function public.award_verified_quest_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'claimed' and new.verified_at is not null
    and new.quest_key in ('verify-email', 'link-telegram', 'connect-wallet') then
    if tg_op = 'INSERT' then
      perform public.credit_reward_event(new.user_id, 'task', new.id::text);
    elsif old.status is distinct from new.status or old.verified_at is distinct from new.verified_at then
      perform public.credit_reward_event(new.user_id, 'task', new.id::text);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.award_verified_quest_completion() from public, anon, authenticated;
drop trigger if exists quest_completion_award_verified on public.quest_completions;
create trigger quest_completion_award_verified
after insert or update of status, verified_at on public.quest_completions
for each row execute function public.award_verified_quest_completion();

create or replace function public.record_activity_heartbeat(p_session_id uuid, p_channel text, p_interacted boolean default false)
returns table (last_seen_at timestamptz, active_seconds integer, heartbeat_count integer, interaction_ticks integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_previous_seen timestamptz;
  v_previous_interaction timestamptz;
  v_elapsed integer;
  v_event_bucket bigint;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_session_id is null then raise exception 'session id required' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':' || p_session_id::text, 0));
  select s.last_seen_at, s.last_interaction_at into v_previous_seen, v_previous_interaction
  from public.activity_sessions s
  where s.user_id = v_user_id and s.client_session_id = p_session_id
  for update;

  if not found then
    insert into public.activity_sessions (
      user_id, client_session_id, channel, started_at, last_seen_at, last_interaction_at,
      active_seconds, heartbeat_count, interaction_ticks
    ) values (
      v_user_id, p_session_id, left(coalesce(nullif(p_channel, ''), 'browser'), 40), v_now,
      v_now, case when p_interacted then v_now else null end, 0, 1, case when p_interacted then 1 else 0 end
    );
  else
    v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_previous_seen)))::integer);
    update public.activity_sessions s
    set last_seen_at = v_now,
        channel = left(coalesce(nullif(p_channel, ''), 'browser'), 40),
        active_seconds = s.active_seconds + least(60, v_elapsed),
        heartbeat_count = s.heartbeat_count + 1,
        interaction_ticks = s.interaction_ticks + case when p_interacted then 1 else 0 end,
        last_interaction_at = case when p_interacted then v_now else s.last_interaction_at end
    where s.user_id = v_user_id and s.client_session_id = p_session_id;

    if v_elapsed between 25 and 60
      and coalesce(case when p_interacted then v_now else v_previous_interaction end, '-infinity'::timestamptz) >= v_now - interval '60 seconds' then
      v_event_bucket := floor(extract(epoch from v_now) / 25)::bigint;
      perform public.credit_reward_event(v_user_id, 'session', p_session_id::text || ':' || v_event_bucket::text);
    end if;
  end if;

  return query
  select s.last_seen_at, s.active_seconds, s.heartbeat_count, s.interaction_ticks
  from public.activity_sessions s
  where s.user_id = v_user_id and s.client_session_id = p_session_id;
end;
$$;
revoke all on function public.record_activity_heartbeat(uuid, text, boolean) from public, anon;
grant execute on function public.record_activity_heartbeat(uuid, text, boolean) to authenticated;

create or replace function public.queue_rewards_for_verified_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'verified' and new.verified_at is not null then
    if tg_op = 'INSERT' then
      perform public.queue_available_rewards(new.user_id, 'TON');
      perform public.queue_available_rewards(new.user_id, 'GRAM');
      perform public.queue_available_rewards(new.user_id, 'USDT');
    elsif old.status is distinct from new.status or old.address is distinct from new.address then
      perform public.queue_available_rewards(new.user_id, 'TON');
      perform public.queue_available_rewards(new.user_id, 'GRAM');
      perform public.queue_available_rewards(new.user_id, 'USDT');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_rewards_for_verified_wallet() from public, anon, authenticated;
drop trigger if exists wallet_binding_auto_queue on public.wallet_bindings;
create trigger wallet_binding_auto_queue
after insert or update of status, address, verified_at on public.wallet_bindings
for each row execute function public.queue_rewards_for_verified_wallet();

create or replace function public.consume_wallet_proof_challenge(p_user_id uuid, p_payload text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wallet_proof_challenges
  set used_at = now()
  where user_id = p_user_id and payload = p_payload and used_at is null and expires_at > now();
  return found;
end;
$$;
revoke all on function public.consume_wallet_proof_challenge(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_wallet_proof_challenge(uuid, text) to service_role;

create or replace function public.get_user_reward_balances(p_user_id uuid)
returns table (
  asset_code text,
  available_atomic numeric,
  earned_today_atomic numeric,
  daily_cap_atomic numeric,
  minimum_withdrawal_atomic numeric
)
language sql
security definer
set search_path = ''
as $$
  with balance as (
    select le.asset_master as asset_code,
      floor(coalesce(sum(case
        when le.entry_type = 'reward' and le.status = 'verified' then le.amount
        when le.entry_type = 'payout' and le.status in ('pending', 'paid') then -le.amount
        else 0
      end), 0) * pg_catalog.power(10::numeric, c.decimals)) as available_atomic
    from public.ledger_asset_config c
    left join public.ledger_entries le on le.asset_master = c.asset_code and le.user_id = p_user_id
    group by le.asset_master, c.asset_code, c.decimals
  ), earned as (
    select re.asset_code, coalesce(sum(re.amount_atomic), 0) as earned_today_atomic
    from public.reward_events re
    where re.user_id = p_user_id and re.status = 'credited'
      and re.created_at >= pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    group by re.asset_code
  ), caps as (
    select rr.asset_code, sum(rr.daily_cap_atomic) as daily_cap_atomic
    from public.reward_rules rr
    group by rr.asset_code
  )
  select c.asset_code,
    coalesce(b.available_atomic, 0),
    coalesce(e.earned_today_atomic, 0),
    coalesce(cap.daily_cap_atomic, 0),
    c.minimum_withdrawal_atomic
  from public.ledger_asset_config c
  left join balance b on b.asset_code = c.asset_code
  left join earned e on e.asset_code = c.asset_code
  left join caps cap on cap.asset_code = c.asset_code
  order by c.asset_code
$$;
revoke all on function public.get_user_reward_balances(uuid) from public, anon, authenticated;
grant execute on function public.get_user_reward_balances(uuid) to service_role;

commit;
