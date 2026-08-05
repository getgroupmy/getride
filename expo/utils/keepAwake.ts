/**
 * Thin, crash-proof wrapper around `expo-keep-awake`.
 *
 * `expo-keep-awake` is a core Expo module (available in Expo Go and every
 * dev/prod build), but it is loaded behind a guarded require for the same
 * reason as the CANBus transports and `expo-screen-orientation`: the JS half
 * resolves everywhere, yet a very old binary prebuilt before the dependency
 * landed would not have the native side linked. On web it is a harmless no-op.
 *
 * A *tag* scopes the lock so the always-on controller can hold exactly one
 * activation and release it when the active page changes — an untagged
 * activation/deactivation could stomp on a lock some other screen owns.
 */

type KeepAwakeModule = {
  activateKeepAwakeAsync?: (tag?: string) => Promise<void> | void;
  deactivateKeepAwake?: (tag?: string) => Promise<void> | void;
};

let cached: KeepAwakeModule | null | undefined;

function loadModule(): KeepAwakeModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require("expo-keep-awake") as KeepAwakeModule;
  } catch (e) {
    console.log("[keepAwake] expo-keep-awake unavailable", e);
    cached = null;
  }
  return cached;
}

/** True when the native keep-awake module is linked into this binary. */
export function isKeepAwakeAvailable(): boolean {
  const mod = loadModule();
  return !!(mod && typeof mod.activateKeepAwakeAsync === "function");
}

/** Hold the screen awake under `tag`. Safe to call repeatedly. */
export async function activateKeepAwake(tag: string): Promise<void> {
  const mod = loadModule();
  if (!mod?.activateKeepAwakeAsync) return;
  try {
    await mod.activateKeepAwakeAsync(tag);
  } catch (e) {
    console.log("[keepAwake] activate failed", e);
  }
}

/** Release the screen lock held under `tag`. Safe to call when none is held. */
export async function deactivateKeepAwake(tag: string): Promise<void> {
  const mod = loadModule();
  if (!mod?.deactivateKeepAwake) return;
  try {
    await mod.deactivateKeepAwake(tag);
  } catch (e) {
    console.log("[keepAwake] deactivate failed", e);
  }
}
