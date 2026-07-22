import {
  MAX_ACCOUNTS_PER_DEVICE,
  isRegistrationAllowed,
} from "@/utils/deviceGuard";

describe("isRegistrationAllowed", () => {
  it("allows when the device has no prior accounts", () => {
    expect(isRegistrationAllowed(0)).toBe(true);
  });

  it("allows below the limit", () => {
    expect(isRegistrationAllowed(MAX_ACCOUNTS_PER_DEVICE - 1)).toBe(true);
  });

  it("blocks at the limit", () => {
    expect(isRegistrationAllowed(MAX_ACCOUNTS_PER_DEVICE)).toBe(false);
  });

  it("blocks above the limit", () => {
    expect(isRegistrationAllowed(MAX_ACCOUNTS_PER_DEVICE + 5)).toBe(false);
  });

  it("respects a custom limit", () => {
    expect(isRegistrationAllowed(1, 2)).toBe(true);
    expect(isRegistrationAllowed(2, 2)).toBe(false);
  });

  it("fails open on garbage / negative input", () => {
    expect(isRegistrationAllowed(Number.NaN)).toBe(true);
    expect(isRegistrationAllowed(-3)).toBe(true);
    expect(isRegistrationAllowed(Infinity)).toBe(true);
  });
});
