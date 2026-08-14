/**
 * TEKSI EV order domain logic.
 *
 * The customer wizard (`app/teksi-ev.tsx`) and the admin console
 * (`app/admin-orders.tsx`) both read and write the same `ev-orders` entry
 * shape. Before this module each side carried its own copy of the status
 * vocabulary and its own inline checklist parser, which is how the wizard
 * came to write a status (`ready_for_delivery`) the admin screen had never
 * heard of. Everything shared now lives here, pure and tested.
 */

export type EvOrderValues = Record<string, string | number | boolean | undefined>;

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

export type EvOrderStatus =
  | "pending"
  | "assigned"
  | "in-progress"
  | "ready_for_delivery"
  | "delivered"
  | "cancelled";

/** Every status, in lifecycle order. Drives the admin filter row. */
export const EV_ORDER_STATUSES: EvOrderStatus[] = [
  "pending",
  "assigned",
  "in-progress",
  "ready_for_delivery",
  "delivered",
  "cancelled",
];

export const EV_ORDER_STATUS_LABELS: Record<EvOrderStatus, string> = {
  pending: "Pending DA",
  assigned: "DA assigned",
  "in-progress": "In progress",
  ready_for_delivery: "Ready for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * Lifecycle position. `cancelled` sits outside the progression, so it shares
 * the terminal rank without implying the steps before it happened.
 */
const EV_ORDER_STATUS_RANK: Record<EvOrderStatus, number> = {
  pending: 0,
  assigned: 1,
  "in-progress": 2,
  ready_for_delivery: 3,
  delivered: 4,
  cancelled: 4,
};

/**
 * Semantic colour token for a status. Screens map these onto their own
 * palette, so the vocabulary stays independent of light/dark colours.
 */
export type EvOrderStatusTone = "warning" | "info" | "accent" | "success" | "error";

const EV_ORDER_STATUS_TONES: Record<EvOrderStatus, EvOrderStatusTone> = {
  pending: "warning",
  assigned: "info",
  "in-progress": "accent",
  ready_for_delivery: "accent",
  delivered: "success",
  cancelled: "error",
};

/**
 * Coerce anything stored on an order row into a known status. Tolerates the
 * spelling variants that reached production data (`ready-for-delivery`,
 * `readyForDelivery`, `Delivered`) and falls back to `pending`.
 */
export function normalizeEvOrderStatus(raw: unknown): EvOrderStatus {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (s) {
    case "assigned":
    case "da_assigned":
      return "assigned";
    case "in_progress":
    case "inprogress":
      return "in-progress";
    case "ready_for_delivery":
    case "readyfordelivery":
    case "ready":
      return "ready_for_delivery";
    case "delivered":
    case "completed":
      return "delivered";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

export function evOrderStatusLabel(raw: unknown): string {
  return EV_ORDER_STATUS_LABELS[normalizeEvOrderStatus(raw)];
}

export function evOrderStatusTone(raw: unknown): EvOrderStatusTone {
  return EV_ORDER_STATUS_TONES[normalizeEvOrderStatus(raw)];
}

/** True when `status` is at or past `at` in the lifecycle. */
export function evOrderStatusAtLeast(raw: unknown, at: EvOrderStatus): boolean {
  const s = normalizeEvOrderStatus(raw);
  if (s === "cancelled") return at === "cancelled";
  return EV_ORDER_STATUS_RANK[s] >= EV_ORDER_STATUS_RANK[at];
}

// ---------------------------------------------------------------------------
// Loose value coercion
// ---------------------------------------------------------------------------

/**
 * Order values round-trip through JSON and through hand-edited admin rows, so
 * a boolean can arrive as `true`, `"true"` or `"1"`.
 */
export function evFlag(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

const str = (raw: unknown): string => String(raw ?? "").trim();

// ---------------------------------------------------------------------------
// Delivery checklist
// ---------------------------------------------------------------------------

export interface EvChecklistResult {
  name: string;
  done: boolean;
  note: string;
}

/** Parse the `checklistResults` JSON blob. Never throws. */
export function parseChecklistResults(raw: unknown): EvChecklistResult[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const row = (x ?? {}) as { name?: unknown; done?: unknown; note?: unknown };
        return {
          name: str(row.name),
          done: row.done !== false,
          note: str(row.note),
        };
      })
      .filter((x) => !!x.name);
  } catch {
    return [];
  }
}

export function serializeChecklistResults(items: EvChecklistResult[]): string {
  return JSON.stringify(
    items.map((x) => ({ name: x.name, done: !!x.done, note: x.note ?? "" })),
  );
}

export function isChecklistSubmitted(values: EvOrderValues): boolean {
  return evFlag(values.checklistSubmitted);
}

export function isChecklistAccepted(values: EvOrderValues): boolean {
  return evFlag(values.checklistAccepted);
}

/**
 * Merge the configured checklist template with whatever the advisor has
 * already submitted, so re-opening the submission sheet resumes rather than
 * restarts, and template items added later still appear.
 */
export function buildChecklistDraft(
  templateNames: string[],
  values: EvOrderValues,
): EvChecklistResult[] {
  const saved = parseChecklistResults(values.checklistResults);
  const byName = new Map(saved.map((x) => [x.name, x]));
  const draft: EvChecklistResult[] = templateNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => byName.get(name) ?? { name, done: false, note: "" });
  // Keep submitted items that are no longer in the template — they are part of
  // the record the customer accepted.
  const templateSet = new Set(draft.map((x) => x.name));
  saved.forEach((x) => {
    if (!templateSet.has(x.name)) draft.push(x);
  });
  return draft;
}

// ---------------------------------------------------------------------------
// Wizard progress
// ---------------------------------------------------------------------------

export const EV_STEP_KEYS = [
  "model",
  "specification",
  "deposit",
  "ownership",
  "plate",
  "financing",
  "advisor",
  "schedule",
  "delivery",
] as const;

export type EvStepKey = (typeof EV_STEP_KEYS)[number];

export type EvFinanceType = "cash" | "hp" | "leasing" | "rental";

/** Map an admin-entered finance type label onto the wizard's four types. */
export function mapAdminTypeToFinanceType(raw: unknown): EvFinanceType | null {
  const t = str(raw).toLowerCase();
  if (!t) return null;
  if (t === "cash") return "cash";
  if (t === "leasing" || t.startsWith("leas")) return "leasing";
  if (t === "hire purchase" || t === "hp" || t.includes("hire")) return "hp";
  if (t === "rental" || t.includes("rent")) return "rental";
  return null;
}

export function isEvOwnershipConfirmed(values: EvOrderValues): boolean {
  return !!str(values.ownerFullName) && !!str(values.ownerIdNumber) && !!str(values.ownerAddress);
}

export function isEvPlateAnswered(values: EvOrderValues): boolean {
  const t = str(values.plateTransfer).toLowerCase();
  if (t === "no") return true;
  return t === "yes" && !!str(values.plateNumber);
}

export function isEvFinancingComplete(values: EvOrderValues): boolean {
  const type = mapAdminTypeToFinanceType(values.financeType);
  if (!type) return false;
  if (!str(values.financeChoice)) return false;
  if (type === "cash") return evFlag(values.cashBalancePaid);
  if (type === "leasing") {
    const addon = str(values.leasingAddonRequired).toLowerCase();
    if (addon === "no") return true;
    return addon === "yes" && evFlag(values.leasingAddonPaid);
  }
  return true;
}

/**
 * Furthest step the customer has already satisfied, used to drop them back
 * where they left off when they re-open a wizard they abandoned. An order row
 * only exists from the deposit step onwards, so that is the floor.
 */
export function deriveEvOrderStep(values: EvOrderValues): EvStepKey {
  if (isChecklistAccepted(values) || !!str(values.deliveryDate)) return "delivery";
  if (isEvFinancingComplete(values)) {
    return str(values.advisorId) ? "schedule" : "advisor";
  }
  if (isEvPlateAnswered(values)) return "financing";
  if (isEvOwnershipConfirmed(values)) return "plate";
  return "ownership";
}
