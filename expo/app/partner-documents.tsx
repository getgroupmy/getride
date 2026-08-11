import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  FileText,
  Info,
  Check,
  Clock,
  CircleX,
  CircleAlert,
  FileQuestion,
  ShieldAlert,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchUserProfile,
  findOrCreatePartner,
  type PartnerProfileRow,
} from "@/utils/partnerOnboardingStore";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";
import RequiredDocsUploader from "@/components/RequiredDocsUploader";
import {
  fetchProviderDocuments,
  computeDisplayStatus,
  type ProviderDocumentRow,
  type ProviderDocStatus,
} from "@/utils/providerDocumentsStore";

const REQUIRED_DOCS_KEY = "required-documents" as const;
const PARTNER_TYPE_KEY = "partner-type" as const;
const DOC_TYPE_KEY = "document-type" as const;
const PARTNER_CATEGORY_NAME = "Partner" as const;
const ALL_TOKEN = "__ALL__" as const;
const RENEWAL_WINDOW_DAYS = 14 as const;

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

export default function PartnerDocumentsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const { getEntries } = useAdminData();

  const [partner, setPartner] = useState<PartnerProfileRow | null>(null);
  const [uploads, setUploads] = useState<ProviderDocumentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(async () => {
    const uid = authState.userId;
    if (!uid) {
      setPartner(null);
      setUploads([]);
      setLoading(false);
      return;
    }
    const prof = await fetchUserProfile(uid);
    const p = await findOrCreatePartner(uid, prof);
    setPartner(p);
    if (p?.id) {
      const rows = await fetchProviderDocuments(p.id);
      setUploads(rows);
    } else {
      setUploads([]);
    }
    setLoading(false);
  }, [authState.userId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const requiredDocEntries = getEntries(REQUIRED_DOCS_KEY) as SettingEntry[];
  const partnerTypeEntries = getEntries(PARTNER_TYPE_KEY) as SettingEntry[];
  const docTypeEntries = getEntries(DOC_TYPE_KEY) as SettingEntry[];

  /**
   * Id of the fixed "Partner" document-type category. Required-documents must
   * be tagged with this category (or `__ALL__`) to surface on this screen.
   */
  const partnerCategoryId = useMemo<string | null>(() => {
    const found = docTypeEntries.find(
      (e) =>
        String(e.values.name ?? "").trim().toLowerCase() ===
        PARTNER_CATEGORY_NAME.toLowerCase()
    );
    return found?.id ?? null;
  }, [docTypeEntries]);

  /**
   * Collect docTypes from the partner-type entries assigned to this user.
   *
   * Returns:
   *   - `null` to mean "no filter — show every active required document".
   *     Only when an assigned partner-type explicitly opts in to `__ALL__`.
   *   - an array of docType ids to filter by (union of all assigned partner-
   *     types' docTypes). Strict: a required-document must be tagged with at
   *     least one of these ids (or with `__ALL__`) to be shown.
   *   - an empty array `[]` when the partner has no partner-type assigned, or
   *     when the assigned partner-types exist but have no `docTypes`
   *     configured. Surfaces the friendly empty state — we don't silently
   *     widen the catalogue.
   */
  /**
   * Document-type filter for this screen. We always gate by the fixed
   * "Partner" category id — a required-document only appears here if its
   * `docTypes` includes that id (or `__ALL__`). Partner-type narrowing is
   * applied separately on top of this.
   */
  const allowedDocTypeIds = useMemo<string[] | null>(() => {
    if (!partnerCategoryId) return [];
    return [partnerCategoryId];
  }, [partnerCategoryId]);

  /**
   * IDs of required-document entries that match the partner's assigned
   * partner types via docTypes. Used to detect "extra" uploads — anything in
   * `provider_documents` whose `doc_id` isn't in this filtered catalogue.
   */
  const knownDocIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    const allowedSet = allowedDocTypeIds === null ? null : new Set(allowedDocTypeIds);
    const assignedPtLc = new Set(
      (partner?.partner_types ?? []).map((x) => String(x).trim().toLowerCase())
    );
    for (const e of requiredDocEntries) {
      if (!Boolean(e.values.active ?? true)) continue;
      const docPartnerTypes = parseDocTypes(e.values.partnerTypes);
      if (docPartnerTypes.length > 0) {
        if (!docPartnerTypes.includes(ALL_TOKEN)) {
          if (assignedPtLc.size === 0) continue;
          const lc = docPartnerTypes.map((x) => x.trim().toLowerCase());
          const matches = lc.some((n) => assignedPtLc.has(n));
          if (!matches) continue;
        }
      } else if (allowedSet !== null) {
        const types = parseDocTypes(e.values.docTypes);
        const matches =
          types.includes(ALL_TOKEN) || types.some((id) => allowedSet.has(id));
        if (!matches) continue;
      }
      set.add(e.id);
    }
    return set;
  }, [requiredDocEntries, allowedDocTypeIds, partner?.partner_types]);

  /**
   * Only show the "no eligible docs" empty state when the partner truly has
   * no partner_types assigned. If they have partner-types but those types
   * have no `docTypes` configured (allowedDocTypeIds === []), we still want
   * to render the uploader so required-documents with no docTypes (treated
   * as universal by RequiredDocsUploader) still surface — matching the
   * behaviour of the "missing documents" popup in partnerModeDocCheck.
   */
  const hasNoPartnerType = (partner?.partner_types ?? []).length === 0;
  void hasNoPartnerType;

  const extraUploads = useMemo<ProviderDocumentRow[]>(() => {
    return uploads.filter((u) => !knownDocIds.has(u.doc_id));
  }, [uploads, knownDocIds]);

  /**
   * Cross-check required_documents (filtered by the partner's assigned
   * partner_types) against `provider_documents` and surface every doc that
   * still needs attention:
   *   - never uploaded
   *   - rejected
   *   - expired
   * Compulsory misses are listed first.
   */
  const missingDocs = useMemo<
    { id: string; name: string; compulsory: boolean; reason: "missing" | "rejected" | "expired" }[]
  >(() => {
    const allowedSet = allowedDocTypeIds === null ? null : new Set(allowedDocTypeIds);
    const latestByDoc = new Map<string, ProviderDocumentRow>();
    for (const u of uploads) {
      if (!latestByDoc.has(u.doc_id)) latestByDoc.set(u.doc_id, u);
    }
    const out: {
      id: string;
      name: string;
      compulsory: boolean;
      reason: "missing" | "rejected" | "expired";
    }[] = [];
    const assignedPtLc = new Set(
      (partner?.partner_types ?? []).map((x) => String(x).trim().toLowerCase())
    );
    for (const e of requiredDocEntries) {
      if (!Boolean(e.values.active ?? true)) continue;
      const name = String(e.values.name ?? "").trim();
      if (!name) continue;
      const docPartnerTypes = parseDocTypes(e.values.partnerTypes);
      if (docPartnerTypes.length > 0) {
        if (!docPartnerTypes.includes(ALL_TOKEN)) {
          if (assignedPtLc.size === 0) continue;
          const lc = docPartnerTypes.map((x) => x.trim().toLowerCase());
          const matches = lc.some((n) => assignedPtLc.has(n));
          if (!matches) continue;
        }
      } else if (allowedSet !== null) {
        const types = parseDocTypes(e.values.docTypes);
        const isUniversal = types.length === 0 || types.includes(ALL_TOKEN);
        const matches = isUniversal || types.some((id) => allowedSet.has(id));
        if (!matches) continue;
      }
      const compulsory = Boolean(
        e.values.regionsGlobalCompulsory ?? e.values.required ?? true
      );
      const u = latestByDoc.get(e.id);
      if (!u) {
        out.push({ id: e.id, name, compulsory, reason: "missing" });
        continue;
      }
      const s = computeDisplayStatus(u);
      if (s === "Rejected") out.push({ id: e.id, name, compulsory, reason: "rejected" });
      else if (s === "Expired") out.push({ id: e.id, name, compulsory, reason: "expired" });
    }
    return out.sort((a, b) => {
      if (a.compulsory !== b.compulsory) return a.compulsory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [requiredDocEntries, uploads, allowedDocTypeIds, partner?.partner_types]);

  const missingCompulsoryCount = missingDocs.filter((m) => m.compulsory).length;

  const partnerTypesLabel =
    (partner?.partner_types ?? []).join(" \u2022 ") || "No partner type assigned";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="partner-docs-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <FileText color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Documents</Text>
          </View>
          <Text
            style={[styles.headerSubtitle, { color: Colors.textSecondary }]}
            numberOfLines={1}
          >
            {partnerTypesLabel}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accentText} />
        </View>
      ) : !partner?.id ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
            We couldn&apos;t find your partner profile. Please finish onboarding first.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.infoCard,
              { backgroundColor: Colors.accent + "12", borderColor: Colors.accent + "55" },
            ]}
          >
            <Info color={Colors.accentText} size={16} />
            <Text style={[styles.infoText, { color: Colors.text }]}>
              You can update any document that isn&apos;t approved. Approved documents with
              an expiry date can be renewed in the {RENEWAL_WINDOW_DAYS} days before they
              expire — uploading a new file moves it back to Pending Review.
            </Text>
          </View>

          {missingDocs.length > 0 ? (
            <View
              style={[
                styles.missingCard,
                {
                  backgroundColor: Colors.error + "10",
                  borderColor: Colors.error + "55",
                },
              ]}
              testID="missing-docs-summary"
            >
              <View style={styles.sectionHeaderRow}>
                <ShieldAlert color={Colors.errorText} size={16} />
                <Text style={[styles.sectionTitle, { color: Colors.text }]}>
                  Action needed
                </Text>
              </View>
              <Text style={[styles.sectionSubtitle, { color: Colors.textSecondary }]}>
                {missingCompulsoryCount > 0
                  ? `${missingCompulsoryCount} compulsory document${missingCompulsoryCount === 1 ? "" : "s"} still need your attention.`
                  : "Some optional documents are missing or need re-upload."}
              </Text>
              <View style={styles.missingList}>
                {missingDocs.map((m) => {
                  const reasonLabel =
                    m.reason === "missing"
                      ? "Not uploaded"
                      : m.reason === "rejected"
                        ? "Rejected \u2014 re-upload"
                        : "Expired \u2014 renew";
                  const reasonColor =
                    m.reason === "missing"
                      ? Colors.accent
                      : m.reason === "rejected"
                        ? "#dc2626"
                        : "#d97706";
                  return (
                    <View
                      key={m.id}
                      style={styles.missingRow}
                      testID={`missing-doc-${m.id}`}
                    >
                      <View
                        style={[
                          styles.missingDot,
                          {
                            backgroundColor: m.compulsory
                              ? Colors.error
                              : Colors.textSecondary,
                          },
                        ]}
                      />
                      <Text
                        style={[styles.missingName, { color: Colors.text }]}
                        numberOfLines={1}
                      >
                        {m.name}
                      </Text>
                      <Text
                        style={[styles.missingReason, { color: reasonColor }]}
                        numberOfLines={1}
                      >
                        {reasonLabel}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {hasNoPartnerType ? (
            <View
              style={[
                styles.infoCard,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <CircleAlert color={Colors.textSecondary} size={16} />
              <Text style={[styles.infoText, { color: Colors.textSecondary }]}>
                No documents are configured for your assigned partner type yet. Please
                contact admin if you believe this is a mistake.
              </Text>
            </View>
          ) : (
            <RequiredDocsUploader
              partnerId={partner.id}
              authUserId={authState.userId ?? null}
              docTypeIds={allowedDocTypeIds ?? undefined}
              partnerTypeNames={partner.partner_types ?? []}
              title="Your documents"
              subtitle="Required and optional documents for your partner type. Tap to view, replace, or renew."
              lockApprovedUntilExpiryWithinDays={RENEWAL_WINDOW_DAYS}
              ignoreRegionFilter
              testID="partner-docs-list"
            />
          )}

          {extraUploads.length > 0 ? (
            <View style={styles.extraSection}>
              <View style={styles.sectionHeaderRow}>
                <FileQuestion color={Colors.accentText} size={16} />
                <Text style={[styles.sectionTitle, { color: Colors.text }]}>
                  Other uploaded documents
                </Text>
              </View>
              <Text style={[styles.sectionSubtitle, { color: Colors.textSecondary }]}>
                Uploads in your account that aren&apos;t in the current required-documents
                catalogue.
              </Text>
              <View style={styles.list}>
                {extraUploads.map((u) => {
                  const s = computeDisplayStatus(u);
                  const sm = statusMeta(s);
                  return (
                    <View
                      key={u.id}
                      style={[
                        styles.row,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                      testID={`extra-doc-${u.id}`}
                    >
                      <View
                        style={[styles.thumbWrap, { backgroundColor: Colors.gray[200] }]}
                      >
                        {u.file_url ? (
                          <Image
                            source={{ uri: u.file_url }}
                            style={styles.thumb}
                            resizeMode="cover"
                          />
                        ) : (
                          <FileText color={Colors.textSecondary} size={18} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.docName, { color: Colors.text }]}
                          numberOfLines={1}
                        >
                          {u.doc_name || "Untitled document"}
                        </Text>
                        {u.document_number ? (
                          <Text
                            style={[styles.docMeta, { color: Colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            No. {u.document_number}
                          </Text>
                        ) : null}
                        {u.expiry_date ? (
                          <Text
                            style={[styles.docMeta, { color: Colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            Expires: {u.expiry_date}
                          </Text>
                        ) : null}
                        <Text
                          style={[styles.docMeta, { color: Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          Uploaded {new Date(u.uploaded_at).toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={styles.rightCol}>
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
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  empty: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 32,
  },
  emptyText: { fontSize: 14, textAlign: "center" as const },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 14 },
  infoCard: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 17 },
  extraSection: { gap: 6 },
  sectionHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const },
  sectionSubtitle: { fontSize: 11, marginBottom: 6 },
  list: { gap: 8 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  thumbWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: "hidden" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  thumb: { width: "100%" as const, height: "100%" as const },
  docName: { fontSize: 13, fontWeight: "700" as const },
  docMeta: { fontSize: 11, marginTop: 2 },
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
  missingCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  missingList: { gap: 6, marginTop: 4 },
  missingRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  missingDot: { width: 6, height: 6, borderRadius: 3 },
  missingName: { flex: 1, fontSize: 12, fontWeight: "700" as const },
  missingReason: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.3 },
});
