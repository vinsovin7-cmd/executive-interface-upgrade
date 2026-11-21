-- Dedicated Rewards & Claim engine + operator-controlled reward pool.
-- Adds a real, database-backed claim lifecycle (pending, confirmed,
-- insufficient_balance, wallet_required, pool_paused) that reserves the user's
-- verified balance through the ledger, plus the server-side payout guardrails
-- the claim API enforces on every request: minimum claim thresholds, a per-user
-- cooldown, per-user and global daily payout caps and a treasury
-- collection/refill anchor reference. Also adds database-backed admin login
-- rate limiting for the PIN-protected /admin control plane.
--
-- The legacy automatic withdrawal queue (queue_available_rewards) is retired:
-- it reserved every credited reward the moment a wallet was verified, which made
-- the balance permanently unclaimable. The dedicated claim module is now the
-- single reservation path for GRAM/USDT rewards. The manual TON/GRAM/USDT
-- withdrawal path (queue_withdrawal_request + the payout executor RPCs) is
-- untouched and still works. Idempotent: safe to re-run.
begin;

-- 1. Operator-controlled reward pool configuration (single row).
create table if not exists public.claim_pool_config (
  id boolean primary key default true check (id),
  pool_state text not null default 'active' check (pool_state in ('active', 'paused', 'maintenance')),
  per_user_cooldown_seconds integer not null default 300 check (per_user_cooldown_seconds between 0 and 86400),
  per_user_daily_cap_gram_atomic numeric(78, 0) not null default 100000000000 check (per_user_daily_cap_gram_atomic >= 0),
  per_user_daily_cap_usdt_atomic numeric(78, 0) not null default 10000000 check (per_user_daily_cap_usdt_atomic >= 0),
  global_daily_cap_gram_atomic numeric(78, 0) not null default 1000000000000 check (global_daily_cap_gram_atomic >= 0),
  global_daily_cap_usdt_atomic numeric(78, 0) not null default 100000000 check (global_daily_cap_usdt_atomic >= 0),
  treasury_anchor_address text not null default 'UQDrrGsThCAJrPj6QbUueKJyh8QOQrBZwHSm1C6E_UahK5Ok' check (length(treasury_anchor_address) between 20 and 128),
  updated_at timestamptz not null default now()
);
alter table public.claim_pool_config enable row level security;
revoke all on public.claim_pool_config from public, anon, authenticated;
grant select, insert, update on public.claim_pool_config to service_role;

insert into public.claim_pool_config (id) values (true) on conflict (id) do nothing;

-- 2. Claim request lifecycle log. Every claim attempt is recorded with one of
--    the explicit database-backed states so the rewards UI and the admin
--    telemetry log show exactly what happened and why.
create table if not exists public.claim_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  network text not null default 'ton-mainnet' check (network = 'ton-mainnet'),
  asset_code text not null check (asset_code in ('GRAM', 'USDT')),
  asset_decimals smallint not null check (asset_decimals in (6, 9)),
  amount_atomic numeric(78, 0) not null default 0 check (amount_atomic >= 0),
  destination text check (destination is null or length(destination) between 20 and 128),
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'insufficient_balance', 'wallet_required', 'pool_paused')),
  transaction_hash text,
  failure_reason text,
  idempotency_key uuid not null default gen_random_uuid(),
  payout_attempted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((asset_code = 'GRAM' and asset_decimals = 9) or (asset_code = 'USDT' and asset_decimals = 6)),
  check (state <> 'confirmed' or transaction_hash is not null)
);
create index if not exists claim_requests_user_created_idx on public.claim_requests (user_id, created_at desc);
create index if not exists claim_requests_state_created_idx on public.claim_requests (state, created_at desc);
alter table public.claim_requests enable row level security;
revoke all on public.claim_requests from public, anon, authenticated;
grant select on public.claim_requests to authenticated;
grant select, insert, update on public.claim_requests to service_role;
drop policy if exists claim_requests_read_own on public.claim_requests;
create policy claim_requests_read_own on public.claim_requests for select to authenticated using (auth.uid() = user_id);

-- 3. Link the ledger payout reservation to its claim so the claim module owns
--    the reservation and the available-balance math stays correct.
alter table public.ledger_entries add column if not exists claim_request_id uuid references public.claim_requests(id);
create unique index if not exists ledger_entries_claim_request_id_idx
  on public.ledger_entries (claim_request_id) where claim_request_id is not null;

-- 4. Database-backed admin login rate limiting (keyed by a hashed client id).
create table if not exists public.admin_login_guard (
  guard_key text primary key check (length(guard_key) between 8 and 200),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.admin_login_guard enable row level security;
revoke all on public.admin_login_guard from public, anon, authenticated;
grant select, insert, update, delete on public.admin_login_guard to service_role;

create or replace function public.record_admin_login_failure(p_guard_key text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_lock timestamptz;
begin
  if p_guard_key is null or length(p_guard_key) not between 8 and 200 then
    return null;
  end if;

  insert into public.admin_login_guard (guard_key, failed_attempts, updated_at)
  values (p_guard_key, 1, now())
  on conflict (guard_key) do update set
    failed_attempts = public.admin_login_guard.failed_attempts + 1,
    updated_at = now()
  returning failed_attempts into v_attempts;

  if v_attempts >= 5 then
    v_lock := now() + (least(3600, 60 * v_attempts)::text || ' seconds')::interval;
    update public.admin_login_guard set lock_until = v_lock where guard_key = p_guard_key;
    return v_lock;
  end if;
  return null;
end;
$$;
revoke all on function public.record_admin_login_failure(text) from public, anon, authenticated;
grant execute on function public.record_admin_login_failure(text) to service_role;

create or replace function public.clear_admin_login_failures(p_guard_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_guard_key is null or length(p_guard_key) not between 8 and 200 then
    return;
  end if;
  delete from public.admin_login_guard where guard_key = p_guard_key;
end;
$$;
revoke all on function public.clear_admin_login_failures(text) from public, anon, authenticated;
grant execute on function public.clear_admin_login_failures(text) to service_role;

-- 5. Retire the legacy automatic withdrawal queue. It reserved every credited
--    reward the instant a wallet was verified, leaving nothing claimable. The
--    dedicated claim module now performs reservation explicitly and atomically.
create or replace function public.queue_available_rewards(p_user_id uuid, p_asset_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;
revoke all on function public.queue_available_rewards(uuid, text) from public, anon, authenticated;
grant execute on function public.queue_available_rewards(uuid, text) to service_role;

-- 6. Claim creation with all guardrails evaluated server-side and atomically.
--    Returns the resulting claim (state pending | insufficient_balance |
--    wallet_required | pool_paused). Cooldown and daily-cap violations raise
--    SQLSTATE 22023 so the claim API can answer with an explicit guardrail
--    message without creating a chargeable reservation.
create or replace function public.create_claim_request(
  p_user_id uuid,
  p_asset_code text,
  p_destination text,
  p_idempotency_key uuid
)
returns table (
  claim_id uuid,
  state text,
  asset_code text,
  amount_atomic text,
  destination text,
  transaction_hash text,
  failure_reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.claim_pool_config%rowtype;
  v_asset public.ledger_asset_config%rowtype;
  v_binding_address text;
  v_balance numeric;
  v_amount_atomic numeric;
  v_existing public.claim_requests%rowtype;
  v_claim public.claim_requests%rowtype;
  v_today_start timestamptz;
  v_claimed_today numeric;
  v_cap numeric;
  v_cooldown integer;
  v_last timestamptz;
  v_remaining integer;
  v_state text;
  v_reason text;
begin
  if p_user_id is null or p_asset_code is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Claim details are required.';
  end if;
  if p_asset_code not in ('GRAM', 'USDT') then
    raise exception using errcode = '22023', message = 'Only GRAM and USDT rewards can be claimed.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':claim:' || p_asset_code, 0));

  select * into v_existing from public.claim_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.state, v_existing.asset_code, v_existing.amount_atomic::text, v_existing.destination, v_existing.transaction_hash, v_existing.failure_reason, v_existing.created_at;
    return;
  end if;

  select * into v_asset from public.ledger_asset_config where asset_code = p_asset_code;
  if not found then
    raise exception using errcode = '22023', message = 'Unsupported claim asset.';
  end if;
  select * into v_config from public.claim_pool_config where id;

  select coalesce(sum(case
      when entry_type = 'reward' and status = 'verified' then amount
      when entry_type = 'payout' and status in ('pending', 'paid') then -amount
      else 0
    end), 0)
    into v_balance
  from public.ledger_entries
  where user_id = p_user_id and asset_master = p_asset_code;
  v_amount_atomic := floor(greatest(0, v_balance) * pg_catalog.power(10::numeric, v_asset.decimals));

  select address into v_binding_address from public.wallet_bindings
  where user_id = p_user_id and network = 'ton-mainnet' and status = 'verified' and verified_at is not null;

  if v_binding_address is null or p_destination is null or v_binding_address is distinct from p_destination then
    v_state := 'wallet_required';
    v_reason := 'Connect and bind a verified TON wallet, then claim again.';
  elsif v_config.pool_state <> 'active' then
    v_state := 'pool_paused';
    v_reason := 'The reward pool is paused by the operator. Your balance stays reserved for you.';
  elsif v_amount_atomic <= 0 or v_amount_atomic < v_asset.minimum_withdrawal_atomic then
    v_state := 'insufficient_balance';
    v_reason := 'Claimable balance is below the minimum claim threshold for ' || p_asset_code || '.';
  else
    v_cooldown := coalesce(v_config.per_user_cooldown_seconds, 300);
    select max(created_at) into v_last from public.claim_requests
    where user_id = p_user_id and asset_code = p_asset_code and state in ('pending', 'confirmed');
    if v_last is not null and now() < v_last + (v_cooldown::text || ' seconds')::interval then
      v_remaining := ceil(extract(epoch from (v_last + (v_cooldown::text || ' seconds')::interval - now())))::integer;
      raise exception using errcode = '22023', message = 'Claim cooldown active. ' || v_remaining::text || 's remaining before the next ' || p_asset_code || ' claim.';
    end if;

    v_today_start := pg_catalog.date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    v_cap := case when p_asset_code = 'GRAM' then v_config.per_user_daily_cap_gram_atomic else v_config.per_user_daily_cap_usdt_atomic end;
    select coalesce(sum(amount_atomic), 0) into v_claimed_today from public.claim_requests
    where user_id = p_user_id and asset_code = p_asset_code and state in ('pending', 'confirmed') and created_at >= v_today_start;
    if v_cap is not null and v_claimed_today + v_amount_atomic > v_cap then
      raise exception using errcode = '22023', message = 'Your daily ' || p_asset_code || ' claim limit has been reached. It resets at 00:00 UTC.';
    end if;

    v_cap := case when p_asset_code = 'GRAM' then v_config.global_daily_cap_gram_atomic else v_config.global_daily_cap_usdt_atomic end;
    select coalesce(sum(amount_atomic), 0) into v_claimed_today from public.claim_requests
    where asset_code = p_asset_code and state in ('pending', 'confirmed') and created_at >= v_today_start;
    if v_cap is not null and v_claimed_today + v_amount_atomic > v_cap then
      raise exception using errcode = '22023', message = 'The global daily ' || p_asset_code || ' payout cap has been reached. It resets at 00:00 UTC.';
    end if;

    v_state := 'pending';
    v_reason := null;
  end if;

  insert into public.claim_requests (
    user_id, asset_code, asset_decimals, amount_atomic, destination, state, failure_reason, idempotency_key
  ) values (
    p_user_id, p_asset_code, v_asset.decimals, v_amount_atomic,
    coalesce(v_binding_address, p_destination), v_state, v_reason, p_idempotency_key
  ) returning * into v_claim;

  if v_state = 'pending' then
    insert into public.ledger_entries (
      user_id, network, asset_master, amount, entry_type, status, claim_request_id
    ) values (
      p_user_id, 'ton-mainnet', p_asset_code,
      v_amount_atomic / pg_catalog.power(10::numeric, v_asset.decimals), 'payout', 'pending', v_claim.id
    );
  end if;

  return query select v_claim.id, v_claim.state, v_claim.asset_code, v_claim.amount_atomic::text, v_claim.destination, v_claim.transaction_hash, v_claim.failure_reason, v_claim.created_at;
end;
$$;
revoke all on function public.create_claim_request(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_claim_request(uuid, text, text, uuid) to service_role;

-- 7. Payout execution RPCs. Only service_role (the backend payout engine) can
--    drive these, so settlement never needs an admin browser session.
create or replace function public.begin_claim_payout(p_claim_id uuid)
returns table (claim_id uuid, user_id uuid, asset_code text, asset_decimals smallint, amount_atomic text, destination text, state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.claim_requests%rowtype;
begin
  select * into v_claim from public.claim_requests where id = p_claim_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Claim was not found.';
  end if;
  if v_claim.state <> 'pending' then
    raise exception using errcode = '22023', message = 'Claim is not in a payable state.';
  end if;
  if v_claim.payout_attempted_at is not null and v_claim.payout_attempted_at > now() - interval '15 minutes' then
    raise exception using errcode = '22023', message = 'Claim payout is already in progress.';
  end if;
  update public.claim_requests set payout_attempted_at = now(), updated_at = now() where id = p_claim_id;
  return query select v_claim.id, v_claim.user_id, v_claim.asset_code, v_claim.asset_decimals, v_claim.amount_atomic::text, v_claim.destination, v_claim.state;
end;
$$;
revoke all on function public.begin_claim_payout(uuid) from public, anon, authenticated;
grant execute on function public.begin_claim_payout(uuid) to service_role;

create or replace function public.complete_claim_payout(p_claim_id uuid, p_transaction_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_transaction_hash is null or length(p_transaction_hash) < 10 then
    raise exception using errcode = '22023', message = 'A real on-chain transaction hash is required.';
  end if;
  update public.claim_requests
  set state = 'confirmed', transaction_hash = p_transaction_hash, confirmed_at = now(), failure_reason = null, updated_at = now()
  where id = p_claim_id and state = 'pending';
  update public.ledger_entries
  set status = 'paid', transaction_hash = p_transaction_hash, verified_at = now()
  where claim_request_id = p_claim_id;
end;
$$;
revoke all on function public.complete_claim_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_claim_payout(uuid, text) to service_role;

create or replace function public.fail_claim_payout(p_claim_id uuid, p_reason text, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := case when p_state in ('pending', 'insufficient_balance') then p_state else 'pending' end;
begin
  update public.claim_requests
  set state = v_state, failure_reason = left(coalesce(p_reason, 'Claim payout failed.'), 400), updated_at = now()
  where id = p_claim_id and state = 'pending';
  if v_state = 'insufficient_balance' then
    update public.ledger_entries set status = 'rejected' where claim_request_id = p_claim_id and status = 'pending';
  end if;
end;
$$;
revoke all on function public.fail_claim_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_claim_payout(uuid, text, text) to service_role;

commit;
