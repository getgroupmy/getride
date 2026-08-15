import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  MAX_EMERGENCY_CONTACTS,
  addContact,
  fetchContacts,
  removeContact,
  type EmergencyContact,
} from "@/utils/emergencyContactsStore";

/**
 * Emergency SOS contacts.
 *
 * Rows are owner-scoped, so a failed write is surfaced rather than swallowed —
 * a contact the rider believes is saved but is not would only be discovered in
 * the moment it was needed.
 */
export default function EmergencyContacts() {
  const { ready } = useRequireAuth();
  const colors = useColors();
  const { authState } = useAuth();

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authState.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setContacts(await fetchContacts(authState.userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your contacts.");
    } finally {
      setLoading(false);
    }
  }, [authState.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!authState.userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addContact(authState.userId, { name, phone }, contacts);
      setContacts((prev) => [...prev, created]);
      setName("");
      setPhone("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That contact was not saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: EmergencyContact) => {
    Alert.alert("Remove contact?", `${c.name} will no longer be an SOS contact.`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await removeContact(c.id);
            setContacts((prev) => prev.filter((x) => x.id !== c.id));
          } catch (e) {
            setError(e instanceof Error ? e.message : "That contact was not removed.");
          }
        },
      },
    ]);
  };


  // A deep link can mount this route without passing through the launch
  // buffer, so the screen answers for its own access.
  if (!ready) return null;
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        People we can reach if you raise an SOS during a ride. Up to{" "}
        {MAX_EMERGENCY_CONTACTS}.
      </Text>

      {contacts.map((c) => (
        <View
          key={c.id}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.cardMain}>
            <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
            <Text style={[styles.phone, { color: colors.textSecondary }]}>{c.phone}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${c.name}`}
            onPress={() => void Linking.openURL(`tel:${c.phone}`)}
            style={[styles.smallBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.smallBtnText, { color: colors.text }]}>Call</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${c.name}`}
            onPress={() => remove(c)}
            style={[styles.smallBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.smallBtnText, { color: colors.error }]}>Remove</Text>
          </Pressable>
        </View>
      ))}

      {contacts.length === 0 ? (
        <Text style={[styles.intro, { color: colors.subtext }]}>
          No contacts saved yet.
        </Text>
      ) : null}

      {contacts.length < MAX_EMERGENCY_CONTACTS ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
          <Text style={[styles.name, { color: colors.text }]}>Add a contact</Text>
          <TextInput
            accessibilityLabel="Contact name"
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.subtext}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          <TextInput
            accessibilityLabel="Contact phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.subtext}
            keyboardType="phone-pad"
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save contact"
            onPress={add}
            disabled={busy}
            style={[styles.cta, { backgroundColor: busy ? colors.border : colors.primary }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.onAccent }]}>Save contact</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 14, lineHeight: 20 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  cardMain: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: "700" },
  phone: { fontSize: 13 },
  smallBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  smallBtnText: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  cta: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  ctaText: { fontSize: 15, fontWeight: "700" },
  error: { fontSize: 13 },
});
