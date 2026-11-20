begin;

create table public.wallet_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  network text not null default 'ton-mainnet' check (network = 'ton-mainnet'),
  address text not null check (length(address) between 20 and 128),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (user_id, network)
);

create table public.airdrop_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null check (length(campaign_key) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (user_id, campaign_key)
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  network text not null default 'ton-mainnet' check (network = 'ton-mainnet'),
  asset_code text not null check (asset_code in ('TON', 'GRAM', 'USDT')),
  asset_decimals smallint not null check (
    (asset_code in ('TON', 'GRAM') and asset_decimals = 9)
    or (asset_code = 'USDT' and asset_decimals = 6)
  ),
  amount_atomic numeric(78, 0) not null check (amount_atomic > 0),
  destination text not null check (length(destination) between 20 and 128),
  status text not null default 'pending' check (status in ('pending', 'queued', 'processing', 'paid', 'rejected', 'cancelled')),
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  transaction_hash text,
  unique (user_id, idempotency_key)
);

create table public.quest_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_key text not null check (length(quest_key) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'verifying', 'claimed', 'rejected')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (user_id, quest_key)
);

create table public.referral_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code uuid not null unique default gen_random_uuid(),
  tier1_count bigint not null default 0 check (tier1_count >= 0),
  tier2_count bigint not null default 0 check (tier2_count >= 0),
  tier1_commission_atomic numeric(78, 0) not null default 0 check (tier1_commission_atomic >= 0),
  tier2_commission_atomic numeric(78, 0) not null default 0 check (tier2_commission_atomic >= 0),
  updated_at timestamptz not null default now()
);

create index wallet_bindings_user_created_idx on public.wallet_bindings (user_id, created_at desc);
create index airdrop_claims_user_created_idx on public.airdrop_claims (user_id, created_at desc);
create index withdrawal_requests_user_created_idx on public.withdrawal_requests (user_id, created_at desc);
create index withdrawal_requests_status_created_idx on public.withdrawal_requests (status, created_at);
create index quest_completions_user_created_idx on public.quest_completions (user_id, created_at desc);

alter table public.wallet_bindings enable row level security;
alter table public.airdrop_claims enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.quest_completions enable row level security;
alter table public.referral_stats enable row level security;

revoke all on public.wallet_bindings, public.airdrop_claims, public.withdrawal_requests, public.quest_completions, public.referral_stats from anon, authenticated;
grant select on public.wallet_bindings, public.airdrop_claims, public.withdrawal_requests, public.quest_completions, public.referral_stats to authenticated;
grant insert (user_id, campaign_key, status, verified_at) on public.airdrop_claims to authenticated;
grant insert (user_id, quest_key, status, verified_at) on public.quest_completions to authenticated;
grant select, insert, update on public.wallet_bindings, public.airdrop_claims, public.withdrawal_requests, public.quest_completions, public.referral_stats to service_role;

create policy wallet_bindings_read_own on public.wallet_bindings for select to authenticated using (auth.uid() = user_id);
create policy airdrop_claims_read_own on public.airdrop_claims for select to authenticated using (auth.uid() = user_id);
create policy airdrop_claims_submit_pending on public.airdrop_claims for insert to authenticated with check (auth.uid() = user_id and status = 'pending' and verified_at is null);
create policy withdrawal_requests_read_own on public.withdrawal_requests for select to authenticated using (auth.uid() = user_id);
create policy quest_completions_read_own on public.quest_completions for select to authenticated using (auth.uid() = user_id);
create policy quest_completions_submit_pending on public.quest_completions for insert to authenticated with check (auth.uid() = user_id and status = 'pending' and verified_at is null);
create policy referral_stats_read_own on public.referral_stats for select to authenticated using (auth.uid() = user_id);

commit;
