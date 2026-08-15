import { describe, expect, it } from "vitest";

import {
  IDLE_TIMEOUT_MS,
  confirmStatusMessage,
  isDestructiveStatus,
  isIdleExpired,
} from "../adminSafety";

describe("isDestructiveStatus", () => {
  it("flags the statuses a person cannot undo for themselves", () => {
    expect(isDestructiveStatus("blocked")).toBe(true);
    expect(isDestructiveStatus("deleted")).toBe(true);
    expect(isDestructiveStatus("rejected")).toBe(true);
  });

  it("does not flag recoverable ones", () => {
    expect(isDestructiveStatus("approved")).toBe(false);
    expect(isDestructiveStatus("unapproved")).toBe(false);
    expect(isDestructiveStatus("permit-pending")).toBe(false);
    expect(isDestructiveStatus("")).toBe(false);
  });

  it("is insensitive to case and stray whitespace from a select value", () => {
    expect(isDestructiveStatus("  Blocked ")).toBe(true);
    expect(isDestructiveStatus("DELETED")).toBe(true);
  });
});

describe("confirmStatusMessage", () => {
  it("names the row, since a dropdown gives no other clue which one is changing", () => {
    const msg = confirmStatusMessage("Aisha", "approved", "blocked");
    expect(msg).toContain("Aisha");
    expect(msg).toContain("approved");
    expect(msg).toContain("blocked");
  });

  it("says the change is immediate and silent, because it is", () => {
    const msg = confirmStatusMessage("Aisha", "approved", "blocked");
    expect(msg).toMatch(/immediately/i);
    expect(msg).toMatch(/not told/i);
  });

  it("falls back to a neutral noun rather than an empty gap", () => {
    expect(confirmStatusMessage("   ", "approved", "blocked")).toContain("this record");
  });

  it("describes a missing previous status rather than printing nothing", () => {
    expect(confirmStatusMessage("Aisha", "", "blocked")).toContain("unset");
  });
});

describe("isIdleExpired", () => {
  const t0 = 1_700_000_000_000;

  it("does not expire an active session", () => {
    expect(isIdleExpired(t0, t0 + 60_000)).toBe(false);
  });

  it("expires once the timeout has elapsed", () => {
    expect(isIdleExpired(t0, t0 + IDLE_TIMEOUT_MS)).toBe(true);
    expect(isIdleExpired(t0, t0 + IDLE_TIMEOUT_MS + 1)).toBe(true);
  });

  it("does not expire one millisecond early", () => {
    expect(isIdleExpired(t0, t0 + IDLE_TIMEOUT_MS - 1)).toBe(false);
  });

  it("honours a custom timeout", () => {
    expect(isIdleExpired(t0, t0 + 5_000, 10_000)).toBe(false);
    expect(isIdleExpired(t0, t0 + 10_000, 10_000)).toBe(true);
  });

  it("treats a backwards clock as not idle, rather than expiring instantly", () => {
    // An NTP correction or a timezone change must not sign an admin out
    // mid-sentence.
    expect(isIdleExpired(t0, t0 - 60_000)).toBe(false);
  });

  it("does nothing with unusable timestamps", () => {
    expect(isIdleExpired(NaN, t0)).toBe(false);
    expect(isIdleExpired(t0, NaN)).toBe(false);
  });
});
