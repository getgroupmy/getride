-- 0079: Surface the current user's own referral in their wallet.
--
-- After a new user signs up with a referral link (migration 0078), the wallet
-- should show "You were invited by <name>" plus the welcome bonus they earned.
-- The referred user can already read their own row in public.referrals (RLS),
-- but "profiles self read" prevents them from reading the inviter's name.
-- get_my_referral() bridges that gap with a SECURITY DEFINER lookup that only
-- ever returns the caller's own referral record — never anyone else's.

create or replace function public.get_my_referral()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_referrer uuid;
  v_referred_coins numeric := 0;
  v_code text;
  v_created timestamptz;
  v_name text := '';
begin
  if v_user is null then
    return jsonb_build_object('referred', false);
  end if;

  select referrer_user_id, coalesce(referred_coins, 0), code, created_at
    into v_referrer, v_referred_coins, v_code, v_created
    from public.referrals
   where referred_user_id = v_user
   limit 1;

  if v_referrer is null then
    return jsonb_build_object('referred', false);
  end if;

  select coalesce(nullif(trim(name), ''), '')
    into v_name
    from public.profiles
   where id = v_referrer;

  return jsonb_build_object(
    'referred', true,
    'referrer_name', v_name,
    'referred_coins', v_referred_coins,
    'code', v_code,
    'created_at', v_created
  );
end;
$$;

grant execute on function public.get_my_referral() to authenticated;

notify pgrst, 'reload schema';
