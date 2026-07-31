import { describeWifiAvailability } from "@/utils/canbus/wifi";

describe("describeWifiAvailability", () => {
  const linked = {
    moduleInstalled: true,
    nativeModuleLinked: true,
    runtime: "standalone" as const,
  };

  it("is available on iOS and Android once the native module is linked", () => {
    expect(describeWifiAvailability({ ...linked, platform: "ios" })).toEqual({
      available: true,
    });
    expect(describeWifiAvailability({ ...linked, platform: "android" })).toEqual({
      available: true,
    });
  });

  it("reports web as unsupported — browsers cannot open a raw TCP socket", () => {
    expect(describeWifiAvailability({ ...linked, platform: "web" })).toMatchObject({
      available: false,
      reason: expect.stringMatching(/not supported on web/i),
    });
  });

  /**
   * The regression this whole transport turns on: the package used to be an
   * unresolvable optional peer dep, so an installed build reported "not
   * included in this build" no matter how new it was, telling TestFlight
   * drivers to install an update that could never contain the driver. With the
   * dependency real, a build that ships the native side must report available.
   */
  it("does not blame the build when the driver is actually present", () => {
    expect(
      describeWifiAvailability({ ...linked, platform: "ios" }).reason,
    ).toBeUndefined();
  });

  it("phrases the missing driver for the runtime the driver is in", () => {
    expect(
      describeWifiAvailability({
        moduleInstalled: false,
        nativeModuleLinked: false,
        platform: "ios",
        runtime: "expo-go",
      }),
    ).toMatchObject({
      reason: expect.stringMatching(/development or production build/i),
    });
    expect(
      describeWifiAvailability({
        moduleInstalled: false,
        nativeModuleLinked: false,
        platform: "android",
        runtime: "standalone",
      }),
    ).toMatchObject({
      reason: expect.stringMatching(/not included in this build/i),
      guidance: expect.stringMatching(/react-native-tcp-socket/),
    });
  });

  /**
   * The JS half resolves in every runtime because the package is a real
   * dependency, so "the package is here" says nothing on its own — only the
   * linked native module decides whether a socket can be opened.
   */
  it("treats a resolvable package with no native side as unavailable", () => {
    expect(
      describeWifiAvailability({
        moduleInstalled: true,
        nativeModuleLinked: false,
        platform: "ios",
        runtime: "standalone",
      }),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/not included in this build/i),
    });
  });
});
