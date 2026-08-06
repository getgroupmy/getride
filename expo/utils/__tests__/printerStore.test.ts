import {
  describePrinter,
  findSamePrinter,
  normalizePrinterDraft,
  pickDefaultPrinter,
  printerTransportOptions,
  removePrinter,
  upsertPrinter,
  type SavedPrinter,
} from "@/utils/printerStore";

function wifi(overrides: Partial<SavedPrinter> = {}): SavedPrinter {
  return {
    id: "p1",
    name: "Wi-Fi printer",
    transport: "wifi",
    host: "192.168.0.50",
    port: 9100,
    paperWidth: "58mm",
    createdAt: "2026-08-06T00:00:00.000Z",
    lastConnectedAt: null,
    ...overrides,
  };
}

describe("normalizePrinterDraft", () => {
  it("rejects a Wi-Fi printer with no address", () => {
    const res = normalizePrinterDraft({ transport: "wifi" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/IP address/i);
  });

  it("defaults the Wi-Fi port to the raw ESC/POS port", () => {
    const res = normalizePrinterDraft({ transport: "wifi", host: "10.0.0.5" });
    expect(res.ok).toBe(true);
    expect(res.value?.port).toBe(9100);
    expect(res.value?.host).toBe("10.0.0.5");
  });

  it("rejects an out-of-range port", () => {
    expect(normalizePrinterDraft({ transport: "wifi", host: "10.0.0.5", port: 70000 }).ok).toBe(
      false,
    );
    expect(normalizePrinterDraft({ transport: "wifi", host: "10.0.0.5", port: "abc" }).ok).toBe(
      false,
    );
  });

  it("requires a name to scan a Bluetooth LE printer by", () => {
    expect(normalizePrinterDraft({ transport: "bluetooth" }).ok).toBe(false);
    const res = normalizePrinterDraft({ transport: "bluetooth", address: "MTP-II" });
    expect(res.ok).toBe(true);
    expect(res.value?.address).toBe("MTP-II");
    // Name falls back to the Bluetooth name when none was typed.
    expect(res.value?.name).toBe("MTP-II");
  });

  it("lets a classic printer be saved with no paired name", () => {
    const res = normalizePrinterDraft({ transport: "bluetooth-classic" });
    expect(res.ok).toBe(true);
    expect(res.value?.address).toBeUndefined();
  });

  it("defaults and validates the paper width", () => {
    expect(normalizePrinterDraft({ transport: "wifi", host: "10.0.0.5" }).value?.paperWidth).toBe(
      "58mm",
    );
    expect(
      normalizePrinterDraft({ transport: "wifi", host: "10.0.0.5", paperWidth: "80mm" }).value
        ?.paperWidth,
    ).toBe("80mm");
  });

  it("rejects an unknown transport", () => {
    expect(normalizePrinterDraft({ transport: "carrier-pigeon" as any }).ok).toBe(false);
  });
});

describe("describePrinter", () => {
  it("names the Wi-Fi endpoint and paper width", () => {
    expect(describePrinter(wifi())).toBe("Wi-Fi · 192.168.0.50:9100 · 58mm");
  });

  it("names a Bluetooth printer by its address", () => {
    expect(
      describePrinter(wifi({ transport: "bluetooth", host: undefined, port: undefined, address: "MTP-II" })),
    ).toBe("Bluetooth LE · MTP-II · 58mm");
  });
});

describe("upsert / findSame / remove", () => {
  it("replaces the same physical printer rather than stacking a copy", () => {
    const list = [wifi({ id: "a", name: "Old name" })];
    const next = upsertPrinter(list, wifi({ id: "b", name: "New name" }));
    expect(next).toHaveLength(1);
    // Keeps the original id, takes the new name.
    expect(next[0].id).toBe("a");
    expect(next[0].name).toBe("New name");
  });

  it("treats a different endpoint as a different printer", () => {
    const list = [wifi({ id: "a" })];
    const next = upsertPrinter(list, wifi({ id: "b", host: "192.168.0.99" }));
    expect(next).toHaveLength(2);
  });

  it("matches a Bluetooth printer on its address case-insensitively", () => {
    const list = [wifi({ id: "a", transport: "bluetooth", host: undefined, address: "MTP-II" })];
    const hit = findSamePrinter(
      list,
      wifi({ id: "z", transport: "bluetooth", host: undefined, address: "mtp-ii" }),
    );
    expect(hit?.id).toBe("a");
  });

  it("removes by id", () => {
    expect(removePrinter([wifi({ id: "a" }), wifi({ id: "b" })], "a")).toHaveLength(1);
  });
});

describe("pickDefaultPrinter", () => {
  it("prefers the explicitly selected printer", () => {
    const list = [wifi({ id: "a" }), wifi({ id: "b", host: "10.0.0.9" })];
    expect(pickDefaultPrinter(list, "b")?.id).toBe("b");
  });

  it("falls back to the most recently used", () => {
    const list = [
      wifi({ id: "a", lastConnectedAt: 100 }),
      wifi({ id: "b", host: "10.0.0.9", lastConnectedAt: 200 }),
    ];
    expect(pickDefaultPrinter(list, null)?.id).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultPrinter([], null)).toBeNull();
  });
});

describe("printerTransportOptions", () => {
  it("passes the Wi-Fi endpoint through", () => {
    expect(printerTransportOptions(wifi())).toEqual({ host: "192.168.0.50", port: 9100 });
  });

  it("passes a BLE name as the scan hint", () => {
    expect(
      printerTransportOptions(wifi({ transport: "bluetooth", host: undefined, address: "MTP-II" })),
    ).toEqual({ nameHint: "MTP-II" });
  });

  it("passes a classic address through", () => {
    expect(
      printerTransportOptions(
        wifi({ transport: "bluetooth-classic", host: undefined, address: "00:11:22" }),
      ),
    ).toEqual({ address: "00:11:22" });
  });
});
