import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import {
  FileCheck2,
  FileText,
  Globe2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Camera,
  Check,
  Clock,
  CircleX,
  CircleAlert,
  Sparkles,
  ShieldX,
  Lock,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";
import DocumentUploadModal, {
  type DocumentTarget,
  type DocumentRequirementFlags,
} from "@/components/DocumentUploadModal";
import {
  fetchProviderDocuments,
  computeDisplayStatus,
  type ProviderDocumentRow,
  type ProviderDocStatus,
} from "@/utils/providerDocumentsStore";

const STORAGE_KEY = "required-documents" as const;
const ALL_TOKEN = "__ALL__" as const;

const parseDocTypes = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
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

interface ResolvedDoc {
  id: string;
  name: string;
  description: string;
  compulsory: boolean;
  scope: "global" | "country" | "state" | "mixed";
  matchedLabels: string[];
  flags: DocumentRequirementFlags;
}

interface Props {
  partnerId: string;
  authUserId: string | null;
  countries?: string[];
  states?: { country: string; state: string }[];
  docTypeIds?: string[];
  /**
   * Partner type names assigned to the current partner. When provided, a
   * required-document is considered applicable if its own `partnerTypes`
   * field overlaps with this list (or contains `__ALL__`). Required-documents
   * with no `partnerTypes` configured fall back to the `docTypeIds` filter
   * for backward compatibility.
   */
  partnerTypeNames?: string[];
  title?: string;
  subtitle?: string;
  onCompletionChange?: (allCompulsoryUploaded: boolean) => void;
  /**
   * When set, an Approved document with an `expiry_date` further than this many
   * days in the future is locked (non-tappable). Approved docs within the
   * window — and Approved docs with no expiry — can still be updated. Pending /
   * Rejected / Expired are always tappable. Used by the partner Documents page
   * to enforce "can only renew 14 days before expiry".
   */
  lockApprovedUntilExpiryWithinDays?: number;
  /**
   * When true, all region/regionsGlobal filtering is bypassed and every
   * active required document that passes the docTypes filter is shown.
   * Use on screens like the partner Documents page where region context
   * isn't available but the partner still needs to see every doc applicable
   * to their assigned partner type.
   */
  ignoreRegionFilter?: boolean;
  testID?: string;
}

const statusMeta = (
  s: ProviderDocStatus
): { label: string; bg: string; fg: string; Icon: typeof Check } => {
  switch (s) {
    case "Approved":
      return { label: "Approved", bg: "#10b98122", fg: "#059669", Icon: Check };
    case "Rejected":
      return { label: "Rejected", bg: "#ef444422", fg: "#dc2626", Icon: CircleX };
    case "Expired":
      return { label: "Expired", bg: "#f59e0b22", fg: "#d97706", Icon: CircleAlert };
    case "Pending Review":
    default:
      return { label: "Pending Review", bg: "#3b82f622", fg: "#2563eb", Icon: Clock };
  }
};

export default function RequiredDocsUploader({
  partnerId,
  authUserId,
  countries,
  states,
  docTypeIds,
  partnerTypeNames,
  title = "Required documents",
  subtitle,
  onCompletionChange,
  lockApprovedUntilExpiryWithinDays,
  ignoreRegionFilter,
  testID,
}: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [uploads, setUploads] = useState<ProviderDocumentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [active, setActive] = useState<DocumentTarget | null>(null);

  const load = useCallback(async () => {
    if (!partnerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = await fetchProviderDocuments(partnerId);
    setUploads(rows);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allowedDocTypeIds = useMemo<Set<string> | null>(() => {
    if (docTypeIds && docTypeIds.length > 0) {
      if (docTypeIds.includes(ALL_TOKEN)) return null;
      return new Set(docTypeIds.filter((x) => x && x !== ALL_TOKEN));
    }
    return null;
  }, [docTypeIds]);

  const allowedPartnerTypeNames = useMemo<Set<string> | null>(() => {
    if (!partnerTypeNames) return null;
    if (partnerTypeNames.length === 0) return new Set();
    if (partnerTypeNames.includes(ALL_TOKEN)) return null;
    return new Set(
      partnerTypeNames
        .map((x) => String(x).trim().toLowerCase())
        .filter((x) => x.length > 0)
    );
  }, [partnerTypeNames]);

  const ctxCountries = useMemo(() => {
    const set = new Set<string>();
    (countries ?? []).forEach((c) => {
      const v = String(c ?? "").trim();
      if (v) set.add(v);
    });
    return set;
  }, [countries]);

  const ctxStates = useMemo(() => {
    const set = new Set<string>();
    (states ?? []).forEach((s) => {
      const country = String(s.country ?? "").trim();
      const state = String(s.state ?? "").trim();
      if (country && state) set.add(`${country}|${state}`);
    });
    return set;
  }, [states]);

  const hasContext = ctxCountries.size > 0 || ctxStates.size > 0;

  const resolved = useMemo<ResolvedDoc[]>(() => {
    const out: ResolvedDoc[] = [];
    for (const e of entries as SettingEntry[]) {
      if (!Boolean(e.values.active ?? true)) continue;
      const name = String(e.values.name ?? "").trim();
      if (!name) continue;

      const docPartnerTypes = parseDocTypes(e.values.partnerTypes);
      if (docPartnerTypes.length > 0) {
        // Preferred path: filter directly by partner-type name. If the doc
        // is tagged with __ALL__ it applies to every partner. Otherwise it
        // must overlap with the partner's assigned partner-type names.
        if (!docPartnerTypes.includes(ALL_TOKEN)) {
          if (allowedPartnerTypeNames === null) {
            // No partner-type filter provided — show everything tagged by name.
          } else {
            const lc = docPartnerTypes.map((x) => x.trim().toLowerCase());
            const matches = lc.some((n) => allowedPartnerTypeNames.has(n));
            if (!matches) continue;
          }
        }
      } else if (allowedDocTypeIds) {
        // Backward compatibility: fall back to docTypes-based filter when
        // the doc has no partnerTypes configured.
        const types = parseDocTypes(e.values.docTypes);
        const matches =
          types.includes(ALL_TOKEN) || types.some((id) => allowedDocTypeIds.has(id));
        if (!matches) continue;
      }
      const description = String(e.values.description ?? "").trim();
      const isGlobal = Boolean(e.values.regionsGlobal ?? true);
      const globalCompulsory = Boolean(
        e.values.regionsGlobalCompulsory ?? e.values.required ?? true
      );
      const regions = parseRegions(e.values.regions);
      const flags: DocumentRequirementFlags = {
        requireStartDate: Boolean(e.values.requireStartDate ?? false),
        requireExpiryDate: Boolean(e.values.requireExpiryDate ?? false),
        requireDocumentNumber: Boolean(e.values.requireDocumentNumber ?? false),
        requireInsuranceProvider: Boolean(e.values.requireInsuranceProvider ?? false),
        isPwd: Boolean(e.values.isPwd ?? false),
        requireFrontBack: Boolean(e.values.requireFrontBack ?? false),
        allowPdfUpload: Boolean(e.values.allowPdfUpload ?? false),
        isTaxiPermit: Boolean(e.values.isTaxiPermit ?? false),
      };

      if (isGlobal) {
        out.push({
          id: e.id,
          name,
          description,
          compulsory: globalCompulsory,
          scope: "global",
          matchedLabels: ["Global"],
          flags,
        });
        continue;
      }

      if (ignoreRegionFilter) {
        const anyCompulsory =
          regions.length === 0 ? globalCompulsory : regions.some((r) => r.compulsory);
        const labels =
          regions.length === 0
            ? ["All regions"]
            : regions
                .slice(0, 3)
                .map((r) =>
                  r.type === "country" ? r.country : `${r.state}, ${r.country}`
                );
        if (regions.length > 3) labels.push(`+${regions.length - 3} more`);
        const scope: ResolvedDoc["scope"] =
          regions.length === 0
            ? "global"
            : regions.every((r) => r.type === "country")
              ? "country"
              : regions.every((r) => r.type === "state")
                ? "state"
                : "mixed";
        out.push({
          id: e.id,
          name,
          description,
          compulsory: anyCompulsory,
          scope,
          matchedLabels: labels,
          flags,
        });
        continue;
      }

      if (!hasContext) {
        if (regions.length === 0) continue;
        const anyCompulsory = regions.some((r) => r.compulsory);
        const labels = regions
          .slice(0, 3)
          .map((r) => (r.type === "country" ? r.country : `${r.state}, ${r.country}`));
        if (regions.length > 3) labels.push(`+${regions.length - 3} more`);
        const scope: ResolvedDoc["scope"] = regions.every((r) => r.type === "country")
          ? "country"
          : regions.every((r) => r.type === "state")
            ? "state"
            : "mixed";
        out.push({
          id: e.id,
          name,
          description,
          compulsory: anyCompulsory,
          scope,
          matchedLabels: labels,
          flags,
        });
        continue;
      }

      const matches: ParsedRegion[] = [];
      for (const r of regions) {
        if (r.type === "country" && ctxCountries.has(r.country)) matches.push(r);
        else if (
          r.type === "state" &&
          r.state &&
          ctxStates.has(`${r.country}|${r.state}`)
        )
          matches.push(r);
      }
      if (matches.length === 0) continue;
      const anyCompulsory = matches.some((r) => r.compulsory);
      const labels = matches
        .slice(0, 3)
        .map((r) => (r.type === "country" ? r.country : `${r.state}, ${r.country}`));
      if (matches.length > 3) labels.push(`+${matches.length - 3} more`);
      const scope: ResolvedDoc["scope"] = matches.every((r) => r.type === "country")
        ? "country"
        : matches.every((r) => r.type === "state")
          ? "state"
          : "mixed";
      out.push({
        id: e.id,
        name,
        description,
        compulsory: anyCompulsory,
        scope,
        matchedLabels: labels,
        flags,
      });
    }
    return out.sort((a, b) => {
      if (a.compulsory !== b.compulsory) return a.compulsory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [entries, ctxCountries, ctxStates, hasContext, allowedDocTypeIds, allowedPartnerTypeNames, ignoreRegionFilter]);

  const uploadsByDoc = useMemo(() => {
    const map = new Map<string, ProviderDocumentRow>();
    for (const u of uploads) {
      if (!map.has(u.doc_id)) map.set(u.doc_id, u);
    }
    return map;
  }, [uploads]);

  const compulsoryCount = resolved.filter((d) => d.compulsory).length;
  const uploadedCount = resolved.filter((d) => {
    const u = uploadsByDoc.get(d.id);
    if (!u) return false;
    const s = computeDisplayStatus(u);
    return s !== "Expired" && s !== "Rejected";
  }).length;

  useEffect(() => {
    const ok = resolved.every((d) => {
      if (!d.compulsory) return true;
      const u = uploadsByDoc.get(d.id);
      if (!u) return false;
      const s = computeDisplayStatus(u);
      return s !== "Expired" && s !== "Rejected";
    });
    onCompletionChange?.(ok);
  }, [resolved, uploadsByDoc, onCompletionChange]);

  const isLocked = useCallback(
    (u: ProviderDocumentRow | undefined): boolean => {
      if (!u) return false;
      if (lockApprovedUntilExpiryWithinDays == null) return false;
      const s = computeDisplayStatus(u);
      if (s !== "Approved") return false;
      if (!u.expiry_date) return true; // approved & no expiry → can't be renewed
      const days = (new Date(u.expiry_date).getTime() - Date.now()) / 86400000;
      return days > lockApprovedUntilExpiryWithinDays;
    },
    [lockApprovedUntilExpiryWithinDays]
  );

  const onTap = (doc: ResolvedDoc) => {
    const u = uploadsByDoc.get(doc.id);
    if (isLocked(u)) return;
    setActive({
      docId: doc.id,
      docName: doc.name,
      flags: doc.flags,
    });
  };

  const onSaved = (row: ProviderDocumentRow) => {
    setUploads((prev) => {
      const others = prev.filter((p) => p.doc_id !== row.doc_id);
      return [row, ...others];
    });
  };

  const computedSubtitle =
    subtitle ??
    `${uploadedCount} uploaded · ${Math.max(0, compulsoryCount - uploadedCount)} compulsory left`;

  return (
    <View testID={testID}>
      <View style={styles.headerRow}>
        <FileCheck2 color={Colors.accent} size={16} />
        <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
        {computedSubtitle}
      </Text>

      {loading ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <ActivityIndicator color={Colors.accent} />
          <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
            Loading your documents…
          </Text>
        </View>
      ) : resolved.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <FileText color={Colors.textSecondary} size={18} />
          <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
            {hasContext
              ? "No required documents for the selected region."
              : "No active required documents yet."}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {resolved.map((d) => {
            const u = uploadsByDoc.get(d.id);
            const status: ProviderDocStatus | null = u
              ? computeDisplayStatus(u)
              : null;
            const sm = status ? statusMeta(status) : null;
            const reqColor = d.compulsory ? Colors.error : Colors.textSecondary;
            const ScopeIcon = d.scope === "global" ? Globe2 : MapPin;
            const needsAction =
              !u || status === "Expired" || status === "Rejected";
            const locked = isLocked(u);

            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => onTap(d)}
                disabled={locked}
                activeOpacity={locked ? 1 : 0.85}
                style={[
                  styles.row,
                  {
                    backgroundColor: Colors.gray[100],
                    borderColor: needsAction && d.compulsory ? reqColor + "55" : Colors.border,
                    opacity: locked ? 0.95 : 1,
                  },
                ]}
                testID={`required-doc-upload-${d.id}`}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: reqColor + "18" },
                  ]}
                >
                  {d.compulsory ? (
                    <ShieldAlert color={reqColor} size={18} />
                  ) : (
                    <ShieldCheck color={reqColor} size={18} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.docName, { color: Colors.text }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                  {!!d.description && (
                    <Text
                      style={[styles.docDesc, { color: Colors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {d.description}
                    </Text>
                  )}
                  <View style={styles.scopeRow}>
                    <ScopeIcon color={Colors.textSecondary} size={11} />
                    <Text
                      style={[styles.scopeText, { color: Colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {d.matchedLabels.join(" · ")}
                    </Text>
                  </View>
                  {u?.expiry_date ? (
                    <Text
                      style={[styles.expiryText, { color: Colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      Expires: {u.expiry_date}
                    </Text>
                  ) : null}
                  {u?.ai_verification ? (
                    <View style={styles.aiRow}>
                      {u.ai_verification.matchesTitle ? (
                        <Sparkles color="#059669" size={11} />
                      ) : (
                        <ShieldX color="#d97706" size={11} />
                      )}
                      <Text
                        style={[
                          styles.aiBadgeText,
                          {
                            color: u.ai_verification.matchesTitle
                              ? "#059669"
                              : "#d97706",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        AI {u.ai_verification.matchesTitle ? "verified" : "flagged"}
                        {typeof u.ai_verification.confidence === "number"
                          ? ` \u00b7 ${Math.round(u.ai_verification.confidence * 100)}%`
                          : ""}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.rightCol}>
                  {locked ? (
                    <View
                      style={[
                        styles.uploadHint,
                        { backgroundColor: Colors.textSecondary + "18" },
                      ]}
                    >
                      <Lock color={Colors.textSecondary} size={11} />
                      <Text style={[styles.uploadHintText, { color: Colors.textSecondary }]}>
                        Renew near expiry
                      </Text>
                    </View>
                  ) : null}
                  {sm ? (
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: sm.bg, borderColor: sm.fg + "55" },
                      ]}
                    >
                      <sm.Icon color={sm.fg} size={10} />
                      <Text style={[styles.statusText, { color: sm.fg }]}>
                        {sm.label}
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.uploadHint,
                        { backgroundColor: Colors.accent + "18" },
                      ]}
                    >
                      <Upload color={Colors.accent} size={11} />
                      <Camera color={Colors.accent} size={11} />
                      <Text style={[styles.uploadHintText, { color: Colors.accent }]}>
                        Tap to upload
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.compulsoryText, { color: reqColor }]}>
                    {d.compulsory ? "Compulsory" : "Optional"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <DocumentUploadModal
        visible={active !== null}
        onClose={() => setActive(null)}
        partnerId={partnerId}
        authUserId={authUserId}
        target={active}
        existing={active ? uploadsByDoc.get(active.docId) ?? null : null}
        onSaved={onSaved as React.ComponentProps<typeof DocumentUploadModal>["onSaved"]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 4,
  },
  title: { fontSize: 14, fontWeight: "800" as const },
  subtitle: { fontSize: 11, marginBottom: 10 },
  list: { gap: 8 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  docName: { fontSize: 13, fontWeight: "700" as const },
  docDesc: { fontSize: 11, marginTop: 2 },
  scopeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 4,
  },
  scopeText: { fontSize: 10, fontWeight: "600" as const, flex: 1 },
  expiryText: { fontSize: 10, marginTop: 2 },
  aiRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 2,
  },
  aiBadgeText: { fontSize: 10, fontWeight: "700" as const, flex: 1 },
  rightCol: { alignItems: "flex-end" as const, gap: 4 },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
  uploadHint: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  uploadHintText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
  compulsoryText: { fontSize: 9, fontWeight: "700" as const },
  emptyCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyText: { fontSize: 12, flex: 1 },
});
