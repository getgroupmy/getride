import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

/** Digits only, kept in E.164 so Supabase accepts it. */
function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return "";
  // A leading 0 is the local trunk prefix; Malaysia is +60.
  if (digits.startsWith("0")) return `+60${digits.slice(1)}`;
  if (digits.startsWith("60")) return `+${digits}`;
  return `+${digits}`;
}

export default function PhoneAuth() {
  const colors = useColors();
  const { sendOtp } = useAuth();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone = normalizePhone(raw);
  const valid = phone.length >= 8;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendOtp(phone, true);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? "Could not send the code.");
      return;
    }
    router.push({ pathname: "/otp-verify", params: { phone } });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>What&apos;s your number?</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          We&apos;ll text you a code to sign in.
        </Text>

        <TextInput
          accessibilityLabel="Phone number"
          value={raw}
          onChangeText={setRaw}
          placeholder="012 345 6789"
          placeholderTextColor={colors.subtext}
          keyboardType="phone-pad"
          autoFocus
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
        {phone ? (
          <Text style={[styles.hint, { color: colors.subtext }]}>Sending to {phone}</Text>
        ) : null}
        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send code"
          onPress={submit}
          disabled={!valid || busy}
          style={[
            styles.cta,
            { backgroundColor: valid && !busy ? colors.primary : colors.border },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Send code</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 15, marginBottom: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
  },
  hint: { fontSize: 13 },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
