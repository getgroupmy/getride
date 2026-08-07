/**
 * `react-native-ble-plx` backs every `BleManager` with a single native BLE
 * client and its docs require one instance per app: a second `new BleManager()`
 * re-creates that client and `.destroy()` tears it down for *all* JS managers at
 * once. The OBD-II reader and the mini receipt printer are two independent BLE
 * consumers, so before this the printer's per-job manager `destroy()` was
 * ripping the native client out from under the reader's open session — the
 * reader's next command (the pickup odometer read) then hung until it timed
 * out, and a trip that had printed a receipt could not start the next hire.
 *
 * `getSharedBleManager` must therefore hand every caller the *same* instance,
 * built at most once.
 */

import { NativeModules } from "react-native";

const mockBleRequire = jest.fn();

jest.mock("react-native-ble-plx", () => mockBleRequire());

/* eslint-disable @typescript-eslint/no-require-imports */
function freshBle() {
  return require("@/utils/canbus/bleModule") as typeof import("@/utils/canbus/bleModule");
}
/* eslint-enable @typescript-eslint/no-require-imports */

const nativeModules = NativeModules as Record<string, unknown>;

describe("shared BleManager", () => {
  beforeEach(() => {
    jest.resetModules();
    mockBleRequire.mockReset();
    delete nativeModules.BlePlx;
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null when the BLE native module is absent", () => {
    expect(freshBle().getSharedBleManager()).toBeNull();
    expect(mockBleRequire).not.toHaveBeenCalled();
  });

  it("constructs the BleManager once and hands the same instance to every caller", () => {
    nativeModules.BlePlx = {};
    let constructed = 0;
    class BleManager {
      constructor() {
        constructed += 1;
      }
    }
    mockBleRequire.mockReturnValue({ BleManager });

    const ble = freshBle();
    const first = ble.getSharedBleManager();
    const second = ble.getSharedBleManager();

    expect(first).toBeInstanceOf(BleManager);
    expect(second).toBe(first);
    // The whole point: one native client for the reader and the printer to share.
    expect(constructed).toBe(1);
  });

  it("caches a construction failure as null rather than retrying it", () => {
    nativeModules.BlePlx = {};
    class BleManager {
      constructor() {
        throw new Error("no BLE radio");
      }
    }
    mockBleRequire.mockReturnValue({ BleManager });

    const ble = freshBle();
    expect(ble.getSharedBleManager()).toBeNull();
    expect(ble.getSharedBleManager()).toBeNull();
    // One require, one failed construction — not a fresh attempt each call.
    expect(mockBleRequire).toHaveBeenCalledTimes(1);
  });
});
