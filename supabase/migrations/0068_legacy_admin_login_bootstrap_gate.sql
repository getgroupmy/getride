-- ============================================================================
-- 0068: Bootstrap-only gate for the legacy hardcoded admin login
-- ----------------------------------------------------------------------------
-- `app/admin-login.tsx` ships hardcoded super-admin credentials
-- (username/password, a 6-digit PIN, and an IP-whitelist bypass button) as
-- plain client-side constants — visible to anyone who reads the repo or
-- decompiles the app bundle, and the UI even printed them as a "Demo
-- credentials" hint. Any of the three grants `markSuperAdminSession()`,
-- which is a client-only AsyncStorage flag with no corresponding
-- `auth.uid()` / `admin_access` row — full super-admin, no real identity.
--
-- This table is the only place a *real*, profile-scoped admin identity is
-- recorded, and (by design, see 0009/0066) the very first row can only ever
-- be inserted by the service role or a direct DB session — the API-level
-- insert policy requires an existing admin_access row with edit access,
-- so there is no bootstrapping deadlock to solve here beyond what already
-- exists: whoever operates the database creates that first row out of
-- band (Supabase SQL editor / dashboard), the same way `setup.sh` already
-- assumes direct DB access for initial schema setup.
--
-- Fix: expose a public, read-only "does any admin_access row exist yet?"
-- check. The client only accepts the legacy hardcoded credentials while
-- the table is empty (first-run bootstrap); once a real admin_access row
-- exists, the legacy login rejects every hardcoded credential and the
-- whitelist bypass, and operators must sign in with their own
-- Supabase-authenticated, admin_access-scoped session. This closes the
-- hardcoded-credential exposure and the "god mode with no real identity"
-- gap without any risk of locking out an operator who hasn't set up real
-- admin identity yet.
-- ============================================================================

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
