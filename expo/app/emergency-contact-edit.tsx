import React, { useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ChevronDown, Trash2, Check, BookUser } from "lucide-react-native";
import * as Contacts from "expo-contacts";
import { useColors } from "@/hooks/useColors";
import { useEmergencyContacts } from "@/contexts/EmergencyContactsContext";

type CountryCode = { code: string; label: string };

const COUNTRY_CODES: CountryCode[] = [
  { code: "+60", label: "Malaysia" },
  { code: "+65", label: "Singapore" },
  { code: "+62", label: "Indonesia" },
  { code: "+66", label: "Thailand" },
  { code: "+63", label: "Philippines" },
  { code: "+84", label: "Vietnam" },
  { code: "+91", label: "India" },
  { code: "+1", label: "United States" },
  { code: "+44", label: "United Kingdom" },
  { code: "+61", label: "Australia" },
];

const DEFAULT_CODE = "+60";

function splitPhone(full: string): { code: string; number: string } {
  const trimmed = (full ?? "").trim();
  const match = COUNTRY_CODES.map((c) => c.code)
    .sort((a, b) => b.length - a.length)
    .find((c) => trimmed.startsWith(c));
  if (match) {
    return { code: match, number: trimmed.slice(match.length).trim() };
  }
  return { code: DEFAULT_CODE, number: trimmed.replace(/^\+/, "") };
}

export default function EmergencyContactEditScreen() {
  const router = useRouter();
  const Colors = useColors();
  const params = useLocalSearchParams<{ id?: string; name?: string; phone?: string }>();

  const { addContact, updateContact, deleteContact, isSyncing } = useEmergencyContacts();

  const editingId = typeof params.id === "string" && params.id.length > 0 ? params.id : null;
  const initial = useMemo(() => splitPhone(typeof params.phone === "string" ? params.phone : ""), [params.phone]);

  const [nameInput, setNameInput] = useState<string>(typeof params.name === "string" ? params.name : "");
  const [countryCode, setCountryCode] = useState<string>(initial.code);
  const [phoneInput, setPhoneInput] = useState<string>(initial.number);
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);

  const isDark = Colors.background === "#000000";

  const canSave = useMemo(
    () => nameInput.trim().length > 0 && phoneInput.trim().length >= 5,
    [nameInput, phoneInput]
  );

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSave = useCallback(async () => {
    if (!canSave || isSyncing) return;
    const name = nameInput.trim();
    const phone = `${countryCode} ${phoneInput.trim().replace(/^0+/, "")}`.trim();
    const ok = editingId
      ? await updateContact(editingId, name, phone)
      : await addContact(name, phone);
    if (ok) {
      router.back();
    } else {
      Alert.alert("Couldn't save", "Please check your connection and try again.");
    }
  }, [canSave, isSyncing, nameInput, phoneInput, countryCode, editingId, addContact, updateContact, router]);

  const handleDelete = useCallback(() => {
    if (!editingId) return;
    Alert.alert("Remove contact", "Remove this emergency contact?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const ok = await deleteContact(editingId);
          if (ok) {
            router.back();
          } else {
            Alert.alert("Couldn't remove", "Please check your connection and try again.");
          }
        },
      },
    ]);
  }, [editingId, deleteContact, router]);

  const selectCode = useCallback((code: string) => {
    setCountryCode(code);
    setPickerVisible(false);
  }, []);

  const applyPhone = useCallback((raw: string) => {
    const cleaned = raw.replace(/[^\d+]/g, "");
    const { code, number } = splitPhone(cleaned);
    setCountryCode(code);
    setPhoneInput(number);
  }, []);

  const handlePickContact = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not available", "Picking from contacts isn't supported on web.");
      return;
    }
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Allow access to your contacts to pick an emergency contact."
        );
        return;
      }
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;

      // The picker can return a contact with limited fields (e.g. missing `name`
      // on Android). Refetch the full contact by id when possible, then derive
      // a display name from any available field.
      let contact = picked;
      if (picked.id) {
        try {
          const full = await Contacts.getContactByIdAsync(picked.id, [
            Contacts.Fields.Name,
            Contacts.Fields.FirstName,
            Contacts.Fields.LastName,
            Contacts.Fields.MiddleName,
            Contacts.Fields.Company,
            Contacts.Fields.Nickname,
            Contacts.Fields.PhoneNumbers,
          ]);
          if (full) contact = full;
        } catch (err) {
          console.warn("getContactByIdAsync failed, using picker result", err);
        }
      }

      const derivedName =
        (contact.name ?? "").trim() ||
        [contact.firstName, contact.middleName, contact.lastName]
          .filter((p): p is string => !!p && p.trim().length > 0)
          .join(" ")
          .trim() ||
        (contact.nickname ?? "").trim() ||
        (contact.company ?? "").trim();

      if (derivedName.length > 0) setNameInput(derivedName);

      const firstNumber = contact.phoneNumbers?.[0]?.number;
      if (firstNumber) {
        applyPhone(firstNumber);
      } else {
        Alert.alert("No phone number", "The selected contact has no phone number.");
      }
    } catch (e) {
      console.error("contact picker failed", e);
      Alert.alert("Couldn't open contacts", "Please try again.");
    }
  }, [applyPhone]);

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <SafeAreaView style={{ backgroundColor: Colors.background }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="ece-back"
          >
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>
            {editingId ? "Edit Emergency Contacts" : "Add Emergency Contacts"}
          </Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: Colors.text }]}>
                Name <Text style={[styles.required, { color: Colors.error }]}>*</Text>
              </Text>
              <TouchableOpacity
                style={[styles.pickContactButton, { borderColor: Colors.border }]}
                onPress={handlePickContact}
                testID="ece-pick-contact"
              >
                <BookUser color={Colors.accent} size={18} />
                <Text style={[styles.pickContactText, { color: Colors.accent }]}>Contacts</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrap, { borderColor: Colors.border, backgroundColor: Colors.background }]}>
              <TextInput
                style={[styles.input, { color: Colors.text }]}
                placeholder="Name of contact person"
                placeholderTextColor={Colors.gray[400]}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                testID="ece-name-input"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: Colors.text }]}>
              Mobile <Text style={[styles.required, { color: Colors.error }]}>*</Text>
            </Text>
            <View style={styles.mobileRow}>
              <TouchableOpacity
                style={[styles.codeBox, { borderColor: Colors.border, backgroundColor: Colors.background }]}
                onPress={() => setPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Change dialling code"
                testID="ece-code"
              >
                <Text style={[styles.codeText, { color: Colors.text }]}>{countryCode}</Text>
                <ChevronDown color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
              <View
                style={[
                  styles.inputWrap,
                  styles.mobileInputWrap,
                  { borderColor: Colors.border, backgroundColor: Colors.background },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: Colors.text }]}
                  placeholder="Mobile number"
                  placeholderTextColor={Colors.gray[400]}
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  keyboardType="phone-pad"
                  testID="ece-phone-input"
                />
              </View>
            </View>
          </View>

          <Text style={[styles.consent, { color: Colors.textSecondary }]}>
            By saving, you&apos;ve confirmed that the person agrees to receive emergency messages from you.
          </Text>

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: canSave && !isSyncing ? Colors.success : Colors.gray[100] },
            ]}
            onPress={handleSave}
            disabled={!canSave || isSyncing}
            testID="ece-save"
          >
            {isSyncing ? (
              <ActivityIndicator color={canSave ? "#FFFFFF" : Colors.gray[400]} />
            ) : (
              <Text style={[styles.saveButtonText, { color: canSave ? "#FFFFFF" : Colors.gray[400] }]}>
                Save
              </Text>
            )}
          </TouchableOpacity>

          {editingId ? (
            <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} testID="ece-delete">
              <Trash2 color={Colors.error} size={18} />
              <Text style={[styles.deleteText, { color: Colors.error }]}>Remove contact</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerVisible(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: Colors.background }]}>
            <View style={styles.pickerHandleWrap}>
              <View style={[styles.pickerHandle, { backgroundColor: Colors.border }]} />
            </View>
            <Text style={[styles.pickerTitle, { color: Colors.text }]}>Select country code</Text>
            <FlatList
              data={COUNTRY_CODES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => {
                const selected = item.code === countryCode;
                return (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => selectCode(item.code)}
                    testID={`ece-code-${item.code}`}
                  >
                    <Text style={[styles.pickerCode, { color: Colors.text }]}>{item.code}</Text>
                    <Text style={[styles.pickerLabel, { color: Colors.textSecondary }]}>{item.label}</Text>
                    {selected ? <Check color={Colors.success} size={20} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  iconButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 22, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  field: { marginBottom: 22 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  label: { fontSize: 16, fontWeight: "500" },
  pickContactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pickContactText: { fontSize: 14, fontWeight: "600" },
  required: {},
  inputWrap: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
    justifyContent: "center",
  },
  input: { fontSize: 17, padding: 0 },
  mobileRow: { flexDirection: "row", gap: 12 },
  codeBox: {
    borderWidth: 1,
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  codeText: { fontSize: 17, fontWeight: "600" },
  mobileInputWrap: { flex: 1 },
  consent: { fontSize: 16, lineHeight: 23, marginTop: 2, marginBottom: 28 },
  saveButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  saveButtonText: { fontSize: 18, fontWeight: "700" },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 18,
    paddingVertical: 8,
  },
  deleteText: { fontSize: 15, fontWeight: "700" },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  pickerSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: "70%",
  },
  pickerHandleWrap: { alignItems: "center", paddingVertical: 10 },
  pickerHandle: { width: 40, height: 5, borderRadius: 3 },
  pickerTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  pickerCode: { fontSize: 16, fontWeight: "700", width: 56 },
  pickerLabel: { fontSize: 15, flex: 1 },
});
