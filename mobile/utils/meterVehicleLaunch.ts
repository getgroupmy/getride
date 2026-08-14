/**
 * Which car the meter is running in.
 *
 * A taxi meter is not a screen; it is a fitting inside one vehicle. So when the
 * console opens — whether the driver pressed Meter Digital or the app landed
 * them there on launch (`utils/meterAutoLaunch.ts`) — it has to know the car it
 * is billing for, and there is exactly one place that fact already lives: the
 * active vehicle session the driver claimed (`vehicle_active_session`, claimed
 * through the `claim_vehicle` RPC, surfaced by
 * `fetchAssignableVehicles` as `inUseByMe`).
 *
 * The rule this file owns is the one the operator asked for:
 *
 *   * a vehicle still connected to this driver — and to nobody else — is the
 *     vehicle the meter opens on, with nothing asked. A shift that was
 *     interrupted by a relaunch resumes in the same car it was being driven in.
 *   * with no such session the driver is *asked* which car they are in, because
 *     claiming one takes it away from every other driver assigned to it. The
 *     meter never picks that for them, not even when there is only one to pick.
 *
 * Two failure modes are deliberately not treated as "no vehicle":
 *
 *   * the fleet could not be read at all — no Supabase session (a legacy
 *     local-PIN login), an unconfigured client, a failed query. Nothing is
 *     known, so nothing is claimed and nothing is asked: the console opens
 *     unbound rather than trapping a driver behind a picker the app could not
 *     fill.
 *   * the claimed vehicle has since been blocked or left mid-onboarding. It is
 *     no longer a car the app will let anyone drive, so it does not silently
 *     become the meter's vehicle either — the picker is raised, where the row
 *     says why.
 *
 * Asking is a *request*, never a gate: the picker can be dismissed and the
 * console still works. A fleet whose vehicles are not in the app yet must not
 * lose the ability to run a meter.
 *
 * Pure and tested in `utils/__tests__/meterVehicleLaunch.test.ts`; the IO half
 * (fetch, claim) stays in `utils/vehicleAssignmentStore.ts` and the console
 * wiring in `app/meter-digital.tsx`.
 */

/**
 * The shape this module needs off an assignable vehicle.
 *
 * Structural rather than an import of `AssignableVehicle` so the rule can be
 * exercised with plain objects, and so nothing pure ever reaches for the
 * Supabase client. `AssignableVehicle` satisfies it as it stands.
 */
export interface MeterVehicleRow {
  vehicle: {
    id: string;
    plate?: string | null;
    make?: string | null;
    model?: string | null;
  };
  /** The driver asking has this vehicle claimed right now. */
  inUseByMe: boolean;
  /** Somebody else is driving it. */
  inUseByOther: boolean;
  /** The app will let this driver take it out (approved, documented, free). */
  selectable: boolean;
}

export type MeterVehicleLaunchReason =
  /** A live session of this driver's — open the meter on it. */
  | "bound"
  /** Nothing claimed, but there are cars to choose from. */
  | "choose"
  /** Nothing claimed and nothing claimable — the driver needs a vehicle first. */
  | "none"
  /** The fleet could not be read; the meter opens unbound and asks nothing. */
  | "unavailable";

export interface MeterVehicleLaunchDecision<T extends MeterVehicleRow> {
  reason: MeterVehicleLaunchReason;
  /** The vehicle the console binds to, or null when the driver must choose. */
  vehicle: T | null;
  /** What the picker offers, claimable rows first. */
  choices: T[];
  /** Whether to raise the picker on the driver. */
  prompt: boolean;
  /** One line naming the situation, for the picker and the console. */
  message: string;
}

export interface MeterVehicleLaunchInput<T extends MeterVehicleRow> {
  /** Every vehicle this driver may drive, as the assignment store returned it. */
  vehicles: readonly T[];
  /**
   * Whether that list is worth believing. False for an unauthenticated (legacy
   * local-PIN) session or a query that failed — an empty list then means "not
   * known", not "no vehicles".
   */
  canRead: boolean;
}

/**
 * Is this row the driver's own live session?
 *
 * `inUseByOther` is checked as well as `inUseByMe` even though the store cannot
 * currently set both — the operator's rule is "connected to the partner id and
 * not used by another", and this is where that reads as written.
 */
function isMine(row: MeterVehicleRow): boolean {
  return row.inUseByMe && !row.inUseByOther;
}

/** Deterministic order for the picker: claimable first, then by plate. */
function orderChoices<T extends MeterVehicleRow>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort((a, b) => {
    const rank = (r: T) => (isMine(r) ? 0 : r.selectable ? 1 : 2);
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return String(a.vehicle.plate ?? "").localeCompare(String(b.vehicle.plate ?? ""));
  });
}

/**
 * The vehicle the console opens on, and whether the driver has to be asked.
 *
 * The claimed vehicle wins outright; everything else is a request. Nothing here
 * writes — claiming a vehicle the driver picks is the caller's job, through
 * `claimVehicle`, so the RPC stays the single place a session is taken.
 */
export function resolveMeterVehicleLaunch<T extends MeterVehicleRow>(
  input: MeterVehicleLaunchInput<T>,
): MeterVehicleLaunchDecision<T> {
  const vehicles = input.vehicles ?? [];

  if (!input.canRead) {
    return {
      reason: "unavailable",
      vehicle: null,
      choices: [],
      prompt: false,
      message: "Vehicle list unavailable — the meter is running unassigned.",
    };
  }

  const mine = vehicles.find((v) => isMine(v) && v.selectable);
  if (mine) {
    return {
      reason: "bound",
      vehicle: mine,
      choices: orderChoices(vehicles),
      prompt: false,
      message: `Running in ${describeMeterVehicle(mine)}.`,
    };
  }

  const choices = orderChoices(vehicles);
  const claimable = choices.filter((v) => v.selectable);
  if (claimable.length > 0) {
    return {
      reason: "choose",
      vehicle: null,
      choices,
      prompt: true,
      message: "Select the vehicle you are driving before you start the shift.",
    };
  }

  return {
    reason: "none",
    vehicle: null,
    choices,
    prompt: true,
    message:
      vehicles.length > 0
        ? "None of your vehicles is available to drive right now."
        : "No vehicle is assigned to you yet. Add one to run the meter in it.",
  };
}

/** "WXY 1234 · Perodua Myvi", with whatever parts the row actually carries. */
export function describeMeterVehicle(row: MeterVehicleRow | null | undefined): string {
  if (!row) return "no vehicle";
  const plate = String(row.vehicle.plate ?? "").trim();
  const model = [row.vehicle.make, row.vehicle.model]
    .map((p) => String(p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
  if (plate && model) return `${plate} · ${model}`;
  return plate || model || "no vehicle";
}

/**
 * The plate the console shows, in priority order: the vehicle the meter is
 * actually bound to, then whatever the permit screen handed over, then nothing.
 *
 * The bound vehicle wins because it is the car the fare is being measured in;
 * the permit plate is the car the driver is *licensed* for, which is the same
 * thing on a compliant shift and a mismatch worth showing honestly when it is
 * not.
 */
export function resolveMeterPlate(
  bound: MeterVehicleRow | null | undefined,
  permitPlate: string | null | undefined,
): string | null {
  const fromVehicle = String(bound?.vehicle.plate ?? "").trim();
  if (fromVehicle) return fromVehicle;
  const fromPermit = String(permitPlate ?? "").trim();
  return fromPermit.length > 0 && fromPermit !== "—" ? fromPermit : null;
}
