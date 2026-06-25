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
  cancelled_at  timestamptz
);

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
