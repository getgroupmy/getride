import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Search,
  Inbox,
  Save,
  Package,
  Zap,
  Palette,
  Sofa,
  Sparkles,
  ShoppingBag,
  Check,
  ChevronDown,
  Hash,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "ev-vehicle-inventory";
const DETAILS_KEY = "ev-vehicle-details";

interface ColorItem {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
}
interface PricedItem {
  id: string;
  name: string;
  price: number | string;
  enabled: boolean;
}

interface FormValues {
  vehicleId: string;
  exteriorColorIds: string[];
  interiorColorIds: string[];
  featureIds: string[];
  accessoryIds: string[];
  vin: string;
}

const emptyForm = (): FormValues => ({
  vehicleId: "",
  exteriorColorIds: [],
  interiorColorIds: [],
  featureIds: [],
  accessoryIds: [],
  vin: "",
});

const safeParse = <T,>(raw: string | number | boolean | undefined, fallback: T): T => {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const parseIds = (raw: string | number | boolean | undefined): string[] => {
  if (!raw || typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
};

export default function AdminSettingsEvVehicleInventoryScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();

  const entries = getEntries(STORAGE_KEY);
  const vehicles = getEntries(DETAILS_KEY);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm());

  const vehicleById = useMemo(() => {
    const m = new Map<string, SettingEntry>();
    vehicles.forEach((v) => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const selectedVehicle = form.vehicleId ? vehicleById.get(form.vehicleId) ?? null : null;

  const availExterior = useMemo<ColorItem[]>(
    () =>
      selectedVehicle
        ? safeParse<ColorItem[]>(selectedVehicle.values.exteriorColors, []).filter((c) => c.enabled)
        : [],
    [selectedVehicle]
  );
  const availInterior = useMemo<ColorItem[]>(
    () =>
      selectedVehicle
        ? safeParse<ColorItem[]>(selectedVehicle.values.interiorColors, []).filter((c) => c.enabled)
        : [],
    [selectedVehicle]
  );
  const availFeatures = useMemo<PricedItem[]>(
    () =>
      selectedVehicle
        ? safeParse<PricedItem[]>(selectedVehicle.values.features, []).filter((c) => c.enabled)
        : [],
    [selectedVehicle]
  );
  const availAccessories = useMemo<PricedItem[]>(
    () =>
      selectedVehicle
        ? safeParse<PricedItem[]>(selectedVehicle.values.accessories, []).filter((c) => c.enabled)
        : [],
    [selectedVehicle]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const v = e.values.vehicleId ? vehicleById.get(String(e.values.vehicleId)) : null;
      const make = v ? String(v.values.make ?? "") : String(e.values.make ?? "");
      const model = v ? String(v.values.model ?? "") : String(e.values.model ?? "");
      const vin = String(e.values.vin ?? "");
      return `${make} ${model} ${vin}`.toLowerCase().includes(q);
    });
  }, [entries, query, vehicleById]);

  const openAdd = () => {
    setForm(emptyForm());
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setForm({
      vehicleId: String(entry.values.vehicleId ?? ""),
      exteriorColorIds: parseIds(entry.values.exteriorColorIds),
      interiorColorIds: parseIds(entry.values.interiorColorIds),
      featureIds: parseIds(entry.values.featureIds),
      accessoryIds: parseIds(entry.values.accessoryIds),
      vin: String(entry.values.vin ?? ""),
    });
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const toggleId = (key: keyof Pick<FormValues, "exteriorColorIds" | "interiorColorIds" | "featureIds" | "accessoryIds">, id: string) => {
    setForm((p) => {
      const arr = p[key];
      const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
      return { ...p, [key]: next };
    });
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.vehicleId) {
      Alert.alert("Missing field", "Please select a vehicle.");
      return;
    }
    if (!form.vin.trim()) {
      Alert.alert("Missing field", "Please enter a VIN number.");
      return;
    }
    const v = vehicleById.get(form.vehicleId);
    const make = v ? String(v.values.make ?? "") : "";
    const model = v ? String(v.values.model ?? "") : "";

    // Snapshot selected names for easy display
    const exteriorSnap = availExterior
      .filter((c) => form.exteriorColorIds.includes(c.id))
      .map((c) => c.name);
    const interiorSnap = availInterior
      .filter((c) => form.interiorColorIds.includes(c.id))
      .map((c) => c.name);
    const featuresSnap = availFeatures
      .filter((c) => form.featureIds.includes(c.id))
      .map((c) => c.name);
    const accessoriesSnap = availAccessories
      .filter((c) => form.accessoryIds.includes(c.id))
      .map((c) => c.name);

    const cleaned: Record<string, string | number | boolean> = {
      vehicleId: form.vehicleId,
      make,
      model,
      vin: form.vin.trim(),
      exteriorColorIds: JSON.stringify(form.exteriorColorIds),
      interiorColorIds: JSON.stringify(form.interiorColorIds),
      featureIds: JSON.stringify(form.featureIds),
      accessoryIds: JSON.stringify(form.accessoryIds),
      exteriorColor: exteriorSnap.join(", "),
      interiorColor: interiorSnap.join(", "),
      features: featuresSnap.join(", "),
      accessories: accessoriesSnap.join(", "),
    };

    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, { ...editing.values, ...cleaned });
    } else {
      addEntry(STORAGE_KEY, cleaned);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this inventory unit?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => removeEntry(STORAGE_KEY, entry.id) },
    ]);
  };

  const renderRow = (entry: SettingEntry) => {
    const v = entry.values.vehicleId ? vehicleById.get(String(entry.values.vehicleId)) : null;
    const make = v ? String(v.values.make ?? "") : String(entry.values.make ?? "");
    const model = v ? String(v.values.model ?? "") : String(entry.values.model ?? "");
    const imageUri = v ? String(v.values.imageUri ?? "") : "";
    const vin = String(entry.values.vin ?? "");
    const exterior = String(entry.values.exteriorColor ?? "");
    const interior = String(entry.values.interiorColor ?? "");
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumb} />
        ) : (
          <View
            style={[
              styles.thumb,
              { backgroundColor: Colors.accent + "20", alignItems: "center", justifyContent: "center" },
            ]}
          >
            <Zap color={Colors.accent} size={22} />
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
            {make} {model}
          </Text>
          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
            VIN {vin || "—"}
          </Text>
          {(exterior || interior) ? (
            <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
              {exterior ? `Ext: ${exterior}` : ""}
              {exterior && interior ? "  •  " : ""}
              {interior ? `Int: ${interior}` : ""}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`inv-edit-${entry.id}`}
          accessibilityRole="button"
          accessibilityLabel="Edit inv"
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`inv-delete-${entry.id}`}
          accessibilityRole="button"
          accessibilityLabel="Delete inv"
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderColorChips = (
    title: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    items: ColorItem[],
    selected: string[],
    key: "exteriorColorIds" | "interiorColorIds"
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Icon color={Colors.accent} size={16} />
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={[styles.emptyHint, { color: Colors.textSecondary }]}>
          {selectedVehicle ? "None available." : "Select a vehicle first."}
        </Text>
      ) : (
        <View style={styles.chipWrap}>
          {items.map((c) => {
            const active = selected.includes(c.id);
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => toggleId(key, c.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? Colors.accent + "20" : Colors.gray[100],
                    borderColor: active ? Colors.accent : Colors.border,
                  },
                ]}
                testID={`${key}-${c.id}`}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.chipSwatch,
                    { backgroundColor: c.code || Colors.gray[200], borderColor: Colors.border },
                  ]}
                />
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? Colors.accent : Colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {c.name || c.code}
                </Text>
                {active ? <Check color={Colors.accent} size={14} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderPricedChips = (
    title: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    items: PricedItem[],
    selected: string[],
    key: "featureIds" | "accessoryIds"
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Icon color={Colors.accent} size={16} />
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={[styles.emptyHint, { color: Colors.textSecondary }]}>
          {selectedVehicle ? "None available." : "Select a vehicle first."}
        </Text>
      ) : (
        <View style={styles.chipWrap}>
          {items.map((c) => {
            const active = selected.includes(c.id);
            const priceNum = typeof c.price === "number" ? c.price : parseFloat(String(c.price ?? ""));
            const priceText = Number.isFinite(priceNum) && priceNum > 0 ? ` • RM ${priceNum.toLocaleString()}` : "";
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => toggleId(key, c.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? Colors.accent + "20" : Colors.gray[100],
                    borderColor: active ? Colors.accent : Colors.border,
                  },
                ]}
                testID={`${key}-${c.id}`}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? Colors.accent : Colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {c.name}
                  {priceText}
                </Text>
                {active ? <Check color={Colors.accent} size={14} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );

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
          testID="inv-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Package color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              EV Vehicle Inventory
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Available units ready for fast delivery
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="inv-add"
          accessibilityRole="button"
          accessibilityLabel="Add inv"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search make, model or VIN"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="inv-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No inventory yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap + to add a new unit.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="inv-empty-add"
              accessibilityRole="button"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add Unit</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e) => renderRow(e))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit Inventory Unit" : "Add Inventory Unit"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="inv-modal-close"
                  accessibilityRole="button"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 560 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* Vehicle picker */}
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Vehicle *</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (vehicles.length === 0) {
                      Alert.alert(
                        "No vehicles",
                        "Add a vehicle in EV Vehicle Details first.",
                      );
                      return;
                    }
                    setVehiclePickerOpen(true);
                  }}
                  activeOpacity={0.85}
                  style={[
                    styles.selectWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                  testID="inv-vehicle-select"
                  accessibilityRole="button"
                >
                  {selectedVehicle ? (
                    <View style={styles.selectInner}>
                      {selectedVehicle.values.imageUri ? (
                        <Image
                          source={{ uri: String(selectedVehicle.values.imageUri) }}
                          style={styles.selectThumb}
                        />
                      ) : (
                        <View
                          style={[
                            styles.selectThumb,
                            {
                              backgroundColor: Colors.accent + "20",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          ]}
                        >
                          <Zap color={Colors.accent} size={16} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.selectTitle, { color: Colors.text }]} numberOfLines={1}>
                          {String(selectedVehicle.values.make ?? "")}{" "}
                          {String(selectedVehicle.values.model ?? "")}
                        </Text>
                        <Text
                          style={[styles.selectSub, { color: Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          RM {Number(selectedVehicle.values.price ?? 0).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={[styles.selectPlaceholder, { color: Colors.textSecondary }]}>
                      Choose a vehicle from EV Vehicle Details
                    </Text>
                  )}
                  <ChevronDown color={Colors.textSecondary} size={18} />
                </TouchableOpacity>

                {/* VIN */}
                <Text style={[styles.label, { color: Colors.textSecondary }]}>VIN Number *</Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <Hash color={Colors.textSecondary} size={16} />
                  <TextInput
                    value={form.vin}
                    onChangeText={(t) => setForm((p) => ({ ...p, vin: t.toUpperCase() }))}
                    placeholder="1HGBH41JXMN109186"
                    placeholderTextColor={Colors.textSecondary}
                    autoCapitalize="characters"
                    style={[styles.input, { color: Colors.text }]}
                    testID="inv-vin"
                  />
                </View>

                {renderColorChips(
                  "Exterior Colour",
                  Palette,
                  availExterior,
                  form.exteriorColorIds,
                  "exteriorColorIds"
                )}
                {renderColorChips(
                  "Interior Colour",
                  Sofa,
                  availInterior,
                  form.interiorColorIds,
                  "interiorColorIds"
                )}
                {renderPricedChips(
                  "Add-on Features",
                  Sparkles,
                  availFeatures,
                  form.featureIds,
                  "featureIds"
                )}
                {renderPricedChips(
                  "Optional Accessories",
                  ShoppingBag,
                  availAccessories,
                  form.accessoryIds,
                  "accessoryIds"
                )}
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="inv-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Unit"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Vehicle picker modal */}
      <Modal
        visible={vehiclePickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setVehiclePickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>Select Vehicle</Text>
              <TouchableOpacity
                onPress={() => setVehiclePickerOpen(false)}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="inv-picker-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {vehicles.map((v) => {
                const active = v.id === form.vehicleId;
                return (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => {
                      setForm((p) => {
                        const changed = p.vehicleId !== v.id;
                        return {
                          ...p,
                          vehicleId: v.id,
                          exteriorColorIds: changed ? [] : p.exteriorColorIds,
                          interiorColorIds: changed ? [] : p.interiorColorIds,
                          featureIds: changed ? [] : p.featureIds,
                          accessoryIds: changed ? [] : p.accessoryIds,
                        };
                      });
                      setVehiclePickerOpen(false);
                    }}
                    style={[
                      styles.pickerRow,
                      {
                        backgroundColor: active ? Colors.accent + "15" : Colors.gray[100],
                        borderColor: active ? Colors.accent : Colors.border,
                      },
                    ]}
                    testID={`inv-pick-${v.id}`}
                    accessibilityRole="button"
                  >
                    {v.values.imageUri ? (
                      <Image
                        source={{ uri: String(v.values.imageUri) }}
                        style={styles.thumb}
                      />
                    ) : (
                      <View
                        style={[
                          styles.thumb,
                          {
                            backgroundColor: Colors.accent + "20",
                            alignItems: "center",
                            justifyContent: "center",
                          },
                        ]}
                      >
                        <Zap color={Colors.accent} size={22} />
                      </View>
                    )}
                    <View style={styles.rowInfo}>
                      <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
                        {String(v.values.make ?? "")} {String(v.values.model ?? "")}
                      </Text>
                      <Text
                        style={[styles.rowDesc, { color: Colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        RM {Number(v.values.price ?? 0).toLocaleString()}
                      </Text>
                    </View>
                    {active ? <Check color={Colors.accent} size={18} /> : null}
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  iconBtnSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  rowMeta: { fontSize: 11, marginTop: 2 },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { fontSize: 13, fontWeight: "800" as const },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6, marginTop: 10 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  selectWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 60,
    borderRadius: 12,
    borderWidth: 1,
  },
  selectInner: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flex: 1 },
  selectThumb: { width: 40, height: 40, borderRadius: 10 },
  selectTitle: { fontSize: 14, fontWeight: "700" as const },
  selectSub: { fontSize: 12, marginTop: 2 },
  selectPlaceholder: { fontSize: 14, flex: 1 },
  section: { marginTop: 14 },
  sectionTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const },
  emptyHint: { fontSize: 12, fontStyle: "italic" as const, paddingVertical: 4 },
  chipWrap: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  chip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%" as const,
  },
  chipSwatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "700" as const },
  pickerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    marginBottom: 8,
  },
  submitBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginTop: 6,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
});
