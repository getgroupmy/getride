/**
 * React Native autolinking overrides.
 *
 * `react-native-bluetooth-classic` supplies the Bluetooth MFi (Apple External
 * Accessory) transport, which by design only exists on iOS — `describeMfiAvailability`
 * points Android drivers at Bluetooth LE / USB instead, because the same classic
 * dongles are reachable there with no MFi certification involved.
 *
 * Its Android side is therefore dead weight, and not harmless dead weight: the
 * library's `android/build.gradle` pins `com.facebook.react:react-native:0.71.0-rc.0`
 * and an AGP 3.4 buildscript, neither of which belongs in an RN 0.81 / Expo SDK 54
 * build. Autolinking it on Android buys nothing and risks the Gradle build.
 *
 * Disabling the platform here keeps the JS importable everywhere (the transport
 * still resolves the module and reports MFi as iOS-only) while linking the native
 * side on iOS only.
 */
module.exports = {
  dependencies: {
    "react-native-bluetooth-classic": {
      platforms: {
        android: null,
      },
    },
  },
};
