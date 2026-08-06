import {
  LAUNCH_BUFFER_ROUTE,
  clearLaunchDestination,
  markLaunchDestination,
  markLaunchHandled,
  readLaunchSession,
  resetLaunchSession,
  resolveRootRedirect,
} from "@/utils/launchSession";

beforeEach(() => {
  resetLaunchSession();
});

describe("resolveRootRedirect", () => {
  it("sends an unhandled launch to the buffer", () => {
    expect(resolveRootRedirect({ handled: false, destination: null })).toBe(
      LAUNCH_BUFFER_ROUTE,
    );
  });

  it("never sends a handled launch back to the buffer", () => {
    // The loop this exists to break: remount → root → buffer → meter → remount.
    expect(
      resolveRootRedirect({ handled: true, destination: "/meter-digital" }),
    ).not.toBe(LAUNCH_BUFFER_ROUTE);
    expect(resolveRootRedirect({ handled: true, destination: null })).not.toBe(
      LAUNCH_BUFFER_ROUTE,
    );
  });

  it("puts a driver whose launch opened the meter back on the console", () => {
    expect(
      resolveRootRedirect({ handled: true, destination: "/meter-digital" }),
    ).toBe("/meter-digital");
  });

  it("leaves root alone once the launch has landed anywhere else", () => {
    // Every other destination is a page the user may walk away from; only the
    // console is a mode the app put them in.
    for (const destination of [
      "/",
      "/partner-teksi",
      "/partner-ehailing",
      "/ride-tracking",
      null,
    ]) {
      expect(resolveRootRedirect({ handled: true, destination })).toBeNull();
    }
  });
});

describe("the launch session", () => {
  it("starts unhandled, so the first launch runs the buffer", () => {
    expect(readLaunchSession()).toEqual({ handled: false, destination: null });
    expect(resolveRootRedirect(readLaunchSession())).toBe(LAUNCH_BUFFER_ROUTE);
  });

  it("is handled the moment the buffer is entered, before it has decided", () => {
    markLaunchHandled();
    expect(readLaunchSession()).toEqual({ handled: true, destination: null });
    expect(resolveRootRedirect(readLaunchSession())).toBeNull();
  });

  it("records where the buffer sent the launch", () => {
    markLaunchDestination("/meter-digital");
    expect(readLaunchSession()).toEqual({
      handled: true,
      destination: "/meter-digital",
    });
    expect(resolveRootRedirect(readLaunchSession())).toBe("/meter-digital");
  });

  it("keeps the destination when the buffer is re-marked as handled", () => {
    markLaunchDestination("/meter-digital");
    markLaunchHandled();
    expect(readLaunchSession().destination).toBe("/meter-digital");
  });

  it("forgets the destination when the driver leaves on purpose", () => {
    // Pressing "passenger mode" must not be undone by the restore.
    markLaunchDestination("/meter-digital");
    clearLaunchDestination();
    expect(readLaunchSession()).toEqual({ handled: true, destination: null });
    expect(resolveRootRedirect(readLaunchSession())).toBeNull();
  });

  it("does not re-open the buffer when the destination is cleared", () => {
    markLaunchDestination("/meter-digital");
    clearLaunchDestination();
    expect(readLaunchSession().handled).toBe(true);
  });

  it("forgets everything on sign-out, so the next account runs its own launch", () => {
    markLaunchDestination("/meter-digital");
    resetLaunchSession();
    expect(readLaunchSession()).toEqual({ handled: false, destination: null });
    expect(resolveRootRedirect(readLaunchSession())).toBe(LAUNCH_BUFFER_ROUTE);
  });

  it("hands out copies, so a caller cannot rewrite the launch", () => {
    markLaunchDestination("/meter-digital");
    const snapshot = readLaunchSession();
    snapshot.destination = "/";
    expect(readLaunchSession().destination).toBe("/meter-digital");
  });
});
