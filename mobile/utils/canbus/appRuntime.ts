/**
 * Which runtime this bundle is executing in, kept behind its own module so the
 * pure availability helpers never have to import `expo-constants`.
 */

import Constants, { AppOwnership, ExecutionEnvironment } from "expo-constants";

import type { AppRuntime } from "./availability";

/**
 * `storeClient` is Expo Go; `standalone` and `bare` are both real binaries
 * (TestFlight, App Store, dev client) where a missing native module means the
 * build itself is out of date. `appOwnership` is the pre-SDK-46 spelling and is
 * checked as a fallback for older clients.
 */
export function getAppRuntime(): AppRuntime {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return "expo-go";
  }
  if (Constants.appOwnership === AppOwnership.Expo) return "expo-go";
  return "standalone";
}
