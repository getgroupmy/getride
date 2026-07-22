import {
  DEFAULT_MAX_ACCOUNTS_PER_DEVICE,
  isRegistrationAllowed,
  parseDeviceLimitError,
  isDeviceLimitError,
} from "@/utils/deviceGuard";

describe("isRegistrationAllowed", () => {
  it("allows when the device has no prior accounts", () => {
    expect(isRegistrationAllowed(0)).toBe(true);
  });

  it("allows below the limit", () => {
    expect(isRegistrationAllowed(DEFAULT_MAX_ACCOUNTS_PER_DEVICE - 1)).toBe(true);
  });

  it("blocks at the limit", () => {
    expect(isRegistrationAllowed(DEFAULT_MAX_ACCOUNTS_PER_DEVICE)).toBe(false);
  });

  it("blocks above the limit", () => {
    expect(isRegistrationAllowed(DEFAULT_MAX_ACCOUNTS_PER_DEVICE + 5)).toBe(false);
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

describe("parseDeviceLimitError", () => {
  it("parses the server DEVICE_LIMIT error", () => {
    expect(parseDeviceLimitError("DEVICE_LIMIT:2/3")).toEqual({
      priorAccounts: 2,
      maxAccounts: 3,
    });
  });

  it("parses when wrapped in a longer postgres error string", () => {
    expect(
      parseDeviceLimitError('ERROR: DEVICE_LIMIT:5/3 (SQLSTATE P0001)')
    ).toEqual({ priorAccounts: 5, maxAccounts: 3 });
  });

  it("returns null for unrelated messages", () => {
    expect(parseDeviceLimitError("PIN must be exactly 6 digits")).toBeNull();
    expect(parseDeviceLimitError(null)).toBeNull();
    expect(parseDeviceLimitError(undefined)).toBeNull();
  });
});

describe("isDeviceLimitError", () => {
  it("recognises Error objects", () => {
    expect(isDeviceLimitError(new Error("DEVICE_LIMIT:4/3"))).toBe(true);
  });
  it("recognises raw strings", () => {
    expect(isDeviceLimitError("DEVICE_LIMIT:4/3")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isDeviceLimitError(new Error("nope"))).toBe(false);
    expect(isDeviceLimitError(null)).toBe(false);
    expect(isDeviceLimitError(42)).toBe(false);
  });
});
