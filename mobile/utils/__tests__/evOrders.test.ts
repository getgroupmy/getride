import {
  buildChecklistDraft,
  deriveEvOrderStep,
  evFlag,
  evOrderStatusAtLeast,
  evOrderStatusLabel,
  evOrderStatusTone,
  isChecklistAccepted,
  isChecklistSubmitted,
  isEvFinancingComplete,
  isEvOwnershipConfirmed,
  isEvPlateAnswered,
  mapAdminTypeToFinanceType,
  normalizeEvOrderStatus,
  parseChecklistResults,
  serializeChecklistResults,
  type EvOrderValues,
} from "@/utils/evOrders";

describe("normalizeEvOrderStatus", () => {
  it("passes through the canonical statuses", () => {
    expect(normalizeEvOrderStatus("pending")).toBe("pending");
    expect(normalizeEvOrderStatus("assigned")).toBe("assigned");
    expect(normalizeEvOrderStatus("in-progress")).toBe("in-progress");
    expect(normalizeEvOrderStatus("ready_for_delivery")).toBe("ready_for_delivery");
    expect(normalizeEvOrderStatus("delivered")).toBe("delivered");
    expect(normalizeEvOrderStatus("cancelled")).toBe("cancelled");
  });

  it("accepts the spelling variants that reached stored data", () => {
    expect(normalizeEvOrderStatus("ready-for-delivery")).toBe("ready_for_delivery");
    expect(normalizeEvOrderStatus("Ready For Delivery")).toBe("ready_for_delivery");
    expect(normalizeEvOrderStatus("in progress")).toBe("in-progress");
    expect(normalizeEvOrderStatus("canceled")).toBe("cancelled");
    expect(normalizeEvOrderStatus("completed")).toBe("delivered");
  });

  it("falls back to pending for anything unknown", () => {
    expect(normalizeEvOrderStatus(undefined)).toBe("pending");
    expect(normalizeEvOrderStatus("")).toBe("pending");
    expect(normalizeEvOrderStatus("wat")).toBe("pending");
  });

  it("labels and tones every status it can produce", () => {
    expect(evOrderStatusLabel("ready-for-delivery")).toBe("Ready for delivery");
    expect(evOrderStatusLabel("nonsense")).toBe("Pending DA");
    expect(evOrderStatusTone("delivered")).toBe("success");
    expect(evOrderStatusTone("pending")).toBe("warning");
    expect(evOrderStatusTone("cancelled")).toBe("error");
  });
});

describe("evOrderStatusAtLeast", () => {
  it("orders the lifecycle", () => {
    expect(evOrderStatusAtLeast("ready_for_delivery", "assigned")).toBe(true);
    expect(evOrderStatusAtLeast("assigned", "ready_for_delivery")).toBe(false);
    expect(evOrderStatusAtLeast("delivered", "delivered")).toBe(true);
  });

  it("keeps cancelled outside the progression", () => {
    expect(evOrderStatusAtLeast("cancelled", "assigned")).toBe(false);
    expect(evOrderStatusAtLeast("cancelled", "cancelled")).toBe(true);
  });
});

describe("evFlag", () => {
  it("reads booleans however they were stored", () => {
    expect(evFlag(true)).toBe(true);
    expect(evFlag("true")).toBe(true);
    expect(evFlag("1")).toBe(true);
    expect(evFlag("yes")).toBe(true);
    expect(evFlag(false)).toBe(false);
    expect(evFlag("false")).toBe(false);
    expect(evFlag(undefined)).toBe(false);
    expect(evFlag("")).toBe(false);
  });
});

describe("parseChecklistResults", () => {
  it("returns an empty list for missing or invalid JSON", () => {
    expect(parseChecklistResults(undefined)).toEqual([]);
    expect(parseChecklistResults("")).toEqual([]);
    expect(parseChecklistResults("{not json")).toEqual([]);
    expect(parseChecklistResults('{"name":"x"}')).toEqual([]);
  });

  it("parses items and defaults done to true when absent", () => {
    expect(
      parseChecklistResults('[{"name":"Charge cable","note":"in boot"},{"name":"Tyres","done":false}]'),
    ).toEqual([
      { name: "Charge cable", done: true, note: "in boot" },
      { name: "Tyres", done: false, note: "" },
    ]);
  });

  it("drops nameless rows", () => {
    expect(parseChecklistResults('[{"done":true},{"name":"Keys","done":true}]')).toEqual([
      { name: "Keys", done: true, note: "" },
    ]);
  });

  it("round-trips through serialize", () => {
    const items = [{ name: "Keys", done: false, note: "one missing" }];
    expect(parseChecklistResults(serializeChecklistResults(items))).toEqual(items);
  });
});

describe("isChecklistSubmitted / isChecklistAccepted", () => {
  it("reads both boolean and string forms", () => {
    expect(isChecklistSubmitted({ checklistSubmitted: true })).toBe(true);
    expect(isChecklistSubmitted({ checklistSubmitted: "true" })).toBe(true);
    expect(isChecklistSubmitted({})).toBe(false);
    expect(isChecklistAccepted({ checklistAccepted: "1" })).toBe(true);
    expect(isChecklistAccepted({ checklistAccepted: false })).toBe(false);
  });
});

describe("buildChecklistDraft", () => {
  it("starts every template item unticked when nothing is saved", () => {
    expect(buildChecklistDraft(["Keys", "Charge cable"], {})).toEqual([
      { name: "Keys", done: false, note: "" },
      { name: "Charge cable", done: false, note: "" },
    ]);
  });

  it("resumes from what the advisor already submitted", () => {
    const values: EvOrderValues = {
      checklistResults: '[{"name":"Keys","done":true,"note":"2 fobs"}]',
    };
    expect(buildChecklistDraft(["Keys", "Charge cable"], values)).toEqual([
      { name: "Keys", done: true, note: "2 fobs" },
      { name: "Charge cable", done: false, note: "" },
    ]);
  });

  it("keeps submitted items that have since left the template", () => {
    const values: EvOrderValues = {
      checklistResults: '[{"name":"Retired check","done":true,"note":""}]',
    };
    expect(buildChecklistDraft(["Keys"], values)).toEqual([
      { name: "Keys", done: false, note: "" },
      { name: "Retired check", done: true, note: "" },
    ]);
  });

  it("ignores blank template names", () => {
    expect(buildChecklistDraft(["", "  ", "Keys"], {})).toEqual([
      { name: "Keys", done: false, note: "" },
    ]);
  });
});

describe("mapAdminTypeToFinanceType", () => {
  it("maps the admin labels", () => {
    expect(mapAdminTypeToFinanceType("Cash")).toBe("cash");
    expect(mapAdminTypeToFinanceType("Hire Purchase")).toBe("hp");
    expect(mapAdminTypeToFinanceType("HP")).toBe("hp");
    expect(mapAdminTypeToFinanceType("Leasing")).toBe("leasing");
    expect(mapAdminTypeToFinanceType("Long term rental")).toBe("rental");
    expect(mapAdminTypeToFinanceType("")).toBeNull();
    expect(mapAdminTypeToFinanceType("balloon")).toBeNull();
  });
});

describe("step predicates", () => {
  it("requires all three identity fields for ownership", () => {
    expect(isEvOwnershipConfirmed({ ownerFullName: "A", ownerIdNumber: "1", ownerAddress: "x" })).toBe(true);
    expect(isEvOwnershipConfirmed({ ownerFullName: "A", ownerIdNumber: "1" })).toBe(false);
    expect(isEvOwnershipConfirmed({})).toBe(false);
  });

  it("requires a plate number only when transferring", () => {
    expect(isEvPlateAnswered({ plateTransfer: "no" })).toBe(true);
    expect(isEvPlateAnswered({ plateTransfer: "yes" })).toBe(false);
    expect(isEvPlateAnswered({ plateTransfer: "yes", plateNumber: "WXY 1234" })).toBe(true);
    expect(isEvPlateAnswered({})).toBe(false);
  });

  it("gates financing on the per-type payment", () => {
    expect(isEvFinancingComplete({ financeType: "cash", financeChoice: "f1" })).toBe(false);
    expect(isEvFinancingComplete({ financeType: "cash", financeChoice: "f1", cashBalancePaid: true })).toBe(true);
    expect(isEvFinancingComplete({ financeType: "hp", financeChoice: "f1" })).toBe(true);
    expect(isEvFinancingComplete({ financeType: "hp" })).toBe(false);
    expect(isEvFinancingComplete({ financeType: "leasing", financeChoice: "f1" })).toBe(false);
    expect(
      isEvFinancingComplete({ financeType: "leasing", financeChoice: "f1", leasingAddonRequired: "no" }),
    ).toBe(true);
    expect(
      isEvFinancingComplete({ financeType: "leasing", financeChoice: "f1", leasingAddonRequired: "yes" }),
    ).toBe(false);
    expect(
      isEvFinancingComplete({
        financeType: "leasing",
        financeChoice: "f1",
        leasingAddonRequired: "yes",
        leasingAddonPaid: true,
      }),
    ).toBe(true);
  });
});

describe("deriveEvOrderStep", () => {
  it("floors at ownership — an order row only exists after the deposit", () => {
    expect(deriveEvOrderStep({})).toBe("ownership");
    expect(deriveEvOrderStep({ depositPaid: true })).toBe("ownership");
  });

  it("walks forward as each step is satisfied", () => {
    const owned: EvOrderValues = { ownerFullName: "A", ownerIdNumber: "1", ownerAddress: "x" };
    expect(deriveEvOrderStep(owned)).toBe("plate");
    const plated: EvOrderValues = { ...owned, plateTransfer: "no" };
    expect(deriveEvOrderStep(plated)).toBe("financing");
    const financed: EvOrderValues = { ...plated, financeType: "hp", financeChoice: "f1" };
    expect(deriveEvOrderStep(financed)).toBe("advisor");
    expect(deriveEvOrderStep({ ...financed, advisorId: "da1" })).toBe("schedule");
    expect(deriveEvOrderStep({ ...financed, advisorId: "da1", deliveryDate: "2026-09-01" })).toBe("delivery");
  });

  it("returns delivery once the customer has accepted handover", () => {
    expect(deriveEvOrderStep({ checklistAccepted: true })).toBe("delivery");
  });
});
