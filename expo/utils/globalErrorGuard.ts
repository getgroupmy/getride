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
      // A value with no message/stack is unactionable whether or not it is
      // flagged fatal — surfacing it only produces the opaque `{}` overlay.
      if (isContentlessError(error)) {
        console.log(
          "[globalErrorGuard] Swallowed content-less error (isFatal=" +
            String(isFatal) +
            "):",
          error
        );
        return;
      }
      if (typeof previous === "function") {
        previous(error, isFatal);
      }
    });
  }

  // 3) React Native unhandled promise rejections.
  //
  // On Hermes/RN the `unhandledrejection` event above is NOT dispatched —
  // RN tracks rejections through the bundled `promise` library's
  // rejection-tracking module, and that is what the preview overlay hooks
  // into. We re-enable tracking with our own handler so a content-less `{}`
  // rejection (typically a failed realtime/websocket call in the preview
  // sandbox) is logged but never surfaced as a fake "Runtime error". Real
  // rejections carrying a message/stack are still reported via console.error.
  installRejectionTracking();

  console.log(`[globalErrorGuard] installed (platform=${Platform.OS})`);
}

function installRejectionTracking(): void {
  try {
    // The Promise polyfill RN bundles exposes rejection tracking here.
    // Guarded require: if the path/shape ever changes we just skip silently.
    const tracking =
      require("promise/setimmediate/rejection-tracking") as {
        enable?: (opts: {
          allRejections?: boolean;
          onUnhandled?: (id: unknown, error: unknown) => void;
          onHandled?: (id: unknown) => void;
        }) => void;
      };
    if (typeof tracking?.enable !== "function") return;
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: unknown, error: unknown) => {
        if (isContentlessError(error)) {
          console.log(
            "[globalErrorGuard] Swallowed content-less unhandled rejection (RN):",
            error
          );
          return;
        }
        console.error("[globalErrorGuard] Unhandled promise rejection:", error);
      },
      onHandled: () => {},
    });
    console.log("[globalErrorGuard] RN rejection tracking installed");
  } catch (e) {
    console.log("[globalErrorGuard] RN rejection tracking unavailable", e);
  }
}
