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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldX,
  Plus,
  Trash2,
  X,
  Search,
  Lock,
  Save,
  Globe,
  RefreshCw,
  CheckCircle2,
  Pencil,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { isSupabaseConfigured } from "@/utils/supabase";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  addIpRule,
  updateIpRule,
  deleteIpRule,
  getPublicIp,
  listIpRules,
  type IpAccessRule,
  type IpListType,
} from "@/utils/ipAccessStore";

const PAGE_KEY = "admin-settings-ip-access";

export default function AdminSettingsIpAccessScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit, isLoading: accessLoading } = useAdminAccess();
  const editable = canEdit(PAGE_KEY);

  const [rules, setRules] = useState<IpAccessRule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<"all" | IpListType>("all");
  const [myIp, setMyIp] = useState<string | null>(null);

  const [showForm, setShowForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ipInput, setIpInput] = useState<string>("");
  const [labelInput, setLabelInput] = useState<string>("");
  const [listType, setListType] = useState<IpListType>("whitelist");
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listIpRules();
      setRules(r);
    } finally {
      setLoading(false);
    }
    // IP lookup runs separately so a slow/blocked network never blocks the list.
    void getPublicIp(true).then(setMyIp).catch(() => setMyIp(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openAdd = useCallback(
    (preset?: IpListType, presetIp?: string) => {
      if (!editable) return;
      setEditingId(null);
      setIpInput(presetIp ?? "");
      setLabelInput("");
      setListType(preset ?? "whitelist");
      setShowForm(true);
    },
    [editable]
  );

  const openEdit = useCallback(
    (rule: IpAccessRule) => {
      if (!editable) return;
      setEditingId(rule.id);
      setIpInput(rule.ip_address);
      setLabelInput(rule.label ?? "");
      setListType(rule.list_type);
      setShowForm(true);
    },
    [editable]
  );

  const submit = useCallback(async () => {
    if (!isSupabaseConfigured) {
      Alert.alert("Supabase not configured");
      return;
    }
    const ip = ipInput.trim();
    if (!ip) {
      Alert.alert("IP required", "Enter an IP address to add.");
      return;
    }
    setSaving(true);
    try {
      const saved = editingId
        ? await updateIpRule(editingId, { ipAddress: ip, listType, label: labelInput })
        : await addIpRule({ ipAddress: ip, listType, label: labelInput });
      if (!saved) {
        Alert.alert(
          "Couldn't save",
          `Failed to ${editingId ? "update" : "add"} the IP rule. Please try again.`
        );
        return;
      }
      setShowForm(false);
      setEditingId(null);
      await load();
    } finally {
      setSaving(false);
    }
  }, [ipInput, labelInput, listType, editingId, load]);

  const onDelete = useCallback(
    (rule: IpAccessRule) => {
      if (!editable) return;
      Alert.alert(
        "Remove rule",
        `Remove ${rule.ip_address} from the ${rule.list_type}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              const ok = await deleteIpRule(rule.id);
              if (!ok) {
                Alert.alert("Couldn't remove", "Please try again.");
                return;
              }
              await load();
            },
          },
        ]
      );
    },
    [editable, load]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter((r) => {
      if (filter !== "all" && r.list_type !== filter) return false;
      if (!q) return true;
      const hay = `${r.ip_address} ${r.label ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rules, query, filter]);

  const counts = useMemo(() => {
    let white = 0;
    let black = 0;
    for (const r of rules) {
      if (r.list_type === "whitelist") white += 1;
      else black += 1;
    }
    return { white, black };
  }, [rules]);

  const myIpRule = useMemo(
    () => rules.find((r) => r.ip_address === myIp) ?? null,
    [rules, myIp]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="ip-access-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Globe color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>IP Whitelist / Blacklist</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {counts.white} allowed · {counts.black} blocked · {editable ? "edit" : "read-only"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openAdd()}
          disabled={!editable}
          style={[
            styles.iconBtn,
            { backgroundColor: editable ? Colors.accent + "20" : Colors.gray[100], opacity: editable ? 1 : 0.5 },
          ]}
          testID="ip-access-add"
          accessibilityRole="button"
          accessibilityLabel="Add IP access"
        >
          <Plus color={editable ? Colors.accent : Colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      {accessLoading || loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {!editable ? (
            <View style={[styles.banner, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Lock color={Colors.textSecondary} size={14} />
              <Text style={[styles.bannerText, { color: Colors.textSecondary }]}>
                You have read-only access to this page. Ask a super-admin to grant edit access.
              </Text>
            </View>
          ) : null}

          {/* Current device IP card */}
          <View style={[styles.myIpCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.myIpLabel, { color: Colors.textSecondary }]}>This device&apos;s IP</Text>
              <Text style={[styles.myIpValue, { color: Colors.text }]}>{myIp ?? "Unavailable"}</Text>
              {myIpRule ? (
                <View
                  style={[
                    styles.miniBadge,
                    {
                      backgroundColor:
                        myIpRule.list_type === "whitelist" ? Colors.success + "20" : Colors.error + "20",
                    },
                  ]}
                >
                  {myIpRule.list_type === "whitelist" ? (
                    <ShieldCheck color={Colors.success} size={12} />
                  ) : (
                    <ShieldX color={Colors.error} size={12} />
                  )}
                  <Text
                    style={[
                      styles.miniBadgeTxt,
                      { color: myIpRule.list_type === "whitelist" ? Colors.success : Colors.error },
                    ]}
                  >
                    {myIpRule.list_type === "whitelist" ? "Whitelisted" : "Blacklisted"}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.myIpActions}>
              <TouchableOpacity
                onPress={() => load()}
                style={[styles.smallBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                testID="ip-access-refresh"
              >
                <RefreshCw color={Colors.textSecondary} size={14} />
              </TouchableOpacity>
              {editable && myIp && !myIpRule ? (
                <TouchableOpacity
                  onPress={() => openAdd("whitelist", myIp)}
                  style={[styles.smallBtn, { backgroundColor: Colors.accent + "20", borderColor: Colors.accent }]}
                  testID="ip-access-add-mine"
                >
                  <Plus color={Colors.accent} size={14} />
                  <Text style={[styles.smallBtnTxt, { color: Colors.accent }]}>Add this IP</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Search */}
          <View style={[styles.searchRow, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}>
            <Search color={Colors.textSecondary} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by IP or label..."
              placeholderTextColor={Colors.textSecondary}
              style={[styles.searchInput, { color: Colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              testID="ip-access-search"
            />
          </View>

          {/* Filter chips */}
          <View style={styles.filterRow}>
            {([
              { key: "all", label: `All (${rules.length})` },
              { key: "whitelist", label: `Whitelist (${counts.white})` },
              { key: "blacklist", label: `Blacklist (${counts.black})` },
            ] as const).map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? Colors.accent : Colors.gray[100],
                      borderColor: active ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`ip-access-filter-${f.key}`}
                >
                  <Text style={[styles.filterChipTxt, { color: active ? Colors.onAccent : Colors.text }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {filtered.map((rule) => {
            const isWhite = rule.list_type === "whitelist";
            const tone = isWhite ? Colors.success : Colors.error;
            return (
              <View
                key={rule.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`ip-access-row-${rule.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: tone + "20" }]}>
                  {isWhite ? <ShieldCheck color={tone} size={18} /> : <ShieldX color={tone} size={18} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowIp, { color: Colors.text }]} numberOfLines={1}>
                    {rule.ip_address}
                  </Text>
                  <Text style={[styles.rowLabel, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {rule.label?.trim() ? rule.label : isWhite ? "Allowed — bypass admin login" : "Blocked — Service Not Available"}
                  </Text>
                </View>
                <View style={[styles.typeBadge, { backgroundColor: tone }]}>
                  <Text style={[styles.typeBadgeTxt, { color: Colors.onAccent }]}>
                    {isWhite ? "Allow" : "Block"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(rule)}
                  disabled={!editable}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background, opacity: editable ? 1 : 0.4 }]}
                  testID={`ip-access-edit-${rule.id}`}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Edit IP access"
                >
                  <Pencil color={Colors.accent} size={14} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(rule)}
                  disabled={!editable}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background, opacity: editable ? 1 : 0.4 }]}
                  testID={`ip-access-delete-${rule.id}`}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Delete IP access"
                >
                  <Trash2 color={Colors.error} size={14} />
                </TouchableOpacity>
              </View>
            );
          })}

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTxt, { color: Colors.textSecondary }]}>
                {query || filter !== "all"
                  ? "No rules match your filter."
                  : "No IP rules yet. Tap + to add a whitelist or blacklist entry."}
              </Text>
            </View>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editingId ? "Edit IP rule" : "Add IP rule"}
                </Text>
                <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
                  <X color={Colors.text} size={22} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { color: Colors.textSecondary }]}>List type</Text>
              <View style={styles.typeRow}>
                {([
                  { key: "whitelist", label: "Whitelist", desc: "Allow & bypass login", Icon: ShieldCheck, tone: Colors.success },
                  { key: "blacklist", label: "Blacklist", desc: "Block service", Icon: ShieldX, tone: Colors.error },
                ] as const).map((opt) => {
                  const active = listType === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setListType(opt.key)}
                      style={[
                        styles.typeOption,
                        {
                          backgroundColor: active ? opt.tone + "20" : Colors.gray[100],
                          borderColor: active ? opt.tone : Colors.border,
                        },
                      ]}
                      testID={`ip-access-type-${opt.key}`}
                    >
                      <opt.Icon color={active ? opt.tone : Colors.textSecondary} size={18} />
                      <Text style={[styles.typeOptionTitle, { color: active ? opt.tone : Colors.text }]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.typeOptionDesc, { color: Colors.textSecondary }]}>{opt.desc}</Text>
                      {active ? <CheckCircle2 color={opt.tone} size={14} style={styles.typeCheck} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 14 }]}>IP address</Text>
              <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Globe color={Colors.textSecondary} size={16} />
                <TextInput
                  value={ipInput}
                  onChangeText={setIpInput}
                  placeholder="e.g. 203.0.113.42"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  testID="ip-access-form-ip"
                />
                {myIp && ipInput.trim() !== myIp ? (
                  <TouchableOpacity onPress={() => setIpInput(myIp)} hitSlop={8} testID="ip-access-use-mine">
                    <Text style={[styles.useMine, { color: Colors.accent }]}>Use mine</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 14 }]}>Label (optional)</Text>
              <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <TextInput
                  value={labelInput}
                  onChangeText={setLabelInput}
                  placeholder="e.g. Head office, Fraud block"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                  testID="ip-access-form-label"
                />
              </View>

              <TouchableOpacity
                onPress={submit}
                disabled={saving}
                style={[styles.saveBtn, { backgroundColor: Colors.accent, opacity: saving ? 0.7 : 1 }]}
                testID="ip-access-form-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.onAccent} />
                ) : (
                  <>
                    <Save color={Colors.onAccent} size={16} />
                    <Text style={[styles.saveTxt, { color: Colors.onAccent }]}>
                      {editingId ? "Save changes" : "Add rule"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
  iconBtnSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  banner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  bannerText: { fontSize: 12, flex: 1 },
  myIpCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  myIpLabel: { fontSize: 11, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  myIpValue: { fontSize: 18, fontWeight: "800" as const, marginTop: 2 },
  miniBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  miniBadgeTxt: { fontSize: 11, fontWeight: "700" as const },
  myIpActions: { gap: 8, alignItems: "flex-end" as const },
  smallBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  smallBtnTxt: { fontSize: 12, fontWeight: "700" as const },
  searchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  filterRow: { flexDirection: "row" as const, gap: 8, marginBottom: 14, flexWrap: "wrap" as const },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  filterChipTxt: { fontSize: 12, fontWeight: "700" as const },
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
  rowIp: { fontSize: 15, fontWeight: "800" as const },
  rowLabel: { fontSize: 12, marginTop: 2 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  typeBadgeTxt: { fontSize: 11, fontWeight: "800" as const },
  emptyWrap: { alignItems: "center" as const, paddingVertical: 24 },
  emptyTxt: { fontSize: 13, textAlign: "center" as const, paddingHorizontal: 24 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  typeRow: { flexDirection: "row" as const, gap: 10 },
  typeOption: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 2,
  },
  typeOptionTitle: { fontSize: 14, fontWeight: "800" as const, marginTop: 4 },
  typeOptionDesc: { fontSize: 11 },
  typeCheck: { position: "absolute" as const, top: 10, right: 10 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  useMine: { fontSize: 12, fontWeight: "700" as const },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 18,
  },
  saveTxt: { fontSize: 15, fontWeight: "800" as const },
});
