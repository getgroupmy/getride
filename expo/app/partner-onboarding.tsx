import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Camera,
  Check,
  IdCard,
  MapPin,
  FileText,
  Users2,
  UserCircle2,
  ChevronRight,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";
import ServiceAreaPicker, { type ServiceAreaValue } from "@/components/ServiceAreaPicker";
import PartnerTypePicker from "@/components/PartnerTypePicker";
import RequiredDocsUploader from "@/components/RequiredDocsUploader";
import {
  computeFirstStep,
  fetchUserProfile,
  findOrCreatePartner,
  patchPartner,
  patchProfile,
  uploadPartnerFile,
  type PartnerOnboardingStep,
  type PartnerProfileRow,
  type UserProfileRow,
} from "@/utils/partnerOnboardingStore";
import PartnerModeSelectModal, { type PartnerMode } from "@/components/PartnerModeSelectModal";

const STEPS: { key: PartnerOnboardingStep; label: string; icon: typeof Camera }[] = [
  { key: "avatar", label: "Profile photo", icon: UserCircle2 },
  { key: "id", label: "ID upload", icon: IdCard },
  { key: "address", label: "Address", icon: MapPin },
  { key: "service-area", label: "Service area", icon: MapPin },
  { key: "partner-type", label: "Partner type", icon: Users2 },
  { key: "requirements", label: "Requirements", icon: FileText },
];

const parseDocTypes = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
};

export default function PartnerOnboardingScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const { getEntries } = useAdminData();

  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [partner, setPartner] = useState<PartnerProfileRow | null>(null);
  const [step, setStep] = useState<PartnerOnboardingStep>("avatar");
  const [showModePicker, setShowModePicker] = useState<boolean>(false);

  // Local working state per step
  const [icInput, setIcInput] = useState<string>("");
  const [addressInput, setAddressInput] = useState<string>("");
  const [serviceArea, setServiceArea] = useState<ServiceAreaValue>({
    countries: [],
    states: [],
    cities: [],
  });
  const [partnerTypes, setPartnerTypes] = useState<string[]>([]);

  const partnerTypeEntries = getEntries("partner-type");
  const selectedTypeEntries = useMemo<SettingEntry[]>(() => {
    const set = new Set(partnerTypes.map((n) => n.toLowerCase()));
    return partnerTypeEntries.filter((e) =>
      set.has(String(e.values.name ?? "").toLowerCase())
    );
  }, [partnerTypeEntries, partnerTypes]);

  const allowedDocTypeIds = useMemo<string[] | undefined>(() => {
    if (selectedTypeEntries.length === 0) return undefined;
    const ids = new Set<string>();
    for (const e of selectedTypeEntries) {
      for (const id of parseDocTypes(e.values.docTypes)) ids.add(id);
    }
    if (ids.size === 0) return undefined;
    return Array.from(ids);
  }, [selectedTypeEntries]);

  const load = useCallback(async () => {
    if (!authState.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const prof = await fetchUserProfile(authState.userId);
    setProfile(prof);
    const part = await findOrCreatePartner(authState.userId, prof);
    setPartner(part);
    setIcInput(part?.ic ?? prof?.ic ?? "");
    setAddressInput(part?.address ?? prof?.address ?? "");
    setServiceArea({
      countries: part?.service_countries ?? [],
      states: part?.service_states ?? [],
      cities: part?.service_cities ?? [],
    });
    setPartnerTypes(part?.partner_types ?? []);
    setStep(computeFirstStep(prof, part));
    setLoading(false);
  }, [authState.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = useCallback(
    async (latestPartner: PartnerProfileRow | null, latestProfile: UserProfileRow | null) => {
      const next = computeFirstStep(latestProfile, latestPartner);
      setStep(next);
      if (latestPartner) {
        await patchPartner(latestPartner.id, { onboarding_step: next });
      }
    },
    []
  );

  const stepIndex = useMemo(
    () => Math.max(0, STEPS.findIndex((s) => s.key === step)),
    [step]
  );

  /* -------------------- Step handlers -------------------- */

  const pickAvatar = async () => {
    if (!partner || !authState.userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Please allow photo access to upload your avatar.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const localUri = res.assets[0].uri;
    setBusy(true);
    try {
      const url = await uploadPartnerFile(localUri, authState.userId, "avatar");
      if (!url) {
        Alert.alert("Upload failed", "Couldn't upload your photo. Please try again.");
        return;
      }
      await patchProfile(authState.userId, { avatar_url: url });
      const ok = await patchPartner(partner.id, { avatar_url: url });
      if (!ok) return;
      const nextPartner = { ...partner, avatar_url: url };
      const nextProfile = profile ? { ...profile, avatar_url: url } : profile;
      setPartner(nextPartner);
      setProfile(nextProfile);
      await advance(nextPartner, nextProfile);
    } finally {
      setBusy(false);
    }
  };

  const saveId = async () => {
    if (!partner || !authState.userId) return;
    const ic = icInput.trim();
    if (!ic) {
      Alert.alert("Missing ID", "Please enter your ID number.");
      return;
    }
    setBusy(true);
    try {
      await patchProfile(authState.userId, { ic });
      const ok = await patchPartner(partner.id, { ic });
      if (!ok) return;
      const nextPartner = { ...partner, ic };
      const nextProfile = profile ? { ...profile, ic } : profile;
      setPartner(nextPartner);
      setProfile(nextProfile);
      await advance(nextPartner, nextProfile);
    } finally {
      setBusy(false);
    }
  };

  const uploadIdImage = async () => {
    if (!partner || !authState.userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Please allow photo access to upload your ID.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setBusy(true);
    try {
      const url = await uploadPartnerFile(res.assets[0].uri, authState.userId, "id");
      if (!url) {
        Alert.alert("Upload failed", "Couldn't upload your ID. Please try again.");
        return;
      }
      await patchProfile(authState.userId, { id_image: url });
      setProfile((p) => (p ? { ...p, id_image: url } : p));
      Alert.alert("ID uploaded", "Your ID image was saved.");
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = async () => {
    if (!partner || !authState.userId) return;
    const address = addressInput.trim();
    if (!address) {
      Alert.alert("Missing address", "Please enter your address.");
      return;
    }
    setBusy(true);
    try {
      await patchProfile(authState.userId, { address });
      const ok = await patchPartner(partner.id, { address });
      if (!ok) return;
      const nextPartner = { ...partner, address };
      const nextProfile = profile ? { ...profile, address } : profile;
      setPartner(nextPartner);
      setProfile(nextProfile);
      await advance(nextPartner, nextProfile);
    } finally {
      setBusy(false);
    }
  };

  const saveServiceArea = async () => {
    if (!partner) return;
    if (
      serviceArea.countries.length === 0 ||
      serviceArea.states.length === 0 ||
      serviceArea.cities.length === 0
    ) {
      Alert.alert("Pick all three", "Please select at least one country, state and city of service.");
      return;
    }
    setBusy(true);
    try {
      const ok = await patchPartner(partner.id, {
        service_countries: serviceArea.countries,
        service_states: serviceArea.states,
        service_cities: serviceArea.cities,
      });
      if (!ok) return;
      const nextPartner = {
        ...partner,
        service_countries: serviceArea.countries,
        service_states: serviceArea.states,
        service_cities: serviceArea.cities,
      };
      setPartner(nextPartner);
      await advance(nextPartner, profile);
    } finally {
      setBusy(false);
    }
  };

  const savePartnerType = async () => {
    if (!partner) return;
    if (partnerTypes.length === 0) {
      Alert.alert("Pick a type", "Please select at least one partner type.");
      return;
    }
    setBusy(true);
    try {
      const ok = await patchPartner(partner.id, { partner_types: partnerTypes });
      if (!ok) return;
      const nextPartner = { ...partner, partner_types: partnerTypes };
      setPartner(nextPartner);
      await advance(nextPartner, profile);
    } finally {
      setBusy(false);
    }
  };

  const [docsComplete, setDocsComplete] = useState<boolean>(false);

  const markRequirementsComplete = async () => {
    if (!partner) return;
    if (!docsComplete) {
      Alert.alert(
        "Documents incomplete",
        "Please upload every compulsory document before continuing."
      );
      return;
    }
    setBusy(true);
    try {
      const ok = await patchPartner(partner.id, { documents_ok: true });
      if (!ok) return;
      const nextPartner = { ...partner, documents_ok: true };
      setPartner(nextPartner);
      await advance(nextPartner, profile);
    } finally {
      setBusy(false);
    }
  };

  /* -------------------- Mode picker after completion -------------------- */

  useEffect(() => {
    if (step === "done") setShowModePicker(true);
  }, [step]);

  const handleSelectMode = (mode: PartnerMode) => {
    setShowModePicker(false);
    setTimeout(() => {
      if (mode === "TEKSI") router.replace("/partner-teksi" as never);
      else router.replace("/partner-ehailing" as never);
    }, 150);
  };

  /* -------------------- Render -------------------- */

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
          <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Loading your partner profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!authState.userId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Text style={[styles.title, { color: Colors.text }]}>Please sign in first</Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}>
            <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderStepper = () => (
    <View style={styles.stepper}>
      {STEPS.map((s, idx) => {
        const done = idx < stepIndex;
        const active = idx === stepIndex;
        const color = done ? Colors.accent : active ? Colors.accent : Colors.border;
        return (
          <React.Fragment key={s.key}>
            <View style={styles.stepDotWrap}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: done ? Colors.accent : active ? Colors.accent + "20" : "transparent",
                    borderColor: color,
                  },
                ]}
              >
                {done ? (
                  <Check color={Colors.secondary} size={12} />
                ) : (
                  <Text style={[styles.stepDotText, { color: active ? Colors.accent : Colors.textSecondary }]}>{idx + 1}</Text>
                )}
              </View>
            </View>
            {idx < STEPS.length - 1 ? (
              <View style={[styles.stepLine, { backgroundColor: done ? Colors.accent : Colors.border }]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );

  const renderBody = () => {
    switch (step) {
      case "avatar":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Add a profile photo</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>Riders see this on every trip.</Text>
            <View style={styles.avatarPreviewWrap}>
              {partner?.avatar_url || profile?.avatar_url ? (
                <Image
                  source={{ uri: (partner?.avatar_url || profile?.avatar_url) as string }}
                  style={styles.avatarPreview}
                />
              ) : (
                <View style={[styles.avatarPreview, { backgroundColor: Colors.gray[100], alignItems: "center", justifyContent: "center" }]}>
                  <Camera color={Colors.textSecondary} size={36} />
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={pickAvatar}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="onboard-upload-avatar"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Upload photo</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "id":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Verify your identity</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>Enter your ID number and upload a clear photo.</Text>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>ID number</Text>
            <TextInput
              value={icInput}
              onChangeText={setIcInput}
              placeholder="e.g. 900101-10-1234"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text }]}
              autoCapitalize="characters"
              testID="onboard-ic-input"
            />
            <TouchableOpacity
              onPress={uploadIdImage}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="onboard-upload-id"
            >
              <Camera color={Colors.accent} size={18} />
              <Text style={[styles.secondaryBtnText, { color: Colors.accent }]}>{profile?.id_image ? "Replace ID photo" : "Upload ID photo"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={saveId}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1, marginTop: 12 }]}
              testID="onboard-save-id"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "address":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Your address</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>Used for verification and payouts.</Text>
            <TextInput
              value={addressInput}
              onChangeText={setAddressInput}
              placeholder="Street, city, state, postcode"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, styles.inputMultiline, { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text }]}
              multiline
              numberOfLines={4}
              testID="onboard-address-input"
            />
            <TouchableOpacity
              onPress={saveAddress}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="onboard-save-address"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "service-area":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Where will you operate?</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Pick the country, state and city you want to receive jobs in.
            </Text>
            <ServiceAreaPicker value={serviceArea} onChange={setServiceArea} testID="onboard-service-area" />
            <TouchableOpacity
              onPress={saveServiceArea}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1, marginTop: 16 }]}
              testID="onboard-save-area"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "partner-type":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Choose your partner type</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Pick one or more services you want to offer.
            </Text>
            <PartnerTypePicker value={partnerTypes} onChange={setPartnerTypes} testID="onboard-partner-type" />
            <TouchableOpacity
              onPress={savePartnerType}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1, marginTop: 16 }]}
              testID="onboard-save-type"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "requirements":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Upload required documents</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              These are the documents required for the partner type(s) you selected.
            </Text>
            <RequiredDocsUploader
              partnerId={partner?.id ?? ""}
              authUserId={authState.userId ?? null}
              docTypeIds={allowedDocTypeIds}
              countries={serviceArea.countries}
              states={serviceArea.states.map((s) => {
                const idx = s.indexOf("|");
                if (idx === -1) return { country: serviceArea.countries[0] ?? "", state: s.trim() };
                return { country: s.slice(0, idx).trim(), state: s.slice(idx + 1).trim() };
              })}
              onCompletionChange={setDocsComplete}
              testID="onboard-required-docs"
            />
            <TouchableOpacity
              onPress={markRequirementsComplete}
              disabled={busy || !docsComplete}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: busy || !docsComplete ? 0.5 : 1,
                  marginTop: 16,
                },
              ]}
              testID="onboard-finish"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <View style={styles.row}>
                  <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>
                    {docsComplete ? "Continue" : "Upload all compulsory documents"}
                  </Text>
                  <ChevronRight color={Colors.secondary} size={18} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        );
      case "done":
      default:
        return (
          <View style={styles.center}>
            <View style={[styles.doneIconWrap, { backgroundColor: Colors.accent + "20" }]}>
              <Check color={Colors.accent} size={36} />
            </View>
            <Text style={[styles.title, { color: Colors.text, textAlign: "center" }]}>You&apos;re all set!</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary, textAlign: "center" }]}>
              Pick how you want to earn today.
            </Text>
            <TouchableOpacity
              onPress={() => setShowModePicker(true)}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
              testID="onboard-pick-mode"
            >
              <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Choose service mode</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  const currentLabel = STEPS[stepIndex]?.label ?? "All done";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="onboard-back"
        >
          <ArrowLeft color={Colors.text} size={20} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Become a partner</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length} · {currentLabel}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {renderStepper()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {renderBody()}
        </ScrollView>
      </KeyboardAvoidingView>

      <PartnerModeSelectModal
        visible={showModePicker}
        onClose={() => setShowModePicker(false)}
        onSelect={handleSelectMode}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  loadingText: { fontSize: 13, marginTop: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  stepDotWrap: { alignItems: "center" },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: { fontSize: 11, fontWeight: "700" as const },
  stepLine: { flex: 1, height: 2, marginHorizontal: 4 },
  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: "800" as const, marginBottom: 6 },
  subtitle: { fontSize: 13, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: "top" as const },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "800" as const },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" as const },
  avatarPreviewWrap: { alignItems: "center", marginVertical: 24 },
  avatarPreview: { width: 140, height: 140, borderRadius: 70 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  doneIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
});
