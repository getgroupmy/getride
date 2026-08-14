import { buildPartnerModeOptions } from "@/utils/partnerModeOptions";

type Entry = { id: string; values?: Record<string, unknown> };

const entry = (name: string, values: Record<string, unknown> = {}): Entry => ({
  id: `pt-${name.toLowerCase().replace(/\s+/g, "-")}`,
  values: { name, ...values },
});

const CATALOG: Entry[] = [
  entry("Dealer", { displayPriority: 1 }),
  entry("Delivery", { displayPriority: 2 }),
  entry("eHailing", { displayPriority: 3, shortInfo: "On-demand rides" }),
  entry("Fleet", { displayPriority: 4 }),
  entry("pHailing", { displayPriority: 5 }),
  entry("Service Provider", { displayPriority: 6 }),
  entry("Teksi", { displayPriority: 7, iconUrl: "https://cdn/teksi.png" }),
];

const names = (assigned: unknown[], catalog: Entry[] = CATALOG) =>
  buildPartnerModeOptions(assigned, catalog).map((o) => o.name);

describe("buildPartnerModeOptions", () => {
  it("lists only the partner's assigned types, never the whole catalog", () => {
    expect(names(["Delivery", "eHailing", "Teksi"])).toEqual([
      "Delivery",
      "eHailing",
      "Teksi",
    ]);
  });

  it("returns nothing when the partner has no assigned types", () => {
    expect(buildPartnerModeOptions([], CATALOG)).toEqual([]);
  });

  it("orders by the admin displayPriority, not the stored array order", () => {
    expect(names(["Teksi", "Delivery", "eHailing"])).toEqual([
      "Delivery",
      "eHailing",
      "Teksi",
    ]);
  });

  it("drops a type the admin has switched off", () => {
    const catalog = CATALOG.map((e) =>
      e.values?.name === "Delivery" ? entry("Delivery", { displayPriority: 2, enabled: false }) : e
    );
    expect(names(["Delivery", "eHailing", "Teksi"], catalog)).toEqual(["eHailing", "Teksi"]);
  });

  it("treats a missing enabled flag as enabled", () => {
    expect(names(["Fleet"], [entry("Fleet")])).toEqual(["Fleet"]);
  });

  it("keeps an assigned type the catalog does not know, sorted last", () => {
    expect(names(["Ghost", "Teksi", "Delivery"])).toEqual(["Delivery", "Teksi", "Ghost"]);
  });

  it("keeps everything in stored order when the catalog has not synced", () => {
    expect(names(["Teksi", "Delivery"], [])).toEqual(["Teksi", "Delivery"]);
  });

  it("matches catalog entries case-insensitively and collapses duplicates", () => {
    const options = buildPartnerModeOptions(["TEKSI", "teksi", "Teksi"], CATALOG);
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("TEKSI");
    expect(options[0].iconUrl).toBe("https://cdn/teksi.png");
  });

  it("ignores blank and nullish entries on the partner row", () => {
    expect(names(["Teksi", "", "   ", null, undefined])).toEqual(["Teksi"]);
  });

  it("decorates with shortInfo and the uploaded icon, leaving both undefined when unset", () => {
    const [dealer, ehailing] = buildPartnerModeOptions(["eHailing", "Dealer"], CATALOG);
    expect([dealer.name, ehailing.name]).toEqual(["Dealer", "eHailing"]);
    expect(ehailing.description).toBe("On-demand rides");
    expect(ehailing.iconUrl).toBeUndefined();
    expect(dealer.description).toBeUndefined();
  });

  it("falls back to description when shortInfo is absent", () => {
    const [opt] = buildPartnerModeOptions(
      ["Fleet"],
      [entry("Fleet", { description: "Manage a fleet" })]
    );
    expect(opt.description).toBe("Manage a fleet");
  });

  it("ignores a non-numeric displayPriority instead of poisoning the sort", () => {
    const catalog = [
      entry("Teksi", { displayPriority: "not-a-number" }),
      entry("Delivery", { displayPriority: 2 }),
    ];
    expect(names(["Teksi", "Delivery"], catalog)).toEqual(["Delivery", "Teksi"]);
  });
});
