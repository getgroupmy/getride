/**
 * Native access to `expo-screen-orientation`, kept behind a guarded require for
 * the same reason as the CANBus transport modules (`utils/canbus/*Module.ts`):
 * the JS half of the package resolves in any bundle, but the native side only
 * exists in a binary prebuilt since the dependency landed. An older installed
 * build would otherwise throw from a screen that is only trying to lay itself
 * out, instead of falling back to asking the driver to rotate the device.
 *
 * Both calls swallow their failures and report through the return value —
 * callers turn that into `OrientationLockState` (`utils/orientationLock.ts`).
 */

let cache: any | null | undefined;

/** The `expo-screen-orientation` module, or null when it cannot be loaded. */
function loadScreenOrientation(): any | null {
  if (cache !== undefined) return cache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-screen-orientation");
    cache = mod?.default ?? mod ?? null;
  } catch {
    cache = null;
  }
  return cache;
}

/**
 * `OrientationLock.LANDSCAPE` — both landscape directions, so a dash mount
 * works whichever way round the phone sits, but portrait is refused. The
 * literal is the fallback for a module shape without the enum.
 */
const LANDSCAPE_LOCK = 4;

/**
 * Pin the screen to landscape. Resolves true only when the OS accepted it.
 */
export async function lockLandscape(): Promise<boolean> {
  const mod = loadScreenOrientation();
  if (typeof mod?.lockAsync !== "function") return false;
  try {
    await mod.lockAsync(mod.OrientationLock?.LANDSCAPE ?? LANDSCAPE_LOCK);
    return true;
  } catch (e) {
    console.log("[screenOrientation] landscape lock unavailable", e);
    return false;
  }
}

/** Hand rotation back to the app default (`orientation: "default"`). */
export async function unlockOrientation(): Promise<void> {
  const mod = loadScreenOrientation();
  if (typeof mod?.unlockAsync !== "function") return;
  try {
    await mod.unlockAsync();
  } catch (e) {
    console.log("[screenOrientation] unlock failed", e);
  }
}
