-- Allow the PIN-protected operator control plane to read aggregated telemetry.
--
-- get_admin_global_telemetry() only accepted a user JWT whose app_metadata.role
-- is 'admin'. The /admin control plane is now gated by a signed, HttpOnly server
-- session cookie (process.env.ADMIN_ACCESS_PIN) and reads telemetry with the
-- server-side service-role key, so the function must also accept the service_role
-- JWT. Regular authenticated users stay blocked by the app_metadata check.
-- Idempotent: safe to re-run.
begin;

create or replace function public.get_admin_global_telemetry()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'active_users', (select count(distinct user_id) from public.activity_sessions where last_seen_at >= now() - interval '90 seconds'),
    'active_sessions', (select count(*) from public.activity_sessions where last_seen_at >= now() - interval '90 seconds'),
    'total_active_seconds', coalesce((select sum(active_seconds) from public.activity_sessions), 0),
    'interaction_ticks', coalesce((select sum(interaction_ticks) from public.activity_sessions), 0),
    'verified_rewards_by_asset', coalesce((select jsonb_agg(jsonb_build_object('asset_master', asset_master, 'amount', amount_sum, 'count', entry_count) order by asset_master) from (select asset_master, sum(amount) as amount_sum, count(*) as entry_count from public.ledger_entries where entry_type = 'reward' and status = 'verified' group by asset_master) q), '[]'::jsonb),
    'pending_payouts_by_asset', coalesce((select jsonb_agg(jsonb_build_object('asset_master', asset_master, 'amount', amount_sum, 'count', entry_count) order by asset_master) from (select asset_master, sum(amount) as amount_sum, count(*) as entry_count from public.ledger_entries where entry_type = 'payout' and status = 'pending' group by asset_master) q), '[]'::jsonb),
    'pending_payout_count', (select count(*) from public.ledger_entries where entry_type = 'payout' and status = 'pending'),
    'adsgram_ad_starts', (select count(*) from public.adsgram_ad_starts),
    'adsgram_callback_receipts', (select count(*) from public.adsgram_reward_callbacks),
    'last_adsgram_callback_at', (select max(received_at) from public.adsgram_reward_callbacks),
    'network_impressions_available', false
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_admin_global_telemetry() from public, anon;
grant execute on function public.get_admin_global_telemetry() to authenticated, service_role;

commit;
