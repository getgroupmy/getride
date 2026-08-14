import { router, useLocalSearchParams } from "expo-router";
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

export default function OtpVerify() {
  const colors = useColors();
  const { verifyOtp, sendOtp } = useAuth();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (code.length < 6 || busy || !phone) return;
    setBusy(true);
    setError(null);
    const res = await verifyOtp(phone, code);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? "That code did not work.");
      return;
    }
    // A fresh session with no PIN yet goes on to set one; the PIN screen
    // decides for itself whether it is needed.
    router.replace("/pin-setup");
  };

  const resend = async () => {
    if (!phone || busy) return;
    setBusy(true);
    const res = await sendOtp(phone, true);
    setBusy(false);
    setError(res.ok ? null : (res.message ?? "Could not resend the code."));
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Enter your code</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Sent to {phone ?? "your phone"}.
        </Text>

        <TextInput
          accessibilityLabel="Verification code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^\d]/g, "").slice(0, 6))}
          placeholder="000000"
          placeholderTextColor={colors.subtext}
          keyboardType="number-pad"
          autoFocus
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Verify code"
          onPress={submit}
          disabled={code.length < 6 || busy}
          style={[
            styles.cta,
            { backgroundColor: code.length === 6 && !busy ? colors.primary : colors.border },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Verify</Text>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" accessibilityLabel="Resend code" onPress={resend}>
          <Text style={[styles.link, { color: colors.primary }]}>Send it again</Text>
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
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
  },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  ctaText: { fontSize: 16, fontWeight: "700" },
  link: { fontSize: 14, textAlign: "center", marginTop: 8 },
});
