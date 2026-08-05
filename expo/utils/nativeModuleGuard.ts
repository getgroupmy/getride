/**
 * Loading an optional native package without taking the app down with it.
 *
 * Several modules here resolve a native-only package through a guarded
 * `require` so a build without its native half degrades to "unavailable"
 * instead of crashing (`utils/canbus/tcpModule.ts`, `mfiModule.ts`,
 * `bleModule.ts`, `utils/appExit.ts`, `utils/screenOrientation.ts`). Packages
 * that touch the native side at *import* time — `react-native-tcp-socket`
 * builds a `NativeEventEmitter` in `Globals.js`, `react-native-bluetooth-classic`
 * does the same in its default export, `react-native-exit-app`'s entry point is
 * a `TurboModuleRegistry.getEnforcing` spec — throw from inside the require
 * itself, which is exactly what those try/catch blocks were written for.
 *
 * Except a plain try/catch does not catch it. Metro's module loader wraps the
 * *outermost* require of a tick in its own guard:
 *
 * ```js
 * function guardedLoadModule(moduleId, module) {
 *   if (!inGuard && global.ErrorUtils) {
 *     inGuard = true;
 *     try { returnValue = loadModuleImplementation(moduleId, module); }
 *     catch (e) { global.ErrorUtils.reportFatalError(e); }   // <- swallowed here
 *     inGuard = false;
 *     return returnValue;
 *   }
 *   return loadModuleImplementation(moduleId, module);
 * }
 * ```
 *
 * The throw never reaches the caller — it is handed to `reportFatalError`,
 * which is a red box in development and the fatal global handler in
 * production, and `require` returns `undefined` as if nothing happened. That is
 * how a screen that only asked *which transports exist* died on an
 * "Invariant Violation: native module doesn't exist" it had already wrapped in
 * a try/catch.
 *
 * So the load has to be guarded on both channels: the throw (a require outside
 * Metro's guard, or any other failure) and the fatal report (the guarded one).
 * The swap is only in place for the synchronous duration of the load, and the
 * previous reporter is always restored — including when the load throws, and
 * including when one guarded load nests inside another.
 *
 * This is the backstop, not the first line of defence: where the missing native
 * module can be detected *before* the require (`isTcpNativeLinked` &co.),
 * callers check that first and never import the package at all.
 */

/** The slice of RN's `ErrorUtils` this module touches. */
interface ErrorUtilsLike {
  reportFatalError?: (error: unknown) => void;
}

function getErrorUtils(): ErrorUtilsLike | undefined {
  return (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
}

/**
 * Run `load` (a `require` of an optional native package) and return its module,
 * or null when the package cannot be loaded in this binary.
 *
 * Never throws, and never lets an import-time failure reach the red box: a
 * missing native driver is an answer, not a crash.
 *
 * @param label package name, for the breadcrumb log only.
 */
export function loadOptionalNativeModule<T>(
  label: string,
  load: () => T | null | undefined,
): T | null {
  const errorUtils = getErrorUtils();
  const previousReporter = errorUtils?.reportFatalError;
  const canIntercept = !!errorUtils && typeof previousReporter === "function";
  let reported: unknown;
  let didReport = false;

  if (canIntercept && errorUtils) {
    errorUtils.reportFatalError = (error: unknown) => {
      didReport = true;
      reported = error;
    };
  }

  try {
    const mod = load();
    if (didReport) {
      console.log(`[nativeModuleGuard] ${label} is not available here`, reported);
      return null;
    }
    return (mod ?? null) as T | null;
  } catch (e) {
    console.log(`[nativeModuleGuard] ${label} is not available here`, e);
    return null;
  } finally {
    // Restore whatever was there when we started — the original reporter, or
    // an outer guard's stub when these nest.
    if (canIntercept && errorUtils) {
      errorUtils.reportFatalError = previousReporter;
    }
  }
}
