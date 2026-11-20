begin;

create table if not exists public.ledger_asset_config (
  asset_code text primary key check (asset_code in ('TON', 'GRAM', 'USDT')),
  asset_master text not null unique check (asset_master in ('TON', 'GRAM', 'USDT')),
  asset_kind text not null check (asset_kind in ('native', 'jetton')),
  decimals smallint not null check (decimals between 0 and 18),
  minimum_withdrawal_atomic numeric(78, 0) not null check (minimum_withdrawal_atomic > 0),
  updated_at timestamptz not null default now(),
  check ((asset_code = 'TON' and asset_master = 'TON' and asset_kind = 'native' and decimals = 9)
    or (asset_code = 'GRAM' and asset_master = 'GRAM' and asset_kind = 'jetton' and decimals = 9)
    or (asset_code = 'USDT' and asset_master = 'USDT' and asset_kind = 'jetton' and decimals = 6))
);

alter table public.ledger_asset_config enable row level security;
revoke all on public.ledger_asset_config from public, anon, authenticated;
grant select on public.ledger_asset_config to authenticated, service_role;
grant insert, update on public.ledger_asset_config to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_asset_config' and policyname = 'ledger_asset_config_read_authenticated') then
    create policy ledger_asset_config_read_authenticated on public.ledger_asset_config for select to authenticated using (true);
  end if;
end;
$$;

insert into public.ledger_asset_config (asset_code, asset_master, asset_kind, decimals, minimum_withdrawal_atomic)
values
  ('TON', 'TON', 'native', 9, 1000000000),
  ('GRAM', 'GRAM', 'jetton', 9, 10000000000),
  ('USDT', 'USDT', 'jetton', 6, 5000000)
on conflict (asset_code) do update set
  asset_master = excluded.asset_master,
  asset_kind = excluded.asset_kind,
  decimals = excluded.decimals,
  minimum_withdrawal_atomic = excluded.minimum_withdrawal_atomic,
  updated_at = now();

grant select on public.ledger_asset_config to authenticated;
grant select, insert, update on public.ledger_asset_config to service_role;

alter table public.ledger_entries
  add column if not exists withdrawal_request_id uuid references public.withdrawal_requests(id);
create unique index if not exists ledger_entries_withdrawal_request_id_idx
  on public.ledger_entries (withdrawal_request_id) where withdrawal_request_id is not null;

do $$
begin
  alter table public.ledger_entries drop constraint if exists ledger_entries_asset_master_allowed;
  alter table public.ledger_entries add constraint ledger_entries_asset_master_allowed
    check (asset_master in ('TON', 'GRAM', 'USDT')) not valid;
  alter table public.ledger_entries drop constraint if exists ledger_entries_entry_type_allowed;
  alter table public.ledger_entries drop constraint if exists ledger_entries_entry_type_check;
  alter table public.ledger_entries add constraint ledger_entries_entry_type_check
    check (entry_type in ('reward', 'payout')) not valid;
  alter table public.ledger_entries drop constraint if exists ledger_entries_status_allowed;
  alter table public.ledger_entries drop constraint if exists ledger_entries_status_check;
  alter table public.ledger_entries add constraint ledger_entries_status_check
    check (status in ('pending', 'verified', 'paid', 'rejected')) not valid;
  alter table public.ledger_entries drop constraint if exists ledger_entries_amount_nonzero;
end;
$$;

create or replace function public.touch_withdrawal_request_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_withdrawal_request_updated_at() from public, anon, authenticated;
drop trigger if exists withdrawal_request_updated_at on public.withdrawal_requests;
create trigger withdrawal_request_updated_at
  before update on public.withdrawal_requests
  for each row execute function public.touch_withdrawal_request_updated_at();

create or replace function public.sync_withdrawal_ledger_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ledger_entries
  set status = case
      when new.status in ('queued', 'processing') then 'pending'
      when new.status = 'paid' then 'paid'
      when new.status in ('rejected', 'cancelled') then 'rejected'
      else public.ledger_entries.status
    end,
    transaction_hash = coalesce(new.transaction_hash, public.ledger_entries.transaction_hash)
  where withdrawal_request_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_withdrawal_ledger_status() from public, anon, authenticated;
drop trigger if exists withdrawal_request_ledger_status on public.withdrawal_requests;
create trigger withdrawal_request_ledger_status
  after update of status, transaction_hash on public.withdrawal_requests
  for each row execute function public.sync_withdrawal_ledger_status();

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

commit;
