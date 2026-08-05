/**
 * Leaving the meter — the two configurable keys of the console's exit popup.
 *
 * The promises under test are the ones a driver relies on: a key never claims
 * something the card cannot do (a link that could not open an app falls back to
 * the in-app screen rather than being drawn as a dead button), a card can only
 * be saved with a link that names an app, and a platform that will not let an
 * app close itself says so instead of pretending.
 */

import {
  DEFAULT_METER_LEAVE,
  describeMeterExit,
  describeMeterLeave,
  normalizeMeterLeave,
  normalizeMeterLeaveLabel,
  normalizeMeterLeaveUrl,
  resolveMeterLeave,
  validateMeterLeave,
  type MeterLeaveConfig,
} from "@/utils/meterLeave";

function config(overrides: Partial<MeterLeaveConfig> = {}): MeterLeaveConfig {
  return { ...DEFAULT_METER_LEAVE, ...overrides };
}

describe("normalizeMeterLeaveUrl", () => {
  it("takes a custom scheme, which is how a driver app is opened", () => {
    expect(normalizeMeterLeaveUrl("driverapp://jobs")).toBe("driverapp://jobs");
    expect(normalizeMeterLeaveUrl("  myfleet://  ")).toBe("myfleet://");
  });

  it("takes an https universal link", () => {
    expect(normalizeMeterLeaveUrl("https://dispatch.example.com/driver")).toBe(
      "https://dispatch.example.com/driver",
    );
  });

  it("refuses a string with no scheme — a note to a human is not a link", () => {
    expect(normalizeMeterLeaveUrl("driverapp")).toBeNull();
    expect(normalizeMeterLeaveUrl("open the driver app")).toBeNull();
    expect(normalizeMeterLeaveUrl("")).toBeNull();
    expect(normalizeMeterLeaveUrl(null)).toBeNull();
    expect(normalizeMeterLeaveUrl(42)).toBeNull();
  });

  it("refuses a link with whitespace in it", () => {
    expect(normalizeMeterLeaveUrl("driverapp:// jobs")).toBeNull();
  });

  it("refuses schemes that are script or local-file access, not an app", () => {
    expect(normalizeMeterLeaveUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeMeterLeaveUrl("JavaScript:alert(1)")).toBeNull();
    expect(normalizeMeterLeaveUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeMeterLeaveUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses an absurdly long link rather than storing it", () => {
    expect(normalizeMeterLeaveUrl(`app://${"x".repeat(600)}`)).toBeNull();
  });
});

describe("normalizeMeterLeaveLabel", () => {
  it("collapses whitespace and caps the length the console has to draw", () => {
    expect(normalizeMeterLeaveLabel("  Fleet   dispatch  ")).toBe("Fleet dispatch");
    expect(normalizeMeterLeaveLabel("x".repeat(50))).toHaveLength(22);
  });

  it("is null for nothing entered", () => {
    expect(normalizeMeterLeaveLabel("   ")).toBeNull();
    expect(normalizeMeterLeaveLabel(undefined)).toBeNull();
  });
});

describe("resolveMeterLeave", () => {
  it("defaults to the console's original two keys", () => {
    const { passenger, ehailing } = resolveMeterLeave(config());
    expect(passenger).toMatchObject({ action: "route", route: "/", label: "PASSENGER MODE" });
    expect(ehailing).toMatchObject({
      action: "route",
      route: "/partner-ehailing",
      label: "E-HAILING",
    });
  });

  it("turns the passenger key into an app exit when the card asks", () => {
    const { passenger } = resolveMeterLeave(config({ passenger: "exit" }));
    expect(passenger.action).toBe("exit");
    expect(passenger.route).toBeNull();
    expect(passenger.label).toBe("EXIT");
    // The whole point of the setting, said on the key itself.
    expect(passenger.hint).toContain("stay signed in");
  });

  it("points the e-hailing key at another app, under its own caption", () => {
    const { ehailing } = resolveMeterLeave(
      config({ ehailing: "link", ehailingUrl: "driverapp://jobs", ehailingLabel: "Fleet app" }),
    );
    expect(ehailing).toMatchObject({
      action: "link",
      url: "driverapp://jobs",
      label: "FLEET APP",
      route: null,
    });
  });

  it("names the key for the app even with no caption entered", () => {
    const { ehailing } = resolveMeterLeave(
      config({ ehailing: "link", ehailingUrl: "driverapp://" }),
    );
    expect(ehailing.label).toBe("E-HAILING APP");
  });

  it("falls back to the in-app screen when the link could never open an app", () => {
    // A row written by hand, or by a build that stored the mode without a link:
    // a key that does nothing is worse than the screen the operator didn't pick.
    const { ehailing } = resolveMeterLeave(config({ ehailing: "link", ehailingUrl: "  " }));
    expect(ehailing).toMatchObject({ action: "route", route: "/partner-ehailing", url: null });
  });

  it("does not open a blocked scheme even when one is stored", () => {
    const { ehailing } = resolveMeterLeave(
      config({ ehailing: "link", ehailingUrl: "javascript:alert(1)" }),
    );
    expect(ehailing.action).toBe("route");
    expect(ehailing.url).toBeNull();
  });

  it("offers the original two keys for a card that has no leave half at all", () => {
    // A rate card cached on the device by a build older than this feature — the
    // copy the meter falls back to with no signal. The back key still works.
    const { passenger, ehailing } = resolveMeterLeave(undefined);
    expect(passenger.action).toBe("route");
    expect(ehailing.action).toBe("route");
  });

  it("keeps a card's caption on the in-app key too", () => {
    const { ehailing } = resolveMeterLeave(config({ ehailingLabel: "jobs" }));
    expect(ehailing).toMatchObject({ action: "route", label: "JOBS" });
  });
});

describe("resolveMeterLeave with a catalogue app", () => {
  const picked = config({ ehailing: "link", ehailingAppId: "grab-driver" });

  it("launches by package on an Android phone", () => {
    const { ehailing } = resolveMeterLeave(picked, "android");
    expect(ehailing).toMatchObject({
      action: "link",
      url: "intent://#Intent;package=com.grabtaxi.driver2;end",
      label: "GRAB DRIVER",
    });
  });

  it("offers the store on a platform it has no way into", () => {
    // The catalogue knows Grab's Android package, which says nothing about the
    // iPhone build — so the key installs rather than pretending to launch.
    const withStore = {
      ...picked,
      ehailingStores: { ios: "https://apps.apple.com/app/id123", android: null, huawei: null },
    };
    const { ehailing } = resolveMeterLeave(withStore, "ios");
    expect(ehailing).toMatchObject({
      action: "link",
      url: null,
      store: "https://apps.apple.com/app/id123",
    });
    expect(ehailing.hint).toContain("Install Grab Driver");
  });

  it("falls back to the in-app screen when it can neither open nor install", () => {
    // Nothing for this platform at all: better the screen the operator didn't
    // pick than a key that does nothing.
    const { ehailing } = resolveMeterLeave(picked, "ios");
    expect(ehailing).toMatchObject({ action: "route", route: "/partner-ehailing" });
  });

  it("carries the Play page as the store on Android, derived from the package", () => {
    const { ehailing } = resolveMeterLeave(picked, "android");
    expect(ehailing.store).toBe(
      "https://play.google.com/store/apps/details?id=com.grabtaxi.driver2",
    );
  });

  it("prefers the store page the operator entered over the derived one", () => {
    const own = {
      ...picked,
      ehailingStores: { ios: null, android: "https://play.google.com/store/apps/details?id=x", huawei: null },
    };
    expect(resolveMeterLeave(own, "android").ehailing.store).toBe(
      "https://play.google.com/store/apps/details?id=x",
    );
  });

  it("lets a typed link answer for the platform the catalogue cannot", () => {
    const both = { ...picked, ehailingUrl: "grabdriver://" };
    expect(resolveMeterLeave(both, "ios").ehailing.url).toBe("grabdriver://");
    // ...while the catalogue still wins where it does know the way in.
    expect(resolveMeterLeave(both, "android").ehailing.url).toContain("intent://");
  });

  it("drops an app id that names nothing in the catalogue", () => {
    const stale = config({ ehailing: "link", ehailingAppId: "app-that-was-removed" });
    expect(normalizeMeterLeave(stale).ehailingAppId).toBeNull();
    // ...and with no link either, the key goes back to the in-app screen.
    expect(resolveMeterLeave(stale, "android").ehailing.action).toBe("route");
  });

  it("names the key after the app when the operator gave no caption", () => {
    expect(resolveMeterLeave(picked, "android").ehailing.label).toBe("GRAB DRIVER");
    const captioned = { ...picked, ehailingLabel: "Jobs" };
    expect(resolveMeterLeave(captioned, "android").ehailing.label).toBe("JOBS");
  });

  it("is saveable on the strength of the app alone", () => {
    expect(validateMeterLeave(picked)).toBeNull();
  });
});

describe("describeMeterExit", () => {
  it("closes the app on Android, which always allows it", () => {
    const android = describeMeterExit("android");
    expect(android.supported).toBe(true);
    expect(android.note).toContain("home screen");
  });

  it("closes it on an iOS build that carries the native exit module", () => {
    const ios = describeMeterExit("ios", true);
    expect(ios.supported).toBe(true);
    expect(ios.note).toContain("home screen");
  });

  it("asks an older iOS build to update rather than blaming the setting", () => {
    // The capability is compiled in, so an iOS build that cannot exit is one
    // made before it shipped — that is a new build, not a switch.
    const ios = describeMeterExit("ios", false);
    expect(ios.supported).toBe(false);
    expect(ios.note).toContain("newer build");
    expect(ios.note).toContain("swipe up");
  });

  it("never claims a browser tab can close itself", () => {
    // Even told the platform can exit — the web bundle has no such thing.
    const web = describeMeterExit("web", true);
    expect(web.supported).toBe(false);
    expect(web.note).toContain("tab");
  });

  it("keeps the promise of the setting in every answer: nobody is signed out", () => {
    for (const answer of [
      describeMeterExit("android"),
      describeMeterExit("ios", true),
      describeMeterExit("ios", false),
      describeMeterExit("web"),
    ]) {
      expect(answer.note).toContain("stay signed in");
    }
  });
});

describe("validateMeterLeave", () => {
  it("accepts both in-app keys and an exit key with nothing else set", () => {
    expect(validateMeterLeave(config())).toBeNull();
    expect(validateMeterLeave(config({ passenger: "exit" }))).toBeNull();
  });

  it("refuses to store an app key with no link to open", () => {
    expect(validateMeterLeave(config({ ehailing: "link" }))).toContain("app link");
    expect(validateMeterLeave(config({ ehailing: "link", ehailingUrl: "driverapp" }))).toContain(
      "app link",
    );
  });

  it("accepts an app key that names a scheme", () => {
    expect(
      validateMeterLeave(config({ ehailing: "link", ehailingUrl: "driverapp://jobs" })),
    ).toBeNull();
  });
});

describe("describeMeterLeave", () => {
  it("says nothing about a card that leaves the popup as it comes", () => {
    expect(describeMeterLeave(config())).toEqual([]);
  });

  it("names the answers an operator changed, for the admin card list", () => {
    expect(
      describeMeterLeave(
        config({ passenger: "exit", ehailing: "link", ehailingUrl: "driverapp://" }),
      ),
    ).toEqual(["Leave key closes the app", "E-hailing opens driverapp://"]);
  });

  it("does not advertise a link the console would not open anyway", () => {
    expect(describeMeterLeave(config({ ehailing: "link", ehailingUrl: "nonsense" }))).toEqual([]);
  });
});
