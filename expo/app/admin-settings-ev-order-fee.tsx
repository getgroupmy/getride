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
  Banknote,
  Globe,
  Check,
  Star,
} from "lucide-react-native";
import { Country } from "country-state-city";

const COUNTRY_STATES_CITIES_STORAGE_KEY = "country-states-cities" as const;
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import PaymentGatewayAccountPicker, {
  SelectedGateway,
} from "@/components/PaymentGatewayAccountPicker";

export const ORDER_FEE_STORAGE_KEY = "ev-order-fee" as const;
export const DEFAULT_ORDER_FEE_COUNTRY = "Malaysia";
export const DEFAULT_ORDER_FEE_AMOUNT = 3000;
export const DEFAULT_ORDER_FEE_CURRENCY = "RM";

interface FormState {
  country: string;
  currency: string;
  amount: string;
  isDefault: boolean;
  active: boolean;
  gateway: SelectedGateway | null;
}

const defaultForm = (): FormState => ({
  country: "",
  currency: DEFAULT_ORDER_FEE_CURRENCY,
  amount: "",
  isDefault: false,
  active: true,
  gateway: null,
});

interface SeedEntry {
  country: string;
  currency: string;
  amount: number;
  isDefault: boolean;
  active: boolean;
}

const SEED: SeedEntry[] = [
  {
    country: DEFAULT_ORDER_FEE_COUNTRY,
    currency: DEFAULT_ORDER_FEE_CURRENCY,
    amount: DEFAULT_ORDER_FEE_AMOUNT,
    isDefault: true,
    active: true,
  },
];

export default function AdminSettingsEvOrderFeeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(ORDER_FEE_STORAGE_KEY);

  const [seeded, setSeeded] = useState<boolean>(false);
  useEffect(() => {
    if (seeded) return;
    if (entries.length === 0) {
      SEED.forEach((v) => addEntry(ORDER_FEE_STORAGE_KEY, { ...v }));
    }
    setSeeded(true);
  }, [seeded, entries.length, addEntry]);

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const ad = a.values.isDefault ? 0 : 1;
        const bd = b.values.isDefault ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return String(a.values.country ?? "").localeCompare(
          String(b.values.country ?? "")
        );
      }),
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
  const [form, setForm] = useState<FormState>(defaultForm());
  const [countryPickerOpen, setCountryPickerOpen] = useState<boolean>(false);
  const [countryQuery, setCountryQuery] = useState<string>("");

  const worldCountries = useMemo(() => Country.getAllCountries(), []);

  const csCityEntries = getEntries(COUNTRY_STATES_CITIES_STORAGE_KEY);

  /**
   * Resolve currency symbol for a country: prefer admin-saved country-level
   * entry from country-states-cities, then fall back to country-state-city lib.
   */
  const resolveCurrencyForCountry = (name: string): string => {
    if (!name) return "";
    const norm = (s: string) => s.trim().toLowerCase();
    const saved = csCityEntries.find((e) => {
      const c = String(e.values.country ?? "");
      const st = String(e.values.state ?? "");
      const ci = String(e.values.city ?? "");
      const su = String(e.values.suburb ?? "");
      return norm(c) === norm(name) && !st && !ci && !su;
    });
    const savedSym = String(saved?.values.currencySymbol ?? "").trim();
    if (savedSym) return savedSym;
    const savedName = String(saved?.values.currencyName ?? "").trim();
    if (savedName) return savedName;
    const meta = worldCountries.find((c) => c.name === name);
    return meta?.currency ?? "";
  };
  const countryList = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const names = worldCountries.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    if (!q) return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [worldCountries, countryQuery]);

  const openAdd = () => {
    setEditing(null);
    setForm(defaultForm());
    setModalOpen(true);
  };

  const selectCountry = (name: string) => {
    const cur = resolveCurrencyForCountry(name);
    setForm((p) => ({ ...p, country: name, currency: cur || p.currency }));
    setCountryPickerOpen(false);
  };

  const openEdit = (entry: SettingEntry) => {
    const v = entry.values;
    setEditing(entry);
    const gw: SelectedGateway | null = v.gatewayId
      ? {
          id: String(v.gatewayId),
          providerId: String(v.gatewayProviderId ?? ""),
          providerName: String(v.gatewayProviderName ?? ""),
          accountName: String(v.gatewayAccountName ?? ""),
          mode: String(v.gatewayMode ?? "Live"),
        }
      : null;
    setForm({
      country: String(v.country ?? ""),
      currency: String(v.currency ?? DEFAULT_ORDER_FEE_CURRENCY),
      amount: String(v.amount ?? ""),
      isDefault: Boolean(v.isDefault ?? false),
      active: Boolean(v.active ?? true),
      gateway: gw,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.country.trim()) {
      Alert.alert("Missing field", "Please select a Country.");
      return;
    }
    const amt = parseFloat(form.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      Alert.alert("Missing field", "Please enter a valid order fee amount.");
      return;
    }
    const dupe = entries.find(
      (e) =>
        String(e.values.country ?? "").trim().toLowerCase() ===
          form.country.trim().toLowerCase() && e.id !== editing?.id
    );
    if (dupe) {
      Alert.alert(
        "Duplicate country",
        `An order fee for ${form.country} already exists. Edit the existing entry instead.`
      );
      return;
    }
    const values: Record<string, string | number | boolean> = {
      country: form.country.trim(),
      currency: form.currency.trim() || DEFAULT_ORDER_FEE_CURRENCY,
      amount: amt,
      isDefault: form.isDefault,
      active: form.active,
      gatewayId: form.gateway?.id ?? "",
      gatewayProviderId: form.gateway?.providerId ?? "",
      gatewayProviderName: form.gateway?.providerName ?? "",
      gatewayAccountName: form.gateway?.accountName ?? "",
      gatewayMode: form.gateway?.mode ?? "",
    };
    if (editing) {
      updateEntry(ORDER_FEE_STORAGE_KEY, editing.id, { ...editing.values, ...values });
    } else {
      addEntry(ORDER_FEE_STORAGE_KEY, values);
    }
    if (form.isDefault) {
      entries.forEach((e) => {
        if (e.id === editing?.id) return;
        if (e.values.isDefault) {
          updateEntry(ORDER_FEE_STORAGE_KEY, e.id, { ...e.values, isDefault: false });
        }
      });
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    if (entry.values.country === DEFAULT_ORDER_FEE_COUNTRY) {
      Alert.alert(
        "Cannot delete",
        `${DEFAULT_ORDER_FEE_COUNTRY} is the default country and cannot be removed. You can edit the fee instead.`
      );
      return;
    }
    Alert.alert("Delete", `Remove order fee for ${entry.values.country}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(ORDER_FEE_STORAGE_KEY, entry.id),
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
          testID="ev-order-fee-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Banknote color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Order Fee
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Non-refundable order fee per country
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="ev-order-fee-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search country"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="ev-order-fee-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add an order fee for a country.
            </Text>
          </View>
        ) : (
          filtered.map((e) => {
            const country = String(e.values.country ?? "");
            const currency = String(e.values.currency ?? DEFAULT_ORDER_FEE_CURRENCY);
            const amount = Number(e.values.amount ?? 0);
            const isDefault = Boolean(e.values.isDefault);
            const active = Boolean(e.values.active ?? true);
            return (
              <View
                key={e.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`ev-order-fee-row-${e.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Banknote color={Colors.accent} size={18} />
                </View>
                <View style={styles.rowInfo}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                      {country}
                    </Text>
                    {isDefault ? (
                      <View style={[styles.defaultPill, { backgroundColor: Colors.accent }]}>
                        <Star color={Colors.onAccent} size={10} />
                        <Text style={[styles.defaultPillText, { color: Colors.onAccent }]}>
                          Default
                        </Text>
                      </View>
                    ) : null}
                    {!active ? (
                      <View
                        style={[
                          styles.defaultPill,
                          { backgroundColor: Colors.textSecondary + "30" },
                        ]}
                      >
                        <Text style={[styles.defaultPillText, { color: Colors.textSecondary }]}>
                          Inactive
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {currency} {amount.toLocaleString()}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`ev-order-fee-edit-${e.id}`}
                >
                  <Pencil color={Colors.accent} size={16} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`ev-order-fee-delete-${e.id}`}
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
                  {editing ? "Edit Order Fee" : "Add Order Fee"}
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
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Country *</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setCountryQuery("");
                      setCountryPickerOpen(true);
                    }}
                    style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                    testID="ev-order-fee-field-country"
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

                <View style={styles.row2}>
                  <View style={[styles.fieldGroup, { width: 110 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Currency</Text>
                    <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <TextInput
                        value={form.currency}
                        onChangeText={(t) => setForm((p) => ({ ...p, currency: t.toUpperCase() }))}
                        placeholder="RM"
                        placeholderTextColor={Colors.textSecondary}
                        autoCapitalize="characters"
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-order-fee-field-currency"
                      />
                    </View>
                  </View>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Order Fee *</Text>
                    <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <TextInput
                        value={form.amount}
                        onChangeText={(t) => setForm((p) => ({ ...p, amount: t.replace(/[^0-9.]/g, "") }))}
                        placeholder="3000"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-order-fee-field-amount"
                      />
                    </View>
                  </View>
                </View>

                <PaymentGatewayAccountPicker
                  label="Payment Gateway Account"
                  value={form.gateway}
                  onChange={(g) => setForm((p) => ({ ...p, gateway: g }))}
                  testID="ev-order-fee-field-gateway"
                  helperText="Account used to collect this order fee. Leave as None to use the default gateway."
                />

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Default country
                    </Text>
                    <Text style={[styles.toggleSub, { color: Colors.textSecondary }]}>
                      Used when a customer's country has no specific fee.
                    </Text>
                  </View>
                  <Switch
                    value={form.isDefault}
                    onValueChange={(v) => setForm((p) => ({ ...p, isDefault: v }))}
                    testID="ev-order-fee-field-default"
                  />
                </View>

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
                    testID="ev-order-fee-field-active"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="ev-order-fee-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Order Fee"}
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
                testID="ev-order-fee-country-search"
              />
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {countryList.map((name) => {
                const selected = name === form.country;
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => selectCountry(name)}
                    style={[styles.countryRow, { borderBottomColor: Colors.border }]}
                    testID={`ev-order-fee-country-${name}`}
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

/**
 * Resolve an order fee for a given country from a list of order-fee entries.
 * Falls back to the default-flagged entry, otherwise the Malaysia seed defaults.
 */
export function resolveOrderFee(
  entries: SettingEntry[],
  country: string | undefined,
): { amount: number; currency: string; country: string } {
  const list = entries.filter((e) => e.values.active !== false);
  const norm = (s: string) => s.trim().toLowerCase();
  const byCountry = country
    ? list.find((e) => norm(String(e.values.country ?? "")) === norm(country))
    : null;
  const def = list.find((e) => e.values.isDefault);
  const malaysia = list.find(
    (e) => norm(String(e.values.country ?? "")) === norm(DEFAULT_ORDER_FEE_COUNTRY),
  );
  const picked = byCountry ?? def ?? malaysia ?? null;
  if (!picked) {
    return {
      amount: DEFAULT_ORDER_FEE_AMOUNT,
      currency: DEFAULT_ORDER_FEE_CURRENCY,
      country: DEFAULT_ORDER_FEE_COUNTRY,
    };
  }
  return {
    amount: Number(picked.values.amount ?? DEFAULT_ORDER_FEE_AMOUNT) || DEFAULT_ORDER_FEE_AMOUNT,
    currency: String(picked.values.currency ?? DEFAULT_ORDER_FEE_CURRENCY) || DEFAULT_ORDER_FEE_CURRENCY,
    country: String(picked.values.country ?? DEFAULT_ORDER_FEE_COUNTRY) || DEFAULT_ORDER_FEE_COUNTRY,
  };
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
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  defaultPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  defaultPillText: { fontSize: 11, fontWeight: "800" as const },
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
    gap: 12,
  },
  toggleSub: { fontSize: 11 },
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
