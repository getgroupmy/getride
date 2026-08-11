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
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  KeyRound,
  Search,
  Plus,
  ChevronRight,
  Trash2,
  Building2,
  X,
  Plug,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  loadProviders,
  addProvider,
  removeProvider,
  subscribeProviders,
  type ApiProviderDef,
} from "@/utils/apiKeysStore";

export default function AdminSettingsApiKeysScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-api-keys");
  const [providers, setProviders] = useState<ApiProviderDef[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await loadProviders();
      setProviders(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeProviders((list) => {
      setProviders(list);
    });
    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
    );
  }, [providers, query]);

  const totals = useMemo(() => {
    let services = 0;
    let keys = 0;
    providers.forEach((p) => {
      services += p.services.length;
      p.services.forEach((s) => (keys += s.keys.length));
    });
    return { services, keys };
  }, [providers]);

  const onAdd = useCallback(async () => {
    if (!editable) return;
    const name = newName.trim();
    if (!name) {
      Alert.alert("Name required", "Please enter a provider name.");
      return;
    }
    const { list, write } = await addProvider(name);
    setProviders(list);
    setNewName("");
    setShowAdd(false);
    if (!write.ok && !write.skipped) {
      Alert.alert("Couldn't save to Supabase", write.error);
    }
  }, [newName]);

  const onDelete = useCallback(
    (p: ApiProviderDef) => {
      if (!editable) return;
      const apply = async () => {
        const { list, write } = await removeProvider(p.id);
        setProviders(list);
        if (!write.ok && !write.skipped) {
          Alert.alert("Couldn't save to Supabase", write.error);
        }
      };
      if (Platform.OS === "web") {
        apply();
        return;
      }
      Alert.alert("Delete provider", `Remove "${p.name}" and all its services & keys?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: apply },
      ]);
    },
    []
  );

  const openProvider = useCallback(
    (p: ApiProviderDef) => {
      router.push({
        pathname: "/admin-settings-api-keys-services" as const,
        params: { providerId: p.id },
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
          testID="api-keys-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <KeyRound color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>API Providers</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {providers.length} providers · {totals.services} services · {totals.keys} keys
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => editable && setShowAdd(true)}
          disabled={!editable}
          style={[styles.iconBtn, { backgroundColor: editable ? Colors.accent + "20" : Colors.gray[100], opacity: editable ? 1 : 0.5 }]}
          testID="api-keys-add"
          accessibilityRole="button"
          accessibilityLabel="Add API keys"
        >
          <Plus color={editable ? Colors.accent : Colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text
            style={[
              styles.note,
              { color: Colors.textSecondary, backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            Tap a provider to manage its services and API keys. Multiple keys per service rotate automatically on failure.
          </Text>

          <TouchableOpacity
            onPress={() => router.push("/admin-settings-api-elife" as const)}
            style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            testID="api-elife-entry"
            accessibilityRole="button"
          >
            <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
              <Plug color={Colors.accent} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: Colors.text }]}>Elife Transfer API</Text>
              <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                Fleet & Ride Management integration docs
              </Text>
            </View>
            <ChevronRight color={Colors.textSecondary} size={18} />
          </TouchableOpacity>

          <View
            style={[
              styles.searchRow,
              { borderColor: Colors.border, backgroundColor: Colors.gray[100] },
            ]}
          >
            <Search color={Colors.textSecondary} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search providers..."
              placeholderTextColor={Colors.textSecondary}
              style={[styles.searchInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="api-keys-search"
            />
          </View>

          {filtered.map((p) => {
            const keysCount = p.services.reduce((acc, s) => acc + s.keys.length, 0);
            return (
              <TouchableOpacity
                key={p.id}
                onPress={() => openProvider(p)}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`provider-${p.id}`}
                accessibilityRole="button"
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Building2 color={Colors.accent} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: Colors.text }]}>{p.name}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {p.description ?? p.category ?? "Custom provider"}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                      <Text style={[styles.badgeTxt, { color: Colors.textSecondary }]}>
                        {p.services.length} services
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                      <Text style={[styles.badgeTxt, { color: Colors.textSecondary }]}>
                        {keysCount} keys
                      </Text>
                    </View>
                  </View>
                </View>
                {editable ? (
                  <TouchableOpacity
                    onPress={() => onDelete(p)}
                    style={styles.rowDelete}
                    testID={`provider-delete-${p.id}`}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Delete provider"
                  >
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
                {query ? `No providers match "${query}".` : "No providers yet."}
              </Text>
            </View>
          ) : null}

          {editable ? (
            <TouchableOpacity
              onPress={() => setShowAdd(true)}
              style={[styles.addBtn, { backgroundColor: Colors.accent }]}
              testID="api-keys-add-bottom"
              accessibilityRole="button"
            >
              <Plus color="#000000" size={18} />
              <Text style={styles.addTxt}>Add Provider</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>New Provider</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={8} accessibilityRole="button">
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Provider name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Yandex Maps"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              autoFocus
              testID="provider-add-name"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setShowAdd(false)}
                style={[styles.modalBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                accessibilityRole="button"
              >
                <Text style={[styles.modalBtnTxt, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onAdd}
                style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                testID="provider-add-confirm"
                accessibilityRole="button"
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
  badgeRow: { flexDirection: "row" as const, gap: 6, marginTop: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 11, fontWeight: "600" as const },
  rowDelete: { padding: 6 },
  emptyWrap: { alignItems: "center" as const, paddingVertical: 24 },
  emptyTxt: { fontSize: 13 },
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
  modalLabel: { fontSize: 12, fontWeight: "600" as const },
  modalInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalActions: { flexDirection: "row" as const, gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  modalBtnTxt: { fontSize: 14, fontWeight: "700" as const },
});
