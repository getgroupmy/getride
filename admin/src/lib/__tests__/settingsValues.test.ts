import { describe, expect, it } from "vitest";

import {
  coerceValue,
  collectKeys,
  filterRows,
  type Primitive,
} from "../settingsValues";

describe("coerceValue", () => {
  it("keeps a boolean a boolean", () => {
    expect(coerceValue(true, "false")).toBe(false);
    expect(coerceValue(false, "true")).toBe(true);
  });

  it("treats anything but the literal 'true' as false on a boolean field", () => {
    expect(coerceValue(true, "yes")).toBe(false);
    expect(coerceValue(true, "1")).toBe(false);
    expect(coerceValue(true, "")).toBe(false);
  });

  it("keeps a number a number", () => {
    expect(coerceValue(10, "25")).toBe(25);
    expect(coerceValue(1.5, "2.75")).toBe(2.75);
    expect(coerceValue(0, "-3")).toBe(-3);
  });

  it("leaves a numeric field alone when the text is cleared, rather than writing 0", () => {
    // Number("") is 0, so the obvious implementation turns "cleared" into a
    // real zero — for a fee or a rate that is a silent, expensive difference.
    expect(coerceValue(25, "")).toBe(25);
    expect(coerceValue(25, "   ")).toBe(25);
  });

  it("keeps the previous number when the text is not a number", () => {
    expect(coerceValue(25, "abc")).toBe(25);
    expect(coerceValue(25, "12abc")).toBe(25);
    expect(coerceValue(25, "Infinity")).toBe(25);
    expect(coerceValue(25, "NaN")).toBe(25);
  });

  it("treats a string field as text, including text that looks like other types", () => {
    expect(coerceValue("hello", "world")).toBe("world");
    expect(coerceValue("hello", "true")).toBe("true");
    expect(coerceValue("hello", "42")).toBe("42");
    expect(coerceValue("hello", "")).toBe("");
  });

  it("treats a brand-new key as text, having no stored type to preserve", () => {
    expect(coerceValue(undefined, "42")).toBe("42");
    expect(coerceValue(undefined, "true")).toBe("true");
  });
});

describe("collectKeys", () => {
  it("gathers every key across rows, sorted, without duplicates", () => {
    const rows = [
      { values: { name: "a", price: 1 } },
      { values: { name: "b", enabled: true } },
    ];
    expect(collectKeys(rows)).toEqual(["enabled", "name", "price"]);
  });

  it("survives rows with no values at all", () => {
    expect(collectKeys([{}, { values: undefined }])).toEqual([]);
    expect(collectKeys([])).toEqual([]);
  });
});

describe("filterRows", () => {
  // Codes are deliberately unlike the names, so a test can tell which key was
  // actually searched.
  const rows = [
    { id: "1", name: "Cash", code: "PAY-01" },
    { id: "2", name: "Card", code: "PAY-02" },
    { id: "3", name: "Wallet", code: null as string | null },
  ];

  it("returns everything for an empty query", () => {
    expect(filterRows(rows, "", ["name"])).toHaveLength(3);
    expect(filterRows(rows, "   ", ["name"])).toHaveLength(3);
  });

  it("matches case-insensitively on any searched key", () => {
    expect(filterRows(rows, "car", ["name", "code"]).map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, "CASH", ["name", "code"]).map((r) => r.id)).toEqual(["1"]);
    expect(filterRows(rows, "pay-02", ["name", "code"]).map((r) => r.id)).toEqual(["2"]);
  });

  it("only searches the keys it is given", () => {
    // "PAY-02" lives in `code`, so searching `name` alone must not match it.
    expect(filterRows(rows, "PAY-02", ["name"])).toHaveLength(0);
  });

  it("does not match a null field as the string 'null'", () => {
    expect(filterRows(rows, "null", ["code"])).toHaveLength(0);
  });

  it("returns nothing when nothing matches, rather than everything", () => {
    expect(filterRows(rows, "zzz", ["name", "code"])).toEqual([]);
  });
});

describe("round-tripping a settings row", () => {
  it("preserves each field's type through an edit", () => {
    const stored: Record<string, Primitive> = { name: "Cash", fee: 2.5, enabled: true };
    const edited = {
      name: coerceValue(stored.name, "Card"),
      fee: coerceValue(stored.fee, "3"),
      enabled: coerceValue(stored.enabled, "false"),
    };
    expect(edited).toEqual({ name: "Card", fee: 3, enabled: false });
    expect(typeof edited.fee).toBe("number");
    expect(typeof edited.enabled).toBe("boolean");
  });
});
