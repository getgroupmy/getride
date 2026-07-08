import {
  parsePinLockSeconds,
  pinLockMessage,
  PIN_LOCK_DEFAULT_SECONDS,
} from "@/utils/pinLock";

describe("parsePinLockSeconds", () => {
  it("parses the remaining seconds from a PIN_LOCKED error", () => {
    expect(parsePinLockSeconds("PIN_LOCKED:120")).toBe(120);
    expect(parsePinLockSeconds("PIN_LOCKED:1")).toBe(1);
    expect(parsePinLockSeconds("PIN_LOCKED:0")).toBe(0);
  });

  it("finds the marker inside a longer RPC error message", () => {
    expect(
      parsePinLockSeconds('ERROR: PIN_LOCKED:45 (raised by verify_pin_for_login)')
    ).toBe(45);
  });

  it("falls back to the full 15-minute window when seconds are omitted", () => {
    expect(parsePinLockSeconds("PIN_LOCKED")).toBe(PIN_LOCK_DEFAULT_SECONDS);
    expect(parsePinLockSeconds("PIN_LOCKED:")).toBe(PIN_LOCK_DEFAULT_SECONDS);
    expect(PIN_LOCK_DEFAULT_SECONDS).toBe(15 * 60);
  });

  it("returns null for anything that is not a lockout error", () => {
    expect(parsePinLockSeconds("Invalid PIN")).toBeNull();
    expect(parsePinLockSeconds("")).toBeNull();
    expect(parsePinLockSeconds(null)).toBeNull();
    expect(parsePinLockSeconds(undefined)).toBeNull();
  });
});

describe("pinLockMessage", () => {
  it("rounds the wait up to whole minutes", () => {
    expect(pinLockMessage(61)).toContain("2 minutes");
    expect(pinLockMessage(900)).toContain("15 minutes");
  });

  it("uses the singular for a one-minute wait", () => {
    expect(pinLockMessage(60)).toBe(
      "Too many incorrect attempts. Try again in 1 minute."
    );
    expect(pinLockMessage(1)).toContain("1 minute.");
  });

  it("never reports less than one minute", () => {
    expect(pinLockMessage(0)).toContain("1 minute.");
  });
});
