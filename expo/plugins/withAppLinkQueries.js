/**
 * Android package visibility for the meter's dispatch-app picker.
 *
 * From Android 11 an app cannot see another app unless it says which ones it
 * cares about: `Linking.canOpenURL` answers false for every package that is not
 * declared in `<queries>`, whether or not it is installed. That is what the
 * admin editor's "on this device" hint reads, so without this block the picker
 * would report every app as missing on a phone that has them all.
 *
 * Only the catalogue's packages are declared — the list is short and explicit,
 * which is the point. `QUERY_ALL_PACKAGES` would answer the same question for
 * every app on the phone, but Google Play restricts it to launchers, antivirus
 * and the like, and asking for it here would put the listing at risk for a
 * convenience the operator does not need.
 *
 * Keep in step with `METER_LEAVE_APPS` in `expo/utils/meterLeaveApps.ts`: an app
 * added there and not here still *opens* (openURL needs no declaration), it just
 * cannot be detected. Changing this list needs a new native build, not an OTA
 * update.
 */

const { withAndroidManifest } = require("@expo/config-plugins");

/** The packages the catalogue can point the e-hailing key at. */
const PACKAGES = [
  "com.grabtaxi.driver2",
  "com.ubercab.driver",
  "ee.mtakso.driver",
  "com.taxsee.driver",
];

module.exports = function withAppLinkQueries(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];
    queries.package = queries.package ?? [];

    for (const name of PACKAGES) {
      const declared = queries.package.some((p) => p?.$?.["android:name"] === name);
      if (!declared) queries.package.push({ $: { "android:name": name } });
    }
    return mod;
  });
};
