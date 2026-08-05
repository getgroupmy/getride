import { resolveLaunchDestination } from "@/utils/launchDestination";

const base = {
  hasRiderRestore: false,
  hasPartnerRide: false,
  meterAutoLaunch: false,
  isTablet: false,
};

describe("resolveLaunchDestination", () => {
  it("sends an ordinary phone launch to the passenger home", () => {
    expect(resolveLaunchDestination(base)).toBe("home");
  });

  it("sends a tablet to the partner console when nothing outranks it", () => {
    expect(resolveLaunchDestination({ ...base, isTablet: true })).toBe("partner-console");
  });

  it("opens the meter for a TEKSI driver whose card asks for it", () => {
    expect(resolveLaunchDestination({ ...base, meterAutoLaunch: true })).toBe("meter");
    // …on a tablet too — the meter outranks the console default.
    expect(
      resolveLaunchDestination({ ...base, meterAutoLaunch: true, isTablet: true }),
    ).toBe("meter");
  });

  it("restores an in-progress ride ahead of the meter", () => {
    // A hire the driver is mid-way through outranks the one they'd start next.
    expect(
      resolveLaunchDestination({
        ...base,
        hasRiderRestore: true,
        meterAutoLaunch: true,
      }),
    ).toBe("ride-restore");
    expect(
      resolveLaunchDestination({
        ...base,
        hasPartnerRide: true,
        meterAutoLaunch: true,
      }),
    ).toBe("partner-ride");
  });

  it("prefers the rider's own ride over a partner ride", () => {
    expect(
      resolveLaunchDestination({
        ...base,
        hasRiderRestore: true,
        hasPartnerRide: true,
      }),
    ).toBe("ride-restore");
  });
});
