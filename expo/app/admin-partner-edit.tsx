import React, { useEffect, useMemo, useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Pencil,
  Save,
  Phone as PhoneIcon,
  Mail as MailIcon,
  IdCard,
  Trash2,
  Tag,
  CarFront,
  Plus,
  Search,
  ChevronRight,
  X,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, type VehicleRecord, type SettingEntry } from "@/contexts/AdminDataContext";
import PartnerTypePicker from "@/components/PartnerTypePicker";
import RequiredDocsUploader from "@/components/RequiredDocsUploader";
import ServiceAreaPicker, { type ServiceAreaValue } from "@/components/ServiceAreaPicker";
import { resolvePartnerSupabaseId } from "@/utils/adminSync";

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

export default function AdminPartnerEditScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const params = useLocalSearchParams<{ id?: string }>();
  const { partners, vehicles, updatePartner, removePartner, getEntries } = useAdminData();

  const partner = useMemo(
    () => partners.find((p) => p.id === params.id),
    [partners, params.id]
  );

  const initialVehicleId = useMemo<string>(() => {
    if (!partner) return "";
    const match = vehicles.find(
      (v) => v.plate.trim().toUpperCase() === partner.plate.trim().toUpperCase()
    );
    return match?.id ?? "";
  }, [partner, vehicles]);

  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId);
  const [supabasePartnerId, setSupabasePartnerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!partner?.id) {
      setSupabasePartnerId(null);
      return;
    }
    void (async () => {
      const id = await resolvePartnerSupabaseId(partner.id);
      if (!cancelled) setSupabasePartnerId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [partner?.id]);
  const [vehicleSearch, setVehicleSearch] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [partnerTypes, setPartnerTypes] = useState<string[]>(
    partner?.partnerTypes && partner.partnerTypes.length > 0
      ? partner.partnerTypes
      : partner?.partnerType
        ? [partner.partnerType]
        : []
  );
  const [serviceArea, setServiceArea] = useState<ServiceAreaValue>({
    countries: Array.isArray(partner?.serviceCountries) ? (partner!.serviceCountries as string[]) : [],
    states: Array.isArray(partner?.serviceStates) ? (partner!.serviceStates as string[]) : [],
    cities: Array.isArray(partner?.serviceCities) ? (partner!.serviceCities as string[]) : [],
  });

  const serviceAreaComplete = useMemo<boolean>(
    () =>
      serviceArea.countries.length > 0 &&
      serviceArea.states.length > 0 &&
      serviceArea.cities.length > 0,
    [serviceArea]
  );

  const partnerTypeSelected = partnerTypes.length > 0;

  const partnerTypeEntries = getEntries("partner-type");

  const selectedTypeEntries = useMemo<SettingEntry[]>(() => {
    const set = new Set(partnerTypes.map((n) => n.toLowerCase()));
    return partnerTypeEntries.filter((e) =>
      set.has(String(e.values.name ?? "").toLowerCase())
    );
  }, [partnerTypeEntries, partnerTypes]);

  const vehicleRequired = useMemo<boolean>(
    () => selectedTypeEntries.some((e) => Boolean(e.values.vehicleRequired)),
    [selectedTypeEntries]
  );

  const allowedDocTypeIds = useMemo<string[] | undefined>(() => {
    if (selectedTypeEntries.length === 0) return undefined;
    const ids = new Set<string>();
    for (const e of selectedTypeEntries) {
      for (const id of parseDocTypes(e.values.docTypes)) ids.add(id);
    }
    if (ids.size === 0) return undefined;
    return Array.from(ids);
  }, [selectedTypeEntries]);

  const selectedVehicle = useMemo<VehicleRecord | null>(
    () => vehicles.find((v) => v.id === vehicleId) ?? null,
    [vehicles, vehicleId]
  );

  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    if (!q) return vehicles.slice(0, 20);
    return vehicles
      .filter(
        (v) =>
          v.plate.toLowerCase().includes(q) ||
          v.make.toLowerCase().includes(q) ||
          v.model.toLowerCase().includes(q) ||
          v.ownerName.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [vehicles, vehicleSearch]);

  if (!partner) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.header, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={Colors.text} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Partner not found</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>
      </SafeAreaView>
    );
  }

  const onSave = async () => {
    if (!guard()) return;
    if (!serviceAreaComplete) {
      Alert.alert(
        "Select service area",
        "Please pick at least one country, state and city of service before choosing a partner type."
      );
      return;
    }
    if (partnerTypes.length === 0) {
      Alert.alert("Missing info", "Please select at least one partner type.");
      return;
    }
    if (vehicleRequired && !selectedVehicle) {
      Alert.alert(
        "Vehicle required",
        "The selected partner type requires a vehicle. Pick one from the list or add a new vehicle."
      );
      return;
    }
    setSaving(true);
    const result = await updatePartner(partner.id, {
      vehicle: selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}`.trim() : "",
      plate: selectedVehicle ? selectedVehicle.plate : "",
      vehicleType: selectedVehicle?.vehicleType,
      make: selectedVehicle?.make,
      model: selectedVehicle?.model,
      partnerType: partnerTypes[0],
      partnerTypes: partnerTypes,
      serviceCountries: serviceArea.countries,
      serviceStates: serviceArea.states,
      serviceCities: serviceArea.cities,
    });
    setSaving(false);
    // The partner's own app reads `partner_types` straight off this row (it is
    // what the service-mode modal lists), so a rejected write that still said
    // "Saved" left the operator believing they had changed what the partner
    // sees. Report the failure instead.
    if (!result.ok) {
      Alert.alert(
        "Not saved",
        `The partner could not be updated on the server.\n\n${result.error ?? "Unknown error."}`
      );
      return;
    }
    Alert.alert("Saved", "Partner has been updated.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  };

  const onDelete = () => {
    if (!guard()) return;
    Alert.alert("Delete partner", `Remove ${partner.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          removePartner(partner.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="edit-partner-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Pencil color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Edit Partner</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {partner.name} • {partner.id}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onDelete}
          style={[styles.iconBtn, { backgroundColor: Colors.error + "20" }]}
          testID="edit-partner-delete"
          accessibilityRole="button"
          accessibilityLabel="Delete"
        >
          <Trash2 color={Colors.errorText} size={20} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: Colors.accent }]}>
              <Text style={[styles.avatarText, { color: Colors.secondary }]}>
                {partner.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>{partner.name}</Text>
                {partnerTypes.map((t) => (
                  <View key={t} style={[styles.typePill, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]} testID={`edit-partner-type-badge-${t}`}>
                    <Tag color={Colors.accentText} size={10} />
                    <Text style={[styles.typePillText, { color: Colors.accentText }]} numberOfLines={1}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.metaRow}>
                <PhoneIcon color={Colors.textSecondary} size={12} />
                <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {partner.phone}
                </Text>
              </View>
              {!!partner.email && (
                <View style={styles.metaRow}>
                  <MailIcon color={Colors.textSecondary} size={12} />
                  <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {partner.email}
                  </Text>
                </View>
              )}
              {!!partner.ic && (
                <View style={styles.metaRow}>
                  <IdCard color={Colors.textSecondary} size={12} />
                  <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {partner.ic}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Service Area</Text>
          <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 8 }]}>
            Select country, state and city of service
          </Text>
          <ServiceAreaPicker
            value={serviceArea}
            onChange={setServiceArea}
            testID="edit-partner-service-area"
          />

          {serviceAreaComplete ? (
            <>
              <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Partner Type</Text>
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Type</Text>
                <PartnerTypePicker
                  value={partnerTypes}
                  onChange={(v) => setPartnerTypes(v)}
                  testID="edit-partner-type"
                />
              </View>
            </>
          ) : (
            <View style={[styles.gateCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Text style={[styles.gateText, { color: Colors.textSecondary }]}>
                Pick at least one country, state and city above to continue with partner type and documents.
              </Text>
            </View>
          )}

          {serviceAreaComplete && partnerTypeSelected && vehicleRequired && (
            <>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16, marginBottom: 0 }]}>
                  Vehicle
                </Text>
                <TouchableOpacity
                  onPress={() => router.push("/admin-vehicle-add")}
                  style={[styles.addBtn, { borderColor: Colors.accent }]}
                  activeOpacity={0.85}
                  testID="edit-partner-add-vehicle"
                  accessibilityRole="button"
                >
                  <Plus color={Colors.accentText} size={14} />
                  <Text style={[styles.addBtnText, { color: Colors.accentText }]}>Add new</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 8 }]}>
                Select from registered vehicles
              </Text>
              {selectedVehicle ? (
                <View style={[styles.vehicleCard, { backgroundColor: Colors.gray[100], borderColor: Colors.accent }]}>
                  <View style={[styles.vehicleIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <CarFront color={Colors.accentText} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>
                      {selectedVehicle.make} {selectedVehicle.model}
                    </Text>
                    <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {selectedVehicle.plate} • {selectedVehicle.ownerName}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setVehicleId("")}
                    style={[styles.iconBtnSm, { backgroundColor: Colors.background }]}
                    testID="edit-clear-vehicle"
                    accessibilityRole="button"
                  >
                    <X color={Colors.text} size={16} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 8 }]}>
                    <Search color={Colors.textSecondary} size={18} />
                    <TextInput
                      value={vehicleSearch}
                      onChangeText={setVehicleSearch}
                      placeholder="Search by plate, make, model or owner"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      autoCapitalize="none"
                      testID="edit-vehicle-search"
                      accessibilityLabel="Search by plate, make, model or owner"
                    />
                  </View>
                  {filteredVehicles.length === 0 ? (
                    <View style={[styles.emptyVehicleCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <CarFront color={Colors.textSecondary} size={20} />
                      <Text style={[styles.emptyVehicleText, { color: Colors.textSecondary }]}>
                        No matching vehicles. Tap “Add new” to register one.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {filteredVehicles.map((v) => (
                        <TouchableOpacity
                          key={v.id}
                          onPress={() => setVehicleId(v.id)}
                          style={[styles.vehicleCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                          activeOpacity={0.85}
                          testID={`edit-select-vehicle-${v.id}`}
                          accessibilityRole="button"
                        >
                          <View style={[styles.vehicleIcon, { backgroundColor: Colors.accent + "15" }]}>
                            <CarFront color={Colors.accentText} size={18} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>
                              {v.make} {v.model}
                            </Text>
                            <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                              {v.plate} • {v.ownerName}
                            </Text>
                          </View>
                          <ChevronRight color={Colors.textSecondary} size={16} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {serviceAreaComplete && partnerTypeSelected && (!vehicleRequired || !!selectedVehicle) && (
            <View style={{ marginTop: 16 }}>
              {supabasePartnerId ? (
                <RequiredDocsUploader
                  partnerId={supabasePartnerId}
                  authUserId={null}
                  docTypeIds={allowedDocTypeIds}
                  countries={serviceArea.countries}
                  states={serviceArea.states.map((s) => {
                    const idx = s.indexOf("|");
                    if (idx === -1) return { country: serviceArea.countries[0] ?? "", state: s.trim() };
                    return { country: s.slice(0, idx).trim(), state: s.slice(idx + 1).trim() };
                  })}
                  title="Required documents"
                  subtitle={
                    allowedDocTypeIds
                      ? "Review, approve, or re-upload partner documents below."
                      : "Review, approve, or re-upload partner documents below."
                  }
                  testID="edit-partner-required-docs"
                />
              ) : (
                <View style={[styles.gateCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                  <Text style={[styles.gateText, { color: Colors.textSecondary }]}>
                    Loading partner documents…
                  </Text>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            onPress={() => void onSave()}
            disabled={saving}
            style={[styles.submitBtn, { backgroundColor: Colors.accent, opacity: saving ? 0.6 : 1 }]}
            testID="edit-partner-save"
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Save"
          >
            <Save color={Colors.onAccent} size={18} />
            <Text style={[styles.submitText, { color: Colors.onAccent }]}>
              {saving ? "Saving…" : "Save changes"}
            </Text>
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
  iconBtnSm: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const, marginBottom: 10 },
  sectionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "dashed" as const,
  },
  addBtnText: { fontSize: 12, fontWeight: "700" as const },
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
  vehicleCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  vehicleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  emptyVehicleCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  emptyVehicleText: { fontSize: 12, flex: 1 },
  gateCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    marginTop: 12,
  },
  gateText: { fontSize: 12, lineHeight: 18 },
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
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  avatarText: { fontSize: 16, fontWeight: "800" as const },
  userName: { fontSize: 14, fontWeight: "800" as const, flexShrink: 1 },
  nameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexWrap: "wrap" as const,
  },
  typePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 160,
  },
  typePillText: { fontSize: 10, fontWeight: "800" as const },
  userMeta: { fontSize: 12 },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 4,
  },
});
