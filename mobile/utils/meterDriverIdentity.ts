/**
 * Who the console says is driving.
 *
 * The DRIVER panel on the taxi meter prints a name, a portrait, a licence
 * number and a plate. None of that is the meter's own knowledge — it is the
 * taxi driver permit, the same card `app/partner-teksi.tsx` renders above
 * "Start Pickup" (`utils/driverPermitSource.ts`).
 *
 * That screen used to be the *only* way the meter learned it: the Meter Digital
 * button pushed the permit fields across as route params. So the other way in —
 * the launch buffer sending a TEKSI driver straight to the console on startup
 * (`utils/meterAutoLaunch.ts`) — arrived with no params at all, and the panel
 * fell back to the account: the profile name instead of the permit name, the
 * profile avatar instead of the permit portrait, and a blank licence row. The
 * same shift, the same driver, a different card depending on which door they
 * came through.
 *
 * So the console now loads the permit itself and this module decides what each
 * field shows. The params are kept as a *seed* rather than dropped, for one
 * reason: they are already in hand at the first frame, so the panel launched
 * from the permit screen renders complete immediately and never flickers from
 * account name to permit name while the load runs.
 *
 * Two things are deliberately not treated as facts:
 *
 *   * the placeholder dash. `loadDriverPermitData` fills unknown fields with
 *     "—" so the permit card can print a row for them; a dash is the absence of
 *     a value, and must not beat the account's real name.
 *   * the stock portrait (`PERMIT_STOCK_PHOTO`). It is a photograph of a
 *     stranger, shipped so the permit card has a face-shaped thing to draw. The
 *     permit screen can afford it; a meter that prints it beside a licence
 *     number is showing the wrong person as the driver on hire, so it is
 *     skipped and the account avatar — or the empty avatar glyph — is used.
 *
 * Pure and tested in `utils/__tests__/meterDriverIdentity.test.ts`. The load
 * itself stays in `utils/driverPermitSource.ts` and the wiring in
 * `app/meter-digital.tsx`.
 */

/**
 * The portrait `loadDriverPermitData` falls back to when no permit photo and no
 * account avatar could be found. Defined here — rather than inline in the
 * loader — because this module has to be able to recognise it.
 */
export const PERMIT_STOCK_PHOTO =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces";

/** The name the panel prints when nothing at all is known. */
export const UNKNOWN_DRIVER_NAME = "DRIVER";

/** What the permit screen hands over on its way to the console. */
export interface MeterDriverParams {
  driver?: string | null;
  license?: string | null;
  photo?: string | null;
  plate?: string | null;
}

/**
 * The shape this module needs off a loaded permit.
 *
 * Structural rather than an import of `DriverPermitData` so the rule can be
 * exercised with plain objects and nothing pure reaches the network. The real
 * `DriverPermitData` satisfies it.
 */
export interface MeterDriverPermit {
  name?: string | null;
  permitNumber?: string | null;
  vehiclePlate?: string | null;
  photoUri?: string | null;
}

/** What the signed-in account knows about itself, as a last resort. */
export interface MeterDriverAccount {
  profileName?: string | null;
  profileAvatar?: string | null;
}

export interface MeterDriverIdentity {
  /** Always printable, always upper case — the panel has no empty state. */
  name: string;
  /** Permit reference number, or null for the panel's dash. */
  license: string | null;
  /** A portrait that is actually of this driver, or null for the glyph. */
  photo: string | null;
  /**
   * The plate the *permit* names — the fallback half of `resolveMeterPlate`,
   * which still prefers the vehicle the meter is bound to.
   */
  plate: string | null;
}

/** A real value, or nothing. Blank strings and the placeholder dash are nothing. */
function firstValue(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    if (trimmed === "—" || trimmed === "-") continue;
    return trimmed;
  }
  return null;
}

/** As above, but the shipped stock portrait does not count as a photo. */
function firstPhoto(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const found = firstValue(value);
    if (found && found !== PERMIT_STOCK_PHOTO) return found;
  }
  return null;
}

/**
 * Resolve the DRIVER panel, field by field, in priority order:
 * route params (already in hand) → the loaded permit → the account.
 *
 * `permit` is null until the load lands — and stays null for a driver with no
 * permit on file — so every field degrades on its own rather than the panel
 * waiting for all of them.
 */
export function resolveMeterDriver(
  params: MeterDriverParams | null | undefined,
  permit: MeterDriverPermit | null | undefined,
  account: MeterDriverAccount | null | undefined,
): MeterDriverIdentity {
  const name = firstValue(params?.driver, permit?.name, account?.profileName);
  return {
    name: (name ?? UNKNOWN_DRIVER_NAME).toUpperCase(),
    license: firstValue(params?.license, permit?.permitNumber),
    photo: firstPhoto(params?.photo, permit?.photoUri, account?.profileAvatar),
    plate: firstValue(params?.plate, permit?.vehiclePlate),
  };
}
