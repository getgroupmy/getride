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
  describeAppIosRoute,
  describeAppPresence,
  meterLeaveAppById,
  meterLeaveAppLink,
  meterLeaveAppNeedsLink,
  meterLeaveAppProbe,
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

  it("never carries a guessed iOS route", () => {
    // A wrong scheme is a key that fails on every press, so an entry either
    // knows the route or says it doesn't. A universal link has to be https —
    // that is the only kind iOS will hand to an app.
    for (const app of METER_LEAVE_APPS) {
      if (app.iosScheme !== null) expect(app.iosScheme).toContain(":");
      if (app.iosLink !== null) expect(app.iosLink.startsWith("https://")).toBe(true);
    }
  });

  it("never points iOS at an App Store page as the way in", () => {
    // An App Store URL opens the App Store, never the app — even with the app
    // on the home screen. It belongs in `stores`, and only there.
    for (const app of METER_LEAVE_APPS) {
      expect(app.iosLink ?? "").not.toContain("apps.apple.com");
      expect(app.iosScheme ?? "").not.toContain("apps.apple.com");
    }
  });

  it("has unique ids, since the card stores one", () => {
    const ids = METER_LEAVE_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("GVRIDE", () => {
  const gv = meterLeaveAppById("gvride")!;

  it("opens the installed app on an iPhone, by universal link", () => {
    // `ride.gvmalaysia.com` publishes an apple-app-site-association naming
    // N57RJ3572T.com.jobtepi.app and claiming /app/*, so this path opens the
    // app itself — which an App Store URL never does.
    expect(meterLeaveAppLink(gv, "ios")).toBe("https://ride.gvmalaysia.com/app/");
  });

  it("opens it by package on Android and Huawei", () => {
    expect(meterLeaveAppLink(gv, "android")).toBe(
      "intent://#Intent;package=com.jobtepi.app;end",
    );
    expect(meterLeaveAppLink(gv, "huawei")).toBe(meterLeaveAppLink(gv, "android"));
  });

  it("keeps the App Store page as the install route, not the launch route", () => {
    expect(meterLeaveAppStore(gv, "ios")).toBe(
      "https://apps.apple.com/my/app/gvride/id6651835302",
    );
    expect(meterLeaveAppStore(gv, "android")).toBe(
      "https://play.google.com/store/apps/details?id=com.jobtepi.app",
    );
  });

  it("will not pretend to detect it on an iPhone", () => {
    // canOpenURL says yes to any https link — a browser handles it — so an
    // entry reached by universal link cannot be probed at all.
    expect(meterLeaveAppProbe(gv, "ios")).toBeNull();
    expect(meterLeaveAppProbe(gv, "android")).toContain("com.jobtepi.app");
  });

  it("tells the operator what an iPhone will actually do", () => {
    expect(describeAppIosRoute(gv)).toContain("opens the app");
    expect(describeAppIosRoute(meterLeaveAppById("grab-driver")!)).toContain("needs a link");
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
