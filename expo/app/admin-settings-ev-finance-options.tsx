import React, { useEffect, useMemo, useState } from "react";
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
import * as Haptics from "expo-haptics";
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
  ChevronUp,
  ChevronDown,
  ListOrdered,
  Wallet,
  Globe,
  Check,
} from "lucide-react-native";
import { Country } from "country-state-city";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import PaymentGatewayAccountPicker, {
  SelectedGateway,
} from "@/components/PaymentGatewayAccountPicker";

const STORAGE_KEY = "ev-finance-options" as const;

type OptionType = "Cash" | "Leasing" | "Hire Purchase" | "Rental";
const OPTION_TYPES: OptionType[] = ["Cash", "Leasing", "Hire Purchase", "Rental"];

type TermUnit = "Day" | "Month" | "Year";
const TERM_UNITS: TermUnit[] = ["Day", "Month", "Year"];

type PaymentMode = "Full Balance" | "Custom";

interface FormState {
  name: string;
  type: OptionType;
  country: string;
  paymentMode: PaymentMode;
  paymentAmount: string;
  rate: string;
  termValue: string;
  termUnit: TermUnit;
  details: string;
  active: boolean;
  displayPriority: number;
  gateway: SelectedGateway | null;
}

const defaultForm = (priority: number): FormState => ({
  name: "",
  type: "Cash",
  country: "",
  paymentMode: "Full Balance",
  paymentAmount: "",
  rate: "",
  termValue: "",
  termUnit: "Month",
  details: "",
  active: true,
  displayPriority: priority,
  gateway: null,
});

const SEED: FormState[] = [
  { name: "Full Cash", type: "Cash", country: "Malaysia", paymentMode: "Full Balance", paymentAmount: "", rate: "", termValue: "", termUnit: "Month", details: "Pay total VSO in full to TEKSI account", active: true, displayPriority: 1, gateway: null },
  { name: "Leasing 24 months", type: "Leasing", country: "Malaysia", paymentMode: "Custom", paymentAmount: "850", rate: "", termValue: "24", termUnit: "Month", details: "24-month flexible lease with end-of-term return option", active: true, displayPriority: 2, gateway: null },
  { name: "Hire Purchase 60m", type: "Hire Purchase", country: "Malaysia", paymentMode: "Custom", paymentAmount: "1200", rate: "2.85", termValue: "60", termUnit: "Month", details: "Partnered banks · 10% downpayment", active: true, displayPriority: 3, gateway: null },
  { name: "Daily Rental", type: "Rental", country: "Malaysia", paymentMode: "Custom", paymentAmount: "120", rate: "", termValue: "1", termUnit: "Day", details: "Pay-per-day rental for trial drivers", active: true, displayPriority: 4, gateway: null },
];

export default function AdminSettingsEvFinanceOptionsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [seeded, setSeeded] = useState<boolean>(false);
  useEffect(() => {
    if (seeded) return;
    if (entries.length === 0) {
      SEED.forEach((v) => {
        const { gateway: _gateway, ...rest } = v;
        void _gateway;
        addEntry(STORAGE_KEY, { ...rest, isDefault: true });
      });
    }
    setSeeded(true);
  }, [seeded, entries.length, addEntry]);

  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          Number(a.values.displayPriority ?? 9999) -
          Number(b.values.displayPriority ?? 9999)
      ),
    [entries]
  );

  const [query, setQuery] = useState<string>("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((e) =>
      Object.values(e.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sorted, query]);

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm(1));
  const [countryPickerOpen, setCountryPickerOpen] = useState<boolean>(false);
  const [countryQuery, setCountryQuery] = useState<string>("");

  const worldCountries = useMemo(() => Country.getAllCountries(), []);
  const countryList = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const names = worldCountries.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    if (!q) return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [worldCountries, countryQuery]);

  const openAdd = () => {
    setEditing(null);
    setForm(defaultForm(entries.length + 1));
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const v = entry.values;
    setEditing(entry);
    setForm({
      name: String(v.name ?? ""),
      type: (OPTION_TYPES.includes(String(v.type) as OptionType) ? String(v.type) : "Cash") as OptionType,
      country: String(v.country ?? ""),
      paymentMode: (v.paymentMode === "Custom" ? "Custom" : "Full Balance") as PaymentMode,
      paymentAmount: String(v.paymentAmount ?? ""),
      rate: String(v.rate ?? ""),
      termValue: String(v.termValue ?? ""),
      termUnit: (TERM_UNITS.includes(String(v.termUnit) as TermUnit) ? String(v.termUnit) : "Month") as TermUnit,
      details: String(v.details ?? ""),
      active: Boolean(v.active ?? true),
      displayPriority:
        typeof v.displayPriority === "number"
          ? v.displayPriority
          : Number(v.displayPriority) || entries.length + 1,
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
      Alert.alert("Missing field", "Please fill in Plan Name.");
      return;
    }
    if (!form.country.trim()) {
      Alert.alert("Missing field", "Please select a Country.");
      return;
    }
    if (form.paymentMode === "Custom") {
      const n = parseFloat(form.paymentAmount);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert("Missing field", "Please enter a valid custom payment amount.");
        return;
      }
    }
    const values: Record<string, string | number | boolean> = {
      name: form.name.trim(),
      type: form.type,
      country: form.country.trim(),
      paymentMode: form.paymentMode,
      paymentAmount: form.paymentMode === "Custom" ? parseFloat(form.paymentAmount) || 0 : 0,
      rate: form.rate.trim() ? parseFloat(form.rate) || 0 : 0,
      termValue: form.termValue.trim() ? parseFloat(form.termValue) || 0 : 0,
      termUnit: form.termUnit,
      details: form.details.trim(),
      active: form.active,
      displayPriority: form.displayPriority,
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
    Alert.alert("Delete", "Remove this finance option?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const moveEntry = (id: string, dir: -1 | 1) => {
    const ids = sorted.map((g) => g.id);
    const from = ids.indexOf(id);
    if (from === -1) return;
    const to = from + dir;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    next.forEach((gid, idx) => {
      const g = sorted.find((x) => x.id === gid);
      if (!g) return;
      const newPriority = idx + 1;
      if (Number(g.values.displayPriority ?? -1) !== newPriority) {
        updateEntry(STORAGE_KEY, gid, { ...g.values, displayPriority: newPriority });
      }
    });
  };

  const formatRow = (e: SettingEntry): { title: string; sub: string; meta: string } => {
    const v = e.values;
    const title = String(v.name ?? "Untitled");
    const sub = `${String(v.type ?? "")} • ${String(v.country ?? "—")}`;
    const pay = v.paymentMode === "Custom" ? `${v.paymentAmount}` : "Full Balance";
    const rate = v.rate && Number(v.rate) > 0 ? `${v.rate}%` : "—";
    const term =
      v.termValue && Number(v.termValue) > 0
        ? `${v.termValue} ${v.termUnit}${Number(v.termValue) > 1 ? "s" : ""}`
        : "—";
    const meta = `Pay: ${pay} • Rate: ${rate} • Term: ${term}`;
    return { title, sub, meta };
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="ev-finance-options-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Wallet color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              EV Finance Options
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Cash, Leasing, Hire Purchase & Rental for TEKSI EV
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="ev-finance-options-add"
          accessibilityRole="button"
          accessibilityLabel="Add EV finance options"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="ev-finance-options-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a new option.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="ev-finance-options-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add Option</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e, i) => {
            const isFirst = i === 0;
            const isLast = i === filtered.length - 1;
            const { title, sub, meta } = formatRow(e);
            return (
              <View
                key={e.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`ev-finance-options-row-${e.id}`}
              >
                <View style={styles.reorderColumn}>
                  <TouchableOpacity
                    onPress={() => moveEntry(e.id, -1)}
                    disabled={isFirst}
                    style={[
                      styles.reorderBtn,
                      {
                        backgroundColor: isFirst ? Colors.background : Colors.accent + "20",
                        opacity: isFirst ? 0.4 : 1,
                      },
                    ]}
                    hitSlop={{ top: 4, bottom: 2, left: 4, right: 4 }}
                  >
                    <ChevronUp color={isFirst ? Colors.textSecondary : Colors.accent} size={16} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveEntry(e.id, 1)}
                    disabled={isLast}
                    style={[
                      styles.reorderBtn,
                      {
                        backgroundColor: isLast ? Colors.background : Colors.accent + "20",
                        opacity: isLast ? 0.4 : 1,
                      },
                    ]}
                    hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
                  >
                    <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Wallet color={Colors.accent} size={18} />
                </View>
                <View style={styles.rowInfo}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
                      <ListOrdered color={Colors.onAccent} size={10} />
                      <Text style={[styles.priorityText, { color: Colors.onAccent }]}>
                        {String(e.values.displayPriority ?? "-")}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {sub}
                  </Text>
                  <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {meta}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`ev-finance-options-edit-${e.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Edit EV finance options"
                >
                  <Pencil color={Colors.accent} size={16} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`ev-finance-options-delete-${e.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Delete EV finance options"
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
                  {editing ? "Edit EV Finance Option" : "Add EV Finance Option"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Plan Name *</Text>
                  <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <TextInput
                      value={form.name}
                      onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                      placeholder="e.g. Leasing 24m"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="ev-finance-options-field-name"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Options *</Text>
                  <View style={styles.pillsRow}>
                    {OPTION_TYPES.map((t) => {
                      const active = form.type === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setForm((p) => ({ ...p, type: t }))}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: active ? Colors.accent : Colors.gray[100],
                              borderColor: active ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`ev-finance-options-type-${t}`}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              { color: active ? Colors.onAccent : Colors.text },
                            ]}
                          >
                            {t}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Country *</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setCountryQuery("");
                      setCountryPickerOpen(true);
                    }}
                    style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                    testID="ev-finance-options-field-country"
                  >
                    <Globe color={Colors.textSecondary} size={16} />
                    <Text
                      style={[
                        styles.input,
                        { color: form.country ? Colors.text : Colors.textSecondary, paddingLeft: 8 },
                      ]}
                    >
                      {form.country || "Select country"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Payment</Text>
                  <View style={styles.pillsRow}>
                    {(["Full Balance", "Custom"] as PaymentMode[]).map((m) => {
                      const active = form.paymentMode === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setForm((p) => ({ ...p, paymentMode: m }))}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: active ? Colors.accent : Colors.gray[100],
                              borderColor: active ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`ev-finance-options-payment-${m}`}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              { color: active ? Colors.onAccent : Colors.text },
                            ]}
                          >
                            {m}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {form.paymentMode === "Custom" ? (
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 10 },
                      ]}
                    >
                      <TextInput
                        value={form.paymentAmount}
                        onChangeText={(t) => setForm((p) => ({ ...p, paymentAmount: t.replace(/[^0-9.]/g, "") }))}
                        placeholder="Custom payment sum"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-finance-options-field-paymentAmount"
                      />
                    </View>
                  ) : null}
                </View>

                <View style={styles.row2}>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Rate (%)</Text>
                    <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <TextInput
                        value={form.rate}
                        onChangeText={(t) => setForm((p) => ({ ...p, rate: t.replace(/[^0-9.]/g, "") }))}
                        placeholder="0.00"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-finance-options-field-rate"
                      />
                      <Text style={[styles.suffix, { color: Colors.textSecondary }]}>%</Text>
                    </View>
                  </View>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Term</Text>
                    <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <TextInput
                        value={form.termValue}
                        onChangeText={(t) => setForm((p) => ({ ...p, termValue: t.replace(/[^0-9.]/g, "") }))}
                        placeholder="0"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="number-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-finance-options-field-termValue"
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Term Unit</Text>
                  <View style={styles.pillsRow}>
                    {TERM_UNITS.map((u) => {
                      const active = form.termUnit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          onPress={() => setForm((p) => ({ ...p, termUnit: u }))}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: active ? Colors.accent : Colors.gray[100],
                              borderColor: active ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`ev-finance-options-termUnit-${u}`}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              { color: active ? Colors.onAccent : Colors.text },
                            ]}
                          >
                            {u}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Details</Text>
                  <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <TextInput
                      value={form.details}
                      onChangeText={(t) => setForm((p) => ({ ...p, details: t }))}
                      placeholder="Provider, downpayment, monthly summary"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="ev-finance-options-field-details"
                    />
                  </View>
                </View>

                <PaymentGatewayAccountPicker
                  label="Payment Gateway Account (if applicable)"
                  value={form.gateway}
                  onChange={(g) => setForm((p) => ({ ...p, gateway: g }))}
                  testID="ev-finance-options-field-gateway"
                  helperText="Optional. Only set when this option is collected via a specific gateway account."
                />

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <Text style={[styles.label, { color: Colors.text, marginBottom: 0 }]}>Active</Text>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    testID="ev-finance-options-field-active"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="ev-finance-options-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Option"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={countryPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>Select Country</Text>
              <TouchableOpacity
                onPress={() => setCountryPickerOpen(false)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.searchWrapInline,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <Search color={Colors.textSecondary} size={18} />
              <TextInput
                value={countryQuery}
                onChangeText={setCountryQuery}
                placeholder="Search country"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                testID="ev-finance-options-country-search"
              />
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {countryList.map((name) => {
                const selected = name === form.country;
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => {
                      setForm((p) => ({ ...p, country: name }));
                      setCountryPickerOpen(false);
                    }}
                    style={[
                      styles.countryRow,
                      { borderBottomColor: Colors.border },
                    ]}
                    testID={`ev-finance-options-country-${name}`}
                  >
                    <Text style={[styles.countryName, { color: Colors.text }]}>{name}</Text>
                    {selected ? <Check color={Colors.accent} size={18} /> : null}
                  </TouchableOpacity>
                );
              })}
              {countryList.length === 0 ? (
                <Text style={[styles.emptyDesc, { color: Colors.textSecondary, padding: 20 }]}>
                  No countries match.
                </Text>
              ) : null}
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
  searchWrapInline: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
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
  rowMeta: { fontSize: 11, marginTop: 2 },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  priorityPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  priorityText: { fontSize: 11, fontWeight: "800" as const },
  reorderColumn: {
    width: 32,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 4,
    marginLeft: -2,
  },
  reorderBtn: {
    width: 28,
    height: 26,
    borderRadius: 8,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
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
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { fontSize: 13, fontWeight: "800" as const },
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
  suffix: { fontSize: 14, fontWeight: "700" as const, marginLeft: 6 },
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
  pillsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: "700" as const },
  row2: { flexDirection: "row" as const, gap: 10 },
  countryRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  countryName: { fontSize: 14, fontWeight: "600" as const },
});
