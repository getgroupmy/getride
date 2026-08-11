import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, Link2, Check, X, Building2, Layers, Trash2 } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import {
  MAPPING_PAGES,
  CAPABILITY_LABELS,
  loadAssignments,
  setAssignment,
  type MappingCapability,
  type ServiceAssignmentsMap,
} from "@/utils/serviceAssignmentsStore";
import { loadProviders, type ApiProviderDef } from "@/utils/apiKeysStore";

export default function AdminSettingsAssignServicePageScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { pageId } = useLocalSearchParams<{ pageId: string }>();

  const page = useMemo(
    () => MAPPING_PAGES.find((p) => p.id === pageId) ?? null,
    [pageId]
  );

  const [providers, setProviders] = useState<ApiProviderDef[]>([]);
  const [assignments, setAssignments] = useState<ServiceAssignmentsMap>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [pickerCap, setPickerCap] = useState<MappingCapability | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [list, map] = await Promise.all([loadProviders(), loadAssignments()]);
      setProviders(list);
      setAssignments(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const pageMap = useMemo(() => (page ? assignments[page.id] ?? {} : {}), [assignments, page]);

  const onPick = useCallback(
    async (capability: MappingCapability, providerId: string, serviceId: string) => {
      if (!page) return;
      const next = await setAssignment(page.id, capability, { providerId, serviceId });
      setAssignments(next);
      setPickerCap(null);
    },
    [page]
  );

  const onClear = useCallback(
    async (capability: MappingCapability) => {
      if (!page) return;
      const next = await setAssignment(page.id, capability, null);
      setAssignments(next);
    },
    [page]
  );

  const lookupAssignment = useCallback(
    (cap: MappingCapability) => {
      const a = pageMap[cap];
      if (!a) return null;
      const p = providers.find((x) => x.id === a.providerId);
      const s = p?.services.find((x) => x.id === a.serviceId) ?? null;
      return { provider: p ?? null, service: s };
    },
    [pageMap, providers]
  );

  if (!page) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            testID="assign-page-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={Colors.text} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Page not found</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="assign-page-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Link2 color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              {page.label}
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {page.route}
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
            Assign a provider service to each capability this page needs. Failures rotate keys within the chosen service automatically.
          </Text>

          {page.capabilities.map((cap) => {
            const info = lookupAssignment(cap);
            return (
              <View
                key={cap}
                style={[styles.capCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
              >
                <View style={styles.capHeader}>
                  <View style={[styles.capIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <Layers color={Colors.accentText} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.capLabel, { color: Colors.text }]}>{CAPABILITY_LABELS[cap]}</Text>
                    <Text style={[styles.capKey, { color: Colors.textSecondary }]}>{cap}</Text>
                  </View>
                  {info ? (
                    <TouchableOpacity
                      onPress={() => onClear(cap)}
                      style={styles.clearBtn}
                      hitSlop={8}
                      testID={`assign-clear-${cap}`}
                      accessibilityRole="button"
                      accessibilityLabel="Clear"
                    >
                      <Trash2 color={Colors.errorText} size={16} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <TouchableOpacity
                  onPress={() => setPickerCap(cap)}
                  style={[
                    styles.assignBtn,
                    {
                      backgroundColor: Colors.background,
                      borderColor: info ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`assign-pick-${cap}`}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  {info && info.provider && info.service ? (
                    <>
                      <Building2 color={Colors.accentText} size={16} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.assignTitle, { color: Colors.text }]} numberOfLines={1}>
                          {info.provider.name} · {info.service.name}
                        </Text>
                        <Text style={[styles.assignSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {info.service.keys.length} key{info.service.keys.length === 1 ? "" : "s"}
                        </Text>
                      </View>
                      <Text style={[styles.changeTxt, { color: Colors.accentText }]}>Change</Text>
                    </>
                  ) : (
                    <>
                      <Building2 color={Colors.textSecondary} size={16} />
                      <Text style={[styles.assignPlaceholder, { color: Colors.textSecondary }]}>
                        Tap to assign provider service
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal
        visible={pickerCap !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerCap(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>
                {pickerCap ? `Assign for ${CAPABILITY_LABELS[pickerCap]}` : "Assign"}
              </Text>
              <TouchableOpacity onPress={() => setPickerCap(null)} hitSlop={8} accessibilityRole="button">
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {providers.length === 0 ? (
                <Text style={[styles.emptyTxt, { color: Colors.textSecondary, textAlign: "center" as const, paddingVertical: 24 }]}>
                  No providers configured. Add providers in API Keys first.
                </Text>
              ) : (
                providers.map((prov) => (
                  <View key={prov.id} style={{ marginBottom: 14 }}>
                    <Text style={[styles.providerHead, { color: Colors.textSecondary }]}>
                      {prov.name}
                      {prov.category ? ` · ${prov.category}` : ""}
                    </Text>
                    {prov.services.length === 0 ? (
                      <Text style={[styles.emptyTxt, { color: Colors.textSecondary, paddingVertical: 8 }]}>
                        No services in this provider.
                      </Text>
                    ) : (
                      prov.services.map((svc) => {
                        const selected =
                          pickerCap !== null &&
                          pageMap[pickerCap]?.providerId === prov.id &&
                          pageMap[pickerCap]?.serviceId === svc.id;
                        return (
                          <TouchableOpacity
                            key={svc.id}
                            onPress={() => pickerCap && onPick(pickerCap, prov.id, svc.id)}
                            style={[
                              styles.svcRow,
                              {
                                backgroundColor: Colors.gray[100],
                                borderColor: selected ? Colors.accent : Colors.border,
                                borderWidth: selected ? 1.5 : 1,
                              },
                            ]}
                            testID={`pick-${prov.id}-${svc.id}`}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.svcName, { color: Colors.text }]}>{svc.name}</Text>
                              {svc.description ? (
                                <Text style={[styles.svcDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                                  {svc.description}
                                </Text>
                              ) : null}
                              <Text style={[styles.svcMeta, { color: Colors.textSecondary }]}>
                                {svc.keys.length} key{svc.keys.length === 1 ? "" : "s"}
                              </Text>
                            </View>
                            {selected ? <Check color={Colors.accentText} size={18} /> : null}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                ))
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
  capCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  capHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  capIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  capLabel: { fontSize: 14, fontWeight: "700" as const },
  capKey: { fontSize: 11, marginTop: 2 },
  clearBtn: { padding: 6 },
  assignBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  assignTitle: { fontSize: 14, fontWeight: "700" as const },
  assignSub: { fontSize: 11, marginTop: 2 },
  assignPlaceholder: { fontSize: 13, flex: 1 },
  changeTxt: { fontSize: 12, fontWeight: "700" as const },
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
    gap: 12,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  providerHead: { fontSize: 12, fontWeight: "700" as const, textTransform: "uppercase" as const, marginBottom: 6, letterSpacing: 0.5 },
  svcRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  svcName: { fontSize: 14, fontWeight: "700" as const },
  svcDesc: { fontSize: 12, marginTop: 2 },
  svcMeta: { fontSize: 11, marginTop: 4 },
  emptyTxt: { fontSize: 13 },
});
