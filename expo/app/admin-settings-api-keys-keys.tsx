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
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  KeyRound,
  Plus,
  Trash2,
  X,
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Power,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  loadProviders,
  addKey,
  removeKey,
  updateKey,
  reportKeyUsage,
  pickNextKey,
  subscribeProviders,
  type ApiProviderDef,
  type ApiServiceDef,
  type ApiKeyEntry,
} from "@/utils/apiKeysStore";

export default function AdminSettingsApiKeysKeysScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-api-keys");
  const { providerId, serviceId } = useLocalSearchParams<{ providerId: string; serviceId: string }>();
  const [provider, setProvider] = useState<ApiProviderDef | null>(null);
  const [service, setService] = useState<ApiServiceDef | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [label, setLabel] = useState<string>("");
  const [value, setValue] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!providerId || !serviceId) return;
    try {
      setLoading(true);
      const list = await loadProviders();
      const p = list.find((pp) => pp.id === providerId) ?? null;
      const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
      setProvider(p);
      setService(s);
    } finally {
      setLoading(false);
    }
  }, [providerId, serviceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!providerId || !serviceId) return;
    const unsubscribe = subscribeProviders((list) => {
      const p = list.find((pp) => pp.id === providerId) ?? null;
      const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
      setProvider(p);
      setService(s);
    });
    return unsubscribe;
  }, [providerId, serviceId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const nextKey = useMemo(() => (service ? pickNextKey(service) : null), [service]);

  const onAdd = useCallback(async () => {
    if (!editable) return;
    if (!providerId || !serviceId) return;
    if (!value.trim()) {
      Alert.alert("Key required", "Please enter the API key value.");
      return;
    }
    const { list, write } = await addKey(providerId, serviceId, label, value);
    const p = list.find((pp) => pp.id === providerId) ?? null;
    const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
    setProvider(p);
    setService(s);
    setLabel("");
    setValue("");
    setShowAdd(false);
    if (!write.ok && !write.skipped) {
      Alert.alert("Couldn't save to Supabase", write.error);
    }
  }, [providerId, serviceId, label, value]);

  const onDelete = useCallback(
    (k: ApiKeyEntry) => {
      if (!editable) return;
      if (!providerId || !serviceId) return;
      const apply = async () => {
        const { list, write } = await removeKey(providerId, serviceId, k.id);
        const p = list.find((pp) => pp.id === providerId) ?? null;
        const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
        setProvider(p);
        setService(s);
        if (!write.ok && !write.skipped) {
          Alert.alert("Couldn't save to Supabase", write.error);
        }
      };
      if (Platform.OS === "web") {
        apply();
        return;
      }
      Alert.alert("Delete key", `Remove "${k.label}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: apply },
      ]);
    },
    [providerId, serviceId]
  );

  const onToggleReveal = useCallback(
    async (k: ApiKeyEntry) => {
      const wasRevealed = !!reveal[k.id];
      setReveal((prev) => ({ ...prev, [k.id]: !prev[k.id] }));
      if (wasRevealed) return;
      // Revealing — if the in-memory value is empty (e.g. only the stripped
      // local cache was loaded), try refreshing from Supabase so the user
      // actually sees the secret instead of an empty string.
      if (!k.value || k.value.trim().length === 0) {
        console.log("[keys] reveal: empty value, refreshing from Supabase", k.id);
        await refresh();
      }
    },
    [reveal, refresh]
  );

  const onCopy = useCallback(async (k: ApiKeyEntry) => {
    if (!k.value || k.value.trim().length === 0) {
      Alert.alert(
        "Key not available",
        "This key's value isn't in memory. Pull to refresh from Supabase first."
      );
      return;
    }
    try {
      await Clipboard.setStringAsync(k.value);
      Alert.alert("Copied", "API key copied to clipboard.");
    } catch (e) {
      console.log("[keys] copy error", e);
    }
  }, []);

  const onToggleDisabled = useCallback(
    async (k: ApiKeyEntry) => {
      if (!editable) return;
      if (!providerId || !serviceId) return;
      const { list, write } = await updateKey(providerId, serviceId, k.id, { disabled: !k.disabled });
      const p = list.find((pp) => pp.id === providerId) ?? null;
      const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
      setProvider(p);
      setService(s);
      if (!write.ok && !write.skipped) {
        Alert.alert("Couldn't save to Supabase", write.error);
      }
    },
    [providerId, serviceId]
  );

  const onResetCounts = useCallback(
    async (k: ApiKeyEntry) => {
      if (!editable) return;
      if (!providerId || !serviceId) return;
      const { list, write } = await updateKey(providerId, serviceId, k.id, { useCount: 0, failedCount: 0 });
      const p = list.find((pp) => pp.id === providerId) ?? null;
      const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
      setProvider(p);
      setService(s);
      if (!write.ok && !write.skipped) {
        Alert.alert("Couldn't save to Supabase", write.error);
      }
    },
    [providerId, serviceId]
  );

  const onSimulate = useCallback(
    async (k: ApiKeyEntry, success: boolean) => {
      if (!providerId || !serviceId) return;
      const { list } = await reportKeyUsage(providerId, serviceId, k.id, success);
      const p = list.find((pp) => pp.id === providerId) ?? null;
      const s = p?.services.find((ss) => ss.id === serviceId) ?? null;
      setProvider(p);
      setService(s);
    },
    [providerId, serviceId]
  );

  const mask = useCallback((v: string) => {
    if (v.length <= 6) return "•".repeat(Math.max(v.length, 4));
    return `${v.slice(0, 3)}${"•".repeat(Math.max(v.length - 7, 4))}${v.slice(-4)}`;
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="keys-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <KeyRound color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              {service?.name ?? "Keys"}
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {provider?.name ?? ""} · {service?.keys.length ?? 0} keys
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => editable && setShowAdd(true)}
          disabled={!editable}
          style={[styles.iconBtn, { backgroundColor: editable ? Colors.accent + "20" : Colors.gray[100], opacity: editable ? 1 : 0.5 }]}
          testID="keys-add"
        >
          <Plus color={editable ? Colors.accent : Colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !service ? (
        <View style={styles.loadingWrap}>
          <Text style={{ color: Colors.textSecondary }}>Service not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.note,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <ShieldCheck color={Colors.accent} size={16} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.noteTitle, { color: Colors.text }]}>Automatic failover</Text>
              <Text style={[styles.noteTxt, { color: Colors.textSecondary }]}>
                When a key fails, the next available key with the lowest failure count is used. Disabled keys are skipped.
              </Text>
              {nextKey ? (
                <Text style={[styles.noteHighlight, { color: Colors.accent }]}>
                  Next in rotation: {nextKey.label}
                </Text>
              ) : (
                <Text style={[styles.noteHighlight, { color: Colors.error }]}>
                  No active keys available
                </Text>
              )}
            </View>
          </View>

          {service.keys.map((k, idx) => {
            const isRevealed = !!reveal[k.id];
            const isNext = nextKey?.id === k.id;
            const isMissingValue = !k.value || k.value.trim().length === 0;
            return (
              <View
                key={k.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: Colors.gray[100],
                    borderColor: isNext ? Colors.accent : Colors.border,
                    borderWidth: isNext ? 2 : 1,
                  },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.indexBadge, { backgroundColor: Colors.accent + "20" }]}>
                    <Text style={[styles.indexTxt, { color: Colors.accent }]}>#{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={[styles.cardLabel, { color: Colors.text }]} numberOfLines={1}>
                        {k.label}
                      </Text>
                      {isNext ? (
                        <View style={[styles.activeBadge, { backgroundColor: Colors.accent }]}>
                          <Text style={styles.activeBadgeTxt}>NEXT</Text>
                        </View>
                      ) : null}
                      {k.disabled ? (
                        <View style={[styles.disabledBadge, { backgroundColor: Colors.error + "20", borderColor: Colors.error }]}>
                          <Text style={[styles.disabledBadgeTxt, { color: Colors.error }]}>DISABLED</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => onDelete(k)} style={styles.smallBtn} hitSlop={8} testID={`key-delete-${k.id}`}>
                    <Trash2 color={Colors.error} size={16} />
                  </TouchableOpacity>
                </View>

                <View style={[styles.inputRow, { borderColor: Colors.border, backgroundColor: Colors.background }]}>
                  <Text
                    style={[
                      styles.keyValue,
                      { color: isRevealed && isMissingValue ? Colors.error : Colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {isRevealed
                      ? isMissingValue
                        ? "(not synced from Supabase)"
                        : k.value
                      : mask(k.value)}
                  </Text>
                  <TouchableOpacity onPress={() => onToggleReveal(k)} style={styles.inputAction} testID={`key-reveal-${k.id}`}>
                    {isRevealed ? <EyeOff color={Colors.textSecondary} size={18} /> : <Eye color={Colors.textSecondary} size={18} />}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onCopy(k)} style={styles.inputAction} testID={`key-copy-${k.id}`}>
                    <Copy color={Colors.textSecondary} size={18} />
                  </TouchableOpacity>
                </View>

                {isRevealed && isMissingValue ? (
                  <View style={[styles.warnRow, { backgroundColor: Colors.error + "15", borderColor: Colors.error + "40" }]}>
                    <AlertTriangle color={Colors.error} size={14} />
                    <Text style={[styles.warnTxt, { color: Colors.error }]} numberOfLines={2}>
                      Key value isn't in memory. The local cache stores no secrets — fetch fresh from Supabase.
                    </Text>
                    <TouchableOpacity
                      onPress={refresh}
                      style={[styles.warnBtn, { backgroundColor: Colors.error }]}
                      testID={`key-refetch-${k.id}`}
                    >
                      <RefreshCw color="#fff" size={12} />
                      <Text style={styles.warnBtnTxt}>Refresh</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.statsRow}>
                  <View style={[styles.stat, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                    <CheckCircle2 color={Colors.accent} size={14} />
                    <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Used</Text>
                    <Text style={[styles.statValue, { color: Colors.text }]}>{k.useCount}</Text>
                  </View>
                  <View style={[styles.stat, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                    <XCircle color={Colors.error} size={14} />
                    <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Failed</Text>
                    <Text style={[styles.statValue, { color: Colors.text }]}>{k.failedCount}</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    onPress={() => onSimulate(k, true)}
                    style={[styles.actionBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                    testID={`key-success-${k.id}`}
                  >
                    <CheckCircle2 color={Colors.accent} size={14} />
                    <Text style={[styles.actionTxt, { color: Colors.text }]}>+ Use</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onSimulate(k, false)}
                    style={[styles.actionBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                    testID={`key-fail-${k.id}`}
                  >
                    <XCircle color={Colors.error} size={14} />
                    <Text style={[styles.actionTxt, { color: Colors.text }]}>+ Fail</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onResetCounts(k)}
                    style={[styles.actionBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                    testID={`key-reset-${k.id}`}
                  >
                    <RotateCcw color={Colors.textSecondary} size={14} />
                    <Text style={[styles.actionTxt, { color: Colors.text }]}>Reset</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onToggleDisabled(k)}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: k.disabled ? Colors.accent + "20" : Colors.background,
                        borderColor: k.disabled ? Colors.accent : Colors.border,
                      },
                    ]}
                    testID={`key-toggle-${k.id}`}
                  >
                    <Power color={k.disabled ? Colors.accent : Colors.text} size={14} />
                    <Text style={[styles.actionTxt, { color: k.disabled ? Colors.accent : Colors.text }]}>
                      {k.disabled ? "Enable" : "Disable"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {service.keys.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>
                No keys yet. Add one to enable {service.name}.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={() => setShowAdd(true)}
            style={[styles.addBtn, { backgroundColor: Colors.accent }]}
            testID="keys-add-bottom"
          >
            <Plus color="#000000" size={18} />
            <Text style={styles.addTxt}>Add Key</Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>New API Key</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={8}>
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Label (optional)</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Production Key"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              testID="key-add-label"
            />
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Key value</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="Paste API key"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[styles.modalInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
              testID="key-add-value"
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
                testID="key-add-confirm"
              >
                <Text style={[styles.modalBtnTxt, { color: "#000000" }]}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
    flexDirection: "row" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  noteTitle: { fontSize: 13, fontWeight: "700" as const, marginBottom: 2 },
  noteTxt: { fontSize: 12, lineHeight: 18 },
  noteHighlight: { fontSize: 12, fontWeight: "700" as const, marginTop: 4 },
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  cardTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  indexTxt: { fontSize: 12, fontWeight: "800" as const },
  titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
  cardLabel: { fontSize: 15, fontWeight: "700" as const },
  activeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  activeBadgeTxt: { color: "#000000", fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.5 },
  disabledBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  disabledBadgeTxt: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.5 },
  smallBtn: { padding: 6 },
  inputRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  keyValue: { flex: 1, fontSize: 13, paddingVertical: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  inputAction: { padding: 6 },
  statsRow: { flexDirection: "row" as const, gap: 8 },
  stat: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  statLabel: { fontSize: 11, fontWeight: "600" as const, flex: 1 },
  statValue: { fontSize: 13, fontWeight: "800" as const },
  actionsRow: { flexDirection: "row" as const, gap: 6, flexWrap: "wrap" as const },
  actionBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionTxt: { fontSize: 11, fontWeight: "700" as const },
  warnRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  warnTxt: { flex: 1, fontSize: 11, fontWeight: "600" as const, lineHeight: 15 },
  warnBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  warnBtnTxt: { color: "#fff", fontSize: 11, fontWeight: "800" as const },
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
    gap: 8,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 4,
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
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  modalBtnTxt: { fontSize: 14, fontWeight: "700" as const },
});
