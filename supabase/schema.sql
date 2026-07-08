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

drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read"
  on public.app_settings for select
  using (true);

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

drop policy if exists "wallets read"   on public.wallets;
drop policy if exists "wallets insert" on public.wallets;
drop policy if exists "wallets update" on public.wallets;

create policy "wallets read"   on public.wallets for select using (true);
create policy "wallets insert" on public.wallets for insert to public with check (true);
create policy "wallets update" on public.wallets for update to public using (true) with check (true);

drop policy if exists "wallet_transactions read"   on public.wallet_transactions;
drop policy if exists "wallet_transactions insert" on public.wallet_transactions;

create policy "wallet_transactions read"   on public.wallet_transactions for select using (true);
create policy "wallet_transactions insert" on public.wallet_transactions for insert to public with check (true);

grant select, insert, update on public.wallets to anon, authenticated;
grant select, insert on public.wallet_transactions to anon, authenticated;

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
  if p_user is null then
    raise exception 'invalid_user';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'invalid_amount';
  end if;

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_user, 'get_wallet', 0)
  on conflict (user_id, wallet_type) do nothing;

  update public.wallets
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user and wallet_type = 'get_wallet'
  returning * into w;

  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, balance_after, method, note)
  values
    (p_user, 'get_wallet', 'topup', p_amount, w.balance, p_method, 'Top up GET.wallet');

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
  if p_user is null then
    raise exception 'invalid_user';
  end if;
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

  update public.wallets
     set balance = balance - p_amount, updated_at = now()
   where id = w_master.id
  returning * into w_master;

  update public.wallets
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user and wallet_type = 'get_credit'
  returning * into w_credit;

  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, balance_after, note)
  values
    (p_user, 'get_wallet', 'recharge_out', -p_amount, w_master.balance, 'Recharge GET.credit'),
    (p_user, 'get_credit', 'recharge_in',   p_amount, w_credit.balance, 'Recharged from GET.wallet');

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
begin
  if p_partner is null then
    raise exception 'invalid_partner';
  end if;
  if p_fare is null or p_fare <= 0 then
    raise exception 'invalid_fare';
  end if;

  select * into r from public.ride_requests where id = p_ride for update;
  if not found then
    raise exception 'ride_not_found';
  end if;

  -- Already charged: idempotent no-op.
  if r.commission_charged_at is not null then
    select * into w from public.wallets
     where user_id = p_partner and wallet_type = 'get_credit';
    return w;
  end if;

  v_rate := p_rate;
  if v_rate is null then
    v_rate := public.commission_resolve_rate(p_partner, r.country, r.state, r.city, r.suburb);
  end if;
  if v_rate is null or v_rate <= 0 or v_rate >= 1 then
    raise exception 'invalid_rate';
  end if;

  v_amount := round(p_fare * v_rate, 2);

  insert into public.wallets (user_id, wallet_type, balance)
  values (p_partner, 'get_credit', 0)
  on conflict (user_id, wallet_type) do nothing;

  update public.wallets
     set balance = balance - v_amount, updated_at = now()
   where user_id = p_partner and wallet_type = 'get_credit'
  returning * into w;

  insert into public.wallet_transactions
    (user_id, wallet_type, kind, amount, balance_after, note)
  values
    (p_partner, 'get_credit', 'commission', -v_amount, w.balance,
     'Ride commission ' || round(v_rate * 100, 1) || '% of ' ||
     coalesce(r.currency, 'RM') || ' ' || round(p_fare, 2));

  update public.ride_requests
     set commission_rate = v_rate,
         commission_amount = v_amount,
         commission_charged_at = now()
   where id = p_ride;

  return w;
end;
$$;

grant execute on function public.wallet_charge_ride_commission(uuid, uuid, numeric, numeric)
  to anon, authenticated;
