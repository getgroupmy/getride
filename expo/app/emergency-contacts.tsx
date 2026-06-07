import React, { useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  HelpCircle,
  ChevronRight,
  ShieldAlert,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useEmergencyContacts, type EmergencyContact } from "@/contexts/EmergencyContactsContext";

function avatarIndex(id: string, len: number): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % len;
}

export default function EmergencyContactsScreen() {
  const router = useRouter();
  const Colors = useColors();

  const { contacts, isLoading } = useEmergencyContacts();

  const avatarPalette = useMemo(
    () => [Colors.accent, Colors.success, Colors.warning, Colors.economy, Colors.comfort],
    [Colors]
  );

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const openAdd = useCallback(() => {
    router.push("/emergency-contact-edit");
  }, [router]);

  const openEdit = useCallback(
    (c: EmergencyContact) => {
      router.push({
        pathname: "/emergency-contact-edit",
        params: { id: c.id, name: c.name, phone: c.phone },
      });
    },
    [router]
  );

  const isDark = Colors.background === "#000000";

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <SafeAreaView style={{ backgroundColor: Colors.background }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconButton} onPress={handleBack} testID="ec-back">
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Emergency Contacts</Text>
          <TouchableOpacity style={styles.iconButton} testID="ec-help">
            <HelpCircle color={Colors.textSecondary} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={[styles.topDivider, { backgroundColor: Colors.accent + "1A" }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: Colors.text }]}>
          If you use Emergency SOS, we&apos;ll share your details and live location with your saved
          contacts.
        </Text>

        {isLoading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : contacts.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: Colors.gray[100] }]}>
              <ShieldAlert color={Colors.textSecondary} size={28} />
            </View>
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No contacts yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Add someone you trust so they can be alerted in an emergency.
            </Text>
          </View>
        ) : (
          contacts.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.contactRow}
              onPress={() => openEdit(c)}
              testID={`ec-contact-${c.id}`}
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: avatarPalette[avatarIndex(c.id, avatarPalette.length)] + "22" },
                ]}
              >
                <Text
                  style={[
                    styles.avatarText,
                    { color: avatarPalette[avatarIndex(c.id, avatarPalette.length)] },
                  ]}
                >
                  {c.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.contactBody}>
                <Text style={[styles.contactName, { color: Colors.text }]}>{c.name}</Text>
                <Text style={[styles.contactPhone, { color: Colors.textSecondary }]}>{c.phone}</Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={22} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: Colors.success }]}
            onPress={openAdd}
            testID="ec-add"
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 22, fontWeight: "800", flex: 1, marginLeft: 4 },
  topDivider: { height: 2, width: "100%" },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 20, paddingHorizontal: 20 },
  intro: { fontSize: 16, lineHeight: 23, marginBottom: 24 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 20, fontWeight: "700" },
  contactBody: { flex: 1 },
  contactName: { fontSize: 18, fontWeight: "700", marginBottom: 3 },
  contactPhone: { fontSize: 15 },
  empty: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyDesc: { fontSize: 14, lineHeight: 20, textAlign: "center", paddingHorizontal: 20 },
  footer: { paddingHorizontal: 20, paddingVertical: 12 },
  addButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  addButtonText: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
});
