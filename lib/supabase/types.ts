export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      wallet_bindings: {
        Row: { id: string; user_id: string; network: string; address: string; status: string; created_at: string; verified_at: string | null }
        Insert: { id?: string; user_id: string; network?: string; address: string; status?: string; created_at?: string; verified_at?: string | null }
        Update: { network?: string; address?: string; status?: string; verified_at?: string | null }
        Relationships: []
      }
      airdrop_claims: {
        Row: { id: string; user_id: string; campaign_key: string; status: string; created_at: string; verified_at: string | null }
        Insert: { id?: string; user_id: string; campaign_key: string; status?: string; created_at?: string; verified_at?: string | null }
        Update: { campaign_key?: string; status?: string; verified_at?: string | null }
        Relationships: []
      }
      withdrawal_requests: {
        Row: { id: string; user_id: string; network: string; asset_code: string; asset_decimals: number; amount_atomic: string; destination: string; status: string; idempotency_key: string; created_at: string; updated_at: string; transaction_hash: string | null; failure_reason: string | null; payout_attempted_at: string | null }
        Insert: { id?: string; user_id: string; network?: string; asset_code: string; asset_decimals: number; amount_atomic: string; destination: string; status?: string; idempotency_key?: string; created_at?: string; updated_at?: string; transaction_hash?: string | null; failure_reason?: string | null; payout_attempted_at?: string | null }
        Update: { network?: string; asset_code?: string; asset_decimals?: number; amount_atomic?: string; destination?: string; status?: string; updated_at?: string; transaction_hash?: string | null; failure_reason?: string | null; payout_attempted_at?: string | null }
        Relationships: []
      }
      reward_split_config: {
        Row: { id: boolean; user_share_bps: number; treasury_share_bps: number; minimum_accumulation_seconds: number; updated_at: string }
        Insert: { id?: boolean; user_share_bps: number; treasury_share_bps: number; minimum_accumulation_seconds?: number; updated_at?: string }
        Update: { user_share_bps?: number; treasury_share_bps?: number; minimum_accumulation_seconds?: number; updated_at?: string }
        Relationships: []
      }
      mining_sessions: {
        Row: { user_id: string; wallet_address: string; status: string; started_at: string; last_tick_at: string; updated_at: string }
        Insert: { user_id: string; wallet_address: string; status?: string; started_at?: string; last_tick_at?: string; updated_at?: string }
        Update: { wallet_address?: string; status?: string; started_at?: string; last_tick_at?: string; updated_at?: string }
        Relationships: []
      }
      treasury_accruals: {
        Row: { id: string; source: string; asset_code: string; amount_atomic: string; originating_user_id: string | null; reward_event_id: string | null; created_at: string }
        Insert: { id?: string; source: string; asset_code: string; amount_atomic: string; originating_user_id?: string | null; reward_event_id?: string | null; created_at?: string }
        Update: { source?: string; asset_code?: string; amount_atomic?: string; originating_user_id?: string | null; reward_event_id?: string | null }
        Relationships: []
      }
      quest_completions: {
        Row: { id: string; user_id: string; quest_key: string; status: string; created_at: string; verified_at: string | null }
        Insert: { id?: string; user_id: string; quest_key: string; status?: string; created_at?: string; verified_at?: string | null }
        Update: { quest_key?: string; status?: string; verified_at?: string | null }
        Relationships: []
      }
      referral_stats: {
        Row: { user_id: string; referral_code: string; tier1_count: number; tier2_count: number; tier1_commission_atomic: string; tier2_commission_atomic: string; updated_at: string }
        Insert: { user_id: string; referral_code?: string; tier1_count?: number; tier2_count?: number; tier1_commission_atomic?: string; tier2_commission_atomic?: string; updated_at?: string }
        Update: { tier1_count?: number; tier2_count?: number; tier1_commission_atomic?: string; tier2_commission_atomic?: string; updated_at?: string }
        Relationships: []
      }
      profiles: {
        Row: { id: string; display_name: string | null; email: string | null; created_at: string; updated_at: string }
        Insert: { id: string; display_name?: string | null; email?: string; created_at?: string; updated_at?: string }
        Update: { display_name?: string | null; email?: string | null; updated_at?: string }
        Relationships: []
      }
      owner_vault_settings: {
        Row: { owner_user_id: string; openrouter_key_ciphertext: string | null; gemini_key_ciphertext: string | null; staking_target: string | null; updated_at: string; failed_attempts: number; lock_until: string | null }
        Insert: { owner_user_id: string; openrouter_key_ciphertext?: string | null; gemini_key_ciphertext?: string | null; staking_target?: string | null; updated_at?: string; failed_attempts?: number; lock_until?: string | null }
        Update: { openrouter_key_ciphertext?: string | null; gemini_key_ciphertext?: string | null; staking_target?: string | null; updated_at?: string; failed_attempts?: number; lock_until?: string | null }
        Relationships: []
      }
      wallet_connections: {
        Row: { id: string; user_id: string; network: string; address: string; created_at: string }
        Insert: { id?: string; user_id: string; network: string; address: string; created_at?: string }
        Update: { network?: string; address?: string }
        Relationships: []
      }
      node_telemetry: {
        Row: { id: string; user_id: string; source: string; metric: string; value: number; unit: string; observed_at: string; created_at: string }
        Insert: { id?: string; user_id: string; source: string; metric: string; value: number; unit: string; observed_at: string; created_at?: string }
        Update: { source?: string; metric?: string; value?: number; unit?: string; observed_at?: string }
        Relationships: []
      }
      ledger_asset_config: {
        Row: { asset_code: string; asset_master: string; asset_kind: string; decimals: number; minimum_withdrawal_atomic: string; updated_at: string }
        Insert: { asset_code: string; asset_master: string; asset_kind: string; decimals: number; minimum_withdrawal_atomic: string; updated_at?: string }
        Update: { asset_master?: string; asset_kind?: string; decimals?: number; minimum_withdrawal_atomic?: string; updated_at?: string }
        Relationships: []
      }
      ledger_entries: {
        Row: { id: string; user_id: string; network: string; asset_master: string; amount: number; transaction_hash: string | null; entry_type: string; status: string; created_at: string; verified_at: string | null; withdrawal_request_id: string | null; reward_event_id: string | null }
        Insert: { id?: string; user_id: string; network: string; asset_master: string; amount: number; transaction_hash?: string | null; entry_type: string; status: string; created_at?: string; verified_at?: string | null; withdrawal_request_id?: string | null; reward_event_id?: string | null }
        Update: { network?: string; asset_master?: string; amount?: number; transaction_hash?: string | null; entry_type?: string; status?: string; verified_at?: string | null; withdrawal_request_id?: string | null; reward_event_id?: string | null }
        Relationships: []
      }
      activity_sessions: {
        Row: { id: string; user_id: string; client_session_id: string; channel: string; started_at: string; last_seen_at: string; active_seconds: number; heartbeat_count: number; interaction_ticks: number }
        Insert: { id?: string; user_id: string; client_session_id: string; channel?: string; started_at?: string; last_seen_at?: string; active_seconds?: number; heartbeat_count?: number; interaction_ticks?: number }
        Update: { channel?: string; last_seen_at?: string; active_seconds?: number; heartbeat_count?: number; interaction_ticks?: number }
        Relationships: []
      }
      telegram_accounts: {
        Row: { user_id: string; telegram_user_id: string; verified_at: string }
        Insert: { user_id: string; telegram_user_id: string; verified_at?: string }
        Update: { telegram_user_id?: string; verified_at?: string }
        Relationships: []
      }
      adsgram_ad_starts: {
        Row: { id: string; user_id: string; block_id: string; started_at: string }
        Insert: { id?: string; user_id: string; block_id: string; started_at?: string }
        Update: { block_id?: string; started_at?: string }
        Relationships: []
      }
      adsgram_reward_callbacks: {
        Row: { id: string; telegram_user_id: string; linked_user_id: string | null; block_id: string; received_at: string }
        Insert: { id?: string; telegram_user_id: string; linked_user_id?: string | null; block_id: string; received_at?: string }
        Update: { linked_user_id?: string | null; block_id?: string; received_at?: string }
        Relationships: []
      }
      device_heartbeats: {
        Row: { user_id: string; last_seen_at: string; channel: string }
        Insert: { user_id: string; last_seen_at?: string; channel?: string }
        Update: { last_seen_at?: string; channel?: string }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      queue_withdrawal_request: {
        Args: { p_user_id: string; p_asset_code: string; p_amount_atomic: string; p_destination: string; p_idempotency_key: string }
        Returns: { request_id: string; status: string; asset_code: string; amount_atomic: string }[]
      }
      record_device_heartbeat: { Args: { p_channel: string }; Returns: string }
      record_activity_heartbeat: {
        Args: { p_session_id: string; p_channel: string; p_interacted?: boolean }
        Returns: { last_seen_at: string; active_seconds: number; heartbeat_count: number; interaction_ticks: number }[]
      }
      get_user_reward_balances: {
        Args: { p_user_id: string }
        Returns: { asset_code: string; available_atomic: number; earned_today_atomic: number; daily_cap_atomic: number; minimum_withdrawal_atomic: number }[]
      }
      get_admin_global_telemetry: { Args: Record<PropertyKey, never>; Returns: Json }
      record_owner_vault_failure: { Args: { p_owner_user_id: string }; Returns: string | null }
      credit_reward_event: { Args: { p_user_id: string; p_event_type: string; p_event_key: string }; Returns: number }
      get_mining_state: {
        Args: Record<PropertyKey, never>
        Returns: { status: string; wallet_address: string | null; started_at: string | null; unlock_at: string | null; seconds_remaining: number; withdrawal_locked: boolean; minimum_accumulation_seconds: number }[]
      }
      activate_wallet_mining: {
        Args: { p_address: string }
        Returns: { status: string; wallet_address: string | null; started_at: string | null; unlock_at: string | null; seconds_remaining: number; withdrawal_locked: boolean; minimum_accumulation_seconds: number }[]
      }
      begin_withdrawal_payout: {
        Args: { p_request_id: string }
        Returns: { request_id: string; user_id: string; asset_code: string; asset_decimals: number; amount_atomic: number; destination: string; status: string }[]
      }
      complete_withdrawal_payout: { Args: { p_request_id: string; p_transaction_hash: string }; Returns: undefined }
      fail_withdrawal_payout: { Args: { p_request_id: string; p_reason: string }; Returns: undefined }
      get_treasury_summary: {
        Args: Record<PropertyKey, never>
        Returns: { asset_code: string; accrued_atomic: number; pending_payout_atomic: number; paid_payout_atomic: number }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
