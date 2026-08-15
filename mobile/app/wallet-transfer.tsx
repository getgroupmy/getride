import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useColors } from "@/hooks/useColors";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { requestCoinTransfer } from "@/utils/transferRequestsStore";

/**
 * Send GET.coin to another account.
 *
 * Sending does not move coins. It creates a *pending request* the recipient
 * must accept (migration 0065) — they get a push and an in-app popup naming
 * the sender and amount, and the coins move 1:1 only on acceptance. Requests
 * expire after 15 minutes.
 *
 * On a pre-0065 database the store falls back to the instant transfer RPC and
 * reports `immediate`, which is a materially different outcome for the sender
 * — so it is said plainly rather than described as "sent for approval".
 */
export default function WalletTransfer() {
  const { ready } = useRequireAuth();
  const colors = useColors();
  const { authState } = useAuth();
  const { balances, apply } = useWallet();

  const [phone, setPhone] = useState("");
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const amount = Number(coins);
  const valid = Number.isFinite(amount) && amount > 0 && phone.trim().length >= 6;

  const submit = async () => {
    if (!valid || !authState.userId || busy) return;
    if (amount > balances.getCoin) {
      Alert.alert("Not enough GET.coin", "You don't have that many coins.");
      return;
    }

    setBusy(true);
    const res = await requestCoinTransfer({
      fromUserId: authState.userId,
      toPhone: phone.trim(),
      coins: amount,
      note: note.trim() || undefined,
    });
    setBusy(false);

    if (!res.ok) {
      Alert.alert("Couldn't send", res.error ?? "Please try again.");
      return;
    }

    apply(res.balances);
    setCoins("");
    setNote("");

    const who = res.recipientName ?? phone.trim();
    Alert.alert(
      res.immediate ? "Coins sent" : "Request sent",
      res.immediate
        ? `${amount.toFixed(2)} GC sent to ${who}.`
        : `${who} has 15 minutes to accept. The coins move once they do.`
    );
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    keyboardType: "default" | "phone-pad" | "decimal-pad" = "default"
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        keyboardType={keyboardType}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </View>
  );


  // A deep link can mount this route without passing through the launch
  // buffer, so the screen answers for its own access.
  if (!ready) return null;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.balance, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>You have</Text>
          <Text style={[styles.balanceValue, { color: colors.text }]}>
            {balances.getCoin.toFixed(2)} GC
          </Text>
        </View>

        {field("Send to (phone)", phone, setPhone, "012 345 6789", "phone-pad")}
        {field("Coins (GC)", coins, setCoins, "0.00", "decimal-pad")}
        {field("Note", note, setNote, "Optional")}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send coins"
          onPress={submit}
          disabled={!valid || busy}
          style={[styles.cta, { backgroundColor: valid && !busy ? colors.primary : colors.border }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Send</Text>
          )}
        </Pressable>

        <Text style={[styles.footnote, { color: colors.subtext }]}>
          The person you send to has to accept before the coins move. If they don&apos;t within 15
          minutes, the request expires and nothing leaves your balance.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  balance: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 2,
  },
  balanceValue: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 17,
  },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
  footnote: { fontSize: 12, lineHeight: 17 },
});
