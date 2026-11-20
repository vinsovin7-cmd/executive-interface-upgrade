begin;

-- Ensures every authenticated account (email or Google) has exactly one
-- per-user public profile row, and that the row stays scoped to auth.uid().
-- Idempotent so it is safe on both fresh installs and already-migrated projects.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- A user may only rename their own profile; the id can never be reassigned.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

-- Runs as definer so the row is always written even though the insert into
-- auth.users is performed by the auth service role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    new.email
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Self-heal accounts created before the trigger existed and refresh a
-- missing profile email from the auth record.
insert into public.profiles (id, display_name, email)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data->>'display_name', ''),
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), '')
  ),
  u.email
from auth.users u
on conflict (id) do update
  set email = coalesce(public.profiles.email, excluded.email),
      updated_at = now();

commit;
