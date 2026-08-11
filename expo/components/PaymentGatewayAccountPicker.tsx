import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
} from "react-native";
import { CreditCard, ChevronDown, X, Search, Check, Inbox } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";
import { PAYMENT_GATEWAY_STORAGE_KEY } from "@/app/admin-settings-payment-gateway";

export interface SelectedGateway {
  id: string;
  providerId: string;
  providerName: string;
  accountName: string;
  mode: string;
}

interface Props {
  label?: string;
  value: SelectedGateway | null;
  onChange: (v: SelectedGateway | null) => void;
  required?: boolean;
  optional?: boolean;
  testID?: string;
  /** Optional helper text rendered below the field. */
  helperText?: string;
}

/**
 * Field that opens a modal to select a configured payment gateway account.
 * Reads accounts from the admin "payment-gateway" storage scope and only lists
 * active ones. Includes a "None" option when optional.
 */
export default function PaymentGatewayAccountPicker({
  label = "Payment Gateway Account",
  value,
  onChange,
  required,
  optional = true,
  testID,
  helperText,
}: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const entries = getEntries(PAYMENT_GATEWAY_STORAGE_KEY);

  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const accounts = useMemo<SelectedGateway[]>(() => {
    return entries
      .filter((e) => e.values.active !== false)
      .map((e) => ({
        id: e.id,
        providerId: String(e.values.providerId ?? ""),
        providerName: String(e.values.providerName ?? ""),
        accountName: String(e.values.accountName ?? ""),
        mode: String(e.values.mode ?? "Live"),
      }))
      .sort((a, b) =>
        a.providerName === b.providerName
          ? a.accountName.localeCompare(b.accountName)
          : a.providerName.localeCompare(b.providerName)
      );
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.providerName.toLowerCase().includes(q) ||
        a.accountName.toLowerCase().includes(q) ||
        a.mode.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  const display = value
    ? `${value.providerName} · ${value.accountName}${value.mode ? ` (${value.mode})` : ""}`
    : optional
      ? "None (skip)"
      : "Select gateway account";

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: Colors.textSecondary }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TouchableOpacity
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={[
          styles.inputWrap,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
        testID={testID ?? "payment-gateway-account-picker"}
        accessibilityRole="button"
      >
        <CreditCard color={Colors.textSecondary} size={16} />
        <Text
          numberOfLines={1}
          style={[
            styles.input,
            { color: value ? Colors.text : Colors.textSecondary, paddingLeft: 8 },
          ]}
        >
          {display}
        </Text>
        <ChevronDown color={Colors.textSecondary} size={16} />
      </TouchableOpacity>
      {helperText ? (
        <Text style={[styles.helper, { color: Colors.textSecondary }]} numberOfLines={2}>
          {helperText}
        </Text>
      ) : null}

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>
                Select Gateway Account
              </Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="payment-gateway-account-picker-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={20} />
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
                placeholder="Search provider or account"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                testID="payment-gateway-account-picker-search"
              />
            </View>

            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {optional ? (
                <TouchableOpacity
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  style={[styles.row, { borderBottomColor: Colors.border }]}
                  testID="payment-gateway-account-picker-none"
                  accessibilityRole="button"
                >
                  <View style={[styles.rowIcon, { backgroundColor: Colors.gray[100] }]}>
                    <X color={Colors.textSecondary} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]}>None</Text>
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                      Use default gateway / no specific account
                    </Text>
                  </View>
                  {value === null ? <Check color={Colors.accent} size={18} /> : null}
                </TouchableOpacity>
              ) : null}

              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Inbox color={Colors.textSecondary} size={26} />
                  <Text style={[styles.rowLabel, { color: Colors.text, marginTop: 8 }]}>
                    No gateway accounts
                  </Text>
                  <Text
                    style={[styles.rowDesc, { color: Colors.textSecondary, textAlign: "center" }]}
                  >
                    Add a gateway account first in Admin → Settings → Payment Gateways.
                  </Text>
                </View>
              ) : (
                filtered.map((a) => {
                  const selected = value?.id === a.id;
                  return (
                    <TouchableOpacity
                      key={a.id}
                      onPress={() => {
                        onChange(a);
                        setOpen(false);
                      }}
                      style={[styles.row, { borderBottomColor: Colors.border }]}
                      testID={`payment-gateway-account-picker-row-${a.id}`}
                      accessibilityRole="button"
                    >
                      <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                        <CreditCard color={Colors.accent} size={16} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                          {a.providerName}
                        </Text>
                        <Text
                          style={[styles.rowDesc, { color: Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {a.accountName} · {a.mode}
                        </Text>
                      </View>
                      {selected ? <Check color={Colors.accent} size={18} /> : null}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
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
  helper: { fontSize: 11, marginTop: 6 },
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
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  searchWrap: {
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
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowLabel: { fontSize: 14, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  empty: {
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: "center" as const,
    gap: 4,
  },
});
