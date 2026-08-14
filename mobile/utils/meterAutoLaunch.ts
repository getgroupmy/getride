/**
 * Meter Digital auto-launch — does this account open into the taxi meter?
 *
 * A taxi meter is not a screen a driver visits; it is the screen the shift is
 * spent on. So an operator can make it the app's landing screen for the drivers
 * who bill on it: `autoLaunch` on the rate card (Admin → Settings → Meter
 * Digital Setting) sends a partner carrying the `teksi` partner type straight to
 * `/meter-digital` on sign-in and on every relaunch, instead of the passenger
 * map.
 *
 * Three things have to line up, and this file is where they are decided:
 *
 *   * the account is a partner whose assigned partner types include TEKSI —
 *     nobody else has a meter to open,
 *   * the rate card that applies where the device is says so, resolved the same
 *     way the meter resolves the card it bills on
 *     (suburb → city → state → country → global), and
 *   * nothing more urgent is already claiming the launch — an in-progress ride
 *     is restored ahead of this, since a hire the driver is in the middle of
 *     outranks the screen they start the next one from.
 *
 * The first two are pure and live here (tested in
 * `utils/__tests__/meterAutoLaunch.test.ts`); the third is the caller's, and is
 * why the `/welcome-back` launch buffer (`app/welcome-back.tsx`) only asks about
 * the meter once its ride-restore lookups have come back empty
 * (`resolveLaunchDestination`).
 *
 * Everything defaults to *not* redirecting. A driver taken somewhere they did
 * not ask to go because a field was missing is a worse failure than one extra
 * tap on the Meter Digital button.
 */

import {
  resolveMeterProfile,
  type MeterProfile,
  type ResolvedMeterProfile,
} from "@/utils/meterSettings";

/** The partner type the meter belongs to, as the `partners` row spells it. */
export const TEKSI_PARTNER_TYPE = "teksi";

/**
 * Does this partner drive a taxi?
 *
 * Matched case-insensitively against the assigned `partner_types`, because the
 * admin catalog stores whatever casing the entry was created with ("TEKSI",
 * "Teksi") while the redirect is about the mode, not the spelling.
 */
export function hasTeksiPartnerType(
  types: readonly unknown[] | null | undefined,
): boolean {
  if (!Array.isArray(types)) return false;
  return types.some(
    (t) => String(t ?? "").trim().toLowerCase() === TEKSI_PARTNER_TYPE,
  );
}

/** Where the device is, as far as the rate cards are concerned. */
export interface MeterAutoLaunchGeo {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  suburb?: string | null;
}

export interface MeterAutoLaunchInput {
  /** Every configured rate card, as fetched (or cached) for this device. */
  profiles: MeterProfile[];
  /** The signed-in account's assigned partner types, or null when not a partner. */
  partnerTypes: readonly unknown[] | null | undefined;
  /**
   * The geography the last meter session resolved its card on, if any. Absent
   * geography falls through to the global card rather than blocking the launch
   * on a reverse-geocode nobody is waiting for.
   */
  geo?: MeterAutoLaunchGeo | null;
}

export type MeterAutoLaunchReason =
  /** The account has no TEKSI partner type — the meter is not theirs to open. */
  | "not-teksi"
  /** The applicable card does not ask for it (the default). */
  | "card-off"
  /** Open the meter. */
  | "launch";

export interface MeterAutoLaunchDecision {
  launch: boolean;
  reason: MeterAutoLaunchReason;
  /** The card the decision was read off, for logging and for the admin's sake. */
  card: ResolvedMeterProfile;
}

/**
 * Whether this launch opens the meter.
 *
 * The card is resolved exactly as the meter resolves the one it bills on, so an
 * operator who turns the redirect on for one city turns it on for the drivers
 * working that city and nobody else. With no geography known yet the global card
 * decides — the alternative would be holding the app on a blank screen while a
 * reverse-geocode finishes, which is a worse trade for a routing choice.
 */
export function resolveMeterAutoLaunch(
  input: MeterAutoLaunchInput,
): MeterAutoLaunchDecision {
  const card = resolveMeterProfile({
    profiles: input.profiles ?? [],
    country: input.geo?.country ?? null,
    state: input.geo?.state ?? null,
    city: input.geo?.city ?? null,
    suburb: input.geo?.suburb ?? null,
  });

  if (!hasTeksiPartnerType(input.partnerTypes)) {
    return { launch: false, reason: "not-teksi", card };
  }
  if (!card.profile.autoLaunch) {
    return { launch: false, reason: "card-off", card };
  }
  return { launch: true, reason: "launch", card };
}
