/**
 * The dispatch-app catalogue behind the meter's e-hailing key.
 *
 * The promises under test are about honesty: the catalogue only ever produces a
 * link it can stand behind (a package id really is a launch intent and really is
 * a Play address; an iOS scheme is only ever one that was supplied), and a
 * failed detection is never worded as "not installed", because neither platform
 * can tell us that.
 */

import {
  describeAppPresence,
  meterLeaveAppById,
  meterLeaveAppLink,
  meterLeaveAppNeedsLink,
  meterLeaveAppStore,
  METER_LEAVE_APPS,
  storePlatformFor,
  type MeterLeaveApp,
} from "@/utils/meterLeaveApps";

const grab = meterLeaveAppById("grab-driver")!;

describe("the catalogue itself", () => {
  it("gives every entry a package to launch and find it by", () => {
    // The one fact each entry must carry: without it there is nothing to open,
    // nothing to probe and no store page.
    for (const app of METER_LEAVE_APPS) {
      expect(app.androidPackage).toBeTruthy();
      expect(app.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("never carries a guessed iOS scheme", () => {
    // A wrong scheme is a key that fails on every press, so an entry either
    // knows the scheme or says it doesn't. Any scheme added later must be a
    // real one, with a colon.
    for (const app of METER_LEAVE_APPS) {
      if (app.iosScheme !== null) expect(app.iosScheme).toContain(":");
    }
  });

  it("has unique ids, since the card stores one", () => {
    const ids = METER_LEAVE_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("meterLeaveAppById", () => {
  it("finds an entry and shrugs off anything else", () => {
    expect(meterLeaveAppById("grab-driver")?.name).toBe("Grab Driver");
    expect(meterLeaveAppById("  grab-driver  ")?.id).toBe("grab-driver");
    expect(meterLeaveAppById("not-an-app")).toBeNull();
    expect(meterLeaveAppById(null)).toBeNull();
    expect(meterLeaveAppById("")).toBeNull();
  });
});

describe("meterLeaveAppLink", () => {
  it("launches by package on Android, which needs no scheme", () => {
    expect(meterLeaveAppLink(grab, "android")).toBe(
      "intent://#Intent;package=com.grabtaxi.driver2;end",
    );
  });

  it("gives Huawei the same link — same package, different shop", () => {
    expect(meterLeaveAppLink(grab, "huawei")).toBe(meterLeaveAppLink(grab, "android"));
  });

  it("has nothing for iOS until a scheme is supplied", () => {
    expect(meterLeaveAppLink(grab, "ios")).toBeNull();

    const withScheme: MeterLeaveApp = { ...grab, iosScheme: "grabdriver://" };
    expect(meterLeaveAppLink(withScheme, "ios")).toBe("grabdriver://");
  });

  it("is null for no app at all", () => {
    expect(meterLeaveAppLink(null, "android")).toBeNull();
  });
});

describe("meterLeaveAppStore", () => {
  it("derives the Play page from the package, which is the same fact", () => {
    expect(meterLeaveAppStore(grab, "android")).toBe(
      "https://play.google.com/store/apps/details?id=com.grabtaxi.driver2",
    );
  });

  it("refuses to invent an App Store or AppGallery address", () => {
    // Those are per-app numbers that no package name yields — guessing one
    // would send a driver to install the wrong app.
    expect(meterLeaveAppStore(grab, "ios")).toBeNull();
    expect(meterLeaveAppStore(grab, "huawei")).toBeNull();
  });
});

describe("storePlatformFor", () => {
  it("sends Huawei and Honor devices to AppGallery", () => {
    expect(storePlatformFor("android", "Huawei")).toBe("huawei");
    expect(storePlatformFor("android", "HONOR")).toBe("huawei");
  });

  it("leaves every other Android on Play", () => {
    expect(storePlatformFor("android", "samsung")).toBe("android");
    expect(storePlatformFor("android", null)).toBe("android");
    expect(storePlatformFor("android")).toBe("android");
  });

  it("knows an iPhone", () => {
    expect(storePlatformFor("ios", "Apple")).toBe("ios");
  });
});

describe("describeAppPresence", () => {
  it("never claims an app is not installed, only that it wasn't found", () => {
    // Neither platform will answer that question, so the wording must not
    // pretend it did — an operator told an app is missing from the phone in
    // their hand stops trusting the whole picker.
    expect(describeAppPresence("present")).toBe("On this device");
    expect(describeAppPresence("not-detected")).not.toMatch(/not installed/i);
    expect(describeAppPresence("not-detected")).toContain("Not detected");
    expect(describeAppPresence("unknown")).toContain("Can't check");
  });
});

describe("meterLeaveAppNeedsLink", () => {
  it("flags the platform an entry cannot reach on its own", () => {
    expect(meterLeaveAppNeedsLink(grab, "ios")).toBe(true);
    expect(meterLeaveAppNeedsLink(grab, "android")).toBe(false);
    expect(meterLeaveAppNeedsLink(null, "ios")).toBe(false);
  });
});
