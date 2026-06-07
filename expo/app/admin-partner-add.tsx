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
  FlatList,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  UserPlus,
  Check,
  Search,
  User as UserIcon,
  ChevronRight,
  Phone as PhoneIcon,
  Mail as MailIcon,
  IdCard,
  X,
  CarFront,
  Plus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, type UserRecord, type VehicleRecord, type SettingEntry } from "@/contexts/AdminDataContext";
import PartnerTypePicker from "@/components/PartnerTypePicker";
import RequiredDocsChecklist from "@/components/RequiredDocsChecklist";
import RequiredDocsUploader from "@/components/RequiredDocsUploader";
import ServiceAreaPicker, { type ServiceAreaValue } from "@/components/ServiceAreaPicker";
import { resolvePartnerSupabaseId } from "@/utils/adminSync";

const ALL_TOKEN = "__ALL__" as const;

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

export default function AdminPartnerAddScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { users, partners, vehicles, addPartner, getEntries } = useAdminData();

  const [search, setSearch] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [vehicleSearch, setVehicleSearch] = useState<string>("");
  const [serviceArea, setServiceArea] = useState<ServiceAreaValue>({ countries: [], states: [], cities: [] });
  const [partnerTypes, setPartnerTypes] = useState<string[]>([]);
  const [autoApprove, setAutoApprove] = useState<boolean>(false);

  const [step, setStep] = useState<"form" | "docs">("form");
  const [createdPartnerDisplayId, setCreatedPartnerDisplayId] = useState<string | null>(null);
  const [createdPartnerName, setCreatedPartnerName] = useState<string>("");
  const [createdPartnerSupabaseId, setCreatedPartnerSupabaseId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<boolean>(false);

  useEffect(() => {
    if (step !== "docs" || !createdPartnerDisplayId) return;
    let cancelled = false;
    setResolvingId(true);
    const tryResolve = async (attempt: number): Promise<void> => {
      const id = await resolvePartnerSupabaseId(createdPartnerDisplayId);
      if (cancelled) return;
      if (id) {
        setCreatedPartnerSupabaseId(id);
        setResolvingId(false);
        return;
      }
      if (attempt < 5) {
        setTimeout(() => { void tryResolve(attempt + 1); }, 600);
      } else {
        setResolvingId(false);
      }
    };
    void tryResolve(0);
    return () => {
      cancelled = true;
    };
  }, [step, createdPartnerDisplayId]);

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
    const list = vehicles;
    if (!q) return list.slice(0, 20);
    return list
      .filter(
        (v) =>
          v.plate.toLowerCase().includes(q) ||
          v.make.toLowerCase().includes(q) ||
          v.model.toLowerCase().includes(q) ||
          v.ownerName.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [vehicles, vehicleSearch]);

  const partnerPhones = useMemo(() => {
    const set = new Set<string>();
    partners.forEach((d) => set.add(d.phone.trim()));
    return set;
  }, [partners]);

  const eligibleUsers = useMemo(() => {
    return users.filter((u) => !partnerPhones.has(u.phone.trim()));
  }, [users, partnerPhones]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleUsers;
    return eligibleUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.ic ?? "").toLowerCase().includes(q)
    );
  }, [eligibleUsers, search]);

  const onSubmit = () => {
    if (!guard()) return;
    if (!selectedUser) {
      Alert.alert("Select user", "Please select a user to add as partner.");
      return;
    }
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
    const created = addPartner({
      name: selectedUser.name,
      phone: selectedUser.phone,
      email: selectedUser.email || undefined,
      ic: selectedUser.ic || undefined,
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
      status: autoApprove ? "approved" : "unapproved",
      permit: "none",
      documentsOk: false,
      rating: 0,
      totalRides: 0,
    });
    setCreatedPartnerDisplayId(created.id);
    setCreatedPartnerName(created.name);
    setStep("docs");
  };

  const renderUserItem = ({ item }: { item: UserRecord }) => (
    <TouchableOpacity
      onPress={() => setSelectedUser(item)}
      style={[styles.userRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
      activeOpacity={0.85}
      testID={`select-user-${item.id}`}
    >
      <View style={[styles.avatar, { backgroundColor: Colors.accent }]}>
        <Text style={[styles.avatarText, { color: Colors.secondary }]}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
          {item.phone} • {item.email}
        </Text>
      </View>
      <ChevronRight color={Colors.textSecondary} size={18} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="add-driver-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <UserPlus color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Add Partner</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {step === "docs"
              ? "Step 2 of 2 · Upload required documents"
              : selectedUser
                ? "Step 1 of 2 · Partner details"
                : "Select a user to onboard as partner"}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {step === "form" && !selectedUser && (
          <View style={{ flex: 1 }}>
            <View style={styles.searchSection}>
              <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Search color={Colors.textSecondary} size={18} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search users by name, phone, email…"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                  autoCapitalize="none"
                  testID="user-search"
                />
              </View>

              <TouchableOpacity
                onPress={() => router.push("/admin-user-add")}
                style={[styles.addUserBtn, { borderColor: Colors.accent }]}
                activeOpacity={0.85}
                testID="add-new-user"
              >
                <UserPlus color={Colors.accent} size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.addUserTitle, { color: Colors.text }]}>
                    User doesn’t exist?
                  </Text>
                  <Text style={[styles.addUserDesc, { color: Colors.textSecondary }]}>
                    Add a new user, then come back to select them
                  </Text>
                </View>
                <ChevronRight color={Colors.accent} size={18} />
              </TouchableOpacity>

              <Text style={[styles.listLabel, { color: Colors.textSecondary }]}>
                {filteredUsers.length} eligible user{filteredUsers.length === 1 ? "" : "s"}
              </Text>
            </View>

            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item.id}
              renderItem={renderUserItem}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <UserIcon color={Colors.textSecondary} size={28} />
                  <Text style={[styles.emptyTitle, { color: Colors.text }]}>No users found</Text>
                  <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
                    Try a different search, or add a new user above.
                  </Text>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
        {step === "form" && selectedUser && (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.selectedCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: Colors.accent }]}>
                <Text style={[styles.avatarText, { color: Colors.secondary }]}>
                  {selectedUser.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.userName, { color: Colors.text }]}>{selectedUser.name}</Text>
                <View style={styles.metaRow}>
                  <PhoneIcon color={Colors.textSecondary} size={12} />
                  <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {selectedUser.phone}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <MailIcon color={Colors.textSecondary} size={12} />
                  <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {selectedUser.email}
                  </Text>
                </View>
                {!!selectedUser.ic && (
                  <View style={styles.metaRow}>
                    <IdCard color={Colors.textSecondary} size={12} />
                    <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {selectedUser.ic}
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setSelectedUser(null)}
                style={[styles.iconBtnSm, { backgroundColor: Colors.background }]}
                testID="change-user"
              >
                <X color={Colors.text} size={16} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Service Area</Text>
            <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 8 }]}>
              Select country, state and city of service
            </Text>
            <ServiceAreaPicker
              value={serviceArea}
              onChange={setServiceArea}
              testID="add-partner-service-area"
            />

            {serviceAreaComplete ? (
              <>
                <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Partner Type</Text>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Type</Text>
                  <PartnerTypePicker
                    value={partnerTypes}
                    onChange={(v) => setPartnerTypes(v)}
                    testID="add-partner-type"
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
                    testID="add-partner-add-vehicle"
                  >
                    <Plus color={Colors.accent} size={14} />
                    <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add new</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 8 }]}>
                  Select from registered vehicles
                </Text>
                {selectedVehicle ? (
                  <View style={[styles.vehicleCard, { backgroundColor: Colors.gray[100], borderColor: Colors.accent }]}>
                    <View style={[styles.vehicleIcon, { backgroundColor: Colors.accent + "20" }]}>
                      <CarFront color={Colors.accent} size={18} />
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
                      testID="clear-vehicle"
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
                        testID="vehicle-search"
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
                            testID={`select-vehicle-${v.id}`}
                          >
                            <View style={[styles.vehicleIcon, { backgroundColor: Colors.accent + "15" }]}>
                              <CarFront color={Colors.accent} size={18} />
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
                <RequiredDocsChecklist
                  docTypeIds={allowedDocTypeIds}
                  countries={serviceArea.countries}
                  states={serviceArea.states.map((s) => {
                    const idx = s.indexOf("|");
                    if (idx === -1) return { country: serviceArea.countries[0] ?? "", state: s.trim() };
                    return { country: s.slice(0, idx).trim(), state: s.slice(idx + 1).trim() };
                  })}
                  subtitle={
                    allowedDocTypeIds
                      ? "Preview — you'll be able to upload these in the next step after the partner is created"
                      : "Preview — you'll be able to upload these in the next step after the partner is created"
                  }
                  testID="add-partner-required-docs"
                />
              </View>
            )}

            <TouchableOpacity
              onPress={() => setAutoApprove((v) => !v)}
              style={[
                styles.toggleRow,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
              activeOpacity={0.85}
              testID="auto-approve-toggle"
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
                {autoApprove && <Check color={Colors.secondary} size={16} />}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
              testID="submit-driver"
              activeOpacity={0.9}
            >
              <UserPlus color={Colors.secondary} size={18} />
              <Text style={[styles.submitText, { color: Colors.secondary }]}>
                Create partner & continue
              </Text>
            </TouchableOpacity>

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
        {step === "docs" && createdPartnerDisplayId && (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.successCard, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
              <View style={[styles.avatar, { backgroundColor: Colors.accent }]}>
                <Check color={Colors.secondary} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>
                  {createdPartnerName} created
                </Text>
                <Text style={[styles.userMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                  Partner ID: {createdPartnerDisplayId} · {autoApprove ? "Approved" : "Pending approval"}
                </Text>
                <Text style={[styles.userMeta, { color: Colors.textSecondary }]}>
                  Now upload the partner's required documents below.
                </Text>
              </View>
            </View>

            {resolvingId || !createdPartnerSupabaseId ? (
              <View style={[styles.gateCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 16, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <ActivityIndicator color={Colors.accent} />
                <Text style={[styles.gateText, { color: Colors.textSecondary, flex: 1 }]}>
                  {resolvingId
                    ? "Syncing partner to the server before opening the uploader…"
                    : "Couldn't sync the new partner to the server yet. Save and re-open from the partners list to upload documents."}
                </Text>
              </View>
            ) : (
              <View style={{ marginTop: 16 }}>
                <RequiredDocsUploader
                  partnerId={createdPartnerSupabaseId}
                  authUserId={null}
                  docTypeIds={allowedDocTypeIds}
                  countries={serviceArea.countries}
                  states={serviceArea.states.map((s) => {
                    const idx = s.indexOf("|");
                    if (idx === -1) return { country: serviceArea.countries[0] ?? "", state: s.trim() };
                    return { country: s.slice(0, idx).trim(), state: s.slice(idx + 1).trim() };
                  })}
                  subtitle={
                    allowedDocTypeIds
                      ? "Filtered by document types assigned to the selected partner type(s) and service area"
                      : "Filtered by the selected service area"
                  }
                  testID="add-partner-docs-uploader"
                />
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => {
                  if (createdPartnerDisplayId) {
                    router.replace({ pathname: "/admin-partner-edit", params: { id: createdPartnerDisplayId } });
                  } else {
                    router.back();
                  }
                }}
                style={[styles.submitBtn, { backgroundColor: Colors.gray[100], borderWidth: 1, borderColor: Colors.border, flex: 1, marginTop: 0 }]}
                activeOpacity={0.9}
                testID="open-partner-edit"
              >
                <Text style={[styles.submitText, { color: Colors.text }]}>Open partner</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.back()}
                style={[styles.submitBtn, { backgroundColor: Colors.accent, flex: 1, marginTop: 0 }]}
                activeOpacity={0.9}
                testID="finish-add-partner"
              >
                <Check color={Colors.secondary} size={18} />
                <Text style={[styles.submitText, { color: Colors.secondary }]}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
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
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  searchSection: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  listLabel: { fontSize: 12, fontWeight: "700" as const, marginTop: 4 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
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
  userRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  avatarText: { fontSize: 16, fontWeight: "800" as const },
  userName: { fontSize: 14, fontWeight: "700" as const },
  userMeta: { fontSize: 12, marginTop: 2 },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 2,
  },
  emptyWrap: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: "700" as const },
  emptyDesc: { fontSize: 12, textAlign: "center" as const, paddingHorizontal: 24 },
  addUserBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed" as const,
  },
  addUserTitle: { fontSize: 14, fontWeight: "700" as const },
  addUserDesc: { fontSize: 12, marginTop: 2 },
  selectedCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  successCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
});
