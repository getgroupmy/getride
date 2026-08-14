import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { useColors } from "@/hooks/useColors";
import {
  fetchUserProfile,
  findOrCreatePartner,
  patchPartner,
  type PartnerProfileRow,
} from "@/utils/partnerOnboardingStore";

/**
 * Partner sign-up.
 *
 * The details a dispatcher needs before a driver can be sent a request: who
 * they are, how to reach them, and what they drive. Document upload and
 * verification are a separate surface with their own storage buckets and admin
 * review queue — they are not folded in here, and a partner created by this
 * screen is not verified by it.
 */
export default function PartnerOnboarding() {
  const colors = useColors();
  const { authState } = useAuth();

  const [partner, setPartner] = useState<PartnerProfileRow | null>(null);
  const [name, setName] = useState("");
  const [ic, setIc] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const userId = authState.userId;
      if (!userId) {
        if (!cancelled) setLoading(false);
        return;
      }
      const profile = await fetchUserProfile(userId);
      const row = await findOrCreatePartner(userId, profile);
      if (cancelled) return;
      setPartner(row);
      setName(row?.name ?? profile?.name ?? authState.profileName ?? "");
      setIc(row?.ic ?? "");
      setAddress(row?.address ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authState.userId, authState.profileName]);

  const save = async () => {
    if (!partner || saving) return;
    if (name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await patchPartner(partner.id, {
      name: name.trim(),
      ic: ic.trim() || null,
      address: address.trim() || null,
      onboarding_step: "requirements",
    });
    setSaving(false);
    if (!ok) {
      setError("We couldn't save those details. Please try again.");
      return;
    }
    router.replace("/partner-ehailing");
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!partner) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>Couldn&apos;t start sign-up</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          We couldn&apos;t reach the server. Please try again in a moment.
        </Text>
      </View>
    );
  }

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    multiline = false
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multiline,
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
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]}>Drive with GET.ride</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Tell us who you are. You&apos;ll upload your licence and permit before you can be
          verified.
        </Text>

        {field("Full name", name, setName, "As it appears on your IC")}
        {field("IC / ID number", ic, setIc, "Optional for now")}
        {field("Address", address, setAddress, "Where you're based", true)}

        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save and continue"
          onPress={save}
          disabled={saving}
          style={[styles.cta, { backgroundColor: saving ? colors.border : colors.primary }]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.ctaText, { color: colors.onAccent }]}>Save and continue</Text>
          )}
        </Pressable>

        <Text style={[styles.note, { color: colors.subtext }]}>
          Document upload and verification are handled separately — an admin reviews them before
          your account goes live.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  body: { padding: 24, gap: 14 },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 15, marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  error: { fontSize: 13 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  ctaText: { fontSize: 16, fontWeight: "700" },
  note: { fontSize: 13, lineHeight: 18 },
});
