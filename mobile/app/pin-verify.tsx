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
import { markUnlocked } from "@/utils/appLock";

const PIN_LENGTH = 6;

/**
 * The app lock.
 *
 * Supabase persists the session, so a relaunch is already signed in — without
 * this screen, anyone holding an unlocked phone opens straight into a
 * signed-in wallet. Verification is server-side and rate limited (5 wrong
 * attempts, then a 15 minute lockout), and the lockout is reported with the
 * time remaining rather than as a generic refusal.
 *
 * There is deliberately no "skip". The only way past is the PIN or signing
 * out, which is a real choice rather than a bypass.
 */
export default function PinVerify() {
  const colors = useColors();
  const { authState, verifyPin, signOut } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);

  const submit = async () => {
    if (pin.length !== PIN_LENGTH || busy || !authState.phone) return;
    setBusy(true);
    setError(null);

    const res = await verifyPin(authState.phone, pin);
    setBusy(false);
    setPin("");

    if (!res.ok) {
      setError(res.message ?? "That PIN is not right.");
      if (res.lockedForSeconds != null) setLockedOut(true);
      return;
    }

    markUnlocked();
    router.replace((next && next.startsWith("/") ? next : "/welcome-back") as never);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Enter your PIN</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {authState.profileName
            ? `Welcome back, ${authState.profileName}.`
            : "Welcome back."}
        </Text>

        <TextInput
          accessibilityLabel="PIN"
          value={pin}
          onChangeText={(t) => setPin(t.replace(/[^\d]/g, "").slice(0, PIN_LENGTH))}
          placeholder="••••••"
          placeholderTextColor={colors.subtext}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          editable={!lockedOut}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />

        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unlock"
          onPress={submit}
          disabled={pin.length !== PIN_LENGTH || busy || lockedOut}
          style={[
            styles.cta,
            {
              backgroundColor:
                pin.length === PIN_LENGTH && !busy && !lockedOut
                  ? colors.primary
                  : colors.border,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Unlock</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={async () => {
            await signOut();
            router.replace("/phone-auth");
          }}
        >
          <Text style={[styles.link, { color: colors.primary }]}>Sign out instead</Text>
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
