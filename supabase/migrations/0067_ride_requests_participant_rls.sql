-- ============================================================================
-- 0067: Participant-scoped RLS for ride_requests + admin-only IP rules
-- ----------------------------------------------------------------------------
-- Problem 1: `ride_requests` carried fully public policies — any anon-key
-- holder could read EVERY ride (rider/partner names, phone numbers, live GPS
-- positions from the 0055 columns) and update or delete anyone's ride.
--
-- Fix — dispatch now requires an authenticated Supabase session, and rows are
-- scoped to the people involved:
--   * select : open requests (the dispatch marketplace partners browse),
--              rides you ride or drive, or any ride for admins.
--   * insert : riders create their own requests (rider_id = auth.uid()).
--   * update : participants manage their own rides; OPEN rows stay updatable
--              by any authenticated user so partners can claim them
--              (acceptRideRequest sets partner_id = the caller) or
--              counter-offer (submitRideOffer keeps status 'open') — but the
--              updated row must still be attributable: it must remain
--              open/expired or name the caller as rider/partner, and Postgres
--              additionally re-applies the SELECT policy to the updated row,
--              so a non-participant can never move a request into a state
--              they cannot see. Expiry is rider-driven (ride-confirm's
--              7-minute timer and the rider-scoped stale sweep both run as
--              the request's rider).
--   * delete : the rider or an admin.
--
-- Known trade-offs (accepted):
--   * Legacy local-PIN sessions (no Supabase JWT) can no longer book real
--     rides — the primary phone-OTP flow is unaffected.
--   * A non-participant partner no longer receives the realtime UPDATE when
--     someone else claims an open request (RLS filters realtime), so their
--     incoming card dismisses via its countdown instead; the atomic claim
--     guard (`eq status open`) already handles the accept race gracefully.
--   * Open requests remain visible to every signed-in user — that is the
--     dispatch model — but active-trip data (live GPS, contact details of
--     matched rides) is no longer public.
--
-- Problem 2: `ip_access_rules` was publicly writable — a blocked device could
-- delete its own blacklist row, and anyone could whitelist their IP to skip
-- the admin PIN. Writes are now admin-only; reads stay open because every
-- client evaluates the blacklist at login time.
--
-- This migration also makes the admin_access table (0009) + is_admin helper
-- available on databases bootstrapped from an older schema.sql that predates
-- it (idempotent copy).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_access (0009) — idempotent, in case the database was bootstrapped
-- from a schema.sql snapshot that predates it.
-- ----------------------------------------------------------------------------
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

create or replace function public.is_admin(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_access where profile_id = p_profile
  );
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- ride_requests: participant-scoped policies
-- ----------------------------------------------------------------------------
drop policy if exists "ride_requests read"   on public.ride_requests;
drop policy if exists "ride_requests insert" on public.ride_requests;
drop policy if exists "ride_requests update" on public.ride_requests;
drop policy if exists "ride_requests delete" on public.ride_requests;

create policy "ride_requests read"
  on public.ride_requests for select
  to authenticated
  using (
    status = 'open'
    or rider_id = auth.uid()
    or partner_id = auth.uid()
    or public.is_admin(auth.uid())
  );

create policy "ride_requests insert"
  on public.ride_requests for insert
  to authenticated
  with check (
    rider_id = auth.uid()
    or public.is_admin(auth.uid())
  );

create policy "ride_requests update"
  on public.ride_requests for update
  to authenticated
  using (
    status = 'open'
    or rider_id = auth.uid()
    or partner_id = auth.uid()
    or public.is_admin(auth.uid())
  )
  with check (
    rider_id = auth.uid()
    or partner_id = auth.uid()
    or public.is_admin(auth.uid())
    -- Offers keep the row 'open'; expiry is rider-driven. Note Postgres
    -- also re-applies the SELECT policy to updated rows, so a
    -- non-participant can never move an open request into a state they
    -- cannot see (e.g. expire someone else's request).
    or status in ('open', 'expired')
  );

create policy "ride_requests delete"
  on public.ride_requests for delete
  to authenticated
  using (
    rider_id = auth.uid()
    or public.is_admin(auth.uid())
  );

revoke select, insert, update, delete on public.ride_requests from anon;

-- ----------------------------------------------------------------------------
-- ip_access_rules: reads stay open (login-time blacklist evaluation runs on
-- every device), writes are admin-only.
-- ----------------------------------------------------------------------------
drop policy if exists "ip_access_rules read"   on public.ip_access_rules;
drop policy if exists "ip_access_rules insert" on public.ip_access_rules;
drop policy if exists "ip_access_rules update" on public.ip_access_rules;
drop policy if exists "ip_access_rules delete" on public.ip_access_rules;

create policy "ip_access_rules read"
  on public.ip_access_rules for select
  using (true);

create policy "ip_access_rules insert"
  on public.ip_access_rules for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

create policy "ip_access_rules update"
  on public.ip_access_rules for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "ip_access_rules delete"
  on public.ip_access_rules for delete
  to authenticated
  using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.ip_access_rules from anon;
