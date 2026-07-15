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
create or replace function public.set_login_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'set_login_pin requires an authenticated session';
  end if;
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must be exactly 6 digits';
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

revoke all on function public.set_login_pin(text) from public;
grant execute on function public.set_login_pin(text) to authenticated;

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
-- Generic write gate for admin-only settings tables (0067): true for direct
-- DB sessions and the service role, otherwise requires an admin_access row
-- with edit access on the given page.
-- ---------------------------------------------------------------------------
create or replace function public.admin_write_access(p_page text)
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
  return public.admin_can_edit(auth.uid(), p_page);
end;
$$;

grant execute on function public.admin_write_access(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap gate for the legacy hardcoded admin login (0068): the client
-- only honors the hardcoded PIN/credentials/whitelist-bypass while no real
-- admin_access row exists yet. Once a real admin has been seeded (only
-- possible via the service role / a direct DB session, since the insert
-- policy above requires an existing admin), the legacy login stops working
-- and operators must sign in with their own admin_access-scoped session.
-- ---------------------------------------------------------------------------
create or replace function public.admin_access_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_access);
$$;

grant execute on function public.admin_access_exists() to anon, authenticated;

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

-- Read stays open (evaluated pre-login, sometimes with no session at all).
-- Writes (0067) require edit access on admin-settings-ip-access — this table
-- backs the admin-login whitelist bypass, so a public write policy here is a
-- credential-free path to a super-admin session.
create policy "ip_access_rules read"   on public.ip_access_rules for select using (true);
create policy "ip_access_rules insert" on public.ip_access_rules for insert to public
  with check (public.admin_write_access('admin-settings-ip-access'));
create policy "ip_access_rules update" on public.ip_access_rules for update to public
  using (public.admin_write_access('admin-settings-ip-access'))
  with check (public.admin_write_access('admin-settings-ip-access'));
create policy "ip_access_rules delete" on public.ip_access_rules for delete to public
  using (public.admin_write_access('admin-settings-ip-access'));

grant select on public.ip_access_rules to anon, authenticated;
grant insert, update, delete on public.ip_access_rules to authenticated;

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

-- Read stays open (rate cards render across admin/rider/partner screens).
-- Writes (0067) require edit access on admin-settings-commission — resolved
-- server-side by wallet_charge_ride_commission, a public write policy here
-- would let any partner zero their own commission with a user-level override.
create policy "commission_rates read"   on public.commission_rates for select using (true);
create policy "commission_rates insert" on public.commission_rates for insert to public
  with check (public.admin_write_access('admin-settings-commission'));
create policy "commission_rates update" on public.commission_rates for update to public
  using (public.admin_write_access('admin-settings-commission'))
  with check (public.admin_write_access('admin-settings-commission'));
create policy "commission_rates delete" on public.commission_rates for delete to public
  using (public.admin_write_access('admin-settings-commission'));

grant select on public.commission_rates to anon, authenticated;
grant insert, update, delete on public.commission_rates to authenticated;

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

-- Read stays open (balances/rates render across the app). Writes (0067)
-- require edit access on admin-settings-get-coin — wallet_trade_coins anchors
-- trade rates to this row, so a public write policy here would let anyone
-- rewrite the peg right before trading.
create policy "get_coin_settings read"   on public.get_coin_settings for select using (true);
create policy "get_coin_settings insert" on public.get_coin_settings for insert to public
  with check (public.admin_write_access('admin-settings-get-coin'));
create policy "get_coin_settings update" on public.get_coin_settings for update to public
  using (public.admin_write_access('admin-settings-get-coin'))
  with check (public.admin_write_access('admin-settings-get-coin'));

grant select on public.get_coin_settings to anon, authenticated;
grant insert, update on public.get_coin_settings to authenticated;

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
