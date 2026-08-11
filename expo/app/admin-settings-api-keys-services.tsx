import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Layers,
  Search,
  Plus,
  ChevronRight,
  Trash2,
  X,
  KeyRound,
  Check,
  CopyPlus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  loadProviders,
  addService,
  removeService,
  addKey,
  subscribeProviders,
  type ApiProviderDef,
  type ApiServiceDef,
} from "@/utils/apiKeysStore";

export default function AdminSettingsApiKeysServicesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-api-keys");
  const { providerId } = useLocalSearchParams<{ providerId: string }>();
  const [provider, setProvider] = useState<ApiProviderDef | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [desc, setDesc] = useState<string>("");
  const [showBulk, setShowBulk] = useState<boolean>(false);
  const [bulkLabel, setBulkLabel] = useState<string>("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [bulkSelected, setBulkSelected] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!providerId) return;
    try {
      setLoading(true);
      const list = await loadProviders();
      const found = list.find((p) => p.id === providerId) ?? null;
      setProvider(found);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!providerId) return;
    const unsubscribe = subscribeProviders((list) => {
      const found = list.find((p) => p.id === providerId) ?? null;
      setProvider(found);
    });
    return unsubscribe;
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const filtered = useMemo(() => {
    if (!provider) return [] as ApiServiceDef[];
    const q = query.trim().toLowerCase();
    if (!q) return provider.services;
    return provider.services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q)
    );
  }, [provider, query]);

  const onAdd = useCallback(async () => {
    if (!editable) return;
    if (!providerId) return;
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter a service name.");
      return;
    }
    const { list, write } = await addService(providerId, name.trim(), desc.trim() || undefined);
    const found = list.find((p) => p.id === providerId) ?? null;
    setProvider(found);
    setName("");
    setDesc("");
    setShowAdd(false);
    if (!write.ok && !write.skipped) {
      Alert.alert("Couldn't save to Supabase", write.error);
    }
  }, [providerId, name, desc]);

  const onDelete = useCallback(
    (s: ApiServiceDef) => {
      if (!editable) return;
      if (!providerId) return;
      const apply = async () => {
        const { list, write } = await removeService(providerId, s.id);
        const found = list.find((p) => p.id === providerId) ?? null;
        setProvider(found);
        if (!write.ok && !write.skipped) {
          Alert.alert("Couldn't save to Supabase", write.error);
        }
      };
      if (Platform.OS === "web") {
        apply();
        return;
      }
      Alert.alert("Delete service", `Remove "${s.name}" and its keys?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: apply },
      ]);
    },
    [providerId]
  );

  const openService = useCallback(
    (s: ApiServiceDef) => {
      router.push({
        pathname: "/admin-settings-api-keys-keys" as const,
        params: { providerId: providerId ?? "", serviceId: s.id },
      });
    },
    [router, providerId]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="services-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Layers color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              {provider?.name ?? "Services"}
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {provider ? `${provider.services.length} services` : ""}
          </Text>
        </View>
        {editable ? (
          <>
            <TouchableOpacity
              onPress={() => {
                setBulkLabel("");
                setBulkValue("");
                setBulkSelected({});
                setShowBulk(true);
              }}
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20" }]}
              testID="services-bulk-add"
              accessibilityRole="button"
              accessibilityLabel="Add services"
            >
              <CopyPlus color={Colors.accent} size={20} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              style={[styles.iconBtn, { backgroundColor: Colors.accent + "20" }]}
              testID="services-add"
              accessibilityRole="button"
              accessibilityLabel="Add services"
            >
              <Plus color={Colors.accent} size={20} />
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !provider ? (
        <View style={styles.loadingWrap}>
          <Text style={{ color: Colors.textSecondary }}>Provider not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.searchRow, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}>
            <Search color={Colors.textSecondary} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search services..."
              placeholderTextColor={Colors.textSecondary}
              style={[styles.searchInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="services-search"
            />
          </View>

          {filtered.map((s) => {
            const activeKeys = s.keys.filter((k) => !k.disabled && k.value.trim().length > 0).length;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => openService(s)}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`service-${s.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <KeyRound color={Colors.accent} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: Colors.text }]}>{s.name}</Text>
                  {s.description ? (
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
                      {s.description}
                    </Text>
                  ) : null}
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                      <Text style={[styles.badgeTxt, { color: Colors.textSecondary }]}>
                        {s.keys.length} keys
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                      <Text
                        style={[
                          styles.badgeTxt,
                          { color: activeKeys > 0 ? Colors.accent : Colors.textSecondary },
                        ]}
                      >
                        {activeKeys} active
                      </Text>
                    </View>
                  </View>
                </View>
                {editable ? (
                  <TouchableOpacity onPress={() => onDelete(s)} style={styles.rowDelete} hitSlop={8} testID={`service-delete-${s.id}`} accessibilityRole="button" accessibilityLabel="Delete service">
                    <Trash2 color={Colors.error} size={16} />
                  </TouchableOpacity>
                ) : null}
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            );
          })}

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>
                {query ? `No services match "${query}".` : "No services yet. Add one to get started."}
              </Text>
            </View>
          ) : null}

          {editable ? (
            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              style={[styles.addBtn, { backgroundColor: Colors.accent }]}
              testID="services-add-bottom"
            >
              <Plus color="#000000" size={18} />
              <Text style={styles.addTxt}>Add Service</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal visible={showBulk} animationType="slide" transparent onRequestClose={() => setShowBulk(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border, maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>Add Key to Services</Text>
              <TouchableOpacity onPress={() => setShowBulk(false)} hitSlop={8}>
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Key label (optional)</Text>
            <TextInput
              value={bulkLabel}
              onChangeText={setBulkLabel}
              placeholder="e.g. Primary"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              testID="bulk-key-label"
            />
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>API Key</Text>
            <TextInput
              value={bulkValue}
              onChangeText={setBulkValue}
              placeholder="Paste API key"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              testID="bulk-key-value"
            />
            <View style={styles.bulkSelectHeader}>
              <Text style={[styles.modalLabel, { color: Colors.textSecondary, marginTop: 0 }]}>Select services</Text>
              <TouchableOpacity
                onPress={() => {
                  if (!provider) return;
                  const allSelected = provider.services.every((s) => bulkSelected[s.id]);
                  if (allSelected) {
                    setBulkSelected({});
                  } else {
                    const all: Record<string, boolean> = {};
                    provider.services.forEach((s) => { all[s.id] = true; });
                    setBulkSelected(all);
                  }
                }}
                hitSlop={8}
                testID="bulk-toggle-all"
              >
                <Text style={[styles.bulkToggleAllTxt, { color: Colors.accent }]}>
                  {provider && provider.services.every((s) => bulkSelected[s.id]) ? "Clear all" : "Select all"}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.bulkList} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              {(provider?.services ?? []).map((s) => {
                const checked = !!bulkSelected[s.id];
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => setBulkSelected((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                    style={[styles.bulkRow, { borderColor: Colors.border, backgroundColor: checked ? Colors.accent + "15" : Colors.gray[100] }]}
                    testID={`bulk-svc-${s.id}`}
                  >
                    <View style={[styles.bulkCheckbox, { borderColor: checked ? Colors.accent : Colors.border, backgroundColor: checked ? Colors.accent : "transparent" }]}>
                      {checked ? <Check color="#000000" size={14} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bulkRowTitle, { color: Colors.text }]}>{s.name}</Text>
                      {s.description ? (
                        <Text style={[styles.bulkRowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>{s.description}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.bulkRowKeys, { color: Colors.textSecondary }]}>{s.keys.length} keys</Text>
                  </TouchableOpacity>
                );
              })}
              {(!provider || provider.services.length === 0) ? (
                <View style={styles.emptyWrap}>
                  <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>No services yet. Add one first.</Text>
                </View>
              ) : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setShowBulk(false)}
                style={[styles.modalBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                disabled={bulkSaving}
              >
                <Text style={[styles.modalBtnTxt, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!providerId) return;
                  const value = bulkValue.trim();
                  if (!value) {
                    Alert.alert("Key required", "Please enter the API key value.");
                    return;
                  }
                  const ids = Object.keys(bulkSelected).filter((k) => bulkSelected[k]);
                  if (ids.length === 0) {
                    Alert.alert("Select services", "Please select at least one service.");
                    return;
                  }
                  try {
                    setBulkSaving(true);
                    let latest: ApiProviderDef[] = [];
                    let lastWriteError = "";
                    for (const sid of ids) {
                      const res = await addKey(providerId, sid, bulkLabel.trim(), value);
                      latest = res.list;
                      if (!res.write.ok && !res.write.skipped) {
                        lastWriteError = res.write.error;
                      }
                    }
                    const found = latest.find((p) => p.id === providerId) ?? null;
                    setProvider(found);
                    setShowBulk(false);
                    setBulkLabel("");
                    setBulkValue("");
                    setBulkSelected({});
                    if (lastWriteError) {
                      Alert.alert("Couldn't save to Supabase", lastWriteError);
                    }
                  } catch (e) {
                    console.log("[bulk-add-key] error", e);
                    Alert.alert("Error", "Failed to add key to selected services.");
                  } finally {
                    setBulkSaving(false);
                  }
                }}
                style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent, opacity: bulkSaving ? 0.7 : 1 }]}
                disabled={bulkSaving}
                testID="bulk-add-confirm"
              >
                {bulkSaving ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={[styles.modalBtnTxt, { color: "#000000" }]}>
                    Add to {Object.values(bulkSelected).filter(Boolean).length || 0}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>New Service</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={8}>
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Service name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Geocoding"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              autoFocus
              testID="service-add-name"
            />
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Description (optional)</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder="Short description"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              testID="service-add-desc"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setShowAdd(false)}
                style={[styles.modalBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
              >
                <Text style={[styles.modalBtnTxt, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onAdd}
                style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                testID="service-add-confirm"
              >
                <Text style={[styles.modalBtnTxt, { color: "#000000" }]}>Add</Text>
              </TouchableOpacity>
            </View>
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
  badgeRow: { flexDirection: "row" as const, gap: 6, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeTxt: { fontSize: 11, fontWeight: "600" as const },
  rowDelete: { padding: 6 },
  emptyWrap: { alignItems: "center" as const, paddingVertical: 24 },
  emptyTxt: { fontSize: 13, textAlign: "center" as const },
  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginTop: 6,
  },
  addTxt: { color: "#000000", fontSize: 15, fontWeight: "800" as const },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" as const },
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
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  modalLabel: { fontSize: 12, fontWeight: "600" as const, marginTop: 4 },
  modalInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalActions: { flexDirection: "row" as const, gap: 10, marginTop: 8 },
  bulkSelectHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 8,
  },
  bulkToggleAllTxt: { fontSize: 12, fontWeight: "700" as const },
  bulkList: { maxHeight: 280, marginTop: 6 },
  bulkRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  bulkCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  bulkRowTitle: { fontSize: 14, fontWeight: "700" as const },
  bulkRowDesc: { fontSize: 11, marginTop: 1 },
  bulkRowKeys: { fontSize: 11, fontWeight: "600" as const },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  modalBtnTxt: { fontSize: 14, fontWeight: "700" as const },
});
