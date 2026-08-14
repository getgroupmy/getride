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

const PIN_LENGTH = 6;

export default function PinSetup() {
  const colors = useColors();
  const { setPin } = useAuth();

  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = pin.length === PIN_LENGTH && confirm.length === PIN_LENGTH;
  const matches = pin === confirm;

  const submit = async () => {
    if (!complete || busy) return;
    if (!matches) {
      setError("Those two PINs are different.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setPin(pin);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? "Could not save your PIN.");
      return;
    }
    router.replace("/");
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoFocus = false
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^\d]/g, "").slice(0, PIN_LENGTH))}
        placeholder="••••••"
        placeholderTextColor={colors.subtext}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus={autoFocus}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Choose a PIN</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Six digits. You&apos;ll use it to sign in from now on.
        </Text>

        {field("PIN", pin, setPinValue, true)}
        {field("Confirm PIN", confirm, setConfirm)}

        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save PIN"
          onPress={submit}
          disabled={!complete || busy}
          style={[
            styles.cta,
            { backgroundColor: complete && !busy ? colors.primary : colors.border },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Save PIN</Text>
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
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    letterSpacing: 6,
  },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
