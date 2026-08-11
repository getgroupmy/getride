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
  CreditCard,
  ChevronRight,
  ChevronDown,
  Check,
  Star,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

export const PAYMENT_GATEWAY_STORAGE_KEY = "payment-gateway" as const;

/** Resolved gateway used by checkout/order flows. */
export interface ResolvedGateway {
  id: string;
  providerId: string;
  providerName: string;
  accountName: string;
  mode: "Live" | "Sandbox";
  isDefault: boolean;
}

import type { SettingEntry as _GW_SettingEntry } from "@/contexts/AdminDataContext";

/**
 * Pick the active default payment gateway from configured entries.
 * Falls back to the first active entry; returns null if nothing is configured.
 */
export function resolveDefaultGateway(
  entries: _GW_SettingEntry[],
): ResolvedGateway | null {
  const active = entries.filter((e) => e.values.active !== false);
  if (active.length === 0) return null;
  const picked = active.find((e) => e.values.isDefault) ?? active[0];
  const v = picked.values as Partial<AccountValues>;
  return {
    id: picked.id,
    providerId: String(v.providerId ?? ""),
    providerName: String(v.providerName ?? ""),
    accountName: String(v.accountName ?? ""),
    mode: (v.mode as "Live" | "Sandbox") ?? "Live",
    isDefault: Boolean(v.isDefault),
  };
}

/** Required credential field per gateway provider. */
interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

interface GatewayProvider {
  id: string;
  name: string;
  description: string;
  website?: string;
  modes: ("Live" | "Sandbox")[];
  fields: CredentialField[];
}

/**
 * Default provider catalog. Each provider lists the credential fields
 * required by their official SDKs.
 */
export const GATEWAY_PROVIDERS: GatewayProvider[] = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Cards, wallets and global payments",
    website: "https://stripe.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "publishableKey", label: "Publishable Key", placeholder: "pk_live_..." },
      { key: "secretKey", label: "Secret Key", placeholder: "sk_live_...", secret: true },
      { key: "webhookSecret", label: "Webhook Signing Secret", placeholder: "whsec_...", secret: true, optional: true },
      { key: "accountId", label: "Account ID", placeholder: "acct_...", optional: true },
    ],
  },
  {
    id: "fiuu",
    name: "Fiuu (Razer Merchant Services)",
    description: "Malaysian merchant payments (FPX, cards, e-wallets)",
    website: "https://fiuu.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "merchantId", label: "Merchant ID", placeholder: "Your merchant ID" },
      { key: "verifyKey", label: "Verify Key", placeholder: "Verify key", secret: true },
      { key: "secretKey", label: "Secret Key", placeholder: "Secret key", secret: true },
      { key: "callbackUrl", label: "Callback URL", placeholder: "https://...", optional: true },
    ],
  },
  {
    id: "adaptis",
    name: "ADAPTIS (iPay88 + eGHL)",
    description: "Unified gateway over iPay88 and eGHL",
    website: "https://adaptis.my",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "merchantCode", label: "Merchant Code", placeholder: "Merchant code" },
      { key: "merchantKey", label: "Merchant Key", placeholder: "Merchant key", secret: true },
      { key: "ipay88MerchantCode", label: "iPay88 Merchant Code", placeholder: "iPay88 merchant code", optional: true },
      { key: "eghlPaymentId", label: "eGHL Payment ID", placeholder: "eGHL payment ID", optional: true },
      { key: "eghlPassword", label: "eGHL Password", placeholder: "eGHL password", secret: true, optional: true },
    ],
  },
  {
    id: "senangpay",
    name: "SenangPay",
    description: "Malaysian card & FPX payments",
    website: "https://senangpay.my",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "merchantId", label: "Merchant ID", placeholder: "Merchant ID" },
      { key: "secretKey", label: "Secret Key", placeholder: "Secret key", secret: true },
    ],
  },
  {
    id: "billplz",
    name: "Billplz",
    description: "FPX, cards & e-wallets",
    website: "https://billplz.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "apiKey", label: "API Secret Key", placeholder: "Bearer key", secret: true },
      { key: "collectionId", label: "Collection ID", placeholder: "Collection ID" },
      { key: "xSignatureKey", label: "X-Signature Key", placeholder: "X-Signature key", secret: true, optional: true },
    ],
  },
  {
    id: "hitpay",
    name: "HitPay",
    description: "Cards, PayNow, GrabPay (SG/MY)",
    website: "https://hit-pay.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "API key", secret: true },
      { key: "salt", label: "Salt", placeholder: "Webhook salt", secret: true, optional: true },
    ],
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Global PayPal payments",
    website: "https://developer.paypal.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "PayPal client ID" },
      { key: "clientSecret", label: "Client Secret", placeholder: "PayPal secret", secret: true },
      { key: "webhookId", label: "Webhook ID", placeholder: "Webhook ID", optional: true },
    ],
  },
  {
    id: "airwallex",
    name: "Airwallex",
    description: "Global cards & APMs",
    website: "https://www.airwallex.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Airwallex client ID" },
      { key: "apiKey", label: "API Key", placeholder: "API key", secret: true },
      { key: "webhookSecret", label: "Webhook Secret", placeholder: "Webhook secret", secret: true, optional: true },
    ],
  },
  {
    id: "payhalal",
    name: "PayHalal",
    description: "Shariah-compliant payment gateway",
    website: "https://payhalal.my",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "merchantId", label: "Merchant ID", placeholder: "Merchant ID" },
      { key: "appId", label: "App ID", placeholder: "App ID" },
      { key: "secretKey", label: "Secret Key", placeholder: "Secret key", secret: true },
    ],
  },
  {
    id: "toyyibpay",
    name: "ToyyibPay",
    description: "Low-fee MY payment gateway (FPX, cards)",
    website: "https://toyyibpay.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "userSecretKey", label: "User Secret Key", placeholder: "User secret key", secret: true },
      { key: "categoryCode", label: "Category Code", placeholder: "Category code" },
    ],
  },
  {
    id: "paydibs",
    name: "Paydibs",
    description: "Multi-channel payments (cards, FPX, e-wallets)",
    website: "https://v3api-docs.paydibs.com",
    modes: ["Live", "Sandbox"],
    fields: [
      { key: "merchantId", label: "Merchant ID", placeholder: "Merchant ID" },
      { key: "merchantPassword", label: "Merchant Password", placeholder: "Merchant password", secret: true },
      { key: "paymentUrl", label: "Payment URL", placeholder: "https://..." },
      { key: "apiVersion", label: "API Version", placeholder: "3.8", optional: true },
    ],
  },
];

interface AccountValues {
  providerId: string;
  providerName: string;
  accountName: string;
  mode: "Live" | "Sandbox";
  active: boolean;
  isDefault: boolean;
  /** Per-field credentials, prefixed by provider id (e.g. "stripe_secretKey"). */
  [key: string]: string | number | boolean;
}

interface FormState {
  providerId: string;
  accountName: string;
  mode: "Live" | "Sandbox";
  active: boolean;
  isDefault: boolean;
  credentials: Record<string, string>;
}

const defaultForm = (provider?: GatewayProvider): FormState => ({
  providerId: provider?.id ?? "",
  accountName: "",
  mode: "Live",
  active: true,
  isDefault: false,
  credentials: {},
});

export default function AdminSettingsPaymentGatewayScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(PAYMENT_GATEWAY_STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [providerPickerOpen, setProviderPickerOpen] = useState<boolean>(false);
  const [revealMap, setRevealMap] = useState<Record<string, boolean>>({});

  const providerById = useMemo(() => {
    const map: Record<string, GatewayProvider> = {};
    GATEWAY_PROVIDERS.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, []);

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const ap = String(a.values.providerName ?? "");
        const bp = String(b.values.providerName ?? "");
        if (ap !== bp) return ap.localeCompare(bp);
        return String(a.values.accountName ?? "").localeCompare(
          String(b.values.accountName ?? "")
        );
      }),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((e) => {
      if (providerFilter && e.values.providerId !== providerFilter) return false;
      if (!q) return true;
      return Object.values(e.values).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [sorted, query, providerFilter]);

  const openAddForProvider = (provider: GatewayProvider) => {
    setEditing(null);
    setForm(defaultForm(provider));
    setProviderPickerOpen(false);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const v = entry.values as Partial<AccountValues>;
    const providerId = String(v.providerId ?? "");
    const provider = providerById[providerId];
    const credentials: Record<string, string> = {};
    if (provider) {
      provider.fields.forEach((f) => {
        const val = v[`${provider.id}_${f.key}`];
        credentials[f.key] = val != null ? String(val) : "";
      });
    }
    setEditing(entry);
    setForm({
      providerId,
      accountName: String(v.accountName ?? ""),
      mode: (v.mode as "Live" | "Sandbox") ?? "Live",
      active: Boolean(v.active ?? true),
      isDefault: Boolean(v.isDefault ?? false),
      credentials,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setRevealMap({});
  };

  const onSave = () => {
    if (!guard()) return;
    const provider = providerById[form.providerId];
    if (!provider) {
      Alert.alert("Missing field", "Please select a payment gateway provider.");
      return;
    }
    if (!form.accountName.trim()) {
      Alert.alert("Missing field", "Please enter an account name to identify this configuration.");
      return;
    }
    const missing = provider.fields.find(
      (f) => !f.optional && !(form.credentials[f.key] ?? "").trim()
    );
    if (missing) {
      Alert.alert("Missing credential", `Please fill in “${missing.label}”.`);
      return;
    }

    const values: Record<string, string | number | boolean> = {
      providerId: provider.id,
      providerName: provider.name,
      accountName: form.accountName.trim(),
      mode: form.mode,
      active: form.active,
      isDefault: form.isDefault,
    };
    provider.fields.forEach((f) => {
      values[`${provider.id}_${f.key}`] = (form.credentials[f.key] ?? "").trim();
    });

    if (editing) {
      updateEntry(PAYMENT_GATEWAY_STORAGE_KEY, editing.id, { ...editing.values, ...values });
    } else {
      addEntry(PAYMENT_GATEWAY_STORAGE_KEY, values);
    }
    if (form.isDefault) {
      entries.forEach((e) => {
        if (e.id === editing?.id) return;
        if (e.values.isDefault) {
          updateEntry(PAYMENT_GATEWAY_STORAGE_KEY, e.id, { ...e.values, isDefault: false });
        }
      });
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert(
      "Delete",
      `Remove ${entry.values.providerName} (${entry.values.accountName})?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => removeEntry(PAYMENT_GATEWAY_STORAGE_KEY, entry.id),
        },
      ]
    );
  };

  const selectedProvider = providerById[form.providerId];

  const accountsByProvider = useMemo(() => {
    const map: Record<string, number> = {};
    entries.forEach((e) => {
      const id = String(e.values.providerId ?? "");
      map[id] = (map[id] ?? 0) + 1;
    });
    return map;
  }, [entries]);

  const stats = useMemo(() => {
    const total = entries.length;
    const active = entries.filter((e) => e.values.active !== false).length;
    const live = entries.filter((e) => String(e.values.mode ?? "Live") === "Live").length;
    const defaultEntry = entries.find((e) => e.values.isDefault);
    return {
      total,
      active,
      live,
      defaultName: defaultEntry ? String(defaultEntry.values.providerName ?? "") : null,
    };
  }, [entries]);

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
          testID="payment-gateway-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <CreditCard color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Payment Gateways
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Configure provider accounts & credentials
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setProviderPickerOpen(true)}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="payment-gateway-add"
          accessibilityRole="button"
          accessibilityLabel="Add payment gateway"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search account or provider"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="payment-gateway-search"
          accessibilityLabel="Search account or provider"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.providerChips}
        style={styles.providerChipsScroll}
      >
        <TouchableOpacity
          onPress={() => setProviderFilter(null)}
          style={[
            styles.chip,
            {
              backgroundColor: providerFilter === null ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          testID="payment-gateway-filter-all"
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.chipText,
              { color: providerFilter === null ? Colors.onAccent : Colors.text },
            ]}
          >
            All ({entries.length})
          </Text>
        </TouchableOpacity>
        {GATEWAY_PROVIDERS.map((p) => {
          const active = providerFilter === p.id;
          const count = accountsByProvider[p.id] ?? 0;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => setProviderFilter(active ? null : p.id)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? Colors.accent : Colors.gray[100],
                  borderColor: Colors.border,
                },
              ]}
              testID={`payment-gateway-filter-${p.id}`}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? Colors.onAccent : Colors.text },
                ]}
                numberOfLines={1}
              >
                {p.name}
                {count > 0 ? `  ·  ${count}` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {entries.length > 0 ? (
          <View style={styles.statsRow}>
            <View style={[styles.statCard, styles.cardShadow, { backgroundColor: Colors.card ?? Colors.background, borderColor: Colors.border }]}>
              <Text style={[styles.statValue, { color: Colors.text }]}>{stats.total}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Configured</Text>
            </View>
            <View style={[styles.statCard, styles.cardShadow, { backgroundColor: Colors.card ?? Colors.background, borderColor: Colors.border }]}>
              <Text style={[styles.statValue, { color: Colors.successText ?? "#10B981" }]}>{stats.active}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Active</Text>
            </View>
            <View style={[styles.statCard, styles.cardShadow, { backgroundColor: Colors.card ?? Colors.background, borderColor: Colors.border }]}>
              <Text style={[styles.statValue, { color: Colors.accentText }]}>{stats.live}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Live mode</Text>
            </View>
          </View>
        ) : null}
        {stats.defaultName ? (
          <View style={[styles.defaultBanner, { backgroundColor: Colors.accent + "14", borderColor: Colors.accent + "40" }]}>
            <Star color={Colors.accentText} size={14} />
            <Text style={[styles.defaultBannerText, { color: Colors.text }]} numberOfLines={1}>
              <Text style={{ color: Colors.textSecondary }}>Default gateway:  </Text>
              {stats.defaultName}
            </Text>
          </View>
        ) : null}
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No gateways configured</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to set up Stripe, Fiuu, PayPal and more.
            </Text>
            <TouchableOpacity
              onPress={() => setProviderPickerOpen(true)}
              style={[styles.emptyAction, { backgroundColor: Colors.accent }]}
              testID="payment-gateway-empty-add"
              accessibilityRole="button"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.emptyActionText, { color: Colors.onAccent }]}>
                Add Gateway
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e) => {
            const v = e.values;
            const providerName = String(v.providerName ?? "");
            const accountName = String(v.accountName ?? "");
            const mode = String(v.mode ?? "Live");
            const isDefault = Boolean(v.isDefault);
            const active = Boolean(v.active ?? true);
            return (
              <TouchableOpacity
                key={e.id}
                style={[
                  styles.row,
                  styles.cardShadow,
                  {
                    backgroundColor: Colors.card ?? Colors.background,
                    borderColor: isDefault ? Colors.accent + "55" : Colors.border,
                    opacity: active ? 1 : 0.6,
                  },
                ]}
                onPress={() => openEdit(e)}
                activeOpacity={0.85}
                testID={`payment-gateway-row-${e.id}`}
                accessibilityRole="button"
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <CreditCard color={Colors.accentText} size={18} />
                </View>
                <View style={styles.rowInfo}>
                  <View style={styles.rowTitleLine}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                      {providerName}
                    </Text>
                    {isDefault ? (
                      <View style={[styles.pill, { backgroundColor: Colors.accent }]}>
                        <Star color={Colors.onAccent} size={10} />
                        <Text style={[styles.pillText, { color: Colors.onAccent }]}>Default</Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.pill,
                        {
                          backgroundColor:
                            mode === "Live"
                              ? (Colors.success ?? "#10B981") + "30"
                              : (Colors.warning ?? "#F59E0B") + "30",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          {
                            color:
                              mode === "Live"
                                ? Colors.success ?? "#10B981"
                                : Colors.warning ?? "#F59E0B",
                          },
                        ]}
                      >
                        {mode}
                      </Text>
                    </View>
                    {!active ? (
                      <View
                        style={[styles.pill, { backgroundColor: Colors.textSecondary + "30" }]}
                      >
                        <Text style={[styles.pillText, { color: Colors.textSecondary }]}>
                          Inactive
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {accountName}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`payment-gateway-edit-${e.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Edit payment gateway"
                >
                  <Pencil color={Colors.accentText} size={16} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDelete(e)}
                  style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                  testID={`payment-gateway-delete-${e.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Delete payment gateway"
                >
                  <Trash2 color={Colors.errorText} size={16} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Provider picker */}
      <Modal
        visible={providerPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setProviderPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>Select Gateway</Text>
              <TouchableOpacity
                onPress={() => setProviderPickerOpen(false)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                accessibilityRole="button"
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {GATEWAY_PROVIDERS.map((p) => {
                const count = accountsByProvider[p.id] ?? 0;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => openAddForProvider(p)}
                    style={[styles.providerRow, { borderBottomColor: Colors.border }]}
                    testID={`payment-gateway-provider-${p.id}`}
                    accessibilityRole="button"
                  >
                    <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                      <CreditCard color={Colors.accentText} size={18} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {p.description}
                      </Text>
                    </View>
                    {count > 0 ? (
                      <View style={[styles.pill, { backgroundColor: Colors.gray[100] }]}>
                        <Text style={[styles.pillText, { color: Colors.text }]}>
                          {count} account{count === 1 ? "" : "s"}
                        </Text>
                      </View>
                    ) : null}
                    <ChevronRight color={Colors.textSecondary} size={18} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add/edit form */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={[styles.grabber, { backgroundColor: Colors.border }]} />
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleWrap}>
                  <View style={[styles.modalHeaderIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <CreditCard color={Colors.accentText} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: Colors.text }]} numberOfLines={1}>
                      {editing ? "Edit Gateway" : `Add ${selectedProvider?.name ?? "Gateway"}`}
                    </Text>
                    {selectedProvider ? (
                      <Text style={[styles.modalHeaderSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                        {selectedProvider.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  accessibilityRole="button"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 540 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Provider</Text>
                  <TouchableOpacity
                    onPress={() => setProviderPickerOpen(true)}
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                    testID="payment-gateway-field-provider"
                    disabled={!!editing}
                    accessibilityRole="button"
                  >
                    <CreditCard color={Colors.textSecondary} size={16} />
                    <Text
                      style={[
                        styles.input,
                        {
                          color: selectedProvider ? Colors.text : Colors.textSecondary,
                          paddingLeft: 8,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {selectedProvider?.name ?? "Select provider"}
                    </Text>
                    {!editing ? <ChevronDown color={Colors.textSecondary} size={16} /> : null}
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Account name *</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.accountName}
                      onChangeText={(t) => setForm((p) => ({ ...p, accountName: t }))}
                      placeholder="e.g. Stripe MY Live"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="payment-gateway-field-account-name"
                      accessibilityLabel="Account name *"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Mode</Text>
                  <View style={styles.segment}>
                    {(["Live", "Sandbox"] as const).map((m) => {
                      const active = form.mode === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setForm((p) => ({ ...p, mode: m }))}
                          style={[
                            styles.segmentItem,
                            {
                              backgroundColor: active ? Colors.accent : Colors.gray[100],
                              borderColor: Colors.border,
                            },
                          ]}
                          testID={`payment-gateway-field-mode-${m.toLowerCase()}`}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[
                              styles.segmentText,
                              { color: active ? Colors.onAccent : Colors.text },
                            ]}
                          >
                            {m}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {selectedProvider ? (
                  <View style={{ marginTop: 4 }}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={[styles.sectionLabel, { color: Colors.text }]}>
                        Credentials
                      </Text>
                      <View style={[styles.sectionCount, { backgroundColor: Colors.accent + "18" }]}>
                        <Text style={[styles.sectionCountText, { color: Colors.accentText }]}>
                          {selectedProvider.fields.length} fields
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.credentialsCard,
                        styles.cardShadow,
                        { backgroundColor: Colors.card ?? Colors.background, borderColor: Colors.border },
                      ]}
                    >
                    {selectedProvider.fields.map((f, fi) => {
                      const value = form.credentials[f.key] ?? "";
                      const reveal = !!revealMap[f.key];
                      const isLast = fi === selectedProvider.fields.length - 1;
                      return (
                        <View
                          key={f.key}
                          style={[
                            styles.credentialItem,
                            !isLast ? { borderBottomColor: Colors.border, borderBottomWidth: 1 } : null,
                          ]}
                        >
                          <View style={styles.credentialLabelRow}>
                            <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                              {f.label}
                            </Text>
                            {!f.optional ? (
                              <Text style={[styles.requiredDot, { color: Colors.errorText }]}>*</Text>
                            ) : (
                              <Text style={[styles.optionalTag, { color: Colors.textSecondary }]}>Optional</Text>
                            )}
                          </View>
                          <View
                            style={[
                              styles.inputWrap,
                              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                            ]}
                          >
                            <TextInput
                              value={value}
                              onChangeText={(t) =>
                                setForm((p) => ({
                                  ...p,
                                  credentials: { ...p.credentials, [f.key]: t },
                                }))
                              }
                              placeholder={f.placeholder}
                              placeholderTextColor={Colors.textSecondary}
                              secureTextEntry={!!f.secret && !reveal}
                              autoCapitalize="none"
                              autoCorrect={false}
                              style={[styles.input, { color: Colors.text }]}
                              testID={`payment-gateway-field-${f.key}`}
                              accessibilityLabel={f.label}
                            />
                            {f.secret ? (
                              <TouchableOpacity
                                onPress={() =>
                                  setRevealMap((m) => ({ ...m, [f.key]: !m[f.key] }))
                                }
                                style={styles.eyeBtn}
                                testID={`payment-gateway-reveal-${f.key}`}
                                accessibilityRole="button"
                                accessibilityLabel="Show or hide the value"
                              >
                                {reveal ? (
                                  <EyeOff color={Colors.textSecondary} size={16} />
                                ) : (
                                  <Eye color={Colors.textSecondary} size={16} />
                                )}
                              </TouchableOpacity>
                            ) : (
                              <Copy color={Colors.textSecondary + "00"} size={16} />
                            )}
                          </View>
                        </View>
                      );
                    })}
                    </View>
                  </View>
                ) : null}

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Default gateway
                    </Text>
                    <Text style={[styles.toggleSub, { color: Colors.textSecondary }]}>
                      Used when no specific gateway is selected.
                    </Text>
                  </View>
                  <Switch
                    value={form.isDefault}
                    onValueChange={(v) => setForm((p) => ({ ...p, isDefault: v }))}
                    testID="payment-gateway-field-default"
                    accessibilityLabel="Default gateway"
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
                    testID="payment-gateway-field-active"
                    accessibilityLabel="Active"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="payment-gateway-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add gateway"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Silence unused-import warnings for icons reserved for future use.
const _Check = Check;
const _useEffect = useEffect;
void _Check;
void _useEffect;

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
  providerChipsScroll: { flexGrow: 0, flexShrink: 0 },
  providerChips: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "700" as const },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  statsRow: { flexDirection: "row" as const, gap: 10, marginTop: 8, marginBottom: 2 },
  statCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: "900" as const },
  statLabel: { fontSize: 11, fontWeight: "600" as const },
  defaultBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 2,
  },
  defaultBannerText: { flex: 1, fontSize: 13, fontWeight: "800" as const },
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
  rowTitleLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexWrap: "wrap" as const,
  },
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
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
  emptyAction: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
  },
  emptyActionText: { fontSize: 13, fontWeight: "800" as const },
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
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: "center" as const,
    marginBottom: 14,
  },
  modalTitleWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    flex: 1,
    marginRight: 12,
  },
  modalHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  modalHeaderSub: { fontSize: 12, marginTop: 2 },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const, flex: 1, marginRight: 12 },
  sectionLabel: { fontSize: 13, fontWeight: "800" as const },
  sectionHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sectionCountText: { fontSize: 11, fontWeight: "800" as const },
  credentialsCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  credentialItem: { paddingVertical: 12 },
  credentialLabelRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 6,
  },
  requiredDot: { fontSize: 13, fontWeight: "800" as const },
  optionalTag: { fontSize: 10, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.4 },
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
  eyeBtn: { paddingHorizontal: 6, height: 32, justifyContent: "center" as const },
  segment: {
    flexDirection: "row" as const,
    gap: 8,
  },
  segmentItem: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  segmentText: { fontSize: 13, fontWeight: "800" as const },
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
  providerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
});
