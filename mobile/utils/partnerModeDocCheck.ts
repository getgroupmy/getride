import {
  fetchUserProfile,
  findOrCreatePartner,
  type PartnerProfileRow,
} from "@/utils/partnerOnboardingStore";
import {
  fetchProviderDocuments,
  computeDisplayStatus,
  type ProviderDocumentRow,
} from "@/utils/providerDocumentsStore";

type SettingEntry = {
  id: string;
  values: Record<string, unknown> & {
    name?: unknown;
    active?: unknown;
    docTypes?: unknown;
    partnerTypes?: unknown;
    regionsGlobal?: unknown;
    regionsGlobalCompulsory?: unknown;
    regions?: unknown;
    required?: unknown;
  };
};

interface ParsedRegion {
  type: "country" | "state";
  country: string;
  state?: string;
  compulsory: boolean;
}

const parseRegions = (raw: unknown): ParsedRegion[] => {
  const fromArray = (arr: unknown[]): ParsedRegion[] =>
    arr
      .map((r) => {
        if (!r || typeof r !== "object") return null;
        const o = r as Record<string, unknown>;
        const type = o.type === "state" ? ("state" as const) : ("country" as const);
        const country = String(o.country ?? "").trim();
        const state = String(o.state ?? "").trim();
        if (!country) return null;
        if (type === "state" && !state) return null;
        const item: ParsedRegion = {
          type,
          country,
          state: type === "state" ? state : undefined,
          compulsory: Boolean(o.compulsory ?? true),
        };
        return item;
      })
      .filter((x): x is ParsedRegion => x !== null);
  if (Array.isArray(raw)) return fromArray(raw);
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return fromArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
};

type GetEntries = (key: string) => SettingEntry[];

const PARTNER_TYPE_KEY = "partner-type" as const;
const REQUIRED_DOCS_KEY = "required-documents" as const;
const DOC_TYPE_KEY = "document-type" as const;
const PARTNER_CATEGORY_NAME = "Partner" as const;
const ALL_TOKEN = "__ALL__" as const;

const parseDocTypes = (raw: unknown): string[] => {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
};

export interface DocCheckIssue {
  id: string;
  name: string;
  compulsory: boolean;
  reason: "missing" | "rejected" | "expired";
}

export interface DocCheckResult {
  partner: PartnerProfileRow | null;
  /** All issues for the selected partner type (missing / rejected / expired). */
  issues: DocCheckIssue[];
  /** Compulsory-only subset — these block the partner from going online. */
  blockingIssues: DocCheckIssue[];
}

/**
 * Cross-check required-documents (filtered by docTypes of the selected
 * partner-type) against the partner's `provider_documents` uploads.
 *
 * Mirrors the filter logic in partner-documents.tsx: a required-document is
 * considered "applicable" if its docTypes intersect the partner-type's
 * docTypes, or if the partner-type opts into `__ALL__`. Required-documents
 * with no docTypes configured are treated as untargeted and excluded.
 *
 * Returns a list of issues — entries that are not yet uploaded, rejected,
 * or expired — so the caller can prompt the partner to refresh documents
 * before they switch into that service mode.
 */
export async function checkPartnerModeDocuments(
  userId: string | null | undefined,
  partnerModeName: string,
  getEntries: GetEntries
): Promise<DocCheckResult> {
  const empty: DocCheckResult = { partner: null, issues: [], blockingIssues: [] };
  if (!userId) return empty;
  try {
    const prof = await fetchUserProfile(userId);
    const partner = await findOrCreatePartner(userId, prof);
    if (!partner?.id) return empty;

    const partnerTypeEntries = getEntries(PARTNER_TYPE_KEY);
    const requiredDocEntries = getEntries(REQUIRED_DOCS_KEY);
    const docTypeEntries = getEntries(DOC_TYPE_KEY);

    // Id of the fixed "Partner" document-type category. Partner-facing
    // required-documents must be tagged with this category (or __ALL__).
    const partnerCategoryEntry = docTypeEntries.find(
      (e) =>
        String(e.values?.name ?? "").trim().toLowerCase() ===
        PARTNER_CATEGORY_NAME.toLowerCase()
    );
    const partnerCategoryId = partnerCategoryEntry?.id ?? null;

    const target = partnerModeName.trim().toLowerCase();
    // Restrict matching to partner-types actually assigned to this partner
    // (by name, since partner.partner_types stores names). Otherwise the
    // mode name could match a partner-type the user isn't part of.
    const assignedLc = new Set(
      (partner.partner_types ?? []).map((x) => String(x).trim().toLowerCase())
    );
    const matchedType = partnerTypeEntries.find((e) => {
      const n = String(e.values?.name ?? "").trim().toLowerCase();
      if (n !== target) return false;
      return assignedLc.size === 0 || assignedLc.has(n);
    });

    // If the partner-type isn't found / not assigned, treat as no docs
    // applicable — we shouldn't silently widen the catalogue.
    // The mode must correspond to an assigned partner-type, otherwise no
    // partner-facing docs apply.
    const allowedSet: Set<string> | null = matchedType
      ? new Set(partnerCategoryId ? [partnerCategoryId] : [])
      : new Set();

    // Partner's service regions — used to filter region-scoped required-docs.
    const partnerCountries = new Set(
      (partner.service_countries ?? [])
        .map((c) => String(c).trim().toLowerCase())
        .filter(Boolean)
    );
    const partnerStates = new Set(
      (partner.service_states ?? [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    const uploads = await fetchProviderDocuments(partner.id);
    const latestByDoc = new Map<string, ProviderDocumentRow>();
    for (const u of uploads) {
      if (!latestByDoc.has(u.doc_id)) latestByDoc.set(u.doc_id, u);
    }

    const targetLc = target;
    const issues: DocCheckIssue[] = [];
    for (const e of requiredDocEntries) {
      if (!Boolean(e.values.active ?? true)) continue;
      const name = String(e.values.name ?? "").trim();
      if (!name) continue;
      const docPartnerTypes = parseDocTypes(e.values.partnerTypes);
      if (docPartnerTypes.length > 0) {
        // Preferred path: match by partner-type name. The mode the user just
        // selected is `targetLc` — the doc applies if tagged with __ALL__ or
        // includes the selected partner-type name (case-insensitive).
        if (!docPartnerTypes.includes(ALL_TOKEN)) {
          const lc = docPartnerTypes.map((x) => x.trim().toLowerCase());
          if (!lc.includes(targetLc)) continue;
        }
      } else if (allowedSet !== null) {
        // Backward compatibility: fall back to docTypes-based filter.
        const types = parseDocTypes(e.values.docTypes);
        const matches =
          types.includes(ALL_TOKEN) || types.some((id) => allowedSet.has(id));
        if (!matches) continue;
      }
      // Region gate: if the doc isn't global, it only applies when the
      // partner's service_countries / service_states overlap with at least
      // one of the doc's configured regions. Compulsoriness then comes from
      // the matched region(s); if none match, the doc is skipped entirely.
      const isGlobal = Boolean(e.values.regionsGlobal ?? true);
      const regions = parseRegions(e.values.regions);
      let compulsory: boolean;
      if (isGlobal) {
        compulsory = Boolean(
          e.values.regionsGlobalCompulsory ?? e.values.required ?? true
        );
      } else {
        if (regions.length === 0) continue;
        const matchedRegions = regions.filter((r) => {
          const c = r.country.trim().toLowerCase();
          if (r.type === "country") return partnerCountries.has(c);
          const s = (r.state ?? "").trim().toLowerCase();
          // State match: explicit state in service_states, or whole country
          // selected (which implies all its states).
          return partnerStates.has(s) || partnerCountries.has(c);
        });
        if (matchedRegions.length === 0) continue;
        compulsory = matchedRegions.some((r) => r.compulsory);
      }
      const u = latestByDoc.get(e.id);
      if (!u) {
        issues.push({ id: e.id, name, compulsory, reason: "missing" });
        continue;
      }
      const s = computeDisplayStatus(u);
      if (s === "Rejected")
        issues.push({ id: e.id, name, compulsory, reason: "rejected" });
      else if (s === "Expired")
        issues.push({ id: e.id, name, compulsory, reason: "expired" });
    }

    issues.sort((a, b) => {
      if (a.compulsory !== b.compulsory) return a.compulsory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      partner,
      issues,
      blockingIssues: issues.filter((i) => i.compulsory),
    };
  } catch (e) {
    console.log("[partnerModeDocCheck] failed", e);
    return empty;
  }
}

/** Build a short human-readable summary for the prompt body. */
export function summarizeDocIssues(issues: DocCheckIssue[]): string {
  if (issues.length === 0) return "";
  const top = issues.slice(0, 4).map((i) => {
    const reason =
      i.reason === "missing"
        ? "not uploaded"
        : i.reason === "rejected"
          ? "rejected"
          : "expired";
    return `\u2022 ${i.name} (${reason})`;
  });
  const more = issues.length > top.length ? `\n\u2022 +${issues.length - top.length} more` : "";
  return top.join("\n") + more;
}
