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
  /** The iOS URL scheme, where it is known for certain. */
  iosScheme: string | null;
  /** The Android/Huawei package id. */
  androidPackage: string | null;
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
  { id: "grab-driver", name: "Grab Driver", iosScheme: null, androidPackage: "com.grabtaxi.driver2" },
  { id: "uber-driver", name: "Uber Driver", iosScheme: null, androidPackage: "com.ubercab.driver" },
  { id: "bolt-driver", name: "Bolt Driver", iosScheme: null, androidPackage: "ee.mtakso.driver" },
  { id: "maxim-driver", name: "Maxim Driver", iosScheme: null, androidPackage: "com.taxsee.driver" },
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
  if (platform === "ios") return app.iosScheme;
  if (!app.androidPackage) return null;
  return `intent://#Intent;package=${app.androidPackage};end`;
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
  if (!app?.androidPackage || platform !== "android") return null;
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
