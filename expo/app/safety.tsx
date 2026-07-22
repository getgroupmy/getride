import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Switch,
  Linking,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Users, Mic, ShieldCheck, Siren, ChevronRight, Plus } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useEmergencyContacts } from "@/contexts/EmergencyContactsContext";
import { useVoiceProtection } from "@/contexts/VoiceProtectionContext";

const AVATAR_COLORS = ["#DCFCE7", "#DBEAFE", "#FEF3C7", "#FCE7F3", "#EDE9FE"];

function avatarColor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

const PRIVACY_URL = "https://www.getride.app/privacy";

export default function SafetyScreen() {
  const router = useRouter();
  const Colors = useColors();

  const { contacts, isLoading } = useEmergencyContacts();
  const { enabled: voiceProtection, setEnabled: setVoiceProtection } = useVoiceProtection();

  const [alertContacts, setAlertContacts] = useState<boolean>(true);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const openPrivacy = useCallback(() => {
    Linking.openURL(PRIVACY_URL).catch(() => {});
  }, []);

  const triggerSos = useCallback(() => {
    if (contacts.length === 0) {
      Alert.alert(
        "No emergency contacts",
        "Add at least one trusted contact before using Emergency SOS.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Add contact", onPress: () => router.push("/emergency-contacts" as any) },
        ]
      );
      return;
    }
    const names = contacts.map((c) => c.name).join(", ");
    Alert.alert(
      "Send Emergency SOS?",
      `We'll alert ${contacts.length} contact${contacts.length > 1 ? "s" : ""} (${names}) with your details and live location.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send SOS",
          style: "destructive",
          onPress: () => {
            const numbers = contacts.map((c) => c.phone.replace(/[^+\d]/g, "")).join(",");
            const body = encodeURIComponent(
              "EMERGENCY: I need help. This is an automated SOS alert sent from the GET.ride app. Please contact me immediately."
            );
            const sep = Platform.OS === "ios" ? "&" : "?";
            Linking.openURL(`sms:${numbers}${sep}body=${body}`).catch(() => {
              Alert.alert("Couldn't open Messages", "Please contact your emergency contacts directly.");
            });
          },
        },
      ]
    );
  }, [contacts, router]);

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      <SafeAreaView style={{ backgroundColor: Colors.background }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack} testID="safety-back">
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Safety Settings</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Alert Emergency Contacts */}
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: Colors.gray[100] }]}>
            <Users color={Colors.text} size={22} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: Colors.text }]}>Alert Emergency Contacts</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When checked, SMS will be sent to your Emergency Contacts in case of an emergency.
            </Text>
            {!(alertContacts && !isLoading && contacts.length === 0) ? (
              <TouchableOpacity onPress={() => router.push("/emergency-contacts" as any)}>
                <Text style={[styles.link, { color: Colors.accent }]}>Manage Emergency Contacts</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Switch
            value={alertContacts}
            onValueChange={setAlertContacts}
            trackColor={{ false: Colors.gray[200], true: Colors.success }}
            thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
            testID="safety-alert-contacts"
          />
        </View>

        {/* Saved contacts preview */}
        {alertContacts ? (
          <View style={styles.contactsBlock}>
            {isLoading ? (
              <View style={styles.contactsLoading}>
                <ActivityIndicator color={Colors.accent} />
              </View>
            ) : contacts.length === 0 ? (
              <TouchableOpacity
                style={[styles.addContactRow, { borderColor: Colors.border }]}
                onPress={() => router.push("/emergency-contacts" as any)}
                testID="safety-add-contact"
              >
                <View style={[styles.addContactIcon, { backgroundColor: Colors.accent + "1A" }]}>
                  <Plus color={Colors.accent} size={20} />
                </View>
                <Text style={[styles.addContactText, { color: Colors.text }]}>
                  Add a trusted contact
                </Text>
                <ChevronRight color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.divider, { backgroundColor: Colors.border }]} />

        {/* VoiceProtection */}
        <View style={styles.row}>
          <View style={[styles.iconWrap, { backgroundColor: Colors.gray[100] }]}>
            <Mic color={Colors.text} size={22} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: Colors.text }]}>Enable VoiceProtection</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When on, trip audio is recorded with your device microphone once a ride starts. Recordings are stored privately on your device for 24 hours and are never accessible to you. They are only sent to our team if you open a support ticket about a ride and an agent requests them.
            </Text>
            <TouchableOpacity onPress={openPrivacy}>
              <Text style={[styles.link, { color: Colors.accent }]}>Learn more</Text>
            </TouchableOpacity>
          </View>
          <Switch
            value={voiceProtection}
            onValueChange={(v) => { void setVoiceProtection(v); }}
            trackColor={{ false: Colors.gray[200], true: Colors.success }}
            thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
            testID="safety-voice-protection"
          />
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.sosWrap}>
          <TouchableOpacity
            style={[styles.sosButton, { backgroundColor: Colors.error }]}
            onPress={triggerSos}
            activeOpacity={0.85}
            testID="safety-sos"
          >
            <Siren color="#FFFFFF" size={22} />
            <Text style={styles.sosText}>Emergency SOS</Text>
          </TouchableOpacity>
          {contacts.length > 0 ? (
            <Text style={[styles.sosHint, { color: Colors.textSecondary }]}>
              Alerts {contacts.length} saved contact{contacts.length > 1 ? "s" : ""}
            </Text>
          ) : null}
        </View>
        <View style={[styles.consent, { borderTopColor: Colors.border }]}>
          <ShieldCheck color={Colors.textSecondary} size={18} />
          <Text style={[styles.consentText, { color: Colors.textSecondary }]}>
            My passenger(s) and I agree to the processing of personal data for VoiceProtection, and in accordance with{" "}
            <Text style={{ color: Colors.accent }} onPress={openPrivacy}>
              Privacy Notice
            </Text>
          </Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center", marginLeft: -8 },
  headerTitle: { fontSize: 22, fontWeight: "800" },
  placeholder: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 12 },
  row: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  rowDesc: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  link: { fontSize: 15, fontWeight: "700" },
  divider: { height: 1, marginHorizontal: 20 },
  contactsBlock: { paddingHorizontal: 20, paddingBottom: 8, gap: 4 },
  contactsLoading: { paddingVertical: 16, alignItems: "flex-start" },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 17, fontWeight: "700", color: "#0F172A" },
  contactBody: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
  contactPhone: { fontSize: 14 },
  addContactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addContactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  addContactText: { flex: 1, fontSize: 15, fontWeight: "600" },
  sosWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, gap: 6 },
  sosButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 28,
  },
  sosText: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.3 },
  sosHint: { fontSize: 13, textAlign: "center" },
  consent: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    alignItems: "flex-start",
  },
  consentText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
