-- ============================================================================
-- Teksi / Rork app — Supabase schema
-- ----------------------------------------------------------------------------
-- Safe to run on a fresh Supabase project. Idempotent: re-runs do not destroy
-- existing data. To wipe and recreate, run `supabase/reset.sql` first.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type partner_status as enum (
    'approved','unapproved','blocked','rejected',
    'unapproved-docs','permit-pending','permit-non-verified','permit-verified'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type permit_status as enum ('pending','non-verified','verified','none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_status as enum (
    'approved','unapproved','blocked','rejected','unapproved-docs'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender_type as enum ('male','female','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_status as enum (
    'Approved','Un-Approved','Blocked','Rejected','Deleted'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type id_verification_status as enum ('Verified','Failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_id text unique,
  name text,
  phone text,
  email text,
  ic text,
  address text,
  profile_image text,
  avatar_url text,
  id_image text,
  nationality text,
  gender gender_type,
  birth_date date,
  referral_code text,
  pin text,
  login_pin text,
  pin_hash text,
  pin_failed_attempts integer not null default 0,
  pin_locked_until timestamptz,
  device_count integer not null default 1,
  status user_status not null default 'unapproved',
  profile_status profile_status not null default 'Un-Approved',
  id_verified id_verification_status,
  documents_ok boolean not null default false,
  total_rides integer not null default 0,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles(status);
create index if not exists profiles_phone_idx on public.profiles(phone);
create index if not exists profiles_profile_status_idx on public.profiles(profile_status);
create index if not exists profiles_id_verified_idx on public.profiles(id_verified);

-- ---------------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------------
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  display_id text unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text not null,
  email text,
  ic text,
  vehicle text,
  plate text,
  vehicle_type text,
  energy_type text,
  make text,
  model text,
  year_from text,
  year_to text,
  partner_type text,
  permit_number text,
  status partner_status not null default 'unapproved',
  permit permit_status not null default 'pending',
  documents_ok boolean not null default false,
  rating numeric(3,2) not null default 0,
  total_rides integer not null default 0,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partners_status_idx on public.partners(status);
create index if not exists partners_permit_idx on public.partners(permit);
create index if not exists partners_phone_idx on public.partners(phone);

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  display_id text unique,
  partner_id uuid references public.partners(id) on delete set null,
  partner_display_id text,
  plate text not null,
  make text not null,
  model text not null,
  year text,
  color text,
  vehicle_type text,
  owner_name text not null,
  owner_phone text not null,
  status partner_status not null default 'unapproved',
  permit permit_status not null default 'pending',
  documents_ok boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_status_idx on public.vehicles(status);
create index if not exists vehicles_permit_idx on public.vehicles(permit);
create index if not exists vehicles_plate_idx on public.vehicles(plate);
create index if not exists vehicles_partner_idx on public.vehicles(partner_id);

-- ---------------------------------------------------------------------------
-- Vehicle make/model catalog
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_make_models (
  id uuid primary key default gen_random_uuid(),
  vehicle_type text not null,
  energy_type text not null,
  make text not null,
  model text not null,
  year_from text not null default '',
  year_to text not null default '',
  icon_uri text not null default '',
  status boolean not null default true,
  is_default boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vmm_vehicle_type_idx on public.vehicle_make_models(vehicle_type);
create index if not exists vmm_energy_type_idx on public.vehicle_make_models(energy_type);
create index if not exists vmm_make_idx on public.vehicle_make_models(make);
create index if not exists vmm_model_idx on public.vehicle_make_models(model);
create index if not exists vmm_position_idx on public.vehicle_make_models(position);

-- ---------------------------------------------------------------------------
-- Partner documents
-- ---------------------------------------------------------------------------
create table if not exists public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  status text not null default 'pending',
  expires_at timestamptz,
  uploaded_at timestamptz not null default now()
);

create index if not exists partner_documents_partner_idx on public.partner_documents(partner_id);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table if not exists public.settings_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  values jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settings_entries_category_idx on public.settings_entries(category);
create index if not exists settings_entries_active_idx on public.settings_entries(active);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Regions: countries / states / cities / suburbs
-- Source of truth for admin-settings-country-states-cities.tsx.
-- ---------------------------------------------------------------------------
create table if not exists public.countries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  values      jsonb not null default '{}'::jsonb,
  geofence    jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists countries_name_idx on public.countries(name);
create index if not exists countries_position_idx on public.countries(position);

create table if not exists public.states (
  id          uuid primary key default gen_random_uuid(),
  country     text not null,
  name        text not null,
  values      jsonb not null default '{}'::jsonb,
  geofence    jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (country, name)
);

create index if not exists states_country_idx on public.states(country);
create index if not exists states_name_idx on public.states(name);

create table if not exists public.cities (
  id          uuid primary key default gen_random_uuid(),
  country     text not null,
  state       text not null,
  name        text not null,
  values      jsonb not null default '{}'::jsonb,
  geofence    jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (country, state, name)
);

create index if not exists cities_country_idx on public.cities(country);
create index if not exists cities_state_idx on public.cities(state);
create index if not exists cities_name_idx on public.cities(name);

create table if not exists public.suburbs (
  id          uuid primary key default gen_random_uuid(),
  country     text not null,
  state       text not null,
  city        text not null,
  name        text not null,
  values      jsonb not null default '{}'::jsonb,
  geofence    jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (country, state, city, name)
);

create index if not exists suburbs_country_idx on public.suburbs(country);
create index if not exists suburbs_state_idx on public.suburbs(state);
create index if not exists suburbs_city_idx on public.suburbs(city);
create index if not exists suburbs_name_idx on public.suburbs(name);

-- ---------------------------------------------------------------------------
-- Dedicated settings tables (split out of settings_entries — see 0019)
-- ---------------------------------------------------------------------------
create table if not exists public.airport_areas (
  id          uuid primary key default gen_random_uuid(),
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists airport_areas_position_idx on public.airport_areas(position);

create table if not exists public.required_document (
  id          uuid primary key default gen_random_uuid(),
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists required_document_position_idx on public.required_document(position);

create table if not exists public.document_type (
  id          uuid primary key default gen_random_uuid(),
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists document_type_position_idx on public.document_type(position);

create table if not exists public.driver_incentive (
  id          uuid primary key default gen_random_uuid(),
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists driver_incentive_position_idx on public.driver_incentive(position);

-- ---------------------------------------------------------------------------
-- More dedicated settings tables (see 0020)
-- ---------------------------------------------------------------------------
create table if not exists public.multi_gate (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('place','gate')),
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists multi_gate_kind_idx     on public.multi_gate(kind);
create index if not exists multi_gate_position_idx on public.multi_gate(position);

do $extra_tables$
declare t text;
begin
  foreach t in array array[
    'insurance_providers','insurance_types','insurance_durations','insurance_premium',
    'ev_delivery_advisors','ev_finance_options','ev_order_fee',
    'ev_vehicle_details','ev_vehicle_inventory'
  ] loop
    execute format($f$
      create table if not exists public.%1$s (
        id          uuid primary key default gen_random_uuid(),
        values      jsonb not null default '{}'::jsonb,
        position    integer not null default 0,
        active      boolean not null default true,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      );
      create index if not exists %1$s_position_idx on public.%1$s(position);
    $f$, t);
  end loop;
end;
$extra_tables$;

-- ---------------------------------------------------------------------------
-- Rides
-- ---------------------------------------------------------------------------
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references public.profiles(id) on delete set null,
  partner_id uuid references public.partners(id) on delete set null,
  service text,
  status text not null default 'pending',
  pickup jsonb,
  dropoff jsonb,
  fare numeric(10,2),
  currency text default 'MYR',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists rides_status_idx on public.rides(status);
create index if not exists rides_rider_idx on public.rides(rider_id);
create index if not exists rides_partner_idx on public.rides(partner_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','partners','vehicles','vehicle_make_models','settings_entries','app_settings',
    'countries','states','cities','suburbs',
    'airport_areas','required_document','document_type','driver_incentive',
    'multi_gate',
    'insurance_providers','insurance_types','insurance_durations','insurance_premium',
    'ev_delivery_advisors','ev_finance_options','ev_order_fee',
    'ev_vehicle_details','ev_vehicle_inventory'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated_at on public.%1$s;
       create trigger trg_%1$s_updated_at before update on public.%1$s
       for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Auto-create profile on auth user signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone)
  values (new.id, new.email, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Sign-in PIN: bcrypt hashing + brute-force rate limiting
-- (canonical definitions; see migration 0052 for the historical delta)
--
-- profiles.pin_hash stores a bcrypt hash of the 6-digit sign-in PIN. The
-- legacy plaintext columns (pin, login_pin) are kept for backward
-- compatibility as *write-only* inputs: a BEFORE trigger hashes anything
-- written to them and nulls the plaintext, so plaintext never persists.
-- ---------------------------------------------------------------------------
create or replace function public.hash_profile_pin()
returns trigger
language plpgsql
as $$
begin
  -- Prefer login_pin (canonical) over the legacy pin column.
  if new.login_pin is not null and new.login_pin <> '' then
    new.pin_hash := crypt(new.login_pin, gen_salt('bf', 10));
    new.pin_failed_attempts := 0;
    new.pin_locked_until := null;
  elsif new.pin is not null and new.pin <> '' then
    new.pin_hash := crypt(new.pin, gen_salt('bf', 10));
    new.pin_failed_attempts := 0;
    new.pin_locked_until := null;
  end if;
  -- Plaintext never persists.
  new.pin := null;
  new.login_pin := null;
  return new;
end;
$$;

drop trigger if exists trg_profiles_hash_pin on public.profiles;
create trigger trg_profiles_hash_pin
  before insert or update on public.profiles
  for each row execute function public.hash_profile_pin();

-- Client write path for setting/changing the PIN (authenticated users only).
-- set_login_pin also enforces the device-based duplicate-account guard for a
-- brand-new account (no prior pin_hash + freshly created profile). See the
-- device_guard_* functions below and migration 0072. PIN changes / forgot-PIN
-- resets operate on existing profiles and are never blocked.
create or replace function public.set_login_pin(p_pin text, p_device_id text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pin_hash text;
  v_created timestamptz;
  v_is_new boolean;
  v_enabled boolean;
  v_max int;
  v_block_emu boolean;
  v_prior int;
  v_emu boolean;
begin
  if v_uid is null then
    raise exception 'set_login_pin requires an authenticated session';
  end if;
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  select pin_hash, created_at into v_pin_hash, v_created
  from public.profiles where id = v_uid;
  v_is_new := (v_pin_hash is null)
    and (v_created is null or v_created > now() - interval '1 hour');

  if v_is_new then
    select c.enabled, c.max_accounts, c.block_emulators
      into v_enabled, v_max, v_block_emu
    from public.device_guard_config() c;

    if v_enabled and p_device_id is not null and p_device_id <> '' then
      select count(distinct user_id)::int into v_prior
      from public.user_sessions
      where device_id = p_device_id
        and user_id is not null
        and user_id <> v_uid;
      if v_prior >= v_max then
        raise exception 'DEVICE_LIMIT:%/%', v_prior, v_max;
      end if;
    end if;

    if v_enabled and v_block_emu then
      select coalesce(bool_or(is_physical_device is false), false) into v_emu
      from public.user_sessions
      where (p_device_id is not null and p_device_id <> '' and device_id = p_device_id)
         or user_id = v_uid;
      if v_emu then
        raise exception 'EMULATOR_BLOCKED';
      end if;
    end if;
  end if;

  update public.profiles
  set pin_hash            = crypt(p_pin, gen_salt('bf', 10)),
      pin                 = null,
      login_pin           = null,
      pin_failed_attempts = 0,
      pin_locked_until    = null
  where id = v_uid;
  if not found then
    insert into public.profiles (id, pin_hash)
    values (v_uid, crypt(p_pin, gen_salt('bf', 10)))
    on conflict (id) do update set
      pin_hash            = excluded.pin_hash,
      pin                 = null,
      login_pin           = null,
      pin_failed_attempts = 0,
      pin_locked_until    = null;
  end if;
  return true;
end;
$$;

revoke all on function public.set_login_pin(text, text) from public;
grant execute on function public.set_login_pin(text, text) to authenticated;

-- Forgot-PIN reset for the signed-in user.
create or replace function public.clear_login_pin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'clear_login_pin requires an authenticated session';
  end if;
  update public.profiles
  set pin_hash            = null,
      pin                 = null,
      login_pin           = null,
      pin_failed_attempts = 0,
      pin_locked_until    = null
  where id = v_uid;
  return found;
end;
$$;

revoke all on function public.clear_login_pin() from public;
grant execute on function public.clear_login_pin() to authenticated;

-- Pre-login PIN check. Returns the user's UUID on match, null on mismatch.
-- Rate limited: 5 consecutive failures lock verification for 15 minutes and
-- the function raises 'PIN_LOCKED:<seconds-remaining>' while locked.
create or replace function public.verify_pin_for_login(p_phone text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits   text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_row      record;
  v_matched  boolean := false;
  v_attempts integer;
begin
  select p.id, p.pin, p.login_pin, p.pin_hash,
         p.pin_failed_attempts, p.pin_locked_until
    into v_row
    from public.profiles p
   where p.phone = any (array_remove(array[
           '+' || v_digits,
           v_digits,
           '0' || v_digits,
           ltrim(v_digits, '0')
         ], null))
   limit 1;

  if v_row.id is null then
    return null;
  end if;

  if v_row.pin_locked_until is not null and v_row.pin_locked_until > now() then
    raise exception 'PIN_LOCKED:%',
      ceil(extract(epoch from (v_row.pin_locked_until - now())))::integer;
  end if;

  if v_row.pin_hash is not null and v_row.pin_hash <> '' then
    v_matched := v_row.pin_hash = crypt(p_pin, v_row.pin_hash);
  end if;
  -- Legacy plaintext columns (rows written before the 0052 backfill).
  if not v_matched then
    v_matched :=
         (v_row.login_pin is not null and v_row.login_pin <> '' and v_row.login_pin = p_pin)
      or (v_row.pin       is not null and v_row.pin       <> '' and v_row.pin       = p_pin);
  end if;

  if v_matched then
    update public.profiles
       set pin_failed_attempts = 0,
           pin_locked_until    = null,
           -- Opportunistic upgrade: hash any remaining legacy plaintext PIN.
           pin_hash = case when pin_hash is null or pin_hash = ''
                           then crypt(p_pin, gen_salt('bf', 10))
                           else pin_hash end,
           pin       = null,
           login_pin = null
     where id = v_row.id;
    return v_row.id;
  end if;

  v_attempts := coalesce(v_row.pin_failed_attempts, 0) + 1;
  if v_attempts >= 5 then
    update public.profiles
       set pin_failed_attempts = 0,
           pin_locked_until    = now() + interval '15 minutes'
     where id = v_row.id;
  else
    update public.profiles
       set pin_failed_attempts = v_attempts
     where id = v_row.id;
  end if;
  return null;
end;
$$;

revoke all on function public.verify_pin_for_login(text, text) from public;
grant execute on function public.verify_pin_for_login(text, text) to anon, authenticated;

-- Pre-login phone lookup used by the login screen: exposes only booleans,
-- never the profile row itself.
create or replace function public.profile_phone_lookup(p_phone text)
returns table (
  has_profile boolean,
  has_pin     boolean,
  is_deleted  boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d
  ),
  variants as (
    select array_remove(array[
      '+' || d,
      d,
      '0' || d,
      ltrim(d, '0')
    ], null) as v
    from digits
  ),
  match as (
    select p.pin, p.login_pin, p.pin_hash, p.profile_status
    from public.profiles p, variants
    where p.phone = any(variants.v)
    limit 1
  )
  select
    exists(select 1 from match)                                    as has_profile,
    coalesce((select (pin is not null and pin <> '')
                  or (login_pin is not null and login_pin <> '')
                  or (pin_hash is not null and pin_hash <> '')
              from match), false)                                  as has_pin,
    coalesce((select lower(profile_status::text) = 'deleted'
              from match), false)                                  as is_deleted;
$$;

revoke all on function public.profile_phone_lookup(text) from public;
grant execute on function public.profile_phone_lookup(text) to anon, authenticated;

-- Device-based duplicate-account guard for the sign-up flow (migration 0071).
-- Returns how many DISTINCT accounts other than the caller have signed in from
-- a given device_id — a bare count, never PII — so the client can block bulk
-- multi-accounting on one physical device. SECURITY DEFINER because the 0069
-- RLS lockdown otherwise limits a client to its own user_sessions rows.
create or replace function public.device_prior_account_count(p_device_id text)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct user_id)::int
  from public.user_sessions
  where p_device_id is not null
    and p_device_id <> ''
    and device_id = p_device_id
    and user_id is not null
    and user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$$;

revoke all on function public.device_prior_account_count(text) from public;
grant execute on function public.device_prior_account_count(text) to anon, authenticated;

-- Device-guard config (migration 0072), stored in app_settings key
-- 'device_account_guard' = { enabled, maxAccountsPerDevice }. Effective values
-- with safe defaults when the row is absent.
-- Effective config: enabled + cumulative account cap + opt-in emulator block
-- (migration 0074), with safe defaults when the app_settings row is absent.
create or replace function public.device_guard_config()
returns table (enabled boolean, max_accounts int, block_emulators boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  select value into v from public.app_settings where key = 'device_account_guard';
  enabled := coalesce((v->>'enabled')::boolean, true);
  max_accounts := greatest(1, coalesce((v->>'maxAccountsPerDevice')::int, 3));
  block_emulators := coalesce((v->>'blockEmulators')::boolean, false);
  return next;
end;
$$;

revoke all on function public.device_guard_config() from public;
grant execute on function public.device_guard_config() to anon, authenticated;

-- Client pre-check for the sign-up flow: whether a new registration is allowed
-- on this device plus the signals behind the decision.
create or replace function public.device_registration_status(p_device_id text)
returns table (
  allowed boolean,
  prior_accounts int,
  max_accounts int,
  enabled boolean,
  is_emulator boolean,
  block_emulators boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_enabled boolean;
  v_max int;
  v_block_emu boolean;
  v_prior int := 0;
  v_emu boolean := false;
  v_uid uuid := auth.uid();
begin
  select c.enabled, c.max_accounts, c.block_emulators
    into v_enabled, v_max, v_block_emu
  from public.device_guard_config() c;
  if p_device_id is not null and p_device_id <> '' then
    select count(distinct user_id)::int into v_prior
    from public.user_sessions
    where device_id = p_device_id
      and user_id is not null
      and user_id <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  select coalesce(bool_or(is_physical_device is false), false) into v_emu
  from public.user_sessions
  where (p_device_id is not null and p_device_id <> '' and device_id = p_device_id)
     or (v_uid is not null and user_id = v_uid);
  allowed := (not v_enabled)
    or ((v_prior < v_max) and not (v_block_emu and v_emu));
  prior_accounts := v_prior;
  max_accounts := v_max;
  enabled := v_enabled;
  is_emulator := v_emu;
  block_emulators := v_block_emu;
  return next;
end;
$$;

revoke all on function public.device_registration_status(text) from public;
grant execute on function public.device_registration_status(text) to anon, authenticated;

-- Admin-only writer for the device-guard knobs.
create or replace function public.device_guard_set_config(
  p_enabled boolean,
  p_max_accounts int,
  p_block_emulators boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.caller_is_admin() then
    raise exception 'not_authorized';
  end if;
  insert into public.app_settings (key, value, updated_at)
  values (
    'device_account_guard',
    jsonb_build_object(
      'enabled', coalesce(p_enabled, true),
      'maxAccountsPerDevice', greatest(1, coalesce(p_max_accounts, 3)),
      'blockEmulators', coalesce(p_block_emulators, false)
    ),
    now()
  )
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
  return true;
end;
$$;

revoke all on function public.device_guard_set_config(boolean, int, boolean) from public;
grant execute on function public.device_guard_set_config(boolean, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.partners enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_make_models enable row level security;
alter table public.partner_documents enable row level security;
alter table public.settings_entries enable row level security;
alter table public.app_settings enable row level security;
alter table public.rides enable row level security;
alter table public.countries enable row level security;
alter table public.states enable row level security;
alter table public.cities enable row level security;
alter table public.suburbs enable row level security;
alter table public.airport_areas enable row level security;
alter table public.required_document enable row level security;
alter table public.document_type enable row level security;
alter table public.driver_incentive enable row level security;
alter table public.multi_gate enable row level security;
alter table public.insurance_providers enable row level security;
alter table public.insurance_types enable row level security;
alter table public.insurance_durations enable row level security;
alter table public.insurance_premium enable row level security;
alter table public.ev_delivery_advisors enable row level security;
alter table public.ev_finance_options enable row level security;
alter table public.ev_order_fee enable row level security;
alter table public.ev_vehicle_details enable row level security;
alter table public.ev_vehicle_inventory enable row level security;

do $extra_pol$
declare t text;
begin
  foreach t in array array[
    'multi_gate',
    'insurance_providers','insurance_types','insurance_durations','insurance_premium',
    'ev_delivery_advisors','ev_finance_options','ev_order_fee',
    'ev_vehicle_details','ev_vehicle_inventory'
  ] loop
    execute format('drop policy if exists "%1$s read"   on public.%1$s;', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s;', t);
    execute format('create policy "%1$s read"   on public.%1$s for select using (true);', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to public with check (true);', t);
    execute format('create policy "%1$s update" on public.%1$s for update to public using (true) with check (true);', t);
    execute format('create policy "%1$s delete" on public.%1$s for delete to public using (true);', t);
    execute format('grant select, insert, update, delete on public.%1$s to anon, authenticated;', t);
  end loop;
end;
$extra_pol$;

do $dedicated$
declare t text;
begin
  foreach t in array array[
    'airport_areas','required_document','document_type','driver_incentive'
  ] loop
    execute format('drop policy if exists "%1$s read"   on public.%1$s;', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s;', t);
    execute format('create policy "%1$s read"   on public.%1$s for select using (true);', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to public with check (true);', t);
    execute format('create policy "%1$s update" on public.%1$s for update to public using (true) with check (true);', t);
    execute format('create policy "%1$s delete" on public.%1$s for delete to public using (true);', t);
    execute format('grant select, insert, update, delete on public.%1$s to anon, authenticated;', t);
  end loop;
end;
$dedicated$;

do $regions$
declare t text;
begin
  foreach t in array array['countries','states','cities','suburbs'] loop
    execute format('drop policy if exists "%1$s read"   on public.%1$s;', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s;', t);
    execute format('create policy "%1$s read"   on public.%1$s for select using (true);', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to public with check (true);', t);
    execute format('create policy "%1$s update" on public.%1$s for update to public using (true) with check (true);', t);
    execute format('create policy "%1$s delete" on public.%1$s for delete to public using (true);', t);
    execute format('grant select, insert, update, delete on public.%1$s to anon, authenticated;', t);
  end loop;
end;
$regions$;

drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id);
create policy "profiles self write"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "partners read" on public.partners;
create policy "partners read"
  on public.partners for select
  using (auth.role() = 'authenticated');

drop policy if exists "vehicles read" on public.vehicles;
create policy "vehicles read"
  on public.vehicles for select
  using (true);

drop policy if exists "vehicle_make_models read" on public.vehicle_make_models;
create policy "vehicle_make_models read"
  on public.vehicle_make_models for select
  using (true);

drop policy if exists "partner_documents own" on public.partner_documents;
create policy "partner_documents own"
  on public.partner_documents for select
  using (
    exists (
      select 1 from public.partners p
      where p.id = partner_documents.partner_id
        and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "settings_entries read" on public.settings_entries;
create policy "settings_entries read"
  on public.settings_entries for select
  using (true);

-- ---------------------------------------------------------------------------
-- Admin access control (migration 0009, folded in) — one row per
-- (profile, page) pair; a profile with ANY row is considered an admin, and
-- page='*' grants every admin page at the given level. Also backs the
-- app_settings secret-row policies below.
-- ---------------------------------------------------------------------------
do $$ begin
  create type admin_access_level as enum ('read','edit');
exception when duplicate_object then null; end $$;

create table if not exists public.admin_access (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  page          text not null,
  access_level  admin_access_level not null default 'read',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (profile_id, page)
);

create index if not exists admin_access_profile_idx on public.admin_access(profile_id);
create index if not exists admin_access_page_idx    on public.admin_access(page);

drop trigger if exists trg_admin_access_updated_at on public.admin_access;
create trigger trg_admin_access_updated_at
  before update on public.admin_access
  for each row execute function public.set_updated_at();

create or replace function public.is_admin(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_access where profile_id = p_profile
  );
$$;

create or replace function public.admin_can_edit(p_profile uuid, p_page text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_access
    where profile_id = p_profile
      and (page = p_page or page = '*')
      and access_level = 'edit'
  );
$$;

create or replace function public.admin_can_read(p_profile uuid, p_page text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_access
    where profile_id = p_profile
      and (page = p_page or page = '*')
  );
$$;

alter table public.admin_access enable row level security;

drop policy if exists "admin_access self read" on public.admin_access;
create policy "admin_access self read"
  on public.admin_access for select
  using (profile_id = auth.uid());

drop policy if exists "admin_access admin read" on public.admin_access;
create policy "admin_access admin read"
  on public.admin_access for select
  using (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

drop policy if exists "admin_access admin write insert" on public.admin_access;
create policy "admin_access admin write insert"
  on public.admin_access for insert
  with check (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

drop policy if exists "admin_access admin write update" on public.admin_access;
create policy "admin_access admin write update"
  on public.admin_access for update
  using (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

drop policy if exists "admin_access admin write delete" on public.admin_access;
create policy "admin_access admin write delete"
  on public.admin_access for delete
  using (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

grant select, insert, update, delete on public.admin_access to anon, authenticated;

-- ---------------------------------------------------------------------------
-- app_settings (0066): the 'fare_ai_provider' row holds SECRET AI provider
-- API keys. It is only visible/writable to admin_access holders and the
-- service role (used by the ai-route-proxy edge function); every other row
-- keeps the open policies the app relies on.
-- ---------------------------------------------------------------------------
create or replace function public.app_settings_secret_access()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_claims is null or v_claims = '' then
    return true; -- direct database session (setup scripts, psql)
  end if;
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return true;
  end if;
  if auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.admin_access') is null then
    return false;
  end if;
  return exists (
    select 1 from public.admin_access where profile_id = auth.uid()
  );
end;
$$;

grant execute on function public.app_settings_secret_access() to anon, authenticated;

drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read"
  on public.app_settings for select
  using (key <> 'fare_ai_provider' or public.app_settings_secret_access());

drop policy if exists "app_settings insert" on public.app_settings;
create policy "app_settings insert"
  on public.app_settings for insert to public
  with check (key <> 'fare_ai_provider' or public.app_settings_secret_access());

drop policy if exists "app_settings update" on public.app_settings;
create policy "app_settings update"
  on public.app_settings for update to public
  using (key <> 'fare_ai_provider' or public.app_settings_secret_access())
  with check (key <> 'fare_ai_provider' or public.app_settings_secret_access());

drop policy if exists "app_settings delete" on public.app_settings;
create policy "app_settings delete"
  on public.app_settings for delete to public
  using (key <> 'fare_ai_provider' or public.app_settings_secret_access());

drop policy if exists "rides participant" on public.rides;
create policy "rides participant"
  on public.rides for select
  using (
    rider_id = auth.uid()
    or exists (
      select 1 from public.partners p
      where p.id = rides.partner_id and p.auth_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('partner-documents', 'partner-documents', false),
  ('app-assets', 'app-assets', true),
  ('ride-attachments', 'ride-attachments', false),
  ('ID_Image', 'ID_Image', true),
  ('support-media', 'support-media', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Support: tickets / messages / calls (see migration 0036_support.sql for the
-- full RLS + realtime setup; tables created here for fresh installs).
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null default 'Support',
  status text not null default 'open' check (status in ('open','pending','closed')),
  last_message text,
  last_message_at timestamptz,
  last_sender_role text check (last_sender_role in ('user','admin')),
  unread_admin integer not null default 0,
  unread_user integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_role text not null check (sender_role in ('user','admin')),
  sender_id uuid,
  type text not null default 'text' check (type in ('text','image','video','audio','location')),
  body text,
  media_url text,
  media_duration numeric,
  latitude double precision,
  longitude double precision,
  status text not null default 'sent' check (status in ('sent','delivered','read')),
  created_at timestamptz not null default now()
);

create table if not exists public.support_calls (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  caller_role text not null default 'admin' check (caller_role in ('admin')),
  caller_name text,
  media text not null default 'voice' check (media in ('voice','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','ended','missed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_calls enable row level security;

do $support_pol$
declare t text;
begin
  foreach t in array array['support_tickets','support_messages','support_calls'] loop
    execute format('drop policy if exists "%1$s read"   on public.%1$s;', t);
    execute format('drop policy if exists "%1$s insert" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s update" on public.%1$s;', t);
    execute format('drop policy if exists "%1$s delete" on public.%1$s;', t);
    execute format('create policy "%1$s read"   on public.%1$s for select using (true);', t);
    execute format('create policy "%1$s insert" on public.%1$s for insert to public with check (true);', t);
    execute format('create policy "%1$s update" on public.%1$s for update to public using (true) with check (true);', t);
    execute format('create policy "%1$s delete" on public.%1$s for delete to public using (true);', t);
    execute format('grant select, insert, update, delete on public.%1$s to anon, authenticated;', t);
  end loop;
end;
$support_pol$;

drop policy if exists "public read support-media" on storage.objects;
drop policy if exists "anon upload support-media" on storage.objects;
drop policy if exists "auth update support-media" on storage.objects;
drop policy if exists "auth delete support-media" on storage.objects;
create policy "public read support-media"
  on storage.objects for select using (bucket_id = 'support-media');
create policy "anon upload support-media"
  on storage.objects for insert to anon, authenticated with check (bucket_id = 'support-media');
create policy "auth update support-media"
  on storage.objects for update to anon, authenticated using (bucket_id = 'support-media');
create policy "auth delete support-media"
  on storage.objects for delete to anon, authenticated using (bucket_id = 'support-media');

drop policy if exists "public read avatars" on storage.objects;
drop policy if exists "public read app-assets" on storage.objects;
create policy "public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');
create policy "public read app-assets"
  on storage.objects for select
  using (bucket_id = 'app-assets');

drop policy if exists "users upload own avatar" on storage.objects;
drop policy if exists "users update own avatar" on storage.objects;
drop policy if exists "auth upload avatars" on storage.objects;
drop policy if exists "auth update avatars" on storage.objects;
drop policy if exists "auth delete avatars" on storage.objects;

create policy "auth upload avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');

create policy "auth update avatars"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars');

create policy "auth delete avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "partner doc owner read" on storage.objects;
drop policy if exists "partner doc owner write" on storage.objects;
create policy "partner doc owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'partner-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "partner doc owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'partner-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "public read id_image" on storage.objects;
drop policy if exists "auth upload id_image" on storage.objects;
drop policy if exists "auth update id_image" on storage.objects;
drop policy if exists "auth delete id_image" on storage.objects;

create policy "public read id_image"
  on storage.objects for select
  using (bucket_id = 'ID_Image');

create policy "auth upload id_image"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ID_Image');

create policy "auth update id_image"
  on storage.objects for update to authenticated
  using (bucket_id = 'ID_Image');

create policy "auth delete id_image"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ID_Image');

-- ============================================================================
-- Push notifications (Expo push tokens + dispatch log)
-- ----------------------------------------------------------------------------
-- See migrations/0042_push_notifications.sql. Kept here so a fresh bootstrap
-- includes the tables. Tokens are read by the `send-push` edge function with
-- the service-role key; RLS is permissive to match the rest of this project.
-- ============================================================================

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text,
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_profile_idx
  on public.push_tokens(profile_id);

create table if not exists public.push_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all',
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists push_notifications_created_idx
  on public.push_notifications(created_at desc);

do $$
begin
  drop trigger if exists trg_push_tokens_updated_at on public.push_tokens;
  create trigger trg_push_tokens_updated_at before update on public.push_tokens
    for each row execute function public.set_updated_at();
end$$;

alter table public.push_tokens enable row level security;
alter table public.push_notifications enable row level security;

drop policy if exists "push_tokens read"   on public.push_tokens;
drop policy if exists "push_tokens insert" on public.push_tokens;
drop policy if exists "push_tokens update" on public.push_tokens;
drop policy if exists "push_tokens delete" on public.push_tokens;

create policy "push_tokens read"   on public.push_tokens for select using (true);
create policy "push_tokens insert" on public.push_tokens for insert to public with check (true);
create policy "push_tokens update" on public.push_tokens for update to public using (true) with check (true);
create policy "push_tokens delete" on public.push_tokens for delete to public using (true);

drop policy if exists "push_notifications read"   on public.push_notifications;
drop policy if exists "push_notifications insert" on public.push_notifications;
drop policy if exists "push_notifications delete" on public.push_notifications;

create policy "push_notifications read"   on public.push_notifications for select using (true);
create policy "push_notifications insert" on public.push_notifications for insert to public with check (true);
create policy "push_notifications delete" on public.push_notifications for delete to public using (true);

grant select, insert, update, delete on public.push_tokens to anon, authenticated;
grant select, insert, update, delete on public.push_notifications to anon, authenticated;

-- ============================================================================
-- Ride requests (real passenger → partner ride hailing). See migration
-- 0046_ride_requests.sql. Kept here so a fresh bootstrap includes the table.
-- ============================================================================
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id      uuid references public.profiles(id) on delete set null,
  rider_name    text,
  rider_phone   text,
  rider_photo   text,
  rider_rating  numeric(3,2) not null default 5,
  service       text,
  payment_mode  text not null default 'Cash',
  pickup_name   text,
  pickup_address text,
  pickup_lat    double precision,
  pickup_lng    double precision,
  drop_name     text,
  drop_address  text,
  drop_lat      double precision,
  drop_lng      double precision,
  distance_km   numeric(10,2),
  duration_min  integer,
  fare          numeric(10,2),
  currency      text not null default 'MYR',
  passengers    integer not null default 1,
  luggage       integer not null default 0,
  note          text,

  -- Bidding (OfferMe) ----------------------------------------------------------
  offer_me      boolean not null default false,
  offered_fare  numeric(10,2),

  -- Fare breakdown -------------------------------------------------------------
  ride_fare     numeric(10,2),
  toll_charges  numeric(10,2),
  other_charges numeric(10,2),

  -- Partner location checkpoints -----------------------------------------------
  partner_accept_lat double precision,
  partner_accept_lng double precision,
  partner_arrive_lat double precision,
  partner_arrive_lng double precision,
  partner_drop_lat   double precision,
  partner_drop_lng   double precision,

  -- User location checkpoints --------------------------------------------------
  user_accept_lat double precision,
  user_accept_lng double precision,
  user_arrive_lat double precision,
  user_arrive_lng double precision,
  user_drop_lat   double precision,
  user_drop_lng   double precision,

  -- Trip OTP -------------------------------------------------------------------
  otp           text,

  -- Vehicle + address geography ------------------------------------------------
  vehicle_id    text,
  full_address  text,
  country       text,
  state         text,
  city          text,
  suburb        text,

  -- Device / identity metadata -------------------------------------------------
  device_os     text,
  ip_address    text,
  gender        text,

  status        text not null default 'open'
    check (status in ('open','accepted','arrived','on_trip','completed','cancelled','expired')),
  partner_id        uuid,
  partner_name      text,
  partner_phone     text,
  partner_photo     text,
  partner_vehicle   text,
  partner_plate     text,
  partner_rating    numeric(3,2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  arrived_at    timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,

  -- Driver-approved cancellation (0053): set when the passenger asks to cancel
  -- an already-started trip; cleared if the driver declines.
  cancel_requested_at timestamptz,
  cancel_requested_by text,

  -- Why the ride was cancelled (0054): free-text/preset reason chosen by the
  -- rider (or driver) when cancelling.
  cancel_reason text,

  -- Live location sharing (0055): continuously updated GPS fixes published by
  -- the partner and the passenger during an active ride.
  partner_live_lat     double precision,
  partner_live_lng     double precision,
  partner_live_heading double precision,
  partner_live_at      timestamptz,
  user_live_lat        double precision,
  user_live_lng        double precision,
  user_live_at         timestamptz,

  -- Ride commission (0057): platform commission auto-deducted from the
  -- partner's GET.credit wallet when the trip completes.
  commission_rate       numeric(6,4),
  commission_amount     numeric(12,2),
  commission_charged_at timestamptz
);

-- Idempotent upgrade for databases created before 0053/0054/0055.
alter table public.ride_requests
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by text,
  add column if not exists cancel_reason text,
  add column if not exists partner_live_lat     double precision,
  add column if not exists partner_live_lng     double precision,
  add column if not exists partner_live_heading double precision,
  add column if not exists partner_live_at      timestamptz,
  add column if not exists user_live_lat        double precision,
  add column if not exists user_live_lng        double precision,
  add column if not exists user_live_at         timestamptz,
  add column if not exists commission_rate       numeric(6,4),
  add column if not exists commission_amount     numeric(12,2),
  add column if not exists commission_charged_at timestamptz;

create index if not exists ride_requests_status_idx       on public.ride_requests(status);
create index if not exists ride_requests_rider_idx        on public.ride_requests(rider_id);
create index if not exists ride_requests_partner_idx      on public.ride_requests(partner_id);
create index if not exists ride_requests_open_created_idx on public.ride_requests(created_at desc) where status = 'open';

do $$
begin
  drop trigger if exists trg_ride_requests_updated_at on public.ride_requests;
  create trigger trg_ride_requests_updated_at before update on public.ride_requests
    for each row execute function public.set_updated_at();
end$$;

alter table public.ride_requests enable row level security;

drop policy if exists "ride_requests read"   on public.ride_requests;
drop policy if exists "ride_requests insert" on public.ride_requests;
drop policy if exists "ride_requests update" on public.ride_requests;
drop policy if exists "ride_requests delete" on public.ride_requests;

create policy "ride_requests read"   on public.ride_requests for select using (true);
create policy "ride_requests insert" on public.ride_requests for insert to public with check (true);
create policy "ride_requests update" on public.ride_requests for update to public using (true) with check (true);
create policy "ride_requests delete" on public.ride_requests for delete to public using (true);

grant select, insert, update, delete on public.ride_requests to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ride_requests;
exception when duplicate_object then null; end$$;
alter table public.ride_requests replica identity full;

-- ============================================================================
-- IP access rules: admin-managed whitelist / blacklist
-- ============================================================================
create table if not exists public.ip_access_rules (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  list_type  text not null default 'blacklist'
    check (list_type in ('whitelist','blacklist')),
  label      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ip_address, list_type)
);

create index if not exists ip_access_rules_type_idx on public.ip_access_rules(list_type);
create index if not exists ip_access_rules_ip_idx   on public.ip_access_rules(ip_address);

do $$
begin
  drop trigger if exists trg_ip_access_rules_updated_at on public.ip_access_rules;
  create trigger trg_ip_access_rules_updated_at before update on public.ip_access_rules
    for each row execute function public.set_updated_at();
end$$;

alter table public.ip_access_rules enable row level security;

drop policy if exists "ip_access_rules read"   on public.ip_access_rules;
drop policy if exists "ip_access_rules insert" on public.ip_access_rules;
drop policy if exists "ip_access_rules update" on public.ip_access_rules;
drop policy if exists "ip_access_rules delete" on public.ip_access_rules;

create policy "ip_access_rules read"   on public.ip_access_rules for select using (true);
create policy "ip_access_rules insert" on public.ip_access_rules for insert to public with check (true);
create policy "ip_access_rules update" on public.ip_access_rules for update to public using (true) with check (true);
create policy "ip_access_rules delete" on public.ip_access_rules for delete to public using (true);

grant select, insert, update, delete on public.ip_access_rules to anon, authenticated;

-- ============================================================================
-- Wallets — GET.wallet (master) + GET.credit (partner credit)
-- (migrations/0056_wallets.sql + 0057_ride_commission.sql, folded in)
-- ----------------------------------------------------------------------------
-- GET.wallet : master wallet, used by the account in both user & partner mode.
-- GET.credit : partner-only wallet used to pay for in-app services and
--              commissions. Recharged (transferred) from GET.wallet.
-- ============================================================================
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_type text not null check (wallet_type in ('get_wallet','get_credit')),
  balance numeric(12,2) not null default 0,
  currency text not null default 'RM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, wallet_type),
  -- GET.credit may go negative (commission owed); GET.wallet stays >= 0.
  constraint wallets_balance_check check (wallet_type = 'get_credit' or balance >= 0)
);

-- Idempotent upgrade for databases created before 0057 (old check forced all
-- wallet balances to be non-negative).
alter table public.wallets drop constraint if exists wallets_balance_check;
alter table public.wallets add constraint wallets_balance_check
  check (wallet_type = 'get_credit' or balance >= 0);

create index if not exists wallets_user_idx on public.wallets(user_id);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_type text not null check (wallet_type in ('get_wallet','get_credit')),
  kind text not null,
  amount numeric(12,2) not null,
  balance_after numeric(12,2),
  method text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_tx_user_idx
  on public.wallet_transactions(user_id, created_at desc);

do $$
begin
  drop trigger if exists trg_wallets_updated_at on public.wallets;
  create trigger trg_wallets_updated_at before update on public.wallets
    for each row execute function public.set_updated_at();
end$$;

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;

-- Locked down in 0066: balances/history stay readable (admin panel + the
-- user's own app), but the ledger can only be written through the
-- SECURITY DEFINER wallet RPCs below — direct client inserts would let any
-- anon-key holder mint money (the 0060 trigger moves wallets.balance for
-- every wallet_transactions row).
drop policy if exists "wallets read"   on public.wallets;
drop policy if exists "wallets insert" on public.wallets;
drop policy if exists "wallets update" on public.wallets;

create policy "wallets read"   on public.wallets for select using (true);

drop policy if exists "wallet_transactions read"   on public.wallet_transactions;
drop policy if exists "wallet_transactions insert" on public.wallet_transactions;

create policy "wallet_transactions read"   on public.wallet_transactions for select using (true);

grant select on public.wallets to anon, authenticated;
grant select on public.wallet_transactions to anon, authenticated;
revoke insert, update on public.wallets from anon, authenticated;
revoke insert on public.wallet_transactions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Caller assertion helper (0066): every wallet RPC verifies the caller owns
-- the wallet it moves. Direct DB sessions (no PostgREST JWT context) and the
-- service role are exempt.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_assert_caller(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $wac$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if p_user is null then
    raise exception 'invalid_user';
  end if;
  if v_claims is null or v_claims = '' then
    return; -- direct database session (no API JWT context)
  end if;
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return;
  end if;
  if auth.uid() is distinct from p_user then
    raise exception 'not_authorized';
  end if;
end;
$wac$;

-- Realtime: live wallet balance updates (migrations/0059_wallets_realtime.sql)
alter table public.wallets replica identity full;
alter table public.wallet_transactions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.wallets;
exception
  when duplicate_object then null;
end$$;

do $$
begin
  alter publication supabase_realtime add table public.wallet_transactions;
exception
  when duplicate_object then null;
end$$;

-- ----------------------------------------------------------------------------
-- Ledger sync (0060): every wallet_transactions row drives wallets.balance.
-- INSERT applies the signed amount (creating the wallet row when missing) and
-- stamps balance_after; UPDATE/DELETE re-adjust. The wallets UPDATE fires the
-- realtime publication, so balances update live in the app no matter where a
-- transaction row came from (RPC, admin tools, SQL editor, integrations).
-- The wallet RPCs below only insert ledger rows — this trigger is the single
-- writer of wallets.balance.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_apply_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,2);
begin
  if tg_op = 'INSERT' then
    insert into public.wallets (user_id, wallet_type, balance)
    values (new.user_id, new.wallet_type, 0)
    on conflict (user_id, wallet_type) do nothing;

    update public.wallets
       set balance = balance + new.amount, updated_at = now()
     where user_id = new.user_id and wallet_type = new.wallet_type
    returning balance into v_balance;

    new.balance_after := v_balance;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.wallets
       set balance = balance - old.amount, updated_at = now()
     where user_id = old.user_id and wallet_type = old.wallet_type;

    insert into public.wallets (user_id, wallet_type, balance)
    values (new.user_id, new.wallet_type, 0)
    on conflict (user_id, wallet_type) do nothing;

    update public.wallets
       set balance = balance + new.amount, updated_at = now()
     where user_id = new.user_id and wallet_type = new.wallet_type
    returning balance into v_balance;

    new.balance_after := v_balance;
    return new;
  end if;

  update public.wallets
     set balance = balance - old.amount, updated_at = now()
   where user_id = old.user_id and wallet_type = old.wallet_type;
  return old;
end;
$$;

drop trigger if exists trg_wallet_tx_apply on public.wallet_transactions;
create trigger trg_wallet_tx_apply
  before insert or update or delete on public.wallet_transactions
  for each row execute function public.wallet_apply_transaction();

create or replace function public.wallet_topup(
  p_user uuid,
  p_amount numeric,
  p_method text default null
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
begin
  perform public.wallet_assert_caller(p_user);
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'invalid_amount';
  end if;

  -- Ledger-driven: the trg_wallet_tx_apply trigger moves the balance.
  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, method, note)
  values
    (p_user, 'get_wallet', 'topup', p_amount, p_method, 'Top up GET.wallet');

  select * into w from public.wallets
   where user_id = p_user and wallet_type = 'get_wallet';
  return w;
end;
$$;

create or replace function public.wallet_recharge_credit(
  p_user uuid,
  p_amount numeric
)
returns setof public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w_master public.wallets;
  w_credit public.wallets;
begin
  perform public.wallet_assert_caller(p_user);
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_wallet', 0), (p_user, 'get_credit', 0)
  on conflict (user_id, wallet_type) do nothing;

  select * into w_master
    from public.wallets
   where user_id = p_user and wallet_type = 'get_wallet'
   for update;

  if w_master.balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  -- Ledger-driven: the trg_wallet_tx_apply trigger moves both balances.
  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, note)
  values
    (p_user, 'get_wallet', 'recharge_out', -p_amount, 'Recharge GET.credit'),
    (p_user, 'get_credit', 'recharge_in',   p_amount, 'Recharged from GET.wallet');

  select * into w_master from public.wallets
   where user_id = p_user and wallet_type = 'get_wallet';
  select * into w_credit from public.wallets
   where user_id = p_user and wallet_type = 'get_credit';

  return next w_master;
  return next w_credit;
end;
$$;

grant execute on function public.wallet_topup(uuid, numeric, text) to anon, authenticated;
grant execute on function public.wallet_recharge_credit(uuid, numeric) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Commission rates (0058): master default + hierarchical overrides.
-- Resolution priority: user > suburb > city > state > country > master (15%).
-- Managed from Admin -> Settings -> Commission Rates.
-- ----------------------------------------------------------------------------
create table if not exists public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('master','country','state','city','suburb','user')),
  country text,
  state   text,
  city    text,
  suburb  text,
  user_id    uuid,
  user_label text,
  -- Fraction of the fare, e.g. 0.15 = 15%.
  rate numeric(6,4) not null check (rate >= 0 and rate < 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commission_rates_scope_uidx
  on public.commission_rates (
    level,
    coalesce(lower(country), ''),
    coalesce(lower(state), ''),
    coalesce(lower(city), ''),
    coalesce(lower(suburb), ''),
    coalesce(user_id::text, '')
  );

create index if not exists commission_rates_level_idx on public.commission_rates(level);
create index if not exists commission_rates_user_idx  on public.commission_rates(user_id);

do $$
begin
  drop trigger if exists trg_commission_rates_updated_at on public.commission_rates;
  create trigger trg_commission_rates_updated_at before update on public.commission_rates
    for each row execute function public.set_updated_at();
end$$;

alter table public.commission_rates enable row level security;

drop policy if exists "commission_rates read"   on public.commission_rates;
drop policy if exists "commission_rates insert" on public.commission_rates;
drop policy if exists "commission_rates update" on public.commission_rates;
drop policy if exists "commission_rates delete" on public.commission_rates;

create policy "commission_rates read"   on public.commission_rates for select using (true);
create policy "commission_rates insert" on public.commission_rates for insert to public with check (true);
create policy "commission_rates update" on public.commission_rates for update to public using (true) with check (true);
create policy "commission_rates delete" on public.commission_rates for delete to public using (true);

grant select, insert, update, delete on public.commission_rates to anon, authenticated;

-- Server-side rate resolution mirroring the client priority chain.
create or replace function public.commission_resolve_rate(
  p_user uuid default null,
  p_country text default null,
  p_state text default null,
  p_city text default null,
  p_suburb text default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rate numeric;
begin
  if p_user is not null then
    select rate into v_rate from public.commission_rates
     where active and level = 'user' and user_id = p_user
     limit 1;
    if found then return v_rate; end if;
  end if;

  if p_suburb is not null then
    select rate into v_rate from public.commission_rates
     where active and level = 'suburb'
       and lower(suburb) = lower(p_suburb)
       and (city    is null or p_city    is null or lower(city)    = lower(p_city))
       and (state   is null or p_state   is null or lower(state)   = lower(p_state))
       and (country is null or p_country is null or lower(country) = lower(p_country))
     limit 1;
    if found then return v_rate; end if;
  end if;

  if p_city is not null then
    select rate into v_rate from public.commission_rates
     where active and level = 'city'
       and lower(city) = lower(p_city)
       and (state   is null or p_state   is null or lower(state)   = lower(p_state))
       and (country is null or p_country is null or lower(country) = lower(p_country))
     limit 1;
    if found then return v_rate; end if;
  end if;

  if p_state is not null then
    select rate into v_rate from public.commission_rates
     where active and level = 'state'
       and lower(state) = lower(p_state)
       and (country is null or p_country is null or lower(country) = lower(p_country))
     limit 1;
    if found then return v_rate; end if;
  end if;

  if p_country is not null then
    select rate into v_rate from public.commission_rates
     where active and level = 'country'
       and lower(country) = lower(p_country)
     limit 1;
    if found then return v_rate; end if;
  end if;

  select rate into v_rate from public.commission_rates
   where active and level = 'master'
   limit 1;
  if found then return v_rate; end if;

  return 0.15;
end;
$$;

grant execute on function public.commission_resolve_rate(uuid, text, text, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Atomic, idempotent ride-commission charge (0057, updated in 0058): deducts
-- the platform commission from the partner's GET.credit when a trip completes.
-- Locks the ride row; if it was already charged, returns without deducting
-- again. When p_rate is null, the rate is resolved from commission_rates via
-- the ride's stored geography + the partner's user override.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_charge_ride_commission(
  p_ride uuid,
  p_partner uuid,
  p_fare numeric,
  p_rate numeric default null
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ride_requests;
  w public.wallets;
  v_rate numeric;
  v_amount numeric(12,2);
  v_claims text := current_setting('request.jwt.claims', true);
  v_privileged boolean;
begin
  perform public.wallet_assert_caller(p_partner);
  if p_fare is null or p_fare <= 0 then
    raise exception 'invalid_fare';
  end if;

  select * into r from public.ride_requests where id = p_ride for update;
  if not found then
    raise exception 'ride_not_found';
  end if;

  if r.partner_id is not null and r.partner_id <> p_partner then
    raise exception 'not_authorized';
  end if;

  -- Already charged: idempotent no-op.
  if r.commission_charged_at is not null then
    select * into w from public.wallets
     where user_id = p_partner and wallet_type = 'get_credit';
    return w;
  end if;

  -- API callers can't pick their own rate — always resolve server-side
  -- (p_rate is honoured only for service-role / direct DB sessions).
  v_privileged := (v_claims is null or v_claims = '')
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_rate := case when v_privileged then p_rate else null end;
  if v_rate is null then
    v_rate := public.commission_resolve_rate(p_partner, r.country, r.state, r.city, r.suburb);
  end if;
  if v_rate is null or v_rate <= 0 or v_rate >= 1 then
    raise exception 'invalid_rate';
  end if;

  v_amount := round(p_fare * v_rate, 2);

  -- Ledger-driven: the trg_wallet_tx_apply trigger moves the balance.
  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, note)
  values
    (p_partner, 'get_credit', 'commission', -v_amount,
     'Ride commission ' || round(v_rate * 100, 1) || '% of ' ||
     coalesce(r.currency, 'RM') || ' ' || round(p_fare, 2));

  update public.ride_requests
     set commission_rate = v_rate,
         commission_amount = v_amount,
         commission_charged_at = now()
   where id = p_ride;

  select * into w from public.wallets
   where user_id = p_partner and wallet_type = 'get_credit';
  return w;
end;
$$;

grant execute on function public.wallet_charge_ride_commission(uuid, uuid, numeric, numeric)
  to anon, authenticated;

-- ============================================================================
-- GET.coin — third wallet, available to BOTH user and partner mode
-- (migrations/0061_get_coin.sql .. 0065_wallet_transfer_approval.sql, folded in)
-- ----------------------------------------------------------------------------
-- GET.coin balances are denominated in "GC" (Get Coins), not currency. The
-- GC <-> currency exchange rate is set from Admin -> Settings -> Get Coin.
-- Coins are earned as ride rewards, spent on QR payments / fares, traded
-- against GET.wallet, and transferable P2P between accounts.
-- ============================================================================

-- Allow the coin wallet type on both ledger tables (upgrades the inline
-- checks from the original wallets DDL above).
alter table public.wallets
  drop constraint if exists wallets_wallet_type_check;
alter table public.wallets
  add constraint wallets_wallet_type_check
  check (wallet_type in ('get_wallet','get_credit','get_coin'));

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_wallet_type_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_wallet_type_check
  check (wallet_type in ('get_wallet','get_credit','get_coin'));

-- ----------------------------------------------------------------------------
-- Exchange rate + rewards + market settings (single master row)
--   coins_per_currency      : GC per 1 unit of currency (RM). e.g. 10 =>
--                             RM1 = 10 GC, so 1 GC = RM0.10.
--   earn_coins_per_currency : GC earned per RM1 of completed-ride fare
--                             (0 disables ride rewards).
--   market_*                : market-speculated pricing — when enabled, the
--                             coin's RM value floats around the admin peg,
--                             driven by in-app signals (each toggleable).
--   max_supply              : hard cap on total GC in circulation (0 = none).
-- ----------------------------------------------------------------------------
create table if not exists public.get_coin_settings (
  id text primary key default 'master',
  coins_per_currency numeric(12,4) not null default 1 check (coins_per_currency > 0),
  earn_coins_per_currency numeric(12,4) not null default 0,
  market_enabled  boolean       not null default false,
  signal_trading  boolean       not null default true,
  signal_revenue  boolean       not null default true,
  signal_services boolean       not null default true,
  signal_signups  boolean       not null default true,
  signal_minting  boolean       not null default true,
  market_max_swing numeric(6,2) not null default 50,
  max_supply      numeric(18,2) not null default 0,
  currency text not null default 'RM',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Idempotent upgrades for databases created from a pre-0062/0063 snapshot.
alter table public.get_coin_settings
  add column if not exists earn_coins_per_currency numeric(12,4) not null default 0,
  add column if not exists market_enabled  boolean       not null default false,
  add column if not exists signal_trading  boolean       not null default true,
  add column if not exists signal_revenue  boolean       not null default true,
  add column if not exists signal_services boolean       not null default true,
  add column if not exists signal_signups  boolean       not null default true,
  add column if not exists signal_minting  boolean       not null default true,
  add column if not exists market_max_swing numeric(6,2) not null default 50,
  add column if not exists max_supply      numeric(18,2) not null default 0;

alter table public.get_coin_settings
  drop constraint if exists get_coin_settings_earn_rate_check;
alter table public.get_coin_settings
  add constraint get_coin_settings_earn_rate_check
  check (earn_coins_per_currency >= 0);

alter table public.get_coin_settings
  drop constraint if exists get_coin_settings_swing_check;
alter table public.get_coin_settings
  add constraint get_coin_settings_swing_check
  check (market_max_swing >= 0 and market_max_swing <= 95);

alter table public.get_coin_settings
  drop constraint if exists get_coin_settings_supply_check;
alter table public.get_coin_settings
  add constraint get_coin_settings_supply_check
  check (max_supply >= 0);

insert into public.get_coin_settings (id, coins_per_currency)
values ('master', 1)
on conflict (id) do nothing;

do $$
begin
  drop trigger if exists trg_get_coin_settings_updated_at on public.get_coin_settings;
  create trigger trg_get_coin_settings_updated_at before update on public.get_coin_settings
    for each row execute function public.set_updated_at();
end$$;

alter table public.get_coin_settings enable row level security;

drop policy if exists "get_coin_settings read"   on public.get_coin_settings;
drop policy if exists "get_coin_settings insert" on public.get_coin_settings;
drop policy if exists "get_coin_settings update" on public.get_coin_settings;

create policy "get_coin_settings read"   on public.get_coin_settings for select using (true);
create policy "get_coin_settings insert" on public.get_coin_settings for insert to public with check (true);
create policy "get_coin_settings update" on public.get_coin_settings for update to public using (true) with check (true);

grant select, insert, update on public.get_coin_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Ride rewards (0062): idempotent per-ride GC reward, anchored on
-- ride_requests.coin_rewarded_at so a ride can never be rewarded twice.
-- ----------------------------------------------------------------------------
alter table public.ride_requests
  add column if not exists coin_rewarded_at timestamptz;

create or replace function public.wallet_award_ride_coins(
  p_ride uuid,
  p_user uuid,
  p_fare numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ride_requests;
  v_rate numeric;
  v_coins numeric;
begin
  perform public.wallet_assert_caller(p_user);
  if p_fare is null or p_fare <= 0 or p_fare > 10000 then
    return 0;
  end if;

  select earn_coins_per_currency into v_rate
  from public.get_coin_settings
  where id = 'master';

  if v_rate is null or v_rate <= 0 then
    return 0;
  end if;

  -- Only the ride's rider can claim, only for a completed ride, only once.
  select * into r from public.ride_requests where id = p_ride for update;
  if not found then
    return 0;
  end if;
  if r.status <> 'completed' then
    return 0;
  end if;
  if r.rider_id is not null and r.rider_id <> p_user then
    raise exception 'not_authorized';
  end if;
  if r.coin_rewarded_at is not null then
    return 0;
  end if;

  v_coins := round(p_fare * v_rate, 2);
  if v_coins <= 0 then
    return 0;
  end if;

  update public.ride_requests
  set coin_rewarded_at = now()
  where id = p_ride;

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  insert into public.wallet_transactions (user_id, wallet_type, kind, amount, note)
  values (p_user, 'get_coin', 'reward', v_coins, 'Ride reward');

  return v_coins;
end;
$$;

grant execute on function public.wallet_award_ride_coins(uuid, uuid, numeric) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Owner-scoped spending RPCs (0066) — replace the client's direct ledger
-- inserts for QR payments, ride-fare coin redemption and coin trading.
-- ----------------------------------------------------------------------------
alter table public.ride_requests
  add column if not exists fare_coins_redeemed_at timestamptz;

-- QR payment from GET.wallet, optionally redeeming GET.coin first (coins
-- cover what they can at the admin rate, GET.wallet pays the rest).
create or replace function public.wallet_pay(
  p_user uuid,
  p_amount numeric,
  p_note text default null,
  p_method text default 'qr_scan',
  p_redeem_coins boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_rate numeric := 0;
  v_coin_balance numeric := 0;
  v_wallet_balance numeric;
  v_max_coin_value numeric := 0;
  v_coin_value numeric := 0;
  v_coins_used numeric := 0;
  v_wallet_share numeric;
begin
  perform public.wallet_assert_caller(p_user);
  if v_amount <= 0 or v_amount > 100000 then
    raise exception 'invalid_amount';
  end if;

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_wallet', 0), (p_user, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  if coalesce(p_redeem_coins, false) then
    select coins_per_currency into v_rate
    from public.get_coin_settings where id = 'master';

    if coalesce(v_rate, 0) > 0 then
      select balance into v_coin_balance
      from public.wallets
      where user_id = p_user and wallet_type = 'get_coin'
      for update;
      v_coin_balance := coalesce(v_coin_balance, 0);

      if v_coin_balance > 0 then
        v_max_coin_value := floor((v_coin_balance / v_rate) * 100) / 100;
        v_coin_value := least(v_max_coin_value, v_amount);
        v_coins_used := round(v_coin_value * v_rate, 2);
      end if;
    end if;
  end if;

  v_wallet_share := round(v_amount - v_coin_value, 2);

  select balance into v_wallet_balance
  from public.wallets
  where user_id = p_user and wallet_type = 'get_wallet'
  for update;

  if coalesce(v_wallet_balance, 0) < v_wallet_share then
    raise exception 'insufficient_balance';
  end if;

  if v_coins_used > 0 then
    insert into public.wallet_transactions
      (user_id, wallet_type, kind, amount, method, note)
    values
      (p_user, 'get_coin', 'redeem', -v_coins_used, p_method,
       coalesce(p_note, 'Payment') || ' — paid with coins (RM' ||
       to_char(v_coin_value, 'FM999999990.00') || ')');
  end if;

  if v_wallet_share > 0 then
    insert into public.wallet_transactions
      (user_id, wallet_type, kind, amount, method, note)
    values
      (p_user, 'get_wallet', 'payment', -v_wallet_share, p_method, p_note);
  end if;

  return jsonb_build_object(
    'coins_used', v_coins_used,
    'coin_value', v_coin_value,
    'wallet_paid', v_wallet_share
  );
end;
$$;

-- Redeem GET.coin towards a ride fare. Idempotent per ride via
-- ride_requests.fare_coins_redeemed_at (simulated rides pass p_ride = null
-- and rely on the client-side guard).
create or replace function public.wallet_redeem_fare_coins(
  p_user uuid,
  p_fare numeric,
  p_ride uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ride_requests;
  v_fare numeric := round(coalesce(p_fare, 0), 2);
  v_rate numeric;
  v_coin_balance numeric := 0;
  v_max_coin_value numeric := 0;
  v_coin_value numeric := 0;
  v_coins_used numeric := 0;
begin
  perform public.wallet_assert_caller(p_user);
  if v_fare <= 0 or v_fare > 10000 then
    raise exception 'invalid_amount';
  end if;

  select coins_per_currency into v_rate
  from public.get_coin_settings where id = 'master';
  if coalesce(v_rate, 0) <= 0 then
    return jsonb_build_object('coins_used', 0, 'coin_value', 0);
  end if;

  if p_ride is not null then
    select * into r from public.ride_requests where id = p_ride for update;
    if found then
      if r.rider_id is not null and r.rider_id <> p_user then
        raise exception 'not_authorized';
      end if;
      if r.fare_coins_redeemed_at is not null then
        return jsonb_build_object('coins_used', 0, 'coin_value', 0);
      end if;
      update public.ride_requests
         set fare_coins_redeemed_at = now()
       where id = p_ride;
    end if;
  end if;

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  select balance into v_coin_balance
  from public.wallets
  where user_id = p_user and wallet_type = 'get_coin'
  for update;
  v_coin_balance := coalesce(v_coin_balance, 0);

  if v_coin_balance > 0 then
    v_max_coin_value := floor((v_coin_balance / v_rate) * 100) / 100;
    v_coin_value := least(v_max_coin_value, v_fare);
    v_coins_used := round(v_coin_value * v_rate, 2);
  end if;

  if v_coins_used <= 0 then
    return jsonb_build_object('coins_used', 0, 'coin_value', 0);
  end if;

  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, method, note)
  values
    (p_user, 'get_coin', 'redeem', -v_coins_used, 'ride_fare',
     'Ride fare — RM' || to_char(v_coin_value, 'FM999999990.00') || ' paid with coins');

  return jsonb_build_object('coins_used', v_coins_used, 'coin_value', v_coin_value);
end;
$$;

-- Buy GC with GET.wallet / sell GC back. The rate is anchored server-side to
-- the admin peg (clamped to the market swing band when market pricing is on)
-- and the supply cap is enforced on buys.
create or replace function public.wallet_trade_coins(
  p_user uuid,
  p_direction text,
  p_coins numeric,
  p_rate_per_gc numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins numeric := round(coalesce(p_coins, 0), 2);
  v_peg numeric;
  v_rate numeric;
  v_amount numeric;
  v_swing numeric;
  v_market boolean;
  v_max_supply numeric;
  v_circulating numeric;
  v_balance numeric;
  v_rate_note text;
begin
  perform public.wallet_assert_caller(p_user);
  if v_coins <= 0 or v_coins > 1000000 then
    raise exception 'invalid_amount';
  end if;
  if p_direction not in ('buy', 'sell') then
    raise exception 'invalid_direction';
  end if;

  select
    case when coins_per_currency > 0 then 1 / coins_per_currency else 0 end,
    market_enabled,
    coalesce(market_max_swing, 0),
    coalesce(max_supply, 0)
  into v_peg, v_market, v_swing, v_max_supply
  from public.get_coin_settings where id = 'master';

  if coalesce(v_peg, 0) <= 0 then
    raise exception 'rate_unavailable';
  end if;

  if coalesce(v_market, false) and coalesce(p_rate_per_gc, 0) > 0 then
    v_rate := least(
      greatest(p_rate_per_gc, v_peg * (1 - v_swing / 100)),
      v_peg * (1 + v_swing / 100)
    );
  else
    v_rate := v_peg;
  end if;

  v_amount := round(v_coins * v_rate, 2);
  if v_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  v_rate_note := 'RM' || to_char(round(v_rate, 4), 'FM999999990.0000') || '/GC';

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_wallet', 0), (p_user, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  if p_direction = 'buy' then
    if v_max_supply > 0 then
      select coalesce(sum(balance), 0) into v_circulating
      from public.wallets where wallet_type = 'get_coin';
      if v_circulating + v_coins > v_max_supply then
        raise exception 'supply_cap_reached';
      end if;
    end if;

    select balance into v_balance
    from public.wallets
    where user_id = p_user and wallet_type = 'get_wallet'
    for update;
    if coalesce(v_balance, 0) < v_amount then
      raise exception 'insufficient_balance';
    end if;

    insert into public.wallet_transactions
      (user_id, wallet_type, kind, amount, method, note)
    values
      (p_user, 'get_wallet', 'payment', -v_amount, 'coin_trade',
       'Bought ' || v_coins || ' GC @ ' || v_rate_note),
      (p_user, 'get_coin', 'topup', v_coins, 'trade_buy',
       'Bought @ ' || v_rate_note);
  else
    select balance into v_balance
    from public.wallets
    where user_id = p_user and wallet_type = 'get_coin'
    for update;
    if coalesce(v_balance, 0) < v_coins then
      raise exception 'insufficient_coins';
    end if;

    insert into public.wallet_transactions
      (user_id, wallet_type, kind, amount, method, note)
    values
      (p_user, 'get_coin', 'redeem', -v_coins, 'trade_sell',
       'Sold @ ' || v_rate_note),
      (p_user, 'get_wallet', 'topup', v_amount, 'coin_trade',
       'Sold ' || v_coins || ' GC @ ' || v_rate_note);
  end if;

  return jsonb_build_object(
    'coins', v_coins,
    'amount_currency', v_amount,
    'rate_per_gc', v_rate
  );
end;
$$;

grant execute on function public.wallet_pay(uuid, numeric, text, text, boolean) to anon, authenticated;
grant execute on function public.wallet_redeem_fare_coins(uuid, numeric, uuid) to anon, authenticated;
grant execute on function public.wallet_trade_coins(uuid, text, numeric, numeric) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Rate history (0063): snapshots of the effective RM value of 1 GC, for the
-- trade screen's price chart. Clients insert at most one point per ~15 min.
-- ----------------------------------------------------------------------------
create table if not exists public.get_coin_rate_history (
  id uuid primary key default gen_random_uuid(),
  rate_per_gc numeric(14,6) not null check (rate_per_gc > 0),
  recorded_at timestamptz not null default now()
);

create index if not exists get_coin_rate_history_time_idx
  on public.get_coin_rate_history(recorded_at desc);

alter table public.get_coin_rate_history enable row level security;

drop policy if exists "coin rate history read"   on public.get_coin_rate_history;
drop policy if exists "coin rate history insert" on public.get_coin_rate_history;

create policy "coin rate history read"   on public.get_coin_rate_history for select using (true);
create policy "coin rate history insert" on public.get_coin_rate_history for insert to public with check (true);

grant select, insert on public.get_coin_rate_history to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Market stats (0063, updated by 0064): one security-definer RPC returning
-- every pricing signal over a 30-day window plus circulating supply, so
-- clients never need broad table read access. P2P transfers are excluded from
-- the "minted" signal — they only move coins already in circulation.
-- ----------------------------------------------------------------------------
create or replace function public.get_coin_market_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since    timestamptz := now() - interval '30 days';
  v_buy      numeric := 0;
  v_sell     numeric := 0;
  v_revenue  numeric := 0;
  v_services bigint  := 0;
  v_signups  bigint  := 0;
  v_minted   numeric := 0;
  v_supply   numeric := 0;
begin
  -- GC bought / sold through trading (30d)
  select coalesce(sum(amount), 0) into v_buy
  from public.wallet_transactions
  where wallet_type = 'get_coin' and method = 'trade_buy'
    and amount > 0 and created_at >= v_since;

  select coalesce(sum(-amount), 0) into v_sell
  from public.wallet_transactions
  where wallet_type = 'get_coin' and method = 'trade_sell'
    and amount < 0 and created_at >= v_since;

  -- App revenue from commissions charged to partners (30d)
  select coalesce(sum(-amount), 0) into v_revenue
  from public.wallet_transactions
  where wallet_type = 'get_credit' and kind = 'commission'
    and amount < 0 and created_at >= v_since;

  -- Completed services (30d)
  select count(*) into v_services
  from public.ride_requests
  where status = 'completed' and created_at >= v_since;

  -- New sign-ups: users + partners (30d)
  select
    (select count(*) from public.profiles where created_at >= v_since)
    + (select count(*) from public.partners where created_at >= v_since)
  into v_signups;

  -- New coins generated (rewards, admin grants, purchases) (30d) —
  -- p2p transfers move existing coins, so they don't count as minting.
  select coalesce(sum(amount), 0) into v_minted
  from public.wallet_transactions
  where wallet_type = 'get_coin' and amount > 0
    and coalesce(method, '') <> 'p2p_transfer'
    and created_at >= v_since;

  -- Total GC in circulation right now
  select coalesce(sum(balance), 0) into v_supply
  from public.wallets
  where wallet_type = 'get_coin';

  return jsonb_build_object(
    'trade_buy_gc',        v_buy,
    'trade_sell_gc',       v_sell,
    'commission_revenue',  v_revenue,
    'completed_services',  v_services,
    'new_signups',         v_signups,
    'minted_gc',           v_minted,
    'circulating_supply',  v_supply
  );
end;
$$;

grant execute on function public.get_coin_market_stats() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- P2P transfers (0064): send GC straight to another account (user or
-- partner). Transfers move existing coins 1:1 — nothing is minted or burned.
-- Recipients are addressed by account id (scanned getpay:// QR) or by phone
-- number, resolved server-side (profiles are RLS-protected, so the client
-- cannot look other users up itself). The sender's wallet row is locked so
-- concurrent transfers can't overdraw it.
-- ----------------------------------------------------------------------------
create or replace function public.wallet_transfer_coins(
  p_from uuid,
  p_coins numeric,
  p_to uuid default null,
  p_to_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins     numeric := round(coalesce(p_coins, 0), 2);
  v_to        uuid    := p_to;
  v_to_name   text;
  v_from_name text;
  v_digits    text;
  v_balance   numeric;
  v_after     numeric;
  v_suffix    text := coalesce(' — ' || nullif(trim(p_note), ''), '');
begin
  perform public.wallet_assert_caller(p_from);
  if v_coins <= 0 or v_coins > 1000000 then
    raise exception 'invalid_amount';
  end if;

  if v_to is not null then
    select coalesce(name, '') into v_to_name from public.profiles where id = v_to;
    if not found then
      select coalesce(name, '') into v_to_name from public.partners where id = v_to;
      if not found then
        raise exception 'recipient_not_found';
      end if;
    end if;
  else
    -- Resolve by phone: compare digits only, so "+60 12-345 6789" and
    -- "0123456789" line up; fall back to matching the last 9 digits to
    -- bridge country-code prefixes.
    v_digits := regexp_replace(coalesce(p_to_phone, ''), '\D', '', 'g');
    if length(v_digits) < 7 then
      raise exception 'recipient_not_found';
    end if;

    select id, coalesce(name, '') into v_to, v_to_name
    from public.profiles
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
       or (length(v_digits) >= 9
           and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))
    order by created_at
    limit 1;

    if v_to is null then
      select id, coalesce(name, '') into v_to, v_to_name
      from public.partners
      where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
         or (length(v_digits) >= 9
             and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))
      order by created_at
      limit 1;
    end if;

    if v_to is null then
      raise exception 'recipient_not_found';
    end if;
  end if;

  if v_to = p_from then
    raise exception 'self_transfer';
  end if;

  select coalesce(name, '') into v_from_name from public.profiles where id = p_from;
  if not found then
    select coalesce(name, '') into v_from_name from public.partners where id = p_from;
  end if;

  -- Lock the sender's coin wallet so concurrent transfers serialise.
  insert into public.wallets (user_id, wallet_type, balance)
  values (p_from, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  select balance into v_balance
  from public.wallets
  where user_id = p_from and wallet_type = 'get_coin'
  for update;

  if v_balance is null or v_balance < v_coins then
    raise exception 'insufficient_coins';
  end if;

  -- Ledger-driven: the trg_wallet_tx_apply trigger moves both balances.
  insert into public.wallet_transactions (user_id, wallet_type, kind, amount, method, note)
  values
    (p_from, 'get_coin', 'transfer_out', -v_coins, 'p2p_transfer',
     'Sent to ' || coalesce(nullif(v_to_name, ''), 'user') || v_suffix),
    (v_to, 'get_coin', 'transfer_in', v_coins, 'p2p_transfer',
     'Received from ' || coalesce(nullif(v_from_name, ''), 'user') || v_suffix);

  select balance into v_after
  from public.wallets
  where user_id = p_from and wallet_type = 'get_coin';

  return jsonb_build_object(
    'coins',          v_coins,
    'recipient_id',   v_to,
    'recipient_name', nullif(v_to_name, ''),
    'balance_after',  v_after
  );
end;
$$;

grant execute on function public.wallet_transfer_coins(uuid, numeric, uuid, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Transfer approval (0065): sending coins is a two-step handshake. The sender
-- creates a *pending* wallet_transfer_requests row (recipient resolved by id
-- or phone, soft balance check); the recipient gets a popup naming the sender
-- and the amount and accepts or declines. Coins only move on acceptance —
-- same ledger rows as the instant transfer above. Requests expire after 15
-- minutes and can be cancelled by the sender while pending. The push webhook
-- triggers (pg_net + Vault) live in migrations/0065_wallet_transfer_approval.sql.
--
-- State machine: pending -> accepted | declined | cancelled | expired | failed
-- ('failed' = sender no longer had enough coins at acceptance time).
-- ----------------------------------------------------------------------------
create table if not exists public.wallet_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null,
  from_name text,
  to_user_id uuid not null,
  to_name text,
  -- GC being sent (locked in at request time).
  coins numeric(12,2) not null check (coins > 0),
  note text,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled','expired','failed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index if not exists wallet_transfer_requests_to_idx
  on public.wallet_transfer_requests(to_user_id, status, created_at desc);
create index if not exists wallet_transfer_requests_from_idx
  on public.wallet_transfer_requests(from_user_id, created_at desc);

alter table public.wallet_transfer_requests enable row level security;

-- Both parties watch rows over realtime; all writes go through the
-- security-definer RPCs below, so no insert/update policies are exposed.
drop policy if exists "wallet_transfer_requests read" on public.wallet_transfer_requests;
create policy "wallet_transfer_requests read"
  on public.wallet_transfer_requests for select using (true);

grant select on public.wallet_transfer_requests to anon, authenticated;

alter table public.wallet_transfer_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.wallet_transfer_requests;
exception
  when duplicate_object then null;
end$$;

-- Step 1 — sender creates a pending transfer request.
create or replace function public.wallet_request_coin_transfer(
  p_from uuid,
  p_coins numeric,
  p_to uuid default null,
  p_to_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins     numeric := round(coalesce(p_coins, 0), 2);
  v_to        uuid    := p_to;
  v_to_name   text;
  v_from_name text;
  v_digits    text;
  v_balance   numeric;
  v_request   public.wallet_transfer_requests;
begin
  perform public.wallet_assert_caller(p_from);
  if v_coins <= 0 or v_coins > 1000000 then
    raise exception 'invalid_amount';
  end if;

  if v_to is not null then
    select coalesce(name, '') into v_to_name from public.profiles where id = v_to;
    if not found then
      select coalesce(name, '') into v_to_name from public.partners where id = v_to;
      if not found then
        raise exception 'recipient_not_found';
      end if;
    end if;
  else
    v_digits := regexp_replace(coalesce(p_to_phone, ''), '\D', '', 'g');
    if length(v_digits) < 7 then
      raise exception 'recipient_not_found';
    end if;

    select id, coalesce(name, '') into v_to, v_to_name
    from public.profiles
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
       or (length(v_digits) >= 9
           and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))
    order by created_at
    limit 1;

    if v_to is null then
      select id, coalesce(name, '') into v_to, v_to_name
      from public.partners
      where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits
         or (length(v_digits) >= 9
             and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))
      order by created_at
      limit 1;
    end if;

    if v_to is null then
      raise exception 'recipient_not_found';
    end if;
  end if;

  if v_to = p_from then
    raise exception 'self_transfer';
  end if;

  select coalesce(name, '') into v_from_name from public.profiles where id = p_from;
  if not found then
    select coalesce(name, '') into v_from_name from public.partners where id = p_from;
  end if;

  -- Soft balance check so obviously unfunded requests never reach the
  -- recipient. The authoritative check re-runs at acceptance time.
  select balance into v_balance
  from public.wallets
  where user_id = p_from and wallet_type = 'get_coin';

  if v_balance is null or v_balance < v_coins then
    raise exception 'insufficient_coins';
  end if;

  insert into public.wallet_transfer_requests
    (from_user_id, from_name, to_user_id, to_name, coins, note)
  values
    (p_from, nullif(v_from_name, ''), v_to, nullif(v_to_name, ''), v_coins,
     nullif(trim(coalesce(p_note, '')), ''))
  returning * into v_request;

  return jsonb_build_object(
    'request_id',     v_request.id,
    'recipient_id',   v_to,
    'recipient_name', nullif(v_to_name, ''),
    'coins',          v_coins,
    'expires_at',     v_request.expires_at
  );
end;
$$;

grant execute on function public.wallet_request_coin_transfer(uuid, numeric, uuid, text, text)
  to anon, authenticated;

-- Step 2 — recipient accepts or declines. Returns the resulting status
-- ('accepted' | 'declined' | 'expired' | 'failed') rather than raising, so
-- the status write always commits.
create or replace function public.wallet_respond_coin_transfer(
  p_request uuid,
  p_user uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.wallet_transfer_requests;
  v_balance numeric;
  v_suffix  text;
begin
  perform public.wallet_assert_caller(p_user);
  if p_request is null then
    raise exception 'invalid_user';
  end if;

  select * into r
  from public.wallet_transfer_requests
  where id = p_request
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;
  if r.to_user_id <> p_user then
    raise exception 'not_recipient';
  end if;
  if r.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  if now() > r.expires_at then
    update public.wallet_transfer_requests
       set status = 'expired', responded_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'expired', 'coins', r.coins,
                              'from_name', r.from_name, 'to_name', r.to_name);
  end if;

  if not p_accept then
    update public.wallet_transfer_requests
       set status = 'declined', responded_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'declined', 'coins', r.coins,
                              'from_name', r.from_name, 'to_name', r.to_name);
  end if;

  -- Lock the sender's coin wallet so concurrent transfers serialise.
  insert into public.wallets (user_id, wallet_type, balance)
  values (r.from_user_id, 'get_coin', 0)
  on conflict (user_id, wallet_type) do nothing;

  select balance into v_balance
  from public.wallets
  where user_id = r.from_user_id and wallet_type = 'get_coin'
  for update;

  if v_balance is null or v_balance < r.coins then
    update public.wallet_transfer_requests
       set status = 'failed', responded_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'failed', 'coins', r.coins,
                              'from_name', r.from_name, 'to_name', r.to_name);
  end if;

  v_suffix := coalesce(' — ' || r.note, '');

  -- Ledger-driven: the trg_wallet_tx_apply trigger moves both balances.
  insert into public.wallet_transactions (user_id, wallet_type, kind, amount, method, note)
  values
    (r.from_user_id, 'get_coin', 'transfer_out', -r.coins, 'p2p_transfer',
     'Sent to ' || coalesce(r.to_name, 'user') || v_suffix),
    (r.to_user_id, 'get_coin', 'transfer_in', r.coins, 'p2p_transfer',
     'Received from ' || coalesce(r.from_name, 'user') || v_suffix);

  update public.wallet_transfer_requests
     set status = 'accepted', responded_at = now()
   where id = r.id;

  return jsonb_build_object('status', 'accepted', 'coins', r.coins,
                            'from_name', r.from_name, 'to_name', r.to_name);
end;
$$;

grant execute on function public.wallet_respond_coin_transfer(uuid, uuid, boolean)
  to anon, authenticated;

-- Sender cancels their own pending request.
create or replace function public.wallet_cancel_transfer_request(
  p_request uuid,
  p_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.wallet_assert_caller(p_user);
  update public.wallet_transfer_requests
     set status = 'cancelled', responded_at = now()
   where id = p_request and from_user_id = p_user and status = 'pending';
  return found;
end;
$$;

grant execute on function public.wallet_cancel_transfer_request(uuid, uuid)
  to anon, authenticated;

-- ============================================================================
-- Referral program (migrations/0078_referrals.sql, 0079_referrer_name_rpc.sql)
-- ----------------------------------------------------------------------------
-- Invite friends, both earn bonus GET.coin. apply_referral() is called by the
-- NEW user right after signup; get_my_referrer() lets that user learn who
-- invited them (for the profile "Referred" badge) without widening the
-- self-read RLS on public.profiles.
-- ============================================================================

alter table public.get_coin_settings
  add column if not exists referral_enabled boolean not null default true,
  add column if not exists referral_referrer_coins numeric(12,2) not null default 0,
  add column if not exists referral_referred_coins numeric(12,2) not null default 0;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  referrer_coins numeric(12,2) not null default 0,
  referred_coins numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (referred_user_id),
  check (referrer_user_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_user_id);

alter table public.referrals enable row level security;

drop policy if exists "referrals select own" on public.referrals;
create policy "referrals select own" on public.referrals
  for select to authenticated
  using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

-- Apply a referral code (called by the new user right after signup).
create or replace function public.apply_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_referrer uuid;
  v_enabled boolean := true;
  v_referrer_coins numeric := 0;
  v_referred_coins numeric := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if length(v_code) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select coalesce(referral_enabled, true),
         coalesce(referral_referrer_coins, 0),
         coalesce(referral_referred_coins, 0)
    into v_enabled, v_referrer_coins, v_referred_coins
    from public.get_coin_settings
   where id = 'master';

  if not coalesce(v_enabled, true) then
    return jsonb_build_object('ok', false, 'error', 'disabled');
  end if;

  select id into v_referrer
    from public.profiles
   where upper(coalesce(referral_code, '')) = v_code
   limit 1;
  if v_referrer is null then
    select id into v_referrer
      from public.profiles
     where upper(replace(id::text, '-', '')) like v_code || '%'
     limit 1;
  end if;

  if v_referrer is null then
    return jsonb_build_object('ok', false, 'error', 'code_not_found');
  end if;
  if v_referrer = v_user then
    return jsonb_build_object('ok', false, 'error', 'self_referral');
  end if;
  if exists (select 1 from public.referrals where referred_user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'already_referred');
  end if;

  insert into public.referrals
    (referrer_user_id, referred_user_id, code, referrer_coins, referred_coins)
  values
    (v_referrer, v_user, v_code, v_referrer_coins, v_referred_coins);

  if v_referrer_coins > 0 then
    insert into public.wallet_transactions (user_id, wallet_type, kind, amount, method, note)
    values (v_referrer, 'get_coin', 'referral', v_referrer_coins, 'referral', 'Referral bonus — a friend joined with your link');
  end if;
  if v_referred_coins > 0 then
    insert into public.wallet_transactions (user_id, wallet_type, kind, amount, method, note)
    values (v_user, 'get_coin', 'referral', v_referred_coins, 'referral', 'Welcome bonus — joined with a referral link');
  end if;

  return jsonb_build_object(
    'ok', true,
    'referrer_coins', v_referrer_coins,
    'referred_coins', v_referred_coins
  );
end;
$$;

grant execute on function public.apply_referral(text) to authenticated;

-- Who invited the signed-in user (name + code), for the profile badge.
create or replace function public.get_my_referrer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_code text;
  v_created timestamptz;
begin
  if v_user is null then
    return null;
  end if;

  select p.name, r.code, r.created_at
    into v_name, v_code, v_created
    from public.referrals r
    join public.profiles p on p.id = r.referrer_user_id
   where r.referred_user_id = v_user
   limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'name', nullif(trim(coalesce(v_name, '')), ''),
    'code', v_code,
    'created_at', v_created
  );
end;
$$;

grant execute on function public.get_my_referrer() to authenticated;

-- ============================================================================
-- MCash schema groundwork
-- (migrations/0068_mcash_wallet_columns.sql, folded in)
-- ----------------------------------------------------------------------------
-- GET.wallet is planned to be re-based onto the MCash e-money platform
-- (docs/get-wallet-mcash-flow.md): MCash becomes the custodian and ledger of
-- record, the Supabase ledger a read-side mirror written by the future
-- `mcash-proxy` edge function. Columns only — no behavior changes until the
-- proxy ships.
-- ============================================================================

-- Profile <-> MCash identity. All nullable: a null mcash_wallet_id simply
-- means the account has not been provisioned on MCash yet.
alter table public.profiles
  add column if not exists mcash_wallet_id text,
  add column if not exists mcash_ekyc_status text,
  add column if not exists mcash_customer_status text;

alter table public.profiles
  drop constraint if exists profiles_mcash_ekyc_status_check;
alter table public.profiles
  add constraint profiles_mcash_ekyc_status_check
  check (mcash_ekyc_status in
    ('never_submit','pending_screening','pending_review','approved',
     'rejected','on_hold','next_screening_due'));

alter table public.profiles
  drop constraint if exists profiles_mcash_customer_status_check;
alter table public.profiles
  add constraint profiles_mcash_customer_status_check
  check (mcash_customer_status in
    ('active','inactive','partial_blocked','blacklisted','terminated'));

-- One MCash wallet per profile; MCash webhooks/reconciliation resolve the
-- profile by wallet id.
create unique index if not exists profiles_mcash_wallet_id_key
  on public.profiles(mcash_wallet_id) where mcash_wallet_id is not null;

-- Mirror-ledger columns: FPX reloads settle asynchronously, so mirrored rows
-- can sit at pending/processing until MCash acknowledges. Every pre-MCash row
-- is final — hence the 'success' default. mcash_ref carries MCash's
-- transaction reference for reconciliation.
--
-- Note: the 0060 balance trigger still applies every row to wallets.balance
-- regardless of status. That stays correct today because nothing writes
-- non-success rows yet; the mcash-proxy work reworks the trigger when
-- pending mirror rows start to exist.
alter table public.wallet_transactions
  add column if not exists status text not null default 'success',
  add column if not exists mcash_ref text;

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_status_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_status_check
  check (status in ('success','failed','pending','processing','paused','cancelled'));

create index if not exists wallet_tx_mcash_ref_idx
  on public.wallet_transactions(mcash_ref) where mcash_ref is not null;

-- ============================================================================
-- 0069: RLS lockdown (folded in — keep this the LAST section so it overrides
-- the permissive policies created above; see migrations/0069_rls_lockdown.sql
-- for the full rationale). Idempotent: generic drops precede every create.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: privileged-caller check.
-- ----------------------------------------------------------------------------
create or replace function public.caller_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_claims is null or v_claims = '' then
    return true; -- direct database session (setup scripts, psql, triggers)
  end if;
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return true;
  end if;
  if auth.uid() is null then
    return false;
  end if;
  if to_regclass('public.admin_access') is null then
    return false;
  end if;
  return exists (
    select 1 from public.admin_access where profile_id = auth.uid()
  );
end;
$$;

grant execute on function public.caller_is_admin() to anon, authenticated;

-- ============================================================================
-- Part 1 — admin_access: close the privilege-escalation hole (0010)
-- ============================================================================
do $admin_access$
begin
  if to_regclass('public.admin_access') is null then return; end if;

  drop policy if exists "admin_access public read"   on public.admin_access;
  drop policy if exists "admin_access public insert" on public.admin_access;
  drop policy if exists "admin_access public update" on public.admin_access;
  drop policy if exists "admin_access public delete" on public.admin_access;

  drop policy if exists "admin_access self read"          on public.admin_access;
  drop policy if exists "admin_access admin read"         on public.admin_access;
  drop policy if exists "admin_access admin write insert" on public.admin_access;
  drop policy if exists "admin_access admin write update" on public.admin_access;
  drop policy if exists "admin_access admin write delete" on public.admin_access;

  create policy "admin_access self read"
    on public.admin_access for select
    using (profile_id = auth.uid());

  -- Any admin can see the roster (the sub-admin screen lists all rows).
  create policy "admin_access admin read"
    on public.admin_access for select
    using (public.caller_is_admin());

  create policy "admin_access admin write insert"
    on public.admin_access for insert
    with check (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

  create policy "admin_access admin write update"
    on public.admin_access for update
    using (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));

  create policy "admin_access admin write delete"
    on public.admin_access for delete
    using (public.admin_can_edit(auth.uid(), 'admin-settings-sub-admin'));
end;
$admin_access$;

-- First-run bootstrap: on an EMPTY admin_access table the first authenticated
-- caller becomes the wildcard admin. Once any row exists this is a no-op, so
-- it cannot be used for escalation. (Replaces 0010's public write policies.)
create or replace function public.admin_access_bootstrap()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if exists (select 1 from public.admin_access) then
    return false;
  end if;
  insert into public.admin_access (profile_id, page, access_level, notes)
  values (auth.uid(), '*', 'edit', 'bootstrap: first admin');
  return true;
end;
$$;

grant execute on function public.admin_access_bootstrap() to anon, authenticated;

-- Support-agent roster for the in-app support flow. Regular users used to
-- read admin_access (+ joined profiles) directly; this returns only the
-- fields the support screen needs.
create or replace function public.support_agents()
returns table (profile_id uuid, name text, avatar_url text, priority integer)
language sql
stable
security definer
set search_path = public
as $$
  select aa.profile_id,
         coalesce(nullif(p.name, ''), nullif(p.phone, ''), 'Agent') as name,
         coalesce(nullif(p.avatar_url, ''), nullif(p.profile_image, '')) as avatar_url,
         min(aa.support) as priority
    from public.admin_access aa
    join public.profiles p on p.id = aa.profile_id
   group by aa.profile_id, p.name, p.phone, p.avatar_url, p.profile_image;
$$;

grant execute on function public.support_agents() to anon, authenticated;

-- ============================================================================
-- Part 2 — ride_requests: participant-scoped dispatch
-- ============================================================================
-- Write shapes these policies must keep working (see rideRequestsStore.ts):
--   * rider inserts an `open` request with rider_id = their own uid;
--   * partners claim/offer on OPEN rows, always stamping partner_id = self
--     in the same update (`acceptRideRequest` / `submitRideOffer`);
--   * the rider raises the fare on their own open row (clears partner_id);
--   * both participants progress/cancel their own row and publish live GPS;
--   * the rider expires their own stale open rows.
do $ride_requests$
begin
  if to_regclass('public.ride_requests') is null then return; end if;

  drop policy if exists "ride_requests read"   on public.ride_requests;
  drop policy if exists "ride_requests insert" on public.ride_requests;
  drop policy if exists "ride_requests update" on public.ride_requests;
  drop policy if exists "ride_requests delete" on public.ride_requests;
  drop policy if exists "ride_requests rider insert"       on public.ride_requests;
  drop policy if exists "ride_requests participant update" on public.ride_requests;
  drop policy if exists "ride_requests claim open"         on public.ride_requests;
  drop policy if exists "ride_requests admin delete"       on public.ride_requests;

  -- Open requests stay visible to everyone (the partner queue, including
  -- legacy anon sessions, needs them). Active/finished rides — which carry
  -- both parties' phone numbers and live GPS — are participant/admin only.
  create policy "ride_requests read"
    on public.ride_requests for select
    using (
      status = 'open'
      or rider_id = auth.uid()
      or partner_id = auth.uid()
      or public.caller_is_admin()
    );

  create policy "ride_requests rider insert"
    on public.ride_requests for insert to public
    with check (
      (auth.uid() is not null and rider_id = auth.uid())
      or public.caller_is_admin()
    );

  create policy "ride_requests participant update"
    on public.ride_requests for update to public
    using (
      rider_id = auth.uid()
      or partner_id = auth.uid()
      or public.caller_is_admin()
    )
    with check (
      rider_id = auth.uid()
      or partner_id = auth.uid()
      or public.caller_is_admin()
    );

  -- Claiming / offering: any authenticated partner may write to an OPEN row,
  -- but the new row must carry their own partner_id.
  create policy "ride_requests claim open"
    on public.ride_requests for update to public
    using (status = 'open' and auth.uid() is not null)
    with check (partner_id = auth.uid());

  create policy "ride_requests admin delete"
    on public.ride_requests for delete to public
    using (public.caller_is_admin());
end;
$ride_requests$;

-- Permissive policies OR together across USING and WITH CHECK independently,
-- so "claim open" USING + "participant update" WITH CHECK would let a caller
-- re-own someone's open request by rewriting rider_id to themselves. Close
-- that: rider_id is immutable after insert (privileged sessions excepted).
create or replace function public.ride_requests_protect_rider()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rider_id is distinct from old.rider_id and not public.caller_is_admin() then
    raise exception 'rider_immutable';
  end if;
  return new;
end;
$$;

do $rr_trigger$
begin
  if to_regclass('public.ride_requests') is null then return; end if;
  drop trigger if exists trg_ride_requests_protect_rider on public.ride_requests;
  create trigger trg_ride_requests_protect_rider
    before update on public.ride_requests
    for each row execute function public.ride_requests_protect_rider();
end;
$rr_trigger$;

-- ============================================================================
-- Part 3 — admin-managed configuration tables: writes become admin-only
-- ============================================================================
-- Reads stay public (the app renders these), existing INSERT/UPDATE/DELETE
-- policies — whatever their historical names — are dropped and replaced.
do $config$
declare
  t   text;
  pol record;
begin
  foreach t in array array[
    'countries', 'states', 'cities', 'suburbs', 'airport_areas',
    'required_document', 'document_type', 'driver_incentive', 'multi_gate',
    'insurance_providers', 'insurance_types', 'insurance_durations',
    'insurance_premium', 'ev_delivery_advisors', 'ev_finance_options',
    'ev_order_fee', 'ev_vehicle_details', 'ev_vehicle_inventory',
    'vehicle_make_models', 'settings_entries', 'app_settings', 'app_branding',
    'commission_rates', 'ip_access_rules', 'get_coin_settings',
    'get_coin_rate_history', 'admin_display_settings', 'push_notifications',
    'meter_digital_settings'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;

    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
         and cmd in ('INSERT', 'UPDATE', 'DELETE')
    loop
      execute format('drop policy %I on public.%I;', pol.policyname, t);
    end loop;

    execute format(
      'create policy "%1$s admin insert" on public.%1$s for insert to public with check (public.caller_is_admin());', t);
    execute format(
      'create policy "%1$s admin update" on public.%1$s for update to public using (public.caller_is_admin()) with check (public.caller_is_admin());', t);
    execute format(
      'create policy "%1$s admin delete" on public.%1$s for delete to public using (public.caller_is_admin());', t);
  end loop;
end;
$config$;

-- push_notifications additionally loses its public read: broadcast history is
-- an admin dashboard concern and the send-push edge function writes with the
-- service role (bypasses RLS).
do $push_notifications$
begin
  if to_regclass('public.push_notifications') is null then return; end if;
  drop policy if exists "push_notifications read" on public.push_notifications;
  create policy "push_notifications read"
    on public.push_notifications for select
    using (public.caller_is_admin());
end;
$push_notifications$;

-- ============================================================================
-- Part 4 — personal / PII tables: owner-or-admin scoped
-- ============================================================================
do $pii$
declare
  t   text;
  pol record;
begin
  foreach t in array array[
    'emergency_contacts', 'user_sessions', 'user_location_history',
    'voice_protection_recordings', 'support_tickets', 'support_messages',
    'support_calls', 'push_tokens', 'provider_documents', 'vehicle',
    'vehicle_documents', 'vehicle_user_assignment', 'vehicle_active_session',
    'fare_ai_responses'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
         and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    loop
      execute format('drop policy %I on public.%I;', pol.policyname, t);
    end loop;
  end loop;
end;
$pii$;

-- emergency_contacts — the rider's own SOS contacts.
do $emergency$
begin
  if to_regclass('public.emergency_contacts') is null then return; end if;
  create policy "emergency_contacts own select" on public.emergency_contacts
    for select using (profile_id = auth.uid() or public.caller_is_admin());
  create policy "emergency_contacts own insert" on public.emergency_contacts
    for insert to public with check (profile_id = auth.uid() or public.caller_is_admin());
  create policy "emergency_contacts own update" on public.emergency_contacts
    for update to public
    using (profile_id = auth.uid() or public.caller_is_admin())
    with check (profile_id = auth.uid() or public.caller_is_admin());
  create policy "emergency_contacts own delete" on public.emergency_contacts
    for delete to public using (profile_id = auth.uid() or public.caller_is_admin());
end;
$emergency$;

-- partners — the onboarding flow writes the caller's own row (self policies
-- from 0025, kept), and the back office writes any row. Without the admin half
-- (migration 0083) Admin → Partner Edit could never persist a change, because
-- the client upsert carries no auth_user_id and so fails the self WITH CHECK.
do $partners_admin$
begin
  if to_regclass('public.partners') is null then return; end if;
  drop policy if exists "partners admin insert" on public.partners;
  create policy "partners admin insert" on public.partners
    for insert to public with check (public.caller_is_admin());
  drop policy if exists "partners admin update" on public.partners;
  create policy "partners admin update" on public.partners
    for update to public
    using (public.caller_is_admin()) with check (public.caller_is_admin());
  drop policy if exists "partners admin delete" on public.partners;
  create policy "partners admin delete" on public.partners
    for delete to public using (public.caller_is_admin());
end;
$partners_admin$;

-- user_sessions / user_location_history — launch telemetry (public IP, ISP,
-- GPS trail). Inserts remain possible pre-login (user_id null) but a caller
-- can never attribute rows to somebody else; reads are owner/admin only.
do $telemetry$
declare t text;
begin
  foreach t in array array['user_sessions', 'user_location_history'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format(
      'create policy "%1$s own select" on public.%1$s for select using (user_id = auth.uid() or public.caller_is_admin());', t);
    execute format(
      'create policy "%1$s own insert" on public.%1$s for insert to public with check (user_id is null or user_id = auth.uid() or public.caller_is_admin());', t);
    execute format(
      'create policy "%1$s admin update" on public.%1$s for update to public using (public.caller_is_admin()) with check (public.caller_is_admin());', t);
    execute format(
      'create policy "%1$s admin delete" on public.%1$s for delete to public using (public.caller_is_admin());', t);
  end loop;
end;
$telemetry$;

-- device_attestations — Play Integrity / App Attest verdicts (migration 0073).
-- Admin-read only; written by the attest-device edge function via the service
-- role (which bypasses RLS). See docs/device-attestation.md.
create table if not exists public.device_attestations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  device_id     text,
  platform      text not null check (platform in ('android', 'ios')),
  attest_key_id text,
  passed        boolean not null default false,
  verdict       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists device_attestations_device_idx on public.device_attestations (device_id);
create index if not exists device_attestations_key_idx on public.device_attestations (attest_key_id);
create index if not exists device_attestations_user_idx on public.device_attestations (user_id);
alter table public.device_attestations enable row level security;
do $attest$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'device_attestations'
      and policyname = 'device_attestations admin read'
  ) then
    create policy "device_attestations admin read" on public.device_attestations
      for select using (public.caller_is_admin());
  end if;
end;
$attest$;

-- voice_protection_recordings — in-ride audio metadata. The recording device
-- inserts/updates its own rows (upload flags); admins request uploads and
-- review.
do $voice$
begin
  if to_regclass('public.voice_protection_recordings') is null then return; end if;
  create policy "voice_protection own select" on public.voice_protection_recordings
    for select using (profile_id = auth.uid() or public.caller_is_admin());
  create policy "voice_protection own insert" on public.voice_protection_recordings
    for insert to public with check (profile_id = auth.uid() or public.caller_is_admin());
  create policy "voice_protection own update" on public.voice_protection_recordings
    for update to public
    using (profile_id = auth.uid() or public.caller_is_admin())
    with check (profile_id = auth.uid() or public.caller_is_admin());
  create policy "voice_protection admin delete" on public.voice_protection_recordings
    for delete to public using (public.caller_is_admin());
end;
$voice$;

-- support_tickets / support_messages / support_calls — the requester and the
-- support admins. Messages are scoped through their ticket.
do $support$
begin
  if to_regclass('public.support_tickets') is not null then
    create policy "support_tickets own select" on public.support_tickets
      for select using (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_tickets own insert" on public.support_tickets
      for insert to public with check (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_tickets own update" on public.support_tickets
      for update to public
      using (profile_id = auth.uid() or public.caller_is_admin())
      with check (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_tickets admin delete" on public.support_tickets
      for delete to public using (public.caller_is_admin());
  end if;

  if to_regclass('public.support_messages') is not null then
    create policy "support_messages participant select" on public.support_messages
      for select using (
        public.caller_is_admin()
        or exists (
          select 1 from public.support_tickets t
          where t.id = support_messages.ticket_id and t.profile_id = auth.uid()
        )
      );
    create policy "support_messages participant insert" on public.support_messages
      for insert to public with check (
        public.caller_is_admin()
        or exists (
          select 1 from public.support_tickets t
          where t.id = support_messages.ticket_id and t.profile_id = auth.uid()
        )
      );
    create policy "support_messages admin update" on public.support_messages
      for update to public
      using (public.caller_is_admin()) with check (public.caller_is_admin());
    create policy "support_messages admin delete" on public.support_messages
      for delete to public using (public.caller_is_admin());
  end if;

  if to_regclass('public.support_calls') is not null then
    create policy "support_calls own select" on public.support_calls
      for select using (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_calls own insert" on public.support_calls
      for insert to public with check (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_calls own update" on public.support_calls
      for update to public
      using (profile_id = auth.uid() or public.caller_is_admin())
      with check (profile_id = auth.uid() or public.caller_is_admin());
    create policy "support_calls admin delete" on public.support_calls
      for delete to public using (public.caller_is_admin());
  end if;
end;
$support$;

-- push_tokens — Expo push tokens are credentials for reaching a device.
-- Registration moves behind owner-scoped RPCs; the table itself is
-- admin-read/write only (the send-push edge function uses the service role).
do $push_tokens$
begin
  if to_regclass('public.push_tokens') is null then return; end if;
  create policy "push_tokens admin select" on public.push_tokens
    for select using (public.caller_is_admin());
  create policy "push_tokens admin insert" on public.push_tokens
    for insert to public with check (public.caller_is_admin());
  create policy "push_tokens admin update" on public.push_tokens
    for update to public
    using (public.caller_is_admin()) with check (public.caller_is_admin());
  create policy "push_tokens admin delete" on public.push_tokens
    for delete to public using (public.caller_is_admin());
end;
$push_tokens$;

-- Owner-scoped registration. Upserting by token also covers the "same device,
-- new account" case, which plain RLS cannot express (the old row belongs to
-- the previous profile).
create or replace function public.push_register_token(
  p_token text,
  p_platform text default null,
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
  if p_token is null or length(trim(p_token)) = 0 or length(p_token) > 512 then
    raise exception 'invalid_token';
  end if;
  insert into public.push_tokens (token, profile_id, platform, device_name)
  values (p_token, auth.uid(), p_platform, p_device_name)
  on conflict (token) do update
    set profile_id  = excluded.profile_id,
        platform    = excluded.platform,
        device_name = excluded.device_name,
        updated_at  = now();
end;
$$;

-- Knowing the token IS the capability (it is device-secret), so sign-out
-- cleanup works even after the auth session is gone.
create or replace function public.push_unregister_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return;
  end if;
  delete from public.push_tokens where token = p_token;
end;
$$;

grant execute on function public.push_register_token(text, text, text) to anon, authenticated;
grant execute on function public.push_unregister_token(text) to anon, authenticated;

-- provider_documents / vehicle / vehicle_documents / vehicle assignments —
-- partner onboarding data (IC numbers, document scans). Owner = the linked
-- auth user, the owning partner, or an assigned driver; admins see all.
do $partner_data$
begin
  if to_regclass('public.provider_documents') is not null then
    create policy "provider_documents own select" on public.provider_documents
      for select using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = provider_documents.partner_id and p.auth_user_id = auth.uid()
        )
      );
    create policy "provider_documents own insert" on public.provider_documents
      for insert to public with check (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = provider_documents.partner_id and p.auth_user_id = auth.uid()
        )
      );
    create policy "provider_documents own update" on public.provider_documents
      for update to public
      using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = provider_documents.partner_id and p.auth_user_id = auth.uid()
        )
      )
      with check (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = provider_documents.partner_id and p.auth_user_id = auth.uid()
        )
      );
    create policy "provider_documents admin delete" on public.provider_documents
      for delete to public using (public.caller_is_admin());
  end if;

  if to_regclass('public.vehicle') is not null then
    create policy "vehicle own select" on public.vehicle
      for select using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle.owner_partner_id and p.auth_user_id = auth.uid()
        )
        or exists (
          select 1 from public.vehicle_user_assignment a
          where a.vehicle_id = vehicle.id and a.user_id = auth.uid()
        )
      );
    create policy "vehicle own insert" on public.vehicle
      for insert to public with check (
        public.caller_is_admin() or auth_user_id = auth.uid()
      );
    create policy "vehicle own update" on public.vehicle
      for update to public
      using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle.owner_partner_id and p.auth_user_id = auth.uid()
        )
      )
      with check (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle.owner_partner_id and p.auth_user_id = auth.uid()
        )
      );
    create policy "vehicle admin delete" on public.vehicle
      for delete to public using (public.caller_is_admin());
  end if;

  if to_regclass('public.vehicle_documents') is not null then
    create policy "vehicle_documents own select" on public.vehicle_documents
      for select using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle_documents.partner_id and p.auth_user_id = auth.uid()
        )
        or exists (
          select 1 from public.vehicle v
          where v.id = vehicle_documents.vehicle_id
            and (v.auth_user_id = auth.uid()
                 or exists (
                   select 1 from public.vehicle_user_assignment a
                   where a.vehicle_id = v.id and a.user_id = auth.uid()
                 ))
        )
      );
    create policy "vehicle_documents own insert" on public.vehicle_documents
      for insert to public with check (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle_documents.partner_id and p.auth_user_id = auth.uid()
        )
        or exists (
          select 1 from public.vehicle v
          where v.id = vehicle_documents.vehicle_id
            and (v.auth_user_id = auth.uid()
                 or exists (
                   select 1 from public.vehicle_user_assignment a
                   where a.vehicle_id = v.id and a.user_id = auth.uid()
                 ))
        )
      );
    create policy "vehicle_documents own update" on public.vehicle_documents
      for update to public
      using (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle_documents.partner_id and p.auth_user_id = auth.uid()
        )
        or exists (
          select 1 from public.vehicle v
          where v.id = vehicle_documents.vehicle_id
            and (v.auth_user_id = auth.uid()
                 or exists (
                   select 1 from public.vehicle_user_assignment a
                   where a.vehicle_id = v.id and a.user_id = auth.uid()
                 ))
        )
      )
      with check (
        public.caller_is_admin()
        or auth_user_id = auth.uid()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle_documents.partner_id and p.auth_user_id = auth.uid()
        )
        or exists (
          select 1 from public.vehicle v
          where v.id = vehicle_documents.vehicle_id
            and (v.auth_user_id = auth.uid()
                 or exists (
                   select 1 from public.vehicle_user_assignment a
                   where a.vehicle_id = v.id and a.user_id = auth.uid()
                 ))
        )
      );
    create policy "vehicle_documents admin delete" on public.vehicle_documents
      for delete to public using (public.caller_is_admin());
  end if;

  -- Assignments/sessions are managed by admins and the SECURITY DEFINER
  -- claim/release RPCs (0031/0035); drivers only need to read their own.
  if to_regclass('public.vehicle_user_assignment') is not null then
    create policy "vehicle_user_assignment own select" on public.vehicle_user_assignment
      for select using (
        user_id = auth.uid()
        or public.caller_is_admin()
        or exists (
          select 1 from public.partners p
          where p.id = vehicle_user_assignment.partner_id and p.auth_user_id = auth.uid()
        )
      );
    create policy "vehicle_user_assignment admin insert" on public.vehicle_user_assignment
      for insert to public with check (public.caller_is_admin());
    create policy "vehicle_user_assignment admin update" on public.vehicle_user_assignment
      for update to public
      using (public.caller_is_admin()) with check (public.caller_is_admin());
    create policy "vehicle_user_assignment admin delete" on public.vehicle_user_assignment
      for delete to public using (public.caller_is_admin());
  end if;

  if to_regclass('public.vehicle_active_session') is not null then
    create policy "vehicle_active_session own select" on public.vehicle_active_session
      for select using (user_id = auth.uid() or public.caller_is_admin());
    create policy "vehicle_active_session admin insert" on public.vehicle_active_session
      for insert to public with check (public.caller_is_admin());
    create policy "vehicle_active_session admin update" on public.vehicle_active_session
      for update to public
      using (public.caller_is_admin()) with check (public.caller_is_admin());
    create policy "vehicle_active_session admin delete" on public.vehicle_active_session
      for delete to public using (public.caller_is_admin());
  end if;
end;
$partner_data$;

-- fare_ai_responses — request/response logs embed rider route coordinates.
-- Reads become admin-only; inserts stay open because the legacy client-side
-- provider loop (pre ai-route-proxy) logs its attempts best-effort.
do $fare_ai$
begin
  if to_regclass('public.fare_ai_responses') is null then return; end if;
  create policy "fare_ai_responses admin select" on public.fare_ai_responses
    for select using (public.caller_is_admin());
  create policy "fare_ai_responses insert" on public.fare_ai_responses
    for insert to public with check (true);
  create policy "fare_ai_responses admin delete" on public.fare_ai_responses
    for delete to public using (public.caller_is_admin());
end;
$fare_ai$;

-- ============================================================================
-- Part 5 — online_driver_locations: SECURITY DEFINER view → invoker
-- ============================================================================
-- The view (previously created ad hoc, definer-owned, bypassing RLS) exposes
-- online drivers' latest GPS fix. With security_invoker it now runs under the
-- caller's policies — i.e. admin dashboards. No app screen queries it.
do $view$
begin
  if to_regclass('public.vehicle_active_session') is null
     or to_regclass('public.partners') is null
     or to_regclass('public.user_location_history') is null then
    return;
  end if;
  execute $v$
    create or replace view public.online_driver_locations
    with (security_invoker = true) as
    select vas.id as session_id,
           vas.partner_id,
           vas.vehicle_id,
           vas.user_id,
           p.partner_types,
           p.vehicle_type,
           ulh.latitude,
           ulh.longitude,
           ulh.heading,
           ulh.speed,
           ulh.captured_at
      from public.vehicle_active_session vas
      join public.partners p on p.id = vas.partner_id
      join lateral (
        select l.latitude, l.longitude, l.heading, l.speed, l.captured_at
          from public.user_location_history l
         where l.user_id = vas.user_id
         order by l.captured_at desc
         limit 1
      ) ulh on true
     where vas.status = 'online'
  $v$;
end;
$view$;

-- ============================================================================
-- Part 6 — pin search_path on flagged trigger/cron functions
-- ============================================================================
do $fn_paths$
declare f text;
begin
  foreach f in array array[
    'public.set_updated_at()',
    'public.set_support_ticket_number()',
    'public.expire_documents_daily()',
    'public.provider_documents_touch_updated_at()',
    'public.provider_documents_apply_expiry()',
    'public.vehicle_documents_touch_updated_at()',
    'public.vehicle_documents_apply_expiry()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public;', f);
    end if;
  end loop;
  -- hash_profile_pin calls pgcrypto's crypt(); include the extensions schema
  -- in case pgcrypto lives there rather than in public.
  if to_regprocedure('public.hash_profile_pin()') is not null then
    alter function public.hash_profile_pin() set search_path = public, extensions;
  end if;
end;
$fn_paths$;

-- ============================================================================
-- Part 7 — storage: stop public listing + anon writes on managed buckets
-- ============================================================================
-- Buckets stay `public` so existing getPublicUrl() links keep rendering; the
-- policies below only govern the storage API (list/download/upload/delete),
-- which the app uses for uploads and admin signed URLs.

-- Broad SELECT (listing) policies.
drop policy if exists "public read app-assets"     on storage.objects;
drop policy if exists "public read avatars"        on storage.objects;
drop policy if exists "public read id_image"       on storage.objects;
drop policy if exists "public read support-media"  on storage.objects;
drop policy if exists "app-branding read"          on storage.objects;
drop policy if exists "partner-type-icons read"    on storage.objects;
drop policy if exists "provider-documents read"    on storage.objects;
drop policy if exists "vehicle-documents read"     on storage.objects;
drop policy if exists "anon read voice-protection" on storage.objects;

-- Admins keep API-level read (listing, signed URLs) on every managed bucket.
drop policy if exists "managed buckets admin read" on storage.objects;
create policy "managed buckets admin read"
  on storage.objects for select to authenticated
  using (
    public.caller_is_admin()
    and bucket_id in (
      'app-assets', 'app-branding', 'avatars', 'ID_Image',
      'partner-type-icons', 'provider-documents', 'support-media',
      'vehicle-documents', 'voice-protection'
    )
  );

-- Voice-protection recordings: uploads land in a folder named after the
-- recording profile, so the owner keeps read/write on their own folder.
drop policy if exists "anon upload voice-protection" on storage.objects;
drop policy if exists "anon update voice-protection" on storage.objects;
drop policy if exists "anon delete voice-protection" on storage.objects;
drop policy if exists "voice-protection owner read"   on storage.objects;
drop policy if exists "voice-protection owner write"  on storage.objects;
drop policy if exists "voice-protection owner update" on storage.objects;
drop policy if exists "voice-protection admin delete" on storage.objects;
create policy "voice-protection owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-protection'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice-protection owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-protection'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice-protection owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'voice-protection'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice-protection admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'voice-protection' and public.caller_is_admin());

-- Branding + partner-type icons: only admins manage these assets.
drop policy if exists "app-branding insert" on storage.objects;
drop policy if exists "app-branding update" on storage.objects;
drop policy if exists "app-branding delete" on storage.objects;
drop policy if exists "app-branding admin write"  on storage.objects;
drop policy if exists "app-branding admin update" on storage.objects;
drop policy if exists "app-branding admin delete" on storage.objects;
create policy "app-branding admin write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'app-branding' and public.caller_is_admin());
create policy "app-branding admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'app-branding' and public.caller_is_admin());
create policy "app-branding admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'app-branding' and public.caller_is_admin());

drop policy if exists "partner-type-icons insert" on storage.objects;
drop policy if exists "partner-type-icons update" on storage.objects;
drop policy if exists "partner-type-icons delete" on storage.objects;
drop policy if exists "partner-type-icons admin write"  on storage.objects;
drop policy if exists "partner-type-icons admin update" on storage.objects;
drop policy if exists "partner-type-icons admin delete" on storage.objects;
create policy "partner-type-icons admin write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-type-icons' and public.caller_is_admin());
create policy "partner-type-icons admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'partner-type-icons' and public.caller_is_admin());
create policy "partner-type-icons admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'partner-type-icons' and public.caller_is_admin());

-- Partner/vehicle document scans: uploads are keyed by partner/vehicle id
-- (not auth uid), so writes stay authenticated-wide; deletes become admin.
drop policy if exists "provider-documents insert" on storage.objects;
drop policy if exists "provider-documents update" on storage.objects;
drop policy if exists "provider-documents delete" on storage.objects;
drop policy if exists "provider-documents auth write"   on storage.objects;
drop policy if exists "provider-documents auth update"  on storage.objects;
drop policy if exists "provider-documents admin delete" on storage.objects;
create policy "provider-documents auth write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'provider-documents');
create policy "provider-documents auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'provider-documents');
create policy "provider-documents admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'provider-documents' and public.caller_is_admin());

drop policy if exists "vehicle-documents insert" on storage.objects;
drop policy if exists "vehicle-documents update" on storage.objects;
drop policy if exists "vehicle-documents delete" on storage.objects;
drop policy if exists "vehicle-documents auth write"   on storage.objects;
drop policy if exists "vehicle-documents auth update"  on storage.objects;
drop policy if exists "vehicle-documents admin delete" on storage.objects;
create policy "vehicle-documents auth write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-documents');
create policy "vehicle-documents auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-documents');
create policy "vehicle-documents admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-documents' and public.caller_is_admin());

-- Support attachments: authenticated uploads (support requires a profile),
-- admin-only rewrite/delete.
drop policy if exists "anon upload support-media" on storage.objects;
drop policy if exists "auth update support-media" on storage.objects;
drop policy if exists "auth delete support-media" on storage.objects;
drop policy if exists "support-media auth write"   on storage.objects;
drop policy if exists "support-media admin update" on storage.objects;
drop policy if exists "support-media admin delete" on storage.objects;
create policy "support-media auth write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'support-media');
create policy "support-media admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'support-media' and public.caller_is_admin());
create policy "support-media admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'support-media' and public.caller_is_admin());

-- (avatars / ID_Image writes were already authenticated-scoped — unchanged.)

-- ============================================================================
-- Not fixable in SQL: enable "leaked password protection" in the Supabase
-- dashboard (Auth → Providers → Password) to clear the remaining advisor
-- warning. This project signs in via phone OTP + PIN, so impact is minimal.
-- ============================================================================

-- ============================================================================
-- TEKSI EV orders (migration 0080)
-- ============================================================================
-- Customer-owned rows, not admin configuration: the EV wizard creates an order
-- when the customer pays the order fee, so `settings_entries` (admin-write-only
-- since the lockdown above) could never hold them. Same shape as the dedicated
-- settings tables plus `user_id`, with owner-or-admin policies.

create table if not exists public.ev_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  values      jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ev_orders_user_id_idx  on public.ev_orders(user_id);
create index if not exists ev_orders_position_idx on public.ev_orders(position);

drop trigger if exists trg_ev_orders_updated_at on public.ev_orders;
create trigger trg_ev_orders_updated_at
  before update on public.ev_orders
  for each row execute function public.set_updated_at();

-- user_id is immutable after insert (same guard as ride_requests.rider_id).
create or replace function public.ev_orders_freeze_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id and not public.caller_is_admin() then
    raise exception 'ev_orders.user_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ev_orders_freeze_owner on public.ev_orders;
create trigger trg_ev_orders_freeze_owner
  before update on public.ev_orders
  for each row execute function public.ev_orders_freeze_owner();

alter table public.ev_orders enable row level security;

drop policy if exists "ev_orders read"   on public.ev_orders;
drop policy if exists "ev_orders insert" on public.ev_orders;
drop policy if exists "ev_orders update" on public.ev_orders;
drop policy if exists "ev_orders delete" on public.ev_orders;

create policy "ev_orders read" on public.ev_orders
  for select
  using (user_id = auth.uid() or public.caller_is_admin());

create policy "ev_orders insert" on public.ev_orders
  for insert to public
  with check (
    (auth.uid() is not null and user_id = auth.uid())
    or public.caller_is_admin()
  );

create policy "ev_orders update" on public.ev_orders
  for update to public
  using (user_id = auth.uid() or public.caller_is_admin())
  with check (user_id = auth.uid() or public.caller_is_admin());

-- A paid order is a record; only the back office removes one.
create policy "ev_orders delete" on public.ev_orders
  for delete to public
  using (public.caller_is_admin());

grant select, insert, update, delete on public.ev_orders to authenticated;
revoke all on public.ev_orders from anon;

-- ============================================================================
-- Meter Digital settings & rate cards (migration 0081)
-- ----------------------------------------------------------------------------
-- Everything Admin → Settings → Meter Digital Setting configures for the in-app
-- taxi meter (`app/meter-digital.tsx`): which sensors it may bill on, whether a
-- hire may open without an odometer reading, which console panels are shown and
-- which may be tapped, and the rate card itself (flag fare, distance charge per
-- km or per started block, time charge per minute / second / started block, how
-- the two combine, the night surcharge and the luggage/passenger extras).
--
-- Scoped like `commission_rates`: one 'master' row is the global card, and
-- country / state / city / suburb rows override it. The meter resolves the
-- first match, highest first — suburb → city → state → country → master →
-- built-in TEKSI tariff — client-side (`utils/meterSettings.ts`), because it has
-- to keep pricing a hire with no signal at all.
-- ============================================================================

create table if not exists public.meter_digital_settings (
  id uuid primary key default gen_random_uuid(),

  level   text not null check (level in ('master','country','state','city','suburb')),
  country text,
  state   text,
  city    text,
  suburb  text,
  label   text,

  -- Sensors
  source_mode text not null default 'gps+obd'
    check (source_mode in ('gps','gps+obd','obd')),
  allow_start_without_odometer boolean not null default true,
  read_odometer                boolean not null default true,

  -- Open /meter-digital at app launch for partners carrying the TEKSI type.
  auto_launch boolean not null default false,

  -- Console panels: shown, and tappable
  show_meter    boolean not null default true,
  show_trips    boolean not null default true,
  show_printer  boolean not null default true,
  show_obd      boolean not null default true,
  show_settings boolean not null default true,
  tap_meter     boolean not null default true,
  tap_trips     boolean not null default true,
  tap_printer   boolean not null default true,
  tap_obd       boolean not null default true,
  tap_settings  boolean not null default true,

  -- Rate card
  currency text not null default 'MYR',

  flag_fare       numeric(10,2) not null default 4.00 check (flag_fare >= 0),
  flag_distance_m integer       not null default 1000 check (flag_distance_m >= 0),
  minimum_fare    numeric(10,2) not null default 0 check (minimum_fare >= 0),

  distance_mode         text          not null default 'block'
    check (distance_mode in ('block','per_km','off')),
  distance_block_m      integer       not null default 200 check (distance_block_m > 0),
  distance_block_charge numeric(10,2) not null default 0.35 check (distance_block_charge >= 0),
  per_km_charge         numeric(10,2) not null default 1.00 check (per_km_charge >= 0),

  time_mode         text          not null default 'block'
    check (time_mode in ('block','per_minute','per_second','off')),
  time_block_s      integer       not null default 36 check (time_block_s > 0),
  time_block_charge numeric(10,2) not null default 0.35 check (time_block_charge >= 0),
  per_minute_charge numeric(10,2) not null default 0.30 check (per_minute_charge >= 0),
  per_second_charge numeric(10,4) not null default 0 check (per_second_charge >= 0),

  charge_mode text not null default 'max' check (charge_mode in ('max','sum')),
  charge_from text not null default 'flag' check (charge_from in ('flag','start')),

  -- Night shift
  night_multiplier numeric(6,3) not null default 1.5 check (night_multiplier >= 1),
  night_start_hour smallint     not null default 0 check (night_start_hour between 0 and 23),
  night_end_hour   smallint     not null default 6 check (night_end_hour between 0 and 24),

  -- Extras the meter cannot measure
  extra_luggage_charge   numeric(10,2) not null default 0 check (extra_luggage_charge >= 0),
  free_luggage           smallint      not null default 0 check (free_luggage >= 0),
  extra_passenger_charge numeric(10,2) not null default 0 check (extra_passenger_charge >= 0),
  free_passengers        smallint      not null default 1 check (free_passengers >= 0),
  extra_step             numeric(10,2) not null default 0.50 check (extra_step > 0),
  max_extra              numeric(10,2) not null default 99.50 check (max_extra >= 0),

  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 0084: added after the table shipped, so an existing project picks it up here.
alter table public.meter_digital_settings
  add column if not exists auto_launch boolean not null default false;

create unique index if not exists meter_digital_settings_scope_uidx
  on public.meter_digital_settings (
    level,
    coalesce(lower(country), ''),
    coalesce(lower(state), ''),
    coalesce(lower(city), ''),
    coalesce(lower(suburb), '')
  );

create index if not exists meter_digital_settings_level_idx
  on public.meter_digital_settings(level);

do $$
begin
  drop trigger if exists trg_meter_digital_settings_updated_at on public.meter_digital_settings;
  create trigger trg_meter_digital_settings_updated_at
    before update on public.meter_digital_settings
    for each row execute function public.set_updated_at();
end$$;

alter table public.meter_digital_settings enable row level security;

drop policy if exists "meter_digital_settings read"         on public.meter_digital_settings;
drop policy if exists "meter_digital_settings admin insert" on public.meter_digital_settings;
drop policy if exists "meter_digital_settings admin update" on public.meter_digital_settings;
drop policy if exists "meter_digital_settings admin delete" on public.meter_digital_settings;

create policy "meter_digital_settings read" on public.meter_digital_settings
  for select using (true);

create policy "meter_digital_settings admin insert" on public.meter_digital_settings
  for insert to public with check (public.caller_is_admin());

create policy "meter_digital_settings admin update" on public.meter_digital_settings
  for update to public
  using (public.caller_is_admin())
  with check (public.caller_is_admin());

create policy "meter_digital_settings admin delete" on public.meter_digital_settings
  for delete to public using (public.caller_is_admin());

grant select on public.meter_digital_settings to anon, authenticated;
grant insert, update, delete on public.meter_digital_settings to authenticated;

-- The master card seeds to the TEKSI "old rates" tariff the meter has always
-- billed on, so a fresh database changes no fare.
insert into public.meter_digital_settings (level, label)
  select 'master', 'Global (TEKSI old rates)'
 where not exists (
   select 1 from public.meter_digital_settings where level = 'master'
 );

-- Realtime: the console panels of a card apply live — the admin Show / Tap
-- switches write through without a Save — so a change has to reach the drivers'
-- meters on its own (migrations/0082_meter_digital_settings_realtime.sql).
alter table public.meter_digital_settings replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.meter_digital_settings;
exception
  when duplicate_object then null;
end$$;
