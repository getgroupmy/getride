-- ============================================================================
-- Notify partners on raised fare (re-offer) as well as new requests
-- ----------------------------------------------------------------------------
-- The ride-request push webhook (0051, reworked in 0067) only fired on INSERT,
-- so a partner whose app was backgrounded or whose phone was locked got an OS
-- push for a brand-new request but NOT when the passenger raised their fare on
-- an already-open request. A fare raise (`raiseRideRequestFare`) is a fresh,
-- higher offer to the partner queue and deserves the same lock-screen push.
--
-- This migration re-defines `notify_partners_on_ride_request()` to also handle
-- UPDATE, firing only when an open request's fare actually increases — every
-- other open-row update (partner counter-offers, live-location writes, etc.) is
-- ignored so partners aren't spammed. The trigger is recreated to run on
-- INSERT OR UPDATE.
--
-- Still routes through the shared `send_push_webhook` helper from 0067, so it
-- only needs the Vault `project_url` secret and never blocks the parent write.
--
-- Safe to re-run.
-- ============================================================================

create or replace function public.notify_partners_on_ride_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_pickup text;
  v_fare   text;
  v_title  text;
  v_body   text;
begin
  -- Only ever notify about requests that are still open (biddable).
  if new.status is distinct from 'open' then
    return new;
  end if;

  -- On UPDATE, fire only when the passenger raised their fare on the open row.
  -- Skip every other open-row update so the partner queue isn't spammed.
  if tg_op = 'UPDATE'
     and not (new.fare is distinct from old.fare
              and coalesce(new.fare, 0) > coalesce(old.fare, 0)) then
    return new;
  end if;

  v_pickup := coalesce(nullif(new.pickup_name, ''), nullif(new.pickup_address, ''), 'a nearby location');
  v_fare   := case when new.fare is not null
                   then ' • ' || coalesce(new.currency, '') || ' ' || new.fare::text
                   else '' end;
  v_title  := case when tg_op = 'UPDATE' then 'Fare increased' else 'New ride request' end;
  v_body   := case when tg_op = 'UPDATE' then 'Higher fare — pickup at ' else 'Pickup at ' end
              || v_pickup || v_fare;

  perform public.send_push_webhook(jsonb_build_object(
    'title', v_title,
    'body', v_body,
    'audience', 'partners',
    'data', jsonb_build_object(
      'type', case when tg_op = 'UPDATE' then 'ride_request_fare_raised' else 'ride_request' end,
      'ride_request_id', new.id
    )
  ));

  return new;
exception when others then
  -- Never let a notification failure block the ride request write.
  return new;
end;
$$;

do $$
begin
  drop trigger if exists trg_ride_request_push on public.ride_requests;
  create trigger trg_ride_request_push
    after insert or update on public.ride_requests
    for each row execute function public.notify_partners_on_ride_request();
end$$;
