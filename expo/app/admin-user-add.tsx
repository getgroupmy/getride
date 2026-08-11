import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  UserPlus,
  User,
  Phone,
  Mail,
  IdCard,
  MapPin,
  Check,
  Globe,
  Calendar,
  Gift,
  Camera,
  ImagePlus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData } from "@/contexts/AdminDataContext";

interface FormState {
  name: string;
  phone: string;
  email: string;
  ic: string;
  address: string;
  nationality: string;
  birthDate: string;
  referralCode: string;
}

type Gender = "male" | "female" | "other";

export default function AdminUserAddScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { addUser } = useAdminData();
  const [form, setForm] = useState<FormState>({
    name: "",
    phone: "",
    email: "",
    ic: "",
    address: "",
    nationality: "",
    birthDate: "",
    referralCode: "",
  });
  const [gender, setGender] = useState<Gender | null>(null);
  const [profileImage, setProfileImage] = useState<string>("");
  const [idImage, setIdImage] = useState<string>("");
  const [autoApprove, setAutoApprove] = useState<boolean>(false);

  const update = (key: keyof FormState, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const pickImage = async (target: "profile" | "id") => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: target === "profile" ? [1, 1] : [4, 3],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        if (target === "profile") setProfileImage(uri);
        else setIdImage(uri);
      }
    } catch (e) {
      console.log("image pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const onSubmit = () => {
    if (!guard()) return;
    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert("Missing info", "Please fill in name and phone at minimum.");
      return;
    }
    addUser({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || "-",
      ic: form.ic.trim() || undefined,
      address: form.address.trim() || undefined,
      nationality: form.nationality.trim() || undefined,
      birthDate: form.birthDate.trim() || undefined,
      referralCode: form.referralCode.trim() || undefined,
      gender: gender ?? undefined,
      profileImage: profileImage || undefined,
      idImage: idImage || undefined,
      status: autoApprove ? "approved" : "unapproved",
      documentsOk: false,
      totalRides: 0,
    });
    Alert.alert(
      "User added",
      `${form.name} has been ${autoApprove ? "added & approved" : "added pending approval"}.`,
      [{ text: "OK", onPress: () => router.back() }]
    );
  };

  const renderField = (
    label: string,
    key: keyof FormState,
    placeholder: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    keyboardType?: "default" | "phone-pad" | "email-address" | "number-pad"
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: Colors.textSecondary }]}>{label}</Text>
      <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Icon color={Colors.textSecondary} size={18} />
        <TextInput
          value={form[key]}
          onChangeText={(t) => update(key, t)}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          style={[styles.input, { color: Colors.text }]}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={key === "email" || key === "referralCode" ? "none" : "words"}
          testID={`add-user-${key}`}
        />
      </View>
    </View>
  );

  const genders: { key: Gender; label: string }[] = [
    { key: "male", label: "Male" },
    { key: "female", label: "Female" },
    { key: "other", label: "Other" },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="add-user-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <UserPlus color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Add User</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Onboard a new user</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>Profile Image</Text>
          <TouchableOpacity
            onPress={() => pickImage("profile")}
            style={[styles.profileWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            activeOpacity={0.85}
            testID="add-user-profile-image"
            accessibilityRole="button"
          >
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.profileImage} />
            ) : (
              <View style={styles.profileEmpty}>
                <Camera color={Colors.textSecondary} size={28} />
                <Text style={[styles.profileHint, { color: Colors.textSecondary }]}>Tap to upload</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Personal</Text>
          {renderField("Full name", "name", "Jane Doe", User)}
          {renderField("Phone number", "phone", "+60 12-345 6789", Phone, "phone-pad")}
          {renderField("Email", "email", "user@example.com", Mail, "email-address")}
          {renderField("IC / Passport", "ic", "990101-14-5678", IdCard)}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>ID / Passport image</Text>
            <TouchableOpacity
              onPress={() => pickImage("id")}
              style={[styles.idImageWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
              activeOpacity={0.85}
              testID="add-user-id-image"
              accessibilityRole="button"
            >
              {idImage ? (
                <Image source={{ uri: idImage }} style={styles.idImage} />
              ) : (
                <View style={styles.idEmpty}>
                  <ImagePlus color={Colors.textSecondary} size={24} />
                  <Text style={[styles.profileHint, { color: Colors.textSecondary }]}>Upload ID / Passport image</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {renderField("Nationality", "nationality", "Malaysian", Globe)}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Gender</Text>
            <View style={styles.chipRow}>
              {genders.map((g) => {
                const selected = gender === g.key;
                return (
                  <TouchableOpacity
                    key={g.key}
                    onPress={() => setGender(g.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? Colors.accent : Colors.gray[100],
                        borderColor: selected ? Colors.accent : Colors.border,
                      },
                    ]}
                    testID={`add-user-gender-${g.key}`}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.chipText, { color: selected ? Colors.onAccent : Colors.text }]}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {renderField("Birth date", "birthDate", "YYYY-MM-DD", Calendar)}

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Address</Text>
          {renderField("Home address", "address", "Jalan Tun Razak, Kuala Lumpur", MapPin)}

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Referral</Text>
          {renderField("Referral code (optional)", "referralCode", "FRIEND123", Gift)}

          <TouchableOpacity
            onPress={() => setAutoApprove((v) => !v)}
            style={[
              styles.toggleRow,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
            activeOpacity={0.85}
            testID="user-auto-approve-toggle"
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: Colors.text }]}>Auto approve</Text>
              <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
                Skip approval queue and activate immediately
              </Text>
            </View>
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: autoApprove ? Colors.accent : "transparent",
                  borderColor: autoApprove ? Colors.accent : Colors.border,
                },
              ]}
            >
              {autoApprove && <Check color={Colors.onAccent} size={16} />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSubmit}
            style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
            testID="submit-user"
            activeOpacity={0.9}
            accessibilityRole="button"
          >
            <UserPlus color={Colors.onAccent} size={18} />
            <Text style={[styles.submitText, { color: Colors.onAccent }]}>Add User</Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const, marginBottom: 10 },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  profileWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    overflow: "hidden" as const,
    alignSelf: "center" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  profileImage: { width: "100%", height: "100%" },
  profileEmpty: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 4,
  },
  profileHint: { fontSize: 11, fontWeight: "600" as const },
  idImageWrap: {
    height: 140,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  idImage: { width: "100%", height: "100%" },
  idEmpty: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  chipRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: "700" as const },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 6,
  },
  toggleTitle: { fontSize: 14, fontWeight: "700" as const },
  toggleDesc: { fontSize: 12, marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  submitBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginTop: 18,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
});
