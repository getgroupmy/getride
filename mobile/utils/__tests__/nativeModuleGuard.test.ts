import { loadOptionalNativeModule } from "@/utils/nativeModuleGuard";

type Reporter = (error: unknown) => void;

interface GlobalWithErrorUtils {
  ErrorUtils?: { reportFatalError?: Reporter };
}

const globalAny = globalThis as GlobalWithErrorUtils;

/**
 * Metro's `guardedLoadModule`: the outermost require of a tick does NOT rethrow
 * what the module threw — it hands it to `ErrorUtils.reportFatalError` and
 * returns undefined. This is the behaviour that defeated the plain try/catch
 * around `require("react-native-tcp-socket")`.
 */
function metroGuardedRequire(load: () => unknown): unknown {
  try {
    return load();
  } catch (e) {
    globalAny.ErrorUtils?.reportFatalError?.(e);
    return undefined;
  }
}

describe("loadOptionalNativeModule", () => {
  let reported: unknown[];
  let originalReporter: Reporter;

  beforeEach(() => {
    reported = [];
    originalReporter = (error: unknown) => {
      reported.push(error);
    };
    globalAny.ErrorUtils = { reportFatalError: originalReporter };
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete globalAny.ErrorUtils;
    jest.restoreAllMocks();
  });

  it("returns the module when it loads", () => {
    const mod = { createConnection: () => {} };
    expect(loadOptionalNativeModule("pkg", () => mod)).toBe(mod);
  });

  it("returns null instead of the module's undefined/null", () => {
    expect(loadOptionalNativeModule("pkg", () => undefined)).toBeNull();
    expect(loadOptionalNativeModule("pkg", () => null)).toBeNull();
  });

  it("returns null when the load throws outright", () => {
    expect(
      loadOptionalNativeModule("pkg", () => {
        throw new Error("Native module cannot be null");
      }),
    ).toBeNull();
  });

  it("returns null when Metro swallows the throw into reportFatalError", () => {
    const result = loadOptionalNativeModule("react-native-tcp-socket", () =>
      metroGuardedRequire(() => {
        throw new Error("Invariant Violation: native module doesn't exist");
      }),
    );

    expect(result).toBeNull();
    // The red box the driver used to get: nothing reached the real reporter.
    expect(reported).toHaveLength(0);
  });

  it("restores the previous reporter, whichever way the load ends", () => {
    loadOptionalNativeModule("pkg", () => ({}));
    expect(globalAny.ErrorUtils?.reportFatalError).toBe(originalReporter);

    loadOptionalNativeModule("pkg", () => {
      throw new Error("boom");
    });
    expect(globalAny.ErrorUtils?.reportFatalError).toBe(originalReporter);
  });

  it("keeps reporting fatal errors raised after the load returns", () => {
    loadOptionalNativeModule("pkg", () => ({}));

    const later = new Error("a real crash, later on");
    globalAny.ErrorUtils?.reportFatalError?.(later);
    expect(reported).toEqual([later]);
  });

  it("survives nesting, restoring the outer guard's reporter", () => {
    const outer = loadOptionalNativeModule("outer", () => {
      const inner = loadOptionalNativeModule("inner", () =>
        metroGuardedRequire(() => {
          throw new Error("inner has no native module");
        }),
      );
      expect(inner).toBeNull();
      return { inner };
    });

    expect(outer).toEqual({ inner: null });
    expect(globalAny.ErrorUtils?.reportFatalError).toBe(originalReporter);
    expect(reported).toHaveLength(0);
  });

  it("still works where there is no ErrorUtils at all (web)", () => {
    delete globalAny.ErrorUtils;
    expect(loadOptionalNativeModule("pkg", () => ({ ok: true }))).toEqual({ ok: true });
    expect(
      loadOptionalNativeModule("pkg", () => {
        throw new Error("boom");
      }),
    ).toBeNull();
  });
});
