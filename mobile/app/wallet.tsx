import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useColors } from "@/hooks/useColors";
import { rechargeCredit, topUpWallet } from "@/utils/walletStore";

type Sheet = "topup" | "recharge" | null;

/**
 * The three wallets.
 *
 * GET.wallet is the master balance and must stay non-negative. GET.credit pays
 * ride commission and *may* go negative — a driver owing commission is a normal
 * state, not an error, so it is shown plainly rather than flagged. GET.coin is
 * denominated in GC rather than currency, so it never carries a currency
 * symbol.
 */
export default function Wallet() {
  const colors = useColors();
  const { authState } = useAuth();
  const { balances, isLoading, refresh, apply } = useWallet();

  const [sheet, setSheet] = useState<Sheet>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const money = (v: number) => `${balances.currency} ${v.toFixed(2)}`;

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert("Enter an amount", "Please enter an amount greater than 0.");
      return;
    }
    if (!authState.userId) return;

    setBusy(true);
    const res =
      sheet === "topup"
        ? await topUpWallet(authState.userId, value, "Card")
        : await rechargeCredit(authState.userId, value);
    setBusy(false);

    if (!res.ok) {
      Alert.alert("That didn't go through", res.error ?? "Please try again.");
      return;
    }
    apply(res.balances);
    setSheet(null);
    setAmount("");
  };

  const card = (
    label: string,
    value: string,
    note: string,
    action?: { label: string; onPress: () => void }
  ) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.cardValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.cardNote, { color: colors.subtext }]}>{note}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={[styles.cardAction, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.cardActionText, { color: colors.onAccent }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />
      }
    >
      {balances.source === "local" ? (
        <View style={[styles.notice, { backgroundColor: colors.card, borderColor: colors.warning }]}>
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            Showing a saved copy — we couldn&apos;t reach the server, so these balances may be out
            of date.
          </Text>
        </View>
      ) : null}

      {card("GET.wallet", money(balances.getWallet), "Your main balance.", {
        label: "Top up",
        onPress: () => setSheet("topup"),
      })}

      {card(
        "GET.credit",
        money(balances.getCredit),
        balances.getCredit < 0
          ? "Commission owed. Recharge to clear it."
          : "Pays ride commission and in-app services.",
        { label: "Recharge", onPress: () => setSheet("recharge") }
      )}

      {card("GET.coin", `${balances.getCoin.toFixed(2)} GC`, "Earn on rides, spend on fares.")}

      {sheet ? (
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            {sheet === "topup" ? "Top up GET.wallet" : "Recharge GET.credit"}
          </Text>
          {sheet === "recharge" ? (
            <Text style={[styles.cardNote, { color: colors.subtext }]}>
              Moves money from GET.wallet into GET.credit.
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={colors.subtext}
            keyboardType="decimal-pad"
            autoFocus
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
          />
          <View style={styles.sheetRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => {
                setSheet(null);
                setAmount("");
              }}
              style={[styles.sheetBtn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.cardActionText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm"
              onPress={submit}
              disabled={busy}
              style={[styles.sheetBtn, { backgroundColor: busy ? colors.border : colors.primary }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={[styles.cardActionText, { color: colors.onAccent }]}>Confirm</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.links}>
        {[
          { label: "Buy or sell GET.coin", to: "/wallet-trade" },
          { label: "Send GET.coin", to: "/wallet-transfer" },
          { label: "Transaction history", to: "/wallet-history" },
        ].map((l) => (
          <Pressable
            key={l.to}
            accessibilityRole="button"
            accessibilityLabel={l.label}
            onPress={() => router.push(l.to as never)}
            style={[styles.link, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.linkText, { color: colors.text }]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12 },
  noticeText: { fontSize: 13, lineHeight: 18 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 4 },
  cardLabel: { fontSize: 13, fontWeight: "600" },
  cardValue: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  cardNote: { fontSize: 13 },
  cardAction: { borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 8 },
  cardActionText: { fontSize: 15, fontWeight: "700" },
  sheet: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 20,
  },
  sheetRow: { flexDirection: "row", gap: 10 },
  sheetBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  links: { gap: 10, marginTop: 4 },
  link: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16 },
  linkText: { fontSize: 15, fontWeight: "600" },
});
