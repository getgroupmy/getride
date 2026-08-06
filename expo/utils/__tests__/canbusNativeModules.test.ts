/**
 * The transports must be able to *ask* whether a link exists without loading a
 * package that dies on the way in. `react-native-tcp-socket` builds a
 * `NativeEventEmitter` from `NativeModules.TcpSockets` at import time and
 * `react-native-bluetooth-classic` does the same in its default export, so on a
 * binary without the native side the import throws — which is how a driver
 * opening Meter Digital in Expo Go got an "Invariant Violation: native module
 * doesn't exist" red box instead of "Wi-Fi is not included in this build".
 */

import { NativeModules } from "react-native";

const mockTcpRequire = jest.fn();
const mockMfiRequire = jest.fn();

jest.mock("react-native-tcp-socket", () => mockTcpRequire());
jest.mock("react-native-bluetooth-classic", () => mockMfiRequire());

/* eslint-disable @typescript-eslint/no-require-imports */
function freshTcp() {
  return require("@/utils/canbus/tcpModule") as typeof import("@/utils/canbus/tcpModule");
}

function freshMfi() {
  return require("@/utils/canbus/mfiModule") as typeof import("@/utils/canbus/mfiModule");
}
/* eslint-enable @typescript-eslint/no-require-imports */

const nativeModules = NativeModules as Record<string, unknown>;

describe("optional CANBus native packages", () => {
  beforeEach(() => {
    jest.resetModules();
    mockTcpRequire.mockReset();
    mockMfiRequire.mockReset();
    delete nativeModules.TcpSockets;
    delete nativeModules.RNBluetoothClassic;
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("never imports react-native-tcp-socket when its native module is absent", () => {
    expect(freshTcp().loadTcpModule()).toBeNull();
    expect(mockTcpRequire).not.toHaveBeenCalled();
  });

  it("never imports react-native-bluetooth-classic when its native module is absent", () => {
    expect(freshMfi().loadMfiModule()).toBeNull();
    expect(mockMfiRequire).not.toHaveBeenCalled();
  });

  it("loads the TCP package in a build that has the native module", () => {
    nativeModules.TcpSockets = {};
    const mod = { createConnection: jest.fn() };
    mockTcpRequire.mockReturnValue(mod);

    expect(freshTcp().loadTcpModule()).toBe(mod);
    expect(mockTcpRequire).toHaveBeenCalledTimes(1);
  });

  it("degrades to null when the import throws even though the module is linked", () => {
    nativeModules.TcpSockets = {};
    mockTcpRequire.mockImplementation(() => {
      throw new Error("Invariant Violation: native module doesn't exist");
    });

    expect(freshTcp().loadTcpModule()).toBeNull();
    expect(mockTcpRequire).toHaveBeenCalledTimes(1);
  });

  it("caches the answer so the failing import is attempted once", () => {
    nativeModules.TcpSockets = {};
    mockTcpRequire.mockImplementation(() => {
      throw new Error("boom");
    });

    const tcp = freshTcp();
    expect(tcp.loadTcpModule()).toBeNull();
    expect(tcp.loadTcpModule()).toBeNull();
    expect(mockTcpRequire).toHaveBeenCalledTimes(1);
  });
});
