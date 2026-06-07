import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { FileCheck2, FileText, Globe2, MapPin, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "required-documents" as const;
const DOC_TYPE_KEY = "document-type" as const;
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

interface ResolvedDoc {
  id: string;
  name: string;
  description: string;
  compulsory: boolean;
  scope: "global" | "country" | "state" | "mixed";
  matchedLabels: string[];
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

interface Props {
  /** Countries selected in context (e.g. partner / vehicle service area). */
  countries?: string[];
  /** States selected in context (formatted as either "State" or "State, Country"). */
  states?: { country: string; state: string }[];
  /**
   * If provided, only docs whose configured `docTypes` include a document-type
   * matching this name (case-insensitive) — or that target ALL types — are shown.
   * e.g. pass `"Vehicle"` from the vehicle add/edit screens.
   */
  docTypeFilter?: string;
  /**
   * If provided, only docs whose `docTypes` include any of these document-type
   * IDs (or the `__ALL__` token) are shown. Use this when the allowed types come
   * from another settings record (e.g. the selected Partner Type's `docTypes`).
   * If the list itself contains `__ALL__`, no filtering is applied.
   */
  docTypeIds?: string[];
  /** Optional title override. */
  title?: string;
  /** Optional subtitle override. */
  subtitle?: string;
  testID?: string;
}

/**
 * Resolves required documents from admin settings against the supplied
 * region context and renders each one with a Compulsory / Optional badge.
 * Pulls per-region `compulsory` flag from the entry so the onboarding flow
 * shows the exact same scoping that admins configured.
 */
export default function RequiredDocsChecklist({
  countries,
  states,
  docTypeFilter,
  docTypeIds,
  title = "Required documents",
  subtitle,
  testID,
}: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const entries = getEntries(STORAGE_KEY);
  const docTypes = getEntries(DOC_TYPE_KEY);

  const allowedDocTypeIds = useMemo<Set<string> | null>(() => {
    if (docTypeIds && docTypeIds.length > 0) {
      if (docTypeIds.includes(ALL_TOKEN)) return null;
      return new Set(docTypeIds.filter((x) => x && x !== ALL_TOKEN));
    }
    const filter = String(docTypeFilter ?? "").trim().toLowerCase();
    if (!filter) return null;
    const ids = new Set<string>();
    for (const t of docTypes as SettingEntry[]) {
      const name = String(t.values.name ?? "").trim().toLowerCase();
      if (name === filter) ids.add(t.id);
    }
    return ids;
  }, [docTypes, docTypeFilter, docTypeIds]);

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

      if (allowedDocTypeIds) {
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

      if (isGlobal) {
        out.push({
          id: e.id,
          name,
          description,
          compulsory: globalCompulsory,
          scope: "global",
          matchedLabels: ["Global"],
        });
        continue;
      }

      if (!hasContext) {
        // Preview mode (no context yet) — show every regional entry with a
        // hint about how many regions it covers and whether any are compulsory.
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
        });
        continue;
      }

      // Filtered mode — entry applies only if a region matches the context.
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
      });
    }
    // Sort: compulsory first, then by name
    return out.sort((a, b) => {
      if (a.compulsory !== b.compulsory) return a.compulsory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [entries, ctxCountries, ctxStates, hasContext, allowedDocTypeIds]);

  const compulsoryCount = resolved.filter((d) => d.compulsory).length;
  const optionalCount = resolved.length - compulsoryCount;

  const computedSubtitle =
    subtitle ??
    (hasContext
      ? `${compulsoryCount} compulsory · ${optionalCount} optional for the selected region`
      : resolved.length > 0
        ? `${compulsoryCount} compulsory · ${optionalCount} optional (preview — select a region to filter)`
        : "No active documents configured");

  return (
    <View testID={testID}>
      <View style={styles.headerRow}>
        <FileCheck2 color={Colors.accent} size={16} />
        <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>{computedSubtitle}</Text>

      {resolved.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <FileText color={Colors.textSecondary} size={18} />
          <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
            {hasContext
              ? "No required documents configured for the selected region."
              : "No active required documents yet."}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {resolved.map((d) => {
            const badgeColor = d.compulsory ? Colors.error : Colors.textSecondary;
            const ScopeIcon = d.scope === "global" ? Globe2 : MapPin;
            return (
              <View
                key={d.id}
                style={[
                  styles.row,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
                testID={`required-doc-row-${d.id}`}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: badgeColor + "18" },
                  ]}
                >
                  {d.compulsory ? (
                    <ShieldAlert color={badgeColor} size={18} />
                  ) : (
                    <ShieldCheck color={badgeColor} size={18} />
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
                </View>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: badgeColor + "18",
                      borderColor: badgeColor + "55",
                    },
                  ]}
                  testID={`required-doc-badge-${d.id}`}
                >
                  <Text style={[styles.badgeText, { color: badgeColor }]}>
                    {d.compulsory ? "Compulsory" : "Optional"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
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
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.3 },
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
