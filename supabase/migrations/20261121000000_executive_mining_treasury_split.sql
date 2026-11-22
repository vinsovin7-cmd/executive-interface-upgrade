-- Executive mining, earning, and treasury settlement layer.
-- Adds: 30% user / 70% platform treasury reward split, per-user mining sessions,
-- a strict 600-second accumulation lock before withdrawal, TonConnect wallet
-- binding that activates mining, and service-role RPCs used by the real on-chain
-- payout executor. Idempotent: safe to re-run.
begin;

-- 1. Reward split configuration (single row).
create table if not exists public.reward_split_config (
  id boolean primary key default true check (id),
  user_share_bps integer not null check (user_share_bps between 0 and 10000),
  treasury_share_bps integer not null check (treasury_share_bps between 0 and 10000),
  minimum_accumulation_seconds integer not null default 600 check (minimum_accumulation_seconds between 0 and 86400),
  updated_at timestamptz not null default now(),
  check (user_share_bps + treasury_share_bps = 10000)
);
alter table public.reward_split_config enable row level security;
revoke all on public.reward_split_config from public, anon, authenticated;
grant select on public.reward_split_config to authenticated, service_role;
grant insert, update on public.reward_split_config to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reward_split_config' and policyname = 'reward_split_config_read') then
    create policy reward_split_config_read on public.reward_split_config for select to authenticated using (true);
  end if;
end;
$$;

insert into public.reward_split_config (id, user_share_bps, treasury_share_bps, minimum_accumulation_seconds)
values (true, 3000, 7000, 600)
on conflict (id) do update set
  user_share_bps = excluded.user_share_bps,
  treasury_share_bps = excluded.treasury_share_bps,
  minimum_accumulation_seconds = excluded.minimum_accumulation_seconds,
  updated_at = now();

-- 2. Treasury accrual ledger: the 70% platform share retained for liquidity/treasury.
create table if not exists public.treasury_accruals (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('task', 'session', 'adsgram')),
  asset_code text not null references public.ledger_asset_config(asset_code),
  amount_atomic numeric(78, 0) not null check (amount_atomic > 0),
  originating_user_id uuid references auth.users(id) on delete set null,
  reward_event_id uuid references public.reward_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists treasury_accruals_created_idx on public.treasury_accruals (created_at desc);
create index if not exists treasury_accruals_asset_idx on public.treasury_accruals (asset_code, created_at desc);
alter table public.treasury_accruals enable row level security;
revoke all on public.treasury_accruals from public, anon, authenticated;
grant select, insert on public.treasury_accruals to service_role;

-- 3. reward_events stores gross + split shares. amount_atomic stays the gross so
--    daily caps and existing aggregates keep their meaning.
alter table public.reward_events add column if not exists user_share_atomic numeric(78, 0) not null default 0;
alter table public.reward_events add column if not exists treasury_share_atomic numeric(78, 0) not null default 0;
update public.reward_events set user_share_atomic = amount_atomic where user_share_atomic = 0 and amount_atomic > 0;

-- 4. Per-user mining sessions (drives the 10-minute accumulation lock).
create table if not exists public.mining_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text not null check (length(wallet_address) between 20 and 128),
  status text not null default 'active' check (status in ('active', 'stopped')),
  started_at timestamptz not null default now(),
  last_tick_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mining_sessions enable row level security;
revoke all on public.mining_sessions from public, anon, authenticated;
grant select on public.mining_sessions to authenticated;
grant select, insert, update on public.mining_sessions to service_role;
drop policy if exists mining_sessions_read_own on public.mining_sessions;
create policy mining_sessions_read_own on public.mining_sessions for select to authenticated using (auth.uid() = user_id);

-- 5. Withdrawal diagnostics for real payout attempts.
alter table public.withdrawal_requests add column if not exists failure_reason text;
alter table public.withdrawal_requests add column if not exists payout_attempted_at timestamptz;

-- 6. Split-aware reward credit.
create or replace function public.credit_reward_event(p_user_id uuid, p_event_type text, p_event_key text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.reward_rules%rowtype;
  v_user_bps integer := 10000;
  v_existing public.reward_events%rowtype;
  v_day_start timestamptz;
  v_earned_today numeric;
  v_gross numeric;
  v_user_share numeric;
  v_treasury_share numeric;
  v_event_id uuid;
begin
  if p_user_id is null or p_event_type is null or p_event_key is null or length(p_event_key) not between 1 and 180 then
    return 0;
  end if;
  select * into v_rule from public.reward_rules where event_type = p_event_type;
  if not found then return 0; end if;
  select user_share_bps into v_user_bps from public.reward_split_config rsc where rsc.id;
  if v_user_bps is null then v_user_bps := 10000; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || v_rule.asset_code, 0));
  select * into v_existing from public.reward_events
  where user_id = p_user_id and event_type = p_event_type and event_key = p_event_key;
  if found then return v_existing.amount_atomic; end if;

  v_day_start := pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  select coalesce(sum(amount_atomic), 0) into v_earned_today
  from public.reward_events
  where user_id = p_user_id and asset_code = v_rule.asset_code
    and status = 'credited' and created_at >= v_day_start;

  v_gross := least(v_rule.reward_amount_atomic, greatest(0, v_rule.daily_cap_atomic - v_earned_today));
  v_user_share := pg_catalog.floor(v_gross * v_user_bps / 10000);
  v_treasury_share := v_gross - v_user_share;

  insert into public.reward_events (
    user_id, event_type, asset_code, event_key, amount_atomic, user_share_atomic, treasury_share_atomic, status
  ) values (
    p_user_id, p_event_type, v_rule.asset_code, p_event_key, v_gross, v_user_share, v_treasury_share,
    case when v_gross > 0 then 'credited' else 'capped' end
  ) returning id into v_event_id;

  if v_gross > 0 then
    if v_user_share > 0 then
      insert into public.ledger_entries (
        user_id, network, asset_master, amount, entry_type, status, verified_at, reward_event_id
      ) values (
        p_user_id,
        'ton-mainnet',
        v_rule.asset_code,
        v_user_share / pg_catalog.power(10::numeric, (select decimals from public.ledger_asset_config where asset_code = v_rule.asset_code)),
        'reward',
        'verified',
        now(),
        v_event_id
      );
    end if;
    if v_treasury_share > 0 then
      insert into public.treasury_accruals (source, asset_code, amount_atomic, originating_user_id, reward_event_id)
      values (p_event_type, v_rule.asset_code, v_treasury_share, p_user_id, v_event_id);
    end if;
    perform public.queue_available_rewards(p_user_id, v_rule.asset_code);
  end if;

  return v_gross;
end;
$$;
revoke all on function public.credit_reward_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_reward_event(uuid, text, text) to service_role;

-- 7. Auto-queue respects the accumulation lock so nothing is reserved while locked.
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
  v_lock integer := 600;
  v_started timestamptz;
begin
  if p_user_id is null or p_asset_code is null then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_asset_code, 0));

  select minimum_accumulation_seconds into v_lock from public.reward_split_config rsc where rsc.id;
  if v_lock is null then v_lock := 600; end if;
  select started_at into v_started from public.mining_sessions where user_id = p_user_id and status = 'active';
  if v_started is null or now() < v_started + (v_lock::text || ' seconds')::interval then
    return null;
  end if;

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

-- 8. Withdrawal queue enforces the 600-second accumulation lock.
create or replace function public.queue_withdrawal_request(
  p_user_id uuid,
  p_asset_code text,
  p_amount_atomic text,
  p_destination text,
  p_idempotency_key uuid
)
returns table (request_id uuid, status text, asset_code text, amount_atomic text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.ledger_asset_config%rowtype;
  v_balance numeric;
  v_amount numeric;
  v_amount_atomic numeric;
  v_verified_address text;
  v_request public.withdrawal_requests%rowtype;
  v_lock integer := 600;
  v_started timestamptz;
  v_remaining integer;
begin
  if p_user_id is null or p_asset_code is null or p_amount_atomic is null
    or p_destination is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Withdrawal details are required.';
  end if;
  if p_amount_atomic !~ '^[0-9]{1,78}$' then
    raise exception using errcode = '22023', message = 'Withdrawal amount must be a positive integer in atomic units.';
  end if;
  v_amount_atomic := p_amount_atomic::numeric;
  if v_amount_atomic <= 0 then
    raise exception using errcode = '22023', message = 'Withdrawal amount must be a positive integer in atomic units.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_asset_code, 0));

  select * into v_asset from public.ledger_asset_config where asset_code = p_asset_code;
  if not found then
    raise exception using errcode = '22023', message = 'Unsupported withdrawal asset.';
  end if;

  select * into v_request from public.withdrawal_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return query select v_request.id, v_request.status, v_request.asset_code, v_request.amount_atomic::text;
    return;
  end if;

  select minimum_accumulation_seconds into v_lock from public.reward_split_config rsc where rsc.id;
  if v_lock is null then v_lock := 600; end if;
  select started_at into v_started from public.mining_sessions
  where user_id = p_user_id and status = 'active';
  if v_started is null then
    raise exception using errcode = '22023', message = 'Bind a Tonkeeper wallet and start mining before withdrawing.';
  end if;
  if now() < v_started + (v_lock::text || ' seconds')::interval then
    v_remaining := pg_catalog.ceil(extract(epoch from (v_started + (v_lock::text || ' seconds')::interval - now())))::integer;
    raise exception using errcode = '22023', message = 'Withdrawal unlocks after ' || v_lock::text || ' seconds of active accumulation. ' || v_remaining::text || 's remaining.';
  end if;

  select address into v_verified_address from public.wallet_bindings
  where user_id = p_user_id and network = 'ton-mainnet' and status = 'verified' and verified_at is not null;
  if not found or v_verified_address is distinct from p_destination then
    raise exception using errcode = '22023', message = 'A TonConnect-verified TON wallet is required for withdrawals.';
  end if;
  if v_amount_atomic < v_asset.minimum_withdrawal_atomic then
    raise exception using errcode = '22023', message = 'Withdrawal amount is below the configured minimum.';
  end if;

  select coalesce(sum(case
      when entry_type = 'reward' and status = 'verified' then amount
      when entry_type = 'payout' and status in ('pending', 'paid') then -amount
      else 0
    end), 0)
    into v_balance
  from public.ledger_entries
  where user_id = p_user_id and asset_master = p_asset_code;

  v_amount := v_amount_atomic / pg_catalog.power(10::numeric, v_asset.decimals);
  if v_amount > v_balance then
    raise exception using errcode = '22023', message = 'Insufficient verified available balance.';
  end if;

  insert into public.withdrawal_requests (
    user_id, network, asset_code, asset_decimals, amount_atomic, destination, idempotency_key, status
  ) values (
    p_user_id, 'ton-mainnet', p_asset_code, v_asset.decimals, v_amount_atomic, v_verified_address, p_idempotency_key, 'queued'
  ) returning * into v_request;

  insert into public.ledger_entries (
    user_id, network, asset_master, amount, entry_type, status, withdrawal_request_id
  ) values (
    p_user_id, 'ton-mainnet', p_asset_code, v_amount, 'payout', 'pending', v_request.id
  );

  return query select v_request.id, v_request.status, v_request.asset_code, v_request.amount_atomic::text;
end;
$$;
revoke all on function public.queue_withdrawal_request(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.queue_withdrawal_request(uuid, text, text, text, uuid) to service_role;

-- 9. Mining + wallet binding RPCs (called by authenticated server routes).
create or replace function public.get_mining_state()
returns table (
  status text,
  wallet_address text,
  started_at timestamptz,
  unlock_at timestamptz,
  seconds_remaining integer,
  withdrawal_locked boolean,
  minimum_accumulation_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_lock integer := 600;
  v_session public.mining_sessions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select minimum_accumulation_seconds into v_lock from public.reward_split_config rsc where rsc.id;
  if v_lock is null then v_lock := 600; end if;
  select * into v_session from public.mining_sessions where user_id = v_user;
  if not found then
    return query select 'inactive'::text, null::text, null::timestamptz, null::timestamptz, v_lock, true, v_lock;
    return;
  end if;
  return query select
    v_session.status,
    v_session.wallet_address,
    v_session.started_at,
    v_session.started_at + (v_lock::text || ' seconds')::interval,
    greatest(0, pg_catalog.ceil(extract(epoch from (v_session.started_at + (v_lock::text || ' seconds')::interval - now()))))::integer,
    (v_session.status <> 'active' or now() < v_session.started_at + (v_lock::text || ' seconds')::interval),
    v_lock;
end;
$$;
revoke all on function public.get_mining_state() from public, anon;
grant execute on function public.get_mining_state() to authenticated;

create or replace function public.activate_wallet_mining(p_address text)
returns table (
  status text,
  wallet_address text,
  started_at timestamptz,
  unlock_at timestamptz,
  seconds_remaining integer,
  withdrawal_locked boolean,
  minimum_accumulation_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_address is null or length(p_address) not between 20 and 128 then
    raise exception using errcode = '22023', message = 'A valid TON wallet address is required.';
  end if;

  insert into public.wallet_bindings (user_id, network, address, status, verified_at)
  values (v_user, 'ton-mainnet', p_address, 'verified', now())
  on conflict (user_id, network) do update set
    address = excluded.address,
    status = 'verified',
    verified_at = now();

  insert into public.mining_sessions (user_id, wallet_address, status, started_at, last_tick_at, updated_at)
  values (v_user, p_address, 'active', now(), now(), now())
  on conflict (user_id) do update set
    wallet_address = excluded.wallet_address,
    status = 'active',
    started_at = case
      when public.mining_sessions.wallet_address = excluded.wallet_address and public.mining_sessions.status = 'active'
        then public.mining_sessions.started_at
      else now()
    end,
    last_tick_at = now(),
    updated_at = now();

  return query select * from public.get_mining_state();
end;
$$;
revoke all on function public.activate_wallet_mining(text) from public, anon;
grant execute on function public.activate_wallet_mining(text) to authenticated;

-- 10. Payout executor RPCs (service_role only; no fake hashes are ever written).
create or replace function public.begin_withdrawal_payout(p_request_id uuid)
returns table (request_id uuid, user_id uuid, asset_code text, asset_decimals smallint, amount_atomic numeric, destination text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests%rowtype;
begin
  select * into v_request from public.withdrawal_requests where id = p_request_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Withdrawal request was not found.';
  end if;
  if v_request.status not in ('queued', 'processing') then
    raise exception using errcode = '22023', message = 'Withdrawal request is not in a payable state.';
  end if;
  update public.withdrawal_requests
  set status = 'processing', payout_attempted_at = now(), failure_reason = null
  where id = p_request_id;
  return query select v_request.id, v_request.user_id, v_request.asset_code, v_request.asset_decimals, v_request.amount_atomic, v_request.destination, 'processing'::text;
end;
$$;
revoke all on function public.begin_withdrawal_payout(uuid) from public, anon, authenticated;
grant execute on function public.begin_withdrawal_payout(uuid) to service_role;

create or replace function public.complete_withdrawal_payout(p_request_id uuid, p_transaction_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_transaction_hash is null or length(p_transaction_hash) < 10 then
    raise exception using errcode = '22023', message = 'A real on-chain transaction hash is required.';
  end if;
  update public.withdrawal_requests
  set status = 'paid', transaction_hash = p_transaction_hash, failure_reason = null, updated_at = now()
  where id = p_request_id and status in ('queued', 'processing');
end;
$$;
revoke all on function public.complete_withdrawal_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_withdrawal_payout(uuid, text) to service_role;

create or replace function public.fail_withdrawal_payout(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.withdrawal_requests
  set status = 'queued', failure_reason = left(coalesce(p_reason, 'Payout failed.'), 400), updated_at = now()
  where id = p_request_id and status = 'processing';
end;
$$;
revoke all on function public.fail_withdrawal_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_withdrawal_payout(uuid, text) to service_role;

-- 11. Treasury summary for telemetry/admin (service_role only).
create or replace function public.get_treasury_summary()
returns table (asset_code text, accrued_atomic numeric, pending_payout_atomic numeric, paid_payout_atomic numeric)
language sql
security definer
set search_path = ''
as $$
  select c.asset_code,
    coalesce((select sum(ta.amount_atomic) from public.treasury_accruals ta where ta.asset_code = c.asset_code), 0),
    coalesce((select sum(wr.amount_atomic) from public.withdrawal_requests wr where wr.asset_code = c.asset_code and wr.status in ('queued', 'processing')), 0),
    coalesce((select sum(wr.amount_atomic) from public.withdrawal_requests wr where wr.asset_code = c.asset_code and wr.status = 'paid'), 0)
  from public.ledger_asset_config c
  order by c.asset_code
$$;
revoke all on function public.get_treasury_summary() from public, anon, authenticated;
grant execute on function public.get_treasury_summary() to service_role;

-- 12. Allow verified AdsGram callbacks to credit a split reward. The reward rule
--     (and the event_type constraint) is extended so credit_reward_event accepts
--     a real provider-verified 'adsgram' event without touching the task/session
--     rules. Existing rows are not revalidated (not valid).
do $$
begin
  alter table public.reward_rules drop constraint if exists reward_rules_event_type_check;
  alter table public.reward_rules drop constraint if exists reward_rules_check;
  alter table public.reward_rules add constraint reward_rules_event_type_check
    check (event_type in ('task', 'session', 'adsgram')) not valid;
  alter table public.reward_rules add constraint reward_rules_check check (
    (event_type = 'task' and asset_code = 'GRAM' and interval_seconds is null and max_gap_seconds is null)
    or (event_type = 'session' and asset_code = 'TON' and interval_seconds between 1 and 300 and max_gap_seconds >= interval_seconds)
    or (event_type = 'adsgram' and asset_code = 'GRAM' and interval_seconds is null and max_gap_seconds is null)
  ) not valid;
end;
$$;

insert into public.reward_rules (event_type, asset_code, reward_amount_atomic, daily_cap_atomic, interval_seconds, max_gap_seconds)
values ('adsgram', 'GRAM', 5000000, 20000000000, null, null)
on conflict (event_type) do update set
  asset_code = excluded.asset_code,
  reward_amount_atomic = excluded.reward_amount_atomic,
  daily_cap_atomic = excluded.daily_cap_atomic,
  interval_seconds = excluded.interval_seconds,
  max_gap_seconds = excluded.max_gap_seconds,
  updated_at = now();

commit;
