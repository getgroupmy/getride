/**
 * Where an authenticated app launch lands.
 *
 * Every launch — a cold relaunch with a saved session, or the moment sign-in
 * finishes — is routed through the "Welcome back" buffer (`app/welcome-back.tsx`)
 * rather than dropping the user straight onto the passenger map. The buffer does
 * the async lookups (in-progress ride, partner type, rate card) behind a
 * greeting, then hands the answer here: this function owns only the *priority*
 * between the possible destinations, so that ordering is one pure, tested rule
 * instead of a chain of early-returns buried in a screen.
 *
 * The order, highest first:
 *
 *   1. a rider's in-progress request — they were in a ride when the app died,
 *   2. a partner's in-progress ride — same, from the driver's side,
 *   3. the taxi meter, when a TEKSI driver's rate card asks for it,
 *   4. the partner console, for a tablet (its standing home, pre-dating this),
 *   5. the passenger map — the ordinary home.
 *
 * A ride outranks the meter deliberately: a hire the driver is in the middle of
 * is worth more than the screen they start the next one from. The meter check
 * itself is `resolveMeterAutoLaunch`; this only decides it loses to a live ride.
 */

export type LaunchKind =
  | "ride-restore"
  | "partner-ride"
  | "meter"
  | "partner-console"
  | "home";

export interface LaunchDestinationInput {
  /** A rider request was found that should be resumed. */
  hasRiderRestore: boolean;
  /** A partner ride was found that should be resumed. */
  hasPartnerRide: boolean;
  /** The operator's rate card opens a TEKSI driver straight into the meter. */
  meterAutoLaunch: boolean;
  /** Tablets land on the partner console rather than the passenger map. */
  isTablet: boolean;
}

export function resolveLaunchDestination(input: LaunchDestinationInput): LaunchKind {
  if (input.hasRiderRestore) return "ride-restore";
  if (input.hasPartnerRide) return "partner-ride";
  if (input.meterAutoLaunch) return "meter";
  if (input.isTablet) return "partner-console";
  return "home";
}
