import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Inbox,
  Save,
  CreditCard,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import PaymentGatewayAccountPicker, {
  SelectedGateway,
} from "@/components/PaymentGatewayAccountPicker";

const STORAGE_KEY = "payment-type" as const;

interface FormState {
  name: string;
  code: string;
  enabled: boolean;
  gateway: SelectedGateway | null;
}

const defaultForm = (): FormState => ({
  name: "",
  code: "",
  enabled: true,
  gateway: null,
});

export default function AdminSettingsPaymentTypeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      Object.values(e.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [entries, query]);

  const openAdd = () => {
    setEditing(null);
    setForm(defaultForm());
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const v = entry.values;
    setEditing(entry);
    setForm({
      name: String(v.name ?? ""),
      code: String(v.code ?? ""),
      enabled: Boolean(v.enabled ?? true),
      gateway: v.gatewayId
        ? {
            id: String(v.gatewayId),
            providerId: String(v.gatewayProviderId ?? ""),
            providerName: String(v.gatewayProviderName ?? ""),
            accountName: String(v.gatewayAccountName ?? ""),
            mode: String(v.gatewayMode ?? "Live"),
          }
        : null,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.name.trim()) {
      Alert.alert("Missing field", "Please fill in Name.");
      return;
    }
    const values: Record<string, string | number | boolean> = {
      name: form.name.trim(),
      code: form.code.trim(),
      enabled: form.enabled,
      gatewayId: form.gateway?.id ?? "",
      gatewayProviderId: form.gateway?.providerId ?? "",
      gatewayProviderName: form.gateway?.providerName ?? "",
      gatewayAccountName: form.gateway?.accountName ?? "",
      gatewayMode: form.gateway?.mode ?? "",
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, { ...editing.values, ...values });
    } else {
      addEntry(STORAGE_KEY, values);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this payment type?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

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
          testID="payment-type-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <CreditCard color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Payment Type
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Available payment methods
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="payment-type-add"
        >
          <Plus color={Colors.secondary} size={22} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.searchWrap,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
      >
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="payment-type-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View
            style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          >
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No payment types yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a payment method.
            </Text>
          </View>
        ) : (
          filtered.map((e) => {
            const enabled = Boolean(e.values.enabled ?? true);
            const gwName = String(e.values.gatewayProviderName ?? "");
            const gwAccount = String(e.values.gatewayAccountName ?? "");
            const gwLabel = gwName ? `${gwName}${gwAccount ? ` · ${gwAccount}` : ""}` : "No gateway";
            return (
              <View
                key={e.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`payment-type-row-${e.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <CreditCard color={Colors.accent} size={18} />
                </View>
                <View style={styles.rowInfo}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                      {String(e.values.name ?? "Untitled")}
                    </Text>
                    {!enabled ? (
                      <View style={[styles.pill, { backgroundColor: Colors.textSecondary + "30" }]}>
                        <Text style={[styles.pillText, { color: Colors.textSecondary }]}>
                          Disabled
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {String(e.values.code ?? "—")} • {gwLabel}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`payment-type-edit-${e.id}`}
                >
                  <Pencil color={Colors.accent} size={16} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`payment-type-delete-${e.id}`}
                >
                  <Trash2 color={Colors.error} size={16} />
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit Payment Type" : "Add Payment Type"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="payment-type-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Name *</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.name}
                      onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                      placeholder="e.g. Credit Card"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="payment-type-field-name"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Code</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.code}
                      onChangeText={(t) => setForm((p) => ({ ...p, code: t }))}
                      placeholder="e.g. CARD"
                      placeholderTextColor={Colors.textSecondary}
                      autoCapitalize="characters"
                      style={[styles.input, { color: Colors.text }]}
                      testID="payment-type-field-code"
                    />
                  </View>
                </View>

                <PaymentGatewayAccountPicker
                  label="Payment Gateway Account (if applicable)"
                  value={form.gateway}
                  onChange={(g) => setForm((p) => ({ ...p, gateway: g }))}
                  testID="payment-type-field-gateway"
                  helperText="Optional. Bind this payment type to a specific gateway account."
                />

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <Text style={[styles.label, { color: Colors.text, marginBottom: 0 }]}>
                    Enabled
                  </Text>
                  <Switch
                    value={form.enabled}
                    onValueChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
                    testID="payment-type-field-enabled"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="payment-type-save"
              >
                <Save color={Colors.secondary} size={18} />
                <Text style={[styles.submitText, { color: Colors.secondary }]}>
                  {editing ? "Save changes" : "Add Payment Type"}
                </Text>
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
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pillText: { fontSize: 11, fontWeight: "800" as const },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  submitBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginTop: 6,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
});
