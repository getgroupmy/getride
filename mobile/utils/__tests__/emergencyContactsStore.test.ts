import {
  MAX_EMERGENCY_CONTACTS,
  canAddContact,
  isDuplicate,
  normalizePhone,
  validateContact,
  type EmergencyContact,
} from "@/utils/emergencyContactsStore";

const contact = (over: Partial<EmergencyContact> = {}): EmergencyContact => ({
  id: "c1",
  name: "Aisha",
  phone: "012-345 6789",
  createdAt: null,
  ...over,
});

describe("normalizePhone", () => {
  it("keeps only digits, so formatting never makes two contacts of one", () => {
    expect(normalizePhone("012-345 6789")).toBe("0123456789");
    expect(normalizePhone("+60 (12) 345-6789")).toBe("60123456789");
  });

  it("returns an empty string when there are no digits at all", () => {
    expect(normalizePhone("n/a")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("validateContact", () => {
  it("accepts a well-formed contact and trims it", () => {
    expect(validateContact({ name: "  Aisha  ", phone: " 0123456789 " })).toEqual({
      ok: true,
      value: { name: "Aisha", phone: "0123456789" },
    });
  });

  it("requires a name, because a bare number is unusable under stress", () => {
    expect(validateContact({ name: "", phone: "0123456789" }).ok).toBe(false);
    expect(validateContact({ name: "A", phone: "0123456789" }).ok).toBe(false);
    expect(validateContact({ phone: "0123456789" }).error).toMatch(/name/i);
  });

  it("requires a phone number", () => {
    expect(validateContact({ name: "Aisha", phone: "" }).error).toMatch(/phone number/i);
    expect(validateContact({ name: "Aisha" }).ok).toBe(false);
  });

  it("rejects characters that cannot be dialled", () => {
    const res = validateContact({ name: "Aisha", phone: "0123-456-789 ext 4" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/can't dial/i);
  });

  it("accepts the punctuation people actually type", () => {
    expect(validateContact({ name: "Aisha", phone: "+60 (12) 345-6789" }).ok).toBe(true);
  });

  it("rejects numbers that are too short or longer than E.164 allows", () => {
    expect(validateContact({ name: "Aisha", phone: "12345" }).error).toMatch(/too short/i);
    expect(validateContact({ name: "Aisha", phone: "1234567890123456" }).error).toMatch(
      /too long/i
    );
  });
});

describe("isDuplicate", () => {
  it("matches on digits, ignoring formatting", () => {
    const list = [contact()];
    expect(isDuplicate(list, "0123456789")).toBe(true);
    expect(isDuplicate(list, "(012) 345-6789")).toBe(true);
  });

  it("does not match a different number", () => {
    expect(isDuplicate([contact()], "0119998888")).toBe(false);
  });

  it("treats an undiallable string as not a duplicate rather than matching everything", () => {
    expect(isDuplicate([contact()], "")).toBe(false);
    expect(isDuplicate([contact()], "abc")).toBe(false);
  });
});

describe("canAddContact", () => {
  it("passes a valid, non-duplicate contact through", () => {
    const res = canAddContact([contact()], { name: "Ben", phone: "0119998888" });
    expect(res).toEqual({ ok: true, value: { name: "Ben", phone: "0119998888" } });
  });

  it("reports the draft's own problem first", () => {
    expect(canAddContact([], { name: "", phone: "0123456789" }).error).toMatch(/name/i);
  });

  it("refuses a number already saved, whatever its formatting", () => {
    const res = canAddContact([contact()], { name: "Aisha mobile", phone: "(012) 345 6789" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already saved/i);
  });

  it("refuses once the list is full, and says how to proceed", () => {
    const full = Array.from({ length: MAX_EMERGENCY_CONTACTS }, (_, i) =>
      contact({ id: `c${i}`, phone: `01100000${i}0` })
    );
    const res = canAddContact(full, { name: "Ben", phone: "0119998888" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/remove one/i);
  });

  it("checks validity before fullness, so a bad draft is not blamed on the limit", () => {
    const full = Array.from({ length: MAX_EMERGENCY_CONTACTS }, (_, i) =>
      contact({ id: `c${i}`, phone: `01100000${i}0` })
    );
    expect(canAddContact(full, { name: "", phone: "" }).error).toMatch(/name/i);
  });
});
