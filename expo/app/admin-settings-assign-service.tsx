import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, Link2, Search, ChevronRight, MapPin, FileCheck2, X, Check, FileText } from "lucide-react-native";
import { Modal, Image } from "react-native";
import { useColors } from "@/hooks/useColors";
import {
  MAPPING_PAGES,
  loadAssignments,
  loadDocumentSourceAssignments,
  setDocumentSourceAssignment,
  DOCUMENT_SOURCE_FEATURES,
  type ServiceAssignmentsMap,
  type DocumentSourceAssignmentsMap,
} from "@/utils/serviceAssignmentsStore";
import { useAdminData } from "@/contexts/AdminDataContext";

const REQUIRED_DOCS_KEY = "required-documents" as const;

export default function AdminSettingsAssignServiceScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [assignments, setAssignments] = useState<ServiceAssignmentsMap>({});
  const [docSources, setDocSources] = useState<DocumentSourceAssignmentsMap>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [pickerFeatureId, setPickerFeatureId] = useState<string | null>(null);
  const { getEntries } = useAdminData();
  const requiredDocs = getEntries(REQUIRED_DOCS_KEY);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [map, docMap] = await Promise.all([
        loadAssignments(),
        loadDocumentSourceAssignments(),
      ]);
      setAssignments(map);
      setDocSources(docMap);
    } finally {
      setLoading(false);
    }
  }, []);

  const onPickRequiredDoc = useCallback(
    async (featureId: string, requiredDocId: string | null) => {
      const next = await setDocumentSourceAssignment(featureId, requiredDocId);
      setDocSources(next);
      setPickerFeatureId(null);
    },
    []
  );

  const activeRequiredDocs = useMemo(() => {
    return [...requiredDocs]
      .filter((d) => d.values.active !== false)
      .sort((a, b) =>
        String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""))
      );
  }, [requiredDocs]);

  const findDocLabel = useCallback(
    (id: string | undefined): string | null => {
      if (!id) return null;
      const e = requiredDocs.find((x) => x.id === id);
      if (!e) return null;
      return String(e.values.name ?? "Untitled document");
    },
    [requiredDocs]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MAPPING_PAGES;
    return MAPPING_PAGES.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.route.toLowerCase().includes(q)
    );
  }, [query]);

  const totals = useMemo(() => {
    let assigned = 0;
    let total = 0;
    MAPPING_PAGES.forEach((page) => {
      total += page.capabilities.length;
      const m = assignments[page.id] ?? {};
      page.capabilities.forEach((c) => {
        if (m[c]) assigned += 1;
      });
    });
    return { assigned, total };
  }, [assignments]);

  const openPage = useCallback(
    (pageId: string) => {
      router.push({
        pathname: "/admin-settings-assign-service-page" as const,
        params: { pageId },
      });
    },
    [router]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="assign-service-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Link2 color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Assign Service</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {MAPPING_PAGES.length} pages · {totals.assigned}/{totals.total} assigned
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accentText} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text
            style={[
              styles.note,
              { color: Colors.textSecondary, backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            Each page below requires one or more mapping capabilities. Tap a page to assign a provider service to each capability it uses.
          </Text>

          <View style={[styles.searchRow, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}>
            <Search color={Colors.textSecondary} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search pages..."
              placeholderTextColor={Colors.textSecondary}
              style={[styles.searchInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="assign-service-search"
              accessibilityLabel="Search services"
            />
          </View>

          <Text style={[styles.sectionHead, { color: Colors.textSecondary }]}>
            Document sources
          </Text>
          {DOCUMENT_SOURCE_FEATURES.map((feature) => {
            const selectedId = docSources[feature.id];
            const selectedLabel = findDocLabel(selectedId);
            return (
              <TouchableOpacity
                key={feature.id}
                onPress={() => setPickerFeatureId(feature.id)}
                style={[
                  styles.row,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
                testID={`assign-feature-${feature.id}`}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <FileCheck2 color={Colors.accentText} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: Colors.text }]}>{feature.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {feature.description}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: selectedLabel ? Colors.success + "20" : Colors.background,
                          borderColor: selectedLabel ? Colors.success : Colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeTxt,
                          { color: selectedLabel ? Colors.success : Colors.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {selectedLabel ? `Source: ${selectedLabel}` : "No document selected"}
                      </Text>
                    </View>
                  </View>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.sectionHead, { color: Colors.textSecondary, marginTop: 8 }]}>
            Pages
          </Text>
          {filtered.map((page) => {
            const m = assignments[page.id] ?? {};
            const assigned = page.capabilities.filter((c) => m[c]).length;
            const total = page.capabilities.length;
            const complete = assigned === total;
            return (
              <TouchableOpacity
                key={page.id}
                onPress={() => openPage(page.id)}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`assign-page-${page.id}`}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <MapPin color={Colors.accentText} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: Colors.text }]}>{page.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {page.description}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: complete ? Colors.success + "20" : Colors.background,
                          borderColor: complete ? Colors.success : Colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeTxt,
                          { color: complete ? Colors.success : Colors.textSecondary },
                        ]}
                      >
                        {assigned}/{total} assigned
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                      <Text style={[styles.badgeTxt, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {page.route}
                      </Text>
                    </View>
                  </View>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            );
          })}

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>
                {query ? `No pages match "${query}".` : "No pages."}
              </Text>
            </View>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal
        visible={pickerFeatureId !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerFeatureId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]} numberOfLines={1}>
                {pickerFeatureId
                  ? `Choose document for ${DOCUMENT_SOURCE_FEATURES.find((f) => f.id === pickerFeatureId)?.label ?? ""}`
                  : "Choose document"}
              </Text>
              <TouchableOpacity onPress={() => setPickerFeatureId(null)} hitSlop={8} testID="doc-picker-close" accessibilityRole="button">
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSub, { color: Colors.textSecondary }]}>
              The selected document’s uploaded image will be used as the data source.
            </Text>

            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {activeRequiredDocs.length === 0 ? (
                <Text style={[styles.emptyTxt, { color: Colors.textSecondary, textAlign: "center" as const, paddingVertical: 24 }]}>
                  No active required documents. Add them in Required Documents first.
                </Text>
              ) : (
                <>
                  {pickerFeatureId && docSources[pickerFeatureId] ? (
                    <TouchableOpacity
                      onPress={() => pickerFeatureId && onPickRequiredDoc(pickerFeatureId, null)}
                      style={[
                        styles.svcRow,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                      testID="doc-picker-clear"
                      activeOpacity={0.85}
                      accessibilityRole="button"
                    >
                      <X color={Colors.errorText} size={18} />
                      <Text style={[styles.svcName, { color: Colors.errorText, flex: 1 }]}>
                        Clear current selection
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {activeRequiredDocs.map((doc) => {
                    const selected =
                      pickerFeatureId !== null && docSources[pickerFeatureId] === doc.id;
                    const name = String(doc.values.name ?? "Untitled document");
                    const desc = String(doc.values.description ?? "");
                    return (
                      <TouchableOpacity
                        key={doc.id}
                        onPress={() => pickerFeatureId && onPickRequiredDoc(pickerFeatureId, doc.id)}
                        style={[
                          styles.svcRow,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: selected ? Colors.accent : Colors.border,
                            borderWidth: selected ? 1.5 : 1,
                          },
                        ]}
                        testID={`doc-pick-${doc.id}`}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                      >
                        <FileText color={Colors.accentText} size={18} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.svcName, { color: Colors.text }]} numberOfLines={1}>
                            {name}
                          </Text>
                          {desc ? (
                            <Text style={[styles.svcDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
                              {desc}
                            </Text>
                          ) : null}
                        </View>
                        {selected ? <Check color={Colors.accentText} size={18} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  note: {
    fontSize: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    lineHeight: 18,
  },
  searchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowTitle: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  badgeRow: { flexDirection: "row" as const, gap: 6, marginTop: 6, flexWrap: "wrap" as const },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 11, fontWeight: "600" as const },
  emptyWrap: { alignItems: "center" as const, paddingVertical: 24 },
  emptyTxt: { fontSize: 13 },
  sectionHead: {
    fontSize: 12,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  modalTitle: { fontSize: 17, fontWeight: "800" as const, flex: 1, marginRight: 12 },
  modalSub: { fontSize: 12, marginBottom: 4 },
  svcRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  svcName: { fontSize: 14, fontWeight: "700" as const },
  svcDesc: { fontSize: 12, marginTop: 2 },
});
