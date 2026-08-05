/**
 * Asking the device which of the dispatch apps it has.
 *
 * The impure half of `utils/meterLeaveApps.ts` — everything here talks to the
 * platform, so the rules and the wording live over there where they can be
 * tested.
 *
 * `Linking.canOpenURL` is the only door either platform opens, and it is a
 * narrow one: iOS answers only for schemes listed in
 * `LSApplicationQueriesSchemes` (app.json), Android only for packages listed in
 * `<queries>` (added by `plugins/withAppLinkQueries.js`). Both lists are baked
 * into the binary, so a build made before an app was added to the catalogue
 * cannot see that app however installed it is. That is why a false answer is
 * reported as `not-detected` rather than "absent", and why the admin screen
 * says "not detected here" rather than "not installed".
 *
 * This is used by the *admin* picker to show what is on the admin's own phone.
 * The driver's console never asks: it simply tries to open the link and offers
 * the store if that fails, which needs no declaration at all.
 */

import { Linking, Platform } from "react-native";

import { storePlatformFor, type AppPresence, type StorePlatform } from "@/utils/meterLeaveApps";

/** Does this device have the app that answers to `url`? */
export async function detectApp(url: string | null | undefined): Promise<AppPresence> {
  if (Platform.OS === "web") return "unknown";
  const link = typeof url === "string" ? url.trim() : "";
  if (!link) return "unknown";
  try {
    return (await Linking.canOpenURL(link)) ? "present" : "not-detected";
  } catch (e) {
    // A refusal to answer is not an answer — an undeclared scheme throws on
    // some iOS versions rather than returning false.
    console.log("[installedApps] canOpenURL failed", link, e);
    return "unknown";
  }
}

let storePlatform: StorePlatform | undefined;

/**
 * Which store this device installs from, worked out once.
 *
 * `expo-device` is behind a guarded require so this keeps working in a bundle
 * without it; the fallback is plain Android, which is right for every device
 * that is not a Huawei.
 */
export function currentStorePlatform(): StorePlatform {
  if (storePlatform) return storePlatform;
  let maker: string | null = null;
  if (Platform.OS === "android") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Device = require("expo-device");
      maker = Device?.manufacturer ?? Device?.brand ?? null;
    } catch (e) {
      console.log("[installedApps] expo-device unavailable", e);
    }
  }
  storePlatform = storePlatformFor(Platform.OS, maker);
  return storePlatform;
}
