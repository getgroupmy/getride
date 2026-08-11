import React, { useMemo, useState } from "react";
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
  CarFront,
  Hash,
  Palette,
  Calendar,
  User as UserIcon,
  Phone as PhoneIcon,
  Check,
  ShieldCheck,
  Save,
  Trash2,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, PermitStatus, VehicleStatus } from "@/contexts/AdminDataContext";
import { resolvePartnerSupabaseId } from "@/utils/adminSync";
import VehicleMakeModelPicker, {
  formatVehicleLabel,
  type VehicleSelection,
} from "@/components/VehicleMakeModelPicker";
import ServiceAreaPicker, { type ServiceAreaValue } from "@/components/ServiceAreaPicker";
import RequiredDocsChecklist from "@/components/RequiredDocsChecklist";
import { checkVehicleDocsAllApproved } from "@/utils/vehicleDocumentsStore";

interface VehicleForm {
  plate: string;
  year: string;
  color: string;
  ownerName: string;
  ownerPhone: string;
  partnerId: string;
  ownerPartnerUuid: string;
}

const PERMIT_OPTIONS: { label: string; value: PermitStatus }[] = [
  { label: "None", value: "none" },
  { label: "Pending", value: "pending" },
  { label: "Non-verified", value: "non-verified" },
  { label: "Verified", value: "verified" },
];

const STATUS_OPTIONS: { label: string; value: VehicleStatus }[] = [
  { label: "Approved", value: "approved" },
  { label: "Unapproved", value: "unapproved" },
  { label: "Blocked", value: "blocked" },
  { label: "Rejected", value: "rejected" },
  { label: "Docs Pending", value: "unapproved-docs" },
  { label: "Permit Pending", value: "permit-pending" },
  { label: "Permit Unverified", value: "permit-non-verified" },
  { label: "Permit Verified", value: "permit-verified" },
];

export default function AdminVehicleEditScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const params = useLocalSearchParams<{ id?: string }>();
  const { vehicles, updateVehicle, removeVehicle } = useAdminData();

  const record = useMemo(
    () => vehicles.find((v) => v.id === params.id),
    [vehicles, params.id]
  );

  const [form, setForm] = useState<VehicleForm>({
    plate: record?.plate ?? "",
    year: record?.year ?? "",
    color: record?.color ?? "",
    ownerName: record?.ownerName ?? "",
    ownerPhone: record?.ownerPhone ?? "",
    partnerId: record?.partnerId ?? "",
    ownerPartnerUuid: record?.ownerPartnerUuid ?? "",
  });
  const [vehicle, setVehicle] = useState<VehicleSelection | null>(
    record
      ? {
          vehicleType: record.vehicleType ?? "",
          energyType: "",
          make: record.make ?? "",
          model: record.model ?? "",
          yearFrom: "",
          yearTo: "",
        }
      : null
  );
  const [permit, setPermit] = useState<PermitStatus>(record?.permit ?? "none");
  const [status, setStatus] = useState<VehicleStatus>(record?.status ?? "unapproved");
  const [documentsOk, setDocumentsOk] = useState<boolean>(record?.documentsOk ?? false);
  const [serviceArea, setServiceArea] = useState<ServiceAreaValue>({
    countries: record?.serviceCountries ?? [],
    states: record?.serviceStates ?? [],
    cities: record?.serviceCities ?? [],
  });

  if (!record) {
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
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Vehicle not found</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>
      </SafeAreaView>
    );
  }

  const update = (key: keyof VehicleForm, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const persist = () => {
    updateVehicle(record.id, {
      plate: form.plate.trim().toUpperCase(),
      make: vehicle!.make,
      model: vehicle!.model,
      year: form.year.trim() || undefined,
      color: form.color.trim() || undefined,
      vehicleType: vehicle!.vehicleType || undefined,
      ownerName: form.ownerName.trim(),
      ownerPhone: form.ownerPhone.trim(),
      partnerId: form.partnerId.trim() || undefined,
      ownerPartnerUuid: form.ownerPartnerUuid.trim() || undefined,
      status,
      permit,
      documentsOk,
      serviceCountries: serviceArea.countries,
      serviceStates: serviceArea.states,
      serviceCities: serviceArea.cities,
    });
    Alert.alert("Saved", "Vehicle has been updated.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  };

  const onSave = async () => {
    if (!guard()) return;
    if (!form.plate.trim() || !vehicle || !vehicle.make || !vehicle.model) {
      Alert.alert("Missing info", "Please select a vehicle and fill in plate number.");
      return;
    }
    if (!form.ownerName.trim() || !form.ownerPhone.trim()) {
      Alert.alert("Missing info", "Please fill in the owner's name and phone.");
      return;
    }
    const changingToApproved = status === "approved" && record.status !== "approved";
    if (changingToApproved) {
      const check = await checkVehicleDocsAllApproved(record.id);
      const blockWithUnknown = check.unknown && !documentsOk;
      const blockWithRows = !check.unknown && (!check.hasAny || !check.ok);
      if (blockWithUnknown || blockWithRows) {
        const parts: string[] = [];
        if (check.pending > 0) parts.push(`${check.pending} pending`);
        if (check.rejected > 0) parts.push(`${check.rejected} rejected`);
        if (check.expired > 0) parts.push(`${check.expired} expired`);
        if (check.failed > 0) parts.push(`${check.failed} failed`);
        const summary = parts.length ? ` (${parts.join(", ")})` : "";
        const message = check.unknown
          ? `${record.plate} has documents that still need review. Approve them first.`
          : !check.hasAny
            ? `${record.plate} has no vehicle documents on file. Upload and approve the required documents first.`
            : `${check.approved}/${check.total} vehicle documents are approved${summary}. Review and approve them before approving the vehicle.`;
        Alert.alert(
          check.hasAny || check.unknown ? "Documents not fully approved" : "No documents uploaded",
          message,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Review documents",
              onPress: () =>
                router.push({
                  pathname: "/admin-documents-vehicles",
                  params: { vehicleId: record.id },
                }),
            },
          ]
        );
        return;
      }
    }
    persist();
  };

  const _legacyPersist = () => {
    updateVehicle(record.id, {
      plate: form.plate.trim().toUpperCase(),
      make: vehicle!.make,
      model: vehicle!.model,
      year: form.year.trim() || undefined,
      color: form.color.trim() || undefined,
      vehicleType: vehicle!.vehicleType || undefined,
      ownerName: form.ownerName.trim(),
      ownerPhone: form.ownerPhone.trim(),
      partnerId: form.partnerId.trim() || undefined,
      ownerPartnerUuid: form.ownerPartnerUuid.trim() || undefined,
      status,
      permit,
      documentsOk,
      serviceCountries: serviceArea.countries,
      serviceStates: serviceArea.states,
      serviceCities: serviceArea.cities,
    });
  };
  void _legacyPersist;

  const onDelete = () => {
    if (!guard()) return;
    Alert.alert("Delete vehicle", `Remove ${record.plate}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          removeVehicle(record.id);
          router.back();
        },
      },
    ]);
  };

  const renderField = (
    label: string,
    key: keyof VehicleForm,
    placeholder: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    opts?: { autoCapitalize?: "characters" | "words" | "none"; keyboardType?: "default" | "phone-pad" | "number-pad" }
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
          autoCapitalize={opts?.autoCapitalize ?? "words"}
          keyboardType={opts?.keyboardType ?? "default"}
          testID={`edit-vehicle-${key}`}
          accessibilityLabel={label}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="edit-vehicle-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Pencil color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Edit Vehicle</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {record.plate} • {record.id}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onDelete}
          style={[styles.iconBtn, { backgroundColor: Colors.error + "20" }]}
          testID="edit-vehicle-delete"
          accessibilityRole="button"
          accessibilityLabel="Delete"
        >
          <Trash2 color={Colors.error} size={20} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.summaryCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <View style={[styles.summaryIcon, { backgroundColor: Colors.accent + "20" }]}>
              <CarFront color={Colors.accent} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.summaryTitle, { color: Colors.text }]} numberOfLines={1}>
                {vehicle ? formatVehicleLabel(vehicle) || `${vehicle.make} ${vehicle.model}` : `${record.make} ${record.model}`}
              </Text>
              <Text style={[styles.summaryMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                {record.ownerName} • {record.ownerPhone}
              </Text>
            </View>
            <View style={[styles.platePill, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
              <Text style={[styles.plateText, { color: Colors.text }]}>{record.plate}</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Vehicle</Text>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Make &amp; model</Text>
            <VehicleMakeModelPicker
              value={vehicle}
              onChange={(s) => setVehicle(s)}
              testID="edit-vehicle-makemodel"
            />
          </View>
          {renderField("Plate number", "plate", "WPK 1234", Hash, { autoCapitalize: "characters" })}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>{renderField("Year", "year", "2024", Calendar, { keyboardType: "number-pad", autoCapitalize: "none" })}</View>
            <View style={{ flex: 1 }}>{renderField("Color", "color", "White", Palette)}</View>
          </View>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Owner</Text>
          {renderField("Owner name", "ownerName", "Ahmad Faizal", UserIcon)}
          {renderField("Owner phone", "ownerPhone", "+60 12-345 6781", PhoneIcon, {
            keyboardType: "phone-pad",
            autoCapitalize: "none",
          })}
          {renderField("Partner ID", "partnerId", "DR-1001", Hash, { autoCapitalize: "characters" })}

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Service area</Text>
          <ServiceAreaPicker value={serviceArea} onChange={setServiceArea} testID="edit-vehicle-service-area" />

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Documents</Text>
          <RequiredDocsChecklist
            docTypeFilter="Vehicle"
            countries={serviceArea.countries}
            states={serviceArea.states.map((s) => {
              const idx = s.indexOf(",");
              if (idx === -1) return { country: serviceArea.countries[0] ?? "", state: s.trim() };
              return { country: s.slice(idx + 1).trim(), state: s.slice(0, idx).trim() };
            })}
            subtitle="Resolved from service area · per-region compulsory rules"
            testID="edit-vehicle-required-docs"
          />

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Status</Text>
          <View style={styles.chipRow}>
            {STATUS_OPTIONS.map((s) => {
              const selected = status === s.value;
              return (
                <TouchableOpacity
                  key={s.value}
                  onPress={() => setStatus(s.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? Colors.accent + "20" : Colors.gray[100],
                      borderColor: selected ? Colors.accent : Colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  testID={`edit-status-${s.value}`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, { color: selected ? Colors.accent : Colors.text }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Permit</Text>
          <View style={styles.chipRow}>
            {PERMIT_OPTIONS.map((p) => {
              const selected = permit === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  onPress={() => setPermit(p.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? Colors.accent + "20" : Colors.gray[100],
                      borderColor: selected ? Colors.accent : Colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  testID={`edit-permit-${p.value}`}
                  accessibilityRole="button"
                >
                  <ShieldCheck color={selected ? Colors.accent : Colors.textSecondary} size={14} />
                  <Text style={[styles.chipText, { color: selected ? Colors.accent : Colors.text }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={() => setDocumentsOk((v) => !v)}
            style={[styles.toggleRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            activeOpacity={0.85}
            testID="edit-vehicle-docs-ok"
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: Colors.text }]}>Documents verified</Text>
              <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
                Mark vehicle documents as reviewed
              </Text>
            </View>
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: documentsOk ? Colors.accent : "transparent",
                  borderColor: documentsOk ? Colors.accent : Colors.border,
                },
              ]}
            >
              {documentsOk && <Check color={Colors.onAccent} size={16} />}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSave}
            style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
            activeOpacity={0.9}
            testID="edit-vehicle-save"
            accessibilityRole="button"
          >
            <Save color={Colors.onAccent} size={18} />
            <Text style={[styles.submitText, { color: Colors.onAccent }]}>Save changes</Text>
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
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
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
  row: { flexDirection: "row" as const, gap: 12 },
  chipRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginBottom: 6 },
  chip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
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
    marginTop: 10,
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
  summaryCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  summaryTitle: { fontSize: 14, fontWeight: "800" as const },
  summaryMeta: { fontSize: 12, marginTop: 2 },
  platePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  plateText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 0.5 },
});
