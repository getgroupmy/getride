import { Platform } from "react-native";

/**
 * Installs a process-wide guard that catches unhandled promise rejections and
 * uncaught errors, logs them with full detail, and prevents *content-less*
 * values (e.g. a bare `{}` or `null` rejected by a network / realtime call)
 * from surfacing as an opaque "Runtime error" in the preview overlay.
 *
 * Real errors with a message or stack are left untouched so they still show up
 * and can be fixed. This only swallows values that carry no actionable info.
 */

let installed = false;

/** True when the value has no message/stack we could ever act on. */
function isContentlessError(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (value instanceof Error) {
    return !value.message && !value.stack;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const hasMessage =
      typeof obj.message === "string" && obj.message.trim().length > 0;
    const hasStack =
      typeof obj.stack === "string" && obj.stack.trim().length > 0;
    if (hasMessage || hasStack) return false;
    // No own enumerable keys -> a bare {} with nothing useful inside.
    return Object.keys(obj).length === 0;
  }
  return false;
}

export function installGlobalErrorGuard(): void {
  if (installed) return;
  installed = true;

  // 1) Unhandled promise rejections (the usual source of the empty `{}`).
  const globalAny = globalThis as unknown as {
    addEventListener?: (type: string, cb: (ev: unknown) => void) => void;
    HermesInternal?: unknown;
  };

  if (typeof globalAny.addEventListener === "function") {
    globalAny.addEventListener("unhandledrejection", (event: unknown) => {
      const reason = (event as { reason?: unknown })?.reason ?? event;
      if (isContentlessError(reason)) {
        console.log(
          "[globalErrorGuard] Swallowed content-less unhandled rejection:",
          reason
        );
        const preventable = event as { preventDefault?: () => void };
        if (typeof preventable?.preventDefault === "function") {
          preventable.preventDefault();
        }
        return;
      }
      console.log("[globalErrorGuard] Unhandled rejection:", reason);
    });
  }

  // 2) Uncaught synchronous errors via the RN global handler.
  const errorUtils = (
    globalThis as unknown as {
      ErrorUtils?: {
        getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler?: (
          cb: (error: unknown, isFatal?: boolean) => void
        ) => void;
      };
    }
  ).ErrorUtils;

  if (errorUtils?.setGlobalHandler && errorUtils.getGlobalHandler) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      if (!isFatal && isContentlessError(error)) {
        console.log(
          "[globalErrorGuard] Swallowed content-less non-fatal error:",
          error
        );
        return;
      }
      if (typeof previous === "function") {
        previous(error, isFatal);
      }
    });
  }

  console.log(`[globalErrorGuard] installed (platform=${Platform.OS})`);
}
