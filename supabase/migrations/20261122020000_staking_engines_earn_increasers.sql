-- Staking Engines & Earn Increasers upgrade migration.
-- Idempotent: safe to re-run.

begin;

-- -------------------------------------------------------
-- a) staking_engines: up to 5 named staking engines
-- -------------------------------------------------------
create table if not exists public.staking_engines (
  id integer not null,
  name text not null unique,
  asset_code text not null check (asset_code in ('GRAM', 'USDT')),
  pool_status text not null default 'active' check (pool_status in ('active', 'paused', 'maintenance')),
  funded_liquidity_atomic numeric(78, 0) not null default 0 check (funded_liquidity_atomic >= 0),
  active_staked_principal_atomic numeric(78, 0) not null default 0 check (active_staked_principal_atomic >= 0),
  base_apr_bps integer not null default 500 check (base_apr_bps >= 0),
  max_boost_multiplier_bps integer not null default 120000 check (max_boost_multiplier_bps >= 0 and max_boost_multiplier_bps <= 120000),
  lockup_seconds integer not null default 0 check (lockup_seconds >= 0),
  deposit_wallet_address text not null default 'UQDrrGsThCAJrPj6QbUueKJyh8QOQrBZwHSm1C6E_UahK5Ok',
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staking_engines_pkey') then
    alter table public.staking_engines add primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staking_engines_id_range_check') then
    alter table public.staking_engines
      add constraint staking_engines_id_range_check check (id >= 1 and id <= 5);
  end if;
end $$;

alter table public.staking_engines enable row level security;
revoke all on public.staking_engines from public, anon, authenticated;
grant select on public.staking_engines to authenticated;
grant select, update, insert on public.staking_engines to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staking_engines' and policyname = 'staking_engines_read') then
    create policy staking_engines_read on public.staking_engines for select to authenticated using (true);
  end if;
end $$;

insert into public.staking_engines (id, name, asset_code, funded_liquidity_atomic, base_apr_bps, max_boost_multiplier_bps)
values
  (1, 'GRAM Pool', 'GRAM', 0, 500, 120000),
  (2, 'USDT Pool', 'USDT', 0, 500, 120000)
on conflict (id) do nothing;

-- -------------------------------------------------------
-- b) staking_positions: user stake positions
-- -------------------------------------------------------
create table if not exists public.staking_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  engine_id integer not null references public.staking_engines(id) on delete cascade,
  staked_principal_atomic numeric(78, 0) not null default 0 check (staked_principal_atomic >= 0),
  accrued_reward_atomic numeric(78, 0) not null default 0 check (accrued_reward_atomic >= 0),
  applied_multiplier_bps integer not null default 0 check (applied_multiplier_bps >= 0 and applied_multiplier_bps <= 120000),
  deposit_tx_hash text,
  unstake_tx_hash text,
  status text not null default 'active' check (status in ('active', 'unstaked', 'claimed')),
  deposited_at timestamptz not null default now(),
  unstaked_at timestamptz,
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint staking_positions_user_engine_unique unique (user_id, engine_id)
);

alter table public.staking_positions enable row level security;
revoke all on public.staking_positions from public, anon, authenticated;
grant select, insert on public.staking_positions to authenticated;
grant select, insert, update on public.staking_positions to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staking_positions' and policyname = 'staking_positions_select_authenticated') then
    create policy staking_positions_select_authenticated on public.staking_positions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staking_positions' and policyname = 'staking_positions_insert_authenticated') then
    create policy staking_positions_insert_authenticated on public.staking_positions for insert to authenticated with check (true);
  end if;
end $$;

-- -------------------------------------------------------
-- c) earn_increasers: up to 10 configurable modules
-- -------------------------------------------------------
create table if not exists public.earn_increasers (
  key text primary key,
  name text not null,
  description text,
  category text not null check (category in ('staking', 'streak', 'tier', 'task', 'activity', 'liquidity')),
  enabled boolean not null default true,
  multiplier_bps integer not null default 0 check (multiplier_bps >= 0),
  cap_atomic numeric(78, 0) not null default 0 check (cap_atomic >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  updated_at timestamptz not null default now()
);

alter table public.earn_increasers enable row level security;
revoke all on public.earn_increasers from public, anon, authenticated;
grant select on public.earn_increasers to authenticated;
grant select, insert, update, delete on public.earn_increasers to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'earn_increasers' and policyname = 'earn_increasers_read') then
    create policy earn_increasers_read on public.earn_increasers for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'earn_increasers' and policyname = 'earn_increasers_manage') then
    create policy earn_increasers_manage on public.earn_increasers for all to service_role using (true) with check (true);
  end if;
end $$;

insert into public.earn_increasers (key, name, description, category, multiplier_bps, cap_atomic, sort_order)
values
  ('staking_gram_basic', 'GRAM Staking Base', 'Base multiplier for GRAM staking', 'staking', 5000, 0, 0),
  ('staking_usdt_basic', 'USDT Staking Base', 'Base multiplier for USDT staking', 'staking', 5000, 0, 1),
  ('streak_daily', 'Daily Activity Streak', 'Bonus for daily verified activity', 'streak', 3000, 0, 2),
  ('tier_operator', 'Operator Tier', 'Tier bonus for verified actions >= 10', 'tier', 11000, 0, 3),
  ('tier_specialist', 'Specialist Tier', 'Tier bonus for verified actions >= 40', 'tier', 12500, 0, 4),
  ('tier_veteran', 'Veteran Tier', 'Tier bonus for verified actions >= 120', 'tier', 14500, 0, 5),
  ('tier_elite', 'Elite Tier', 'Tier bonus for verified actions >= 300', 'tier', 17500, 0, 6),
  ('tier_master', 'Master Tier', 'Tier bonus for verified actions >= 750', 'tier', 22000, 0, 7),
  ('tier_sovereign', 'Sovereign Tier', 'Tier bonus for verified actions >= 1800', 'tier', 30000, 0, 8),
  ('liquidity_provider', 'Liquidity Provider', 'Bonus for pool liquidity contribution', 'liquidity', 8000, 0, 9)
on conflict (key) do nothing;

-- -------------------------------------------------------
-- RPC: record_stake_deposit — record verified stake deposit
-- -------------------------------------------------------
create or replace function public.record_stake_deposit(
  p_user_id uuid,
  p_engine_id integer,
  p_amount_atomic numeric(78, 0),
  p_deposit_tx_hash text
) returns jsonb
language plpgsql
set search_path = ''
strict security definer
as $function$
declare
  v_engine public.staking_engines%rowtype;
  v_pos public.staking_positions%rowtype;
  v_new_principal numeric(78, 0);
  v_new_accrued numeric(78, 0);
  v_multiplier numeric(78, 0);
begin
  select * into v_engine from public.staking_engines where id = p_engine_id;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Staking engine not found');
  end if;

  update public.staking_engines
     set funded_liquidity_atomic = funded_liquidity_atomic + p_amount_atomic,
         updated_at = now()
   where id = p_engine_id;

  insert into public.staking_positions (user_id, engine_id, staked_principal_atomic, deposited_at, status, deposit_tx_hash)
  values (p_user_id, p_engine_id, p_amount_atomic, now(), 'active', p_deposit_tx_hash)
  on conflict (user_id, engine_id) do update
     set staked_principal_atomic = staking_positions.staked_principal_atomic + p_amount_atomic,
         deposit_tx_hash = p_deposit_tx_hash,
         updated_at = now(),
         status = 'active';

  select staked_principal_atomic, accrued_reward_atomic into v_pos
  from public.staking_positions
  where user_id = p_user_id and engine_id = p_engine_id;

  v_new_principal := v_pos.staked_principal_atomic;
  v_new_accrued := least(
    floor(v_new_principal * v_engine.base_apr_bps / 10000),
    greatest(0, v_engine.funded_liquidity_atomic - v_new_principal)
  );

  select multiplier_bps into v_multiplier
  from public.earn_increasers
  where key = case when v_engine.asset_code = 'GRAM' then 'staking_gram_basic' else 'staking_usdt_basic' end
  limit 1;
  v_multiplier := coalesce(v_multiplier, 0);

  update public.staking_positions
     set accrued_reward_atomic = v_new_accrued,
         applied_multiplier_bps = least(v_engine.base_apr_bps + v_multiplier, 120000),
         updated_at = now()
   where user_id = p_user_id and engine_id = p_engine_id;

  return jsonb_build_object(
    'status', 'ok',
    'engine_name', v_engine.name,
    'new_principal', v_new_principal,
    'new_accrued', v_new_accrued,
    'funded_liquidity', v_engine.funded_liquidity_atomic
  );
end;
$function$;

revoke all on function public.record_stake_deposit from public, anon, authenticated;
grant execute on function public.record_stake_deposit to authenticated;
grant execute on function public.record_stake_deposit to service_role;

-- -------------------------------------------------------
-- RPC: compute_staking_rewards — compute accrued rewards for all positions
-- -------------------------------------------------------
create or replace function public.compute_staking_rewards() returns jsonb
language plpgsql
set search_path = ''
strict security definer
as $function$
declare
  v_result jsonb := '[]'::jsonb;
  v_rec public.staking_positions%rowtype;
  v_engine public.staking_engines%rowtype;
  v_new_accrued numeric(78, 0);
  v_new_principal numeric(78, 0);
begin
  for v_rec in
    select * from public.staking_positions where status = 'active'
  loop
    select * into v_engine from public.staking_engines where id = v_rec.engine_id;
    if not found then
      continue;
    end if;

    v_new_accrued := least(
      floor(v_rec.staked_principal_atomic * v_engine.base_apr_bps / 10000),
      greatest(0, v_engine.funded_liquidity_atomic - v_rec.staked_principal_atomic)
    );

    update public.staking_positions
       set accrued_reward_atomic = v_rec.accrued_reward_atomic + v_new_accrued,
           applied_multiplier_bps = least(v_engine.base_apr_bps + coalesce((select multiplier_bps from public.earn_increasers where enabled = true limit 1), 0), 120000),
           updated_at = now()
     where user_id = v_rec.user_id and engine_id = v_rec.engine_id;

    v_result := v_result || jsonb_build_object(
      'user_id', v_rec.user_id,
      'engine_id', v_rec.engine_id,
      'principal', v_rec.staked_principal_atomic,
      'accrued_added', v_new_accrued,
      'total_accrued', v_rec.accrued_reward_atomic + v_new_accrued
    );
  end loop;

  return v_result;
end;
$function$;

revoke all on function public.compute_staking_rewards from public, anon, authenticated;
grant execute on function public.compute_staking_rewards to authenticated;
grant execute on function public.compute_staking_rewards to service_role;

-- -------------------------------------------------------
-- RPC: unstake_and_settle — withdraw principal + earned rewards
-- -------------------------------------------------------
create or replace function public.unstake_and_settle(
  p_user_id uuid,
  p_engine_id integer,
  p_transaction_hash text
) returns jsonb
language plpgsql
set search_path = ''
strict security definer
as $function$
declare
  v_engine public.staking_engines%rowtype;
  v_pos public.staking_positions%rowtype;
  v_total_atomic numeric(78, 0);
  v_principal numeric(78, 0);
  v_rewards numeric(78, 0);
  v_applied_bps integer;
begin
  select * into v_engine from public.staking_engines where id = p_engine_id;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Staking engine not found');
  end if;

  select * into v_pos from public.staking_positions where user_id = p_user_id and engine_id = p_engine_id;
  if not found then
    return jsonb_build_object('status', 'error', 'message', 'No position found for this engine');
  end if;

  v_principal := v_pos.staked_principal_atomic;
  v_rewards := v_pos.accrued_reward_atomic;

  select coalesce(max(multiplier_bps), 0) into v_applied_bps
  from public.earn_increasers
  where enabled = true;

  v_applied_bps := least((v_engine.base_apr_bps + greatest(0, v_applied_bps)), 120000);

  v_total_atomic := v_principal + v_rewards;

  update public.staking_positions
     set status = 'unstaked',
         unstake_tx_hash = p_transaction_hash,
         unstaked_at = now(),
         updated_at = now()
   where user_id = p_user_id and engine_id = p_engine_id;

  return jsonb_build_object(
    'status', 'unstaked',
    'principal_atomic', v_principal,
    'rewards_atomic', v_rewards,
    'total_atomic', v_total_atomic,
    'applied_multiplier_bps', v_applied_bps,
    'deposit_tx_hash', v_pos.deposit_tx_hash
  );
end;
$function$;

revoke all on function public.unstake_and_settle from public, anon, authenticated;
grant execute on function public.unstake_and_settle to authenticated;
grant execute on function public.unstake_and_settle to service_role;

-- -------------------------------------------------------
-- RPC: list_earn_increasers — for UI listing
-- -------------------------------------------------------
create or replace function public.list_earn_increasers() returns jsonb
language plpgsql
set search_path = ''
strict security definer
as $function$
begin
  return (
    select jsonb_agg(row_to_json(t))
    from (
      select key, name, description, category, enabled, multiplier_bps, cap_atomic, sort_order
      from public.earn_increasers
      order by sort_order
    ) t
  );
end;
$function$;

revoke all on function public.list_earn_increasers from public, anon, authenticated;
grant execute on function public.list_earn_increasers to authenticated;
grant execute on function public.list_earn_increasers to service_role;

-- -------------------------------------------------------
-- Notify schema reload
-- -------------------------------------------------------
notify pgrst, 'reload schema';

commit;
