/**
 * The dispatch apps the meter's e-hailing key can be pointed at.
 *
 * An operator whose drivers take jobs in somebody else's app should not have to
 * know what a URL scheme is, so the admin editor offers a list to pick from
 * instead of an empty text field — and probes the admin's own device to show
 * which of them are actually there (`utils/installedApps.ts`).
 *
 * **What a "list of installed apps" can honestly be.** Neither platform will
 * hand one over. iOS has no API for it at all: the only signal is
 * `canOpenURL(scheme)`, and only for schemes declared up front in
 * `LSApplicationQueriesSchemes`. Android can enumerate packages only with
 * `QUERY_ALL_PACKAGES`, which Google Play restricts to launchers and the like
 * and would put the listing at risk; the sanctioned route is declaring the
 * packages in `<queries>` and asking about those. So detection is always
 * *against a candidate list* — this one — and a negative answer means "not
 * found among the apps we can ask about", never "not installed". Every string
 * this file produces is worded that way.
 *
 * **What is in an entry.** Only facts, never a guessed scheme: a dead key is
 * worse than a blank field an operator fills in once.
 *
 *   * `androidPackage` — the package id, which is public and stable. It gives
 *     three things for free: a launch link (`intent://#Intent;package=…;end`,
 *     the standard way to open an app by package without knowing its scheme),
 *     a Play Store page, and something to probe.
 *   * `ios` — the app's URL scheme, and only where it is known to be right.
 *     Left null otherwise, and the editor asks the operator for it rather than
 *     the meter shipping a key that cannot open anything.
 *   * store pages other than Play are per-app ids that cannot be derived from a
 *     package name, so they are the operator's to paste in.
 *
 * Adding an app is one entry here. Everything else — the picker, the probe, the
 * store fallback — is driven off this list, with two native declarations that
 * have to be kept in step for *detection* (opening never needs either, so an
 * app added here always works; it just cannot be spotted until a new build):
 *
 *   * its package in `plugins/withAppLinkQueries.js` → Android `<queries>`,
 *   * its scheme in `ios.infoPlist.LSApplicationQueriesSchemes` (app.json) —
 *     nothing to declare yet, since no entry below carries a scheme.
 */

/** Which store a device installs from. Huawei devices without Play use AppGallery. */
export type StorePlatform = "ios" | "android" | "huawei";

export interface MeterLeaveApp {
  id: string;
  name: string;
  /**
   * The app's own URL scheme on iOS, where it is known for certain.
   *
   * The only iOS value `canOpenURL` can answer about, so it is also the only
   * one detection uses (`meterLeaveAppProbe`).
   */
  iosScheme: string | null;
  /**
   * A **universal link** the app claims, which opens it on an iPhone that has
   * it installed.
   *
   * This is how an app with no published scheme is still opened directly, and
   * it is a fact that can be checked rather than guessed: the domain publishes
   * `/.well-known/apple-app-site-association` naming the app's bundle id and
   * the paths it claims, and only a path inside those patterns will do.
   *
   * The trade-off is the other half: an iPhone *without* the app follows the
   * same link in Safari, so it wants to be a path that means something on the
   * web. There is no way to tell the two apart from here — `openURL` reports
   * success either way — which is why the store page stays on the card.
   */
  iosLink: string | null;
  /** The Android/Huawei package id. */
  androidPackage: string | null;
  /**
   * Store pages the catalogue knows for certain. Play is derived from the
   * package when this is empty; the other two are only ever real addresses
   * somebody supplied.
   */
  stores: { ios: string | null; huawei: string | null };
}

/**
 * The apps the picker offers, plus "Other app" for everything else (`null` id
 * — a card that names no catalogue app keeps its typed link).
 *
 * Deliberately short and deliberately Android-first: a package id is a public
 * fact, an iOS scheme mostly is not. Where `iosScheme` is null the operator is
 * asked for it in the editor.
 */
export const METER_LEAVE_APPS: MeterLeaveApp[] = [
  {
    // GVRIDE (GV CAR VENTURES SDN. BHD.) — one app, one id on both platforms.
    //
    // The iOS link is a universal link, not the App Store page: an App Store
    // URL only ever opens the App Store, even when the app is right there on
    // the home screen. `ride.gvmalaysia.com` publishes an
    // apple-app-site-association naming `N57RJ3572T.com.jobtepi.app` and
    // claiming `/app/*` and `/invite/*`, so a link inside those paths opens the
    // app itself. An iPhone without it lands on that path in Safari, which is
    // why the App Store page below stays on the entry.
    id: "gvride",
    name: "GVRIDE",
    iosScheme: null,
    iosLink: "https://ride.gvmalaysia.com/app/",
    androidPackage: "com.jobtepi.app",
    stores: { ios: "https://apps.apple.com/my/app/gvride/id6651835302", huawei: null },
  },
  {
    id: "grab-driver",
    name: "Grab Driver",
    iosScheme: null,
    iosLink: null,
    androidPackage: "com.grabtaxi.driver2",
    stores: { ios: null, huawei: null },
  },
  {
    id: "uber-driver",
    name: "Uber Driver",
    iosScheme: null,
    iosLink: null,
    androidPackage: "com.ubercab.driver",
    stores: { ios: null, huawei: null },
  },
  {
    id: "bolt-driver",
    name: "Bolt Driver",
    iosScheme: null,
    iosLink: null,
    androidPackage: "ee.mtakso.driver",
    stores: { ios: null, huawei: null },
  },
  {
    id: "maxim-driver",
    name: "Maxim Driver",
    iosScheme: null,
    iosLink: null,
    androidPackage: "com.taxsee.driver",
    stores: { ios: null, huawei: null },
  },
];

/** The catalogue entry with this id, or null for a hand-entered link. */
export function meterLeaveAppById(id: string | null | undefined): MeterLeaveApp | null {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return null;
  return METER_LEAVE_APPS.find((app) => app.id === key) ?? null;
}

/**
 * The link that opens this app on a given platform, or null where the
 * catalogue does not know one.
 *
 * Android and Huawei share the package, so they share the intent link — the
 * standard way to launch by package when the app's own scheme is unknown.
 */
export function meterLeaveAppLink(
  app: MeterLeaveApp | null,
  platform: StorePlatform,
): string | null {
  if (!app) return null;
  // The app's own scheme first — it opens nothing but the app. A universal
  // link is the fallback: it opens the app when installed, and the website
  // when not, which is still far better than a key that does nothing.
  if (platform === "ios") return app.iosScheme ?? app.iosLink;
  if (!app.androidPackage) return null;
  return `intent://#Intent;package=${app.androidPackage};end`;
}

/**
 * The link detection may ask about — never the same question as launching.
 *
 * `canOpenURL` answers "is there something here that handles this?", so an
 * `https://` universal link always answers *true*: a browser handles it whether
 * or not the app is installed. Probing one would report every iPhone as having
 * every app. Only a scheme (iOS) or a package intent (Android) identifies an
 * app, so anything else returns null and the row honestly says it cannot check.
 */
export function meterLeaveAppProbe(
  app: MeterLeaveApp | null,
  platform: StorePlatform,
): string | null {
  if (!app) return null;
  if (platform === "ios") return app.iosScheme;
  return meterLeaveAppLink(app, platform);
}

/**
 * The store page for an app this device does not have.
 *
 * Only Play is derivable — a package id *is* the Play address. App Store and
 * AppGallery pages are numeric ids that no package name yields, so those come
 * from the card (the operator pastes them once) rather than being guessed.
 */
export function meterLeaveAppStore(
  app: MeterLeaveApp | null,
  platform: StorePlatform,
): string | null {
  if (!app) return null;
  if (platform === "ios") return app.stores.ios;
  if (platform === "huawei") return app.stores.huawei;
  if (!app.androidPackage) return null;
  return `https://play.google.com/store/apps/details?id=${app.androidPackage}`;
}

/** Which store this device installs from. Huawei is Android without Play. */
export function storePlatformFor(
  os: string,
  /** `Device.manufacturer` / `Device.brand`, where the app can read it. */
  manufacturer?: string | null,
): StorePlatform {
  if (os === "ios") return "ios";
  const maker = (manufacturer ?? "").trim().toLowerCase();
  if (maker === "huawei" || maker === "honor") return "huawei";
  return "android";
}

/** What each store is called, for the admin fields and the driver's prompt. */
export const STORE_LABELS: Record<StorePlatform, string> = {
  ios: "App Store",
  android: "Google Play",
  huawei: "Huawei AppGallery",
};

/** Whether an app was found on the device — see the file header on "found". */
export type AppPresence = "present" | "not-detected" | "unknown";

/**
 * The detection result in words.
 *
 * "Not detected" rather than "not installed", always: a false answer can equally
 * mean this build cannot ask about that app, and telling an operator an app is
 * missing from their own phone when it is sitting on the home screen would make
 * the whole picker untrustworthy.
 */
export function describeAppPresence(presence: AppPresence): string {
  switch (presence) {
    case "present":
      return "On this device";
    case "not-detected":
      return "Not detected here";
    default:
      return "Can't check here";
  }
}

/**
 * What an iPhone driver gets from this entry, in the admin row.
 *
 * Worth a line of its own because the three cases behave differently on the one
 * platform that will not simply launch an app by id — and an operator choosing
 * an app for a mixed fleet should see which one they are choosing.
 */
export function describeAppIosRoute(app: MeterLeaveApp): string {
  if (app.iosScheme) return "iPhone: opens the app";
  if (app.iosLink) return "iPhone: opens the app, or the website without it";
  return "iPhone: needs a link or the App Store page";
}

/**
 * Whether a card that names a catalogue app still needs a link for a platform.
 *
 * The editor asks for exactly what is missing rather than a generic warning:
 * with no iOS scheme, iPhone drivers get the store prompt instead of the app.
 */
export function meterLeaveAppNeedsLink(
  app: MeterLeaveApp | null,
  platform: StorePlatform,
): boolean {
  if (!app) return false;
  return meterLeaveAppLink(app, platform) === null;
}
