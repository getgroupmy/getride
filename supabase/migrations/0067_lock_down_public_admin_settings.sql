-- ============================================================================
-- 0067: Lock down public-write RLS on admin-only settings tables
-- ----------------------------------------------------------------------------
-- `ip_access_rules`, `commission_rates` and `get_coin_settings` carried fully
-- permissive RLS policies (insert/update/delete to public, `using (true)`),
-- left over from before the admin_access-based permission model existed.
-- Each is trusted, unauthenticated, by a server-side consumer:
--
--   * `ip_access_rules` gates the admin-login whitelist bypass
--     (`IpAccessContext` -> `evaluateIp` -> "Enter as admin" with no
--     password). Any anon-key holder could insert their own IP as
--     `whitelist` and get a credential-free super-admin session.
--   * `commission_rates` is read by `commission_resolve_rate()`, which
--     `wallet_charge_ride_commission` trusts server-side. Any signed-in
--     partner could insert a `level = 'user'` row scoped to their own
--     account with `rate = 0` and permanently evade commission — the same
--     "public write + trusted-by-a-server-function" hole 0066 fixed for the
--     wallet ledger.
--   * `get_coin_settings` holds the GET.coin peg / market-swing-band /
--     supply-cap that `wallet_trade_coins` anchors trades to. Any anon-key
--     holder could rewrite the peg immediately before trading for a
--     favorable rate.
--
-- Fix: writes now require the caller to hold edit access on the
-- corresponding admin-settings page (`admin_access`), mirroring the
-- `app_settings_secret_access()` pattern from 0066. Reads stay open — all
-- three are consulted before/without a session (IP evaluation runs
-- pre-login; rates and coin settings render in rider/partner-facing
-- screens).
-- ============================================================================

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

-- ----------------------------------------------------------------------------
-- ip_access_rules
-- ----------------------------------------------------------------------------
drop policy if exists "ip_access_rules insert" on public.ip_access_rules;
drop policy if exists "ip_access_rules update" on public.ip_access_rules;
drop policy if exists "ip_access_rules delete" on public.ip_access_rules;

create policy "ip_access_rules insert" on public.ip_access_rules
  for insert to public
  with check (public.admin_write_access('admin-settings-ip-access'));

create policy "ip_access_rules update" on public.ip_access_rules
  for update to public
  using (public.admin_write_access('admin-settings-ip-access'))
  with check (public.admin_write_access('admin-settings-ip-access'));

create policy "ip_access_rules delete" on public.ip_access_rules
  for delete to public
  using (public.admin_write_access('admin-settings-ip-access'));

revoke insert, update, delete on public.ip_access_rules from anon;

-- ----------------------------------------------------------------------------
-- commission_rates
-- ----------------------------------------------------------------------------
drop policy if exists "commission_rates insert" on public.commission_rates;
drop policy if exists "commission_rates update" on public.commission_rates;
drop policy if exists "commission_rates delete" on public.commission_rates;

create policy "commission_rates insert" on public.commission_rates
  for insert to public
  with check (public.admin_write_access('admin-settings-commission'));

create policy "commission_rates update" on public.commission_rates
  for update to public
  using (public.admin_write_access('admin-settings-commission'))
  with check (public.admin_write_access('admin-settings-commission'));

create policy "commission_rates delete" on public.commission_rates
  for delete to public
  using (public.admin_write_access('admin-settings-commission'));

revoke insert, update, delete on public.commission_rates from anon;

-- ----------------------------------------------------------------------------
-- get_coin_settings
-- ----------------------------------------------------------------------------
drop policy if exists "get_coin_settings insert" on public.get_coin_settings;
drop policy if exists "get_coin_settings update" on public.get_coin_settings;

create policy "get_coin_settings insert" on public.get_coin_settings
  for insert to public
  with check (public.admin_write_access('admin-settings-get-coin'));

create policy "get_coin_settings update" on public.get_coin_settings
  for update to public
  using (public.admin_write_access('admin-settings-get-coin'))
  with check (public.admin_write_access('admin-settings-get-coin'));

revoke insert, update on public.get_coin_settings from anon;
