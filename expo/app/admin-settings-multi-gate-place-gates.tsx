import React, { useCallback, useMemo, useState } from "react";
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
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  DoorOpen,
  MapPin,
  Inbox,
  Crosshair,
  Building2,
  ChevronDown,
  Power,
  ListOrdered,
  Check,
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  DollarSign,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

let MapViewRN: any = null;
let MarkerRN: any = null;
try {
  if (Platform.OS !== "web") {
    const Maps = require("react-native-maps");
    MapViewRN = Maps.default;
    MarkerRN = Maps.Marker;
  }
} catch (e) {
  console.log("[mgp-gates] react-native-maps unavailable", e);
}

const GATES_KEY = "multi-gate-place-gates" as const;
const PLACES_KEY = "multi-gate-places" as const;

type GateMode = "both" | "pickup" | "drop";

interface GateForm {
  name: string;
  lat: string;
  lon: string;
  displayPriority: number;
  active: boolean;
  mode: GateMode;
  pickupSurcharge: string;
  dropSurcharge: string;
}

const EMPTY_FORM: GateForm = { name: "", lat: "", lon: "", displayPriority: 1, active: true, mode: "both", pickupSurcharge: "", dropSurcharge: "" };

const MODE_OPTIONS: { id: GateMode; label: string; Icon: React.ComponentType<{ color?: string; size?: number }> }[] = [
  { id: "both", label: "Both", Icon: ArrowLeftRight },
  { id: "pickup", label: "Pick up", Icon: ArrowUpFromLine },
  { id: "drop", label: "Drop", Icon: ArrowDownToLine },
];

export default function AdminSettingsMultiGatePlaceGatesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const params = useLocalSearchParams<{ placeId?: string; parentKey?: string }>();
  const placeId = String(params.placeId ?? "");
  const parentKey = String(params.parentKey ?? PLACES_KEY) || PLACES_KEY;
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();

  const place = useMemo<SettingEntry | undefined>(() => {
    return getEntries(parentKey).find((e) => e.id === placeId);
  }, [getEntries, placeId, parentKey]);

  const allGates = getEntries(GATES_KEY);
  const gates = useMemo(
    () => allGates.filter((g) => String(g.values.placeId ?? "") === placeId && String(g.values.parentKey ?? PLACES_KEY) === parentKey),
    [allGates, placeId, parentKey]
  );

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<GateForm>(EMPTY_FORM);
  const [mapOpen, setMapOpen] = useState<boolean>(false);
  const [priorityOpen, setPriorityOpen] = useState<boolean>(false);

  const sortedGates = useMemo(() => {
    return [...gates].sort((a, b) => {
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      return pa - pb;
    });
  }, [gates]);

  const moveGate = useCallback(
    (id: string, dir: -1 | 1) => {
      const ids = sortedGates.map((g) => g.id);
      const from = ids.indexOf(id);
      if (from === -1) return;
      const to = from + dir;
      if (to < 0 || to >= ids.length) return;
      const next = [...ids];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
      next.forEach((gid, idx) => {
        const g = sortedGates.find((x) => x.id === gid);
        if (!g) return;
        const newPriority = idx + 1;
        if (Number(g.values.displayPriority ?? -1) !== newPriority) {
          updateEntry(GATES_KEY, gid, { ...g.values, displayPriority: newPriority });
        }
      });
    },
    [sortedGates, updateEntry]
  );

  const placeLat = parseFloat(String(place?.values.lat ?? "")) || 3.139;
  const placeLon = parseFloat(String(place?.values.lon ?? "")) || 101.6869;

  const initialPickerRegion = useMemo(() => {
    const lat = parseFloat(form.lat) || placeLat;
    const lon = parseFloat(form.lon) || placeLon;
    return {
      latitude: lat,
      longitude: lon,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [form.lat, form.lon, placeLat, placeLon]);

  const openAdd = () => {
    const nextNum = gates.length + 1;
    setForm({
      name: `Gate ${nextNum}`,
      lat: String(placeLat),
      lon: String(placeLon),
      displayPriority: nextNum,
      active: true,
      mode: "both",
      pickupSurcharge: "",
      dropSurcharge: "",
    });
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const priorityRaw = entry.values.displayPriority;
    const activeRaw = entry.values.active;
    const modeRaw = String(entry.values.mode ?? "both");
    const mode: GateMode = modeRaw === "pickup" || modeRaw === "drop" ? modeRaw : "both";
    setForm({
      name: String(entry.values.name ?? ""),
      lat: String(entry.values.lat ?? ""),
      lon: String(entry.values.lon ?? ""),
      displayPriority: priorityRaw === undefined ? 1 : Number(priorityRaw) || 1,
      active: activeRaw === undefined ? true : Boolean(activeRaw),
      mode,
      pickupSurcharge: entry.values.pickupSurcharge === undefined || entry.values.pickupSurcharge === null ? "" : String(entry.values.pickupSurcharge),
      dropSurcharge: entry.values.dropSurcharge === undefined || entry.values.dropSurcharge === null ? "" : String(entry.values.dropSurcharge),
    });
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setMapOpen(false);
  };

  const onSave = () => {
    if (!guard()) return;
    const name = form.name.trim();
    const lat = parseFloat(form.lat);
    const lon = parseFloat(form.lon);
    if (!name) {
      Alert.alert("Missing field", "Please enter a gate name.");
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      Alert.alert("Invalid location", "Please provide a valid latitude and longitude.");
      return;
    }
    const parseSurcharge = (s: string): string => {
      const t = s.trim();
      if (!t) return "";
      const n = parseFloat(t);
      if (!Number.isFinite(n) || n < 0) return "";
      return String(n);
    };
    const pickupSurcharge = form.mode === "drop" ? "" : parseSurcharge(form.pickupSurcharge);
    const dropSurcharge = form.mode === "pickup" ? "" : parseSurcharge(form.dropSurcharge);
    const cleaned = {
      placeId,
      parentKey,
      name,
      lat: String(lat),
      lon: String(lon),
      displayPriority: form.displayPriority,
      active: form.active,
      mode: form.mode,
      pickupSurcharge,
      dropSurcharge,
    };
    if (editing) {
      updateEntry(GATES_KEY, editing.id, cleaned);
    } else {
      addEntry(GATES_KEY, cleaned);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete gate", "Remove this gate?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(GATES_KEY, entry.id),
      },
    ]);
  };

  const renderGate = (entry: SettingEntry, index: number, total: number) => {
    const name = String(entry.values.name ?? "Gate");
    const lat = String(entry.values.lat ?? "");
    const lon = String(entry.values.lon ?? "");
    const priorityRaw = entry.values.displayPriority;
    const activeRaw = entry.values.active;
    const priority = priorityRaw === undefined ? "-" : String(priorityRaw);
    const active = activeRaw === undefined ? true : Boolean(activeRaw);
    const modeRaw = String(entry.values.mode ?? "both");
    const mode: GateMode = modeRaw === "pickup" || modeRaw === "drop" ? modeRaw : "both";
    const modeMeta = MODE_OPTIONS.find((m) => m.id === mode) ?? MODE_OPTIONS[0];
    const ModeIcon = modeMeta.Icon;
    const pickupSurchargeRaw = entry.values.pickupSurcharge;
    const dropSurchargeRaw = entry.values.dropSurcharge;
    const pickupSurchargeNum = pickupSurchargeRaw === undefined || pickupSurchargeRaw === null || pickupSurchargeRaw === "" ? null : Number(pickupSurchargeRaw);
    const dropSurchargeNum = dropSurchargeRaw === undefined || dropSurchargeRaw === null || dropSurchargeRaw === "" ? null : Number(dropSurchargeRaw);
    const showPickupSurcharge = mode !== "drop" && pickupSurchargeNum !== null && Number.isFinite(pickupSurchargeNum) && pickupSurchargeNum > 0;
    const showDropSurcharge = mode !== "pickup" && dropSurchargeNum !== null && Number.isFinite(dropSurchargeNum) && dropSurchargeNum > 0;
    const isFirst = index === 0;
    const isLast = index === total - 1;

    return (
      <View
        key={entry.id}
        style={[
          styles.row,
          {
            backgroundColor: Colors.gray[100],
            borderColor: Colors.border,
            opacity: active ? 1 : 0.6,
          },
        ]}
        testID={`gate-row-${entry.id}`}
      >
        <View style={styles.reorderColumn}>
          <TouchableOpacity
            onPress={() => moveGate(entry.id, -1)}
            disabled={isFirst}
            style={[
              styles.reorderBtn,
              {
                backgroundColor: isFirst ? Colors.background : Colors.accent + "20",
                opacity: isFirst ? 0.4 : 1,
              },
            ]}
            testID={`gate-move-up-${entry.id}`}
            hitSlop={{ top: 4, bottom: 2, left: 4, right: 4 }}
          >
            <ChevronUp color={isFirst ? Colors.textSecondary : Colors.accent} size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => moveGate(entry.id, 1)}
            disabled={isLast}
            style={[
              styles.reorderBtn,
              {
                backgroundColor: isLast ? Colors.background : Colors.accent + "20",
                opacity: isLast ? 0.4 : 1,
              },
            ]}
            testID={`gate-move-down-${entry.id}`}
            hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
          >
            <ChevronDownIcon color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
          </TouchableOpacity>
        </View>
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          <DoorOpen color={Colors.accent} size={18} />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
              <ListOrdered color={Colors.onAccent} size={10} />
              <Text style={[styles.priorityText, { color: Colors.onAccent }]}>{priority}</Text>
            </View>
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: (active ? Colors.accent : Colors.error) + "20" }]}>
              <Power color={active ? Colors.accent : Colors.error} size={10} />
              <Text style={[styles.statusBadgeText, { color: active ? Colors.accent : Colors.error }]}>
                {active ? "Active" : "Hidden"}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: Colors.accent + "20" }]}>
              <ModeIcon color={Colors.accent} size={10} />
              <Text style={[styles.statusBadgeText, { color: Colors.accent }]}>
                {modeMeta.label}
              </Text>
            </View>
            {showPickupSurcharge ? (
              <View style={[styles.statusBadge, { backgroundColor: Colors.accent + "20" }]}>
                <ArrowUpFromLine color={Colors.accent} size={10} />
                <DollarSign color={Colors.accent} size={10} />
                <Text style={[styles.statusBadgeText, { color: Colors.accent }]}>
                  +{pickupSurchargeNum}
                </Text>
              </View>
            ) : null}
            {showDropSurcharge ? (
              <View style={[styles.statusBadge, { backgroundColor: Colors.accent + "20" }]}>
                <ArrowDownToLine color={Colors.accent} size={10} />
                <DollarSign color={Colors.accent} size={10} />
                <Text style={[styles.statusBadgeText, { color: Colors.accent }]}>
                  +{dropSurchargeNum}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.coordsLine}>
            <MapPin color={Colors.textSecondary} size={11} />
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
              {lat}, {lon}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`gate-edit-${entry.id}`}
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`gate-delete-${entry.id}`}
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="gates-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Building2 color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              {String(place?.values.name ?? "Place Gates")}
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {gates.length} {gates.length === 1 ? "gate" : "gates"} assigned
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="gates-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!place ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>Place not found</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              The place you are trying to manage does not exist.
            </Text>
          </View>
        ) : gates.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <DoorOpen color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No gates yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Add a gate location and name to help drivers reach the right pickup point.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="gates-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add gate</Text>
            </TouchableOpacity>
          </View>
        ) : (
          sortedGates.map((g, i) => renderGate(g, i, sortedGates.length))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={modalOpen && !mapOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit Gate" : "Add Gate"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="gates-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Gate Name *</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.name}
                      onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                      placeholder="e.g. Gate A / Departure Hall"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="gate-field-name"
                    />
                  </View>
                </View>

                <View style={styles.row2}>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Latitude *</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={form.lat}
                        onChangeText={(t) => setForm((p) => ({ ...p, lat: t }))}
                        placeholder="2.7456"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="gate-field-lat"
                      />
                    </View>
                  </View>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Longitude *</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={form.lon}
                        onChangeText={(t) => setForm((p) => ({ ...p, lon: t }))}
                        placeholder="101.7099"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID="gate-field-lon"
                      />
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => setMapOpen(true)}
                  style={[styles.pickBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                  testID="gate-pick-map"
                >
                  <Crosshair color={Colors.accent} size={16} />
                  <Text style={[styles.pickText, { color: Colors.text }]}>
                    {MapViewRN ? "Pick on map" : "Map unavailable on web — enter manually"}
                  </Text>
                </TouchableOpacity>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Display Priority</Text>
                  <TouchableOpacity
                    onPress={() => setPriorityOpen((v) => !v)}
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border, justifyContent: "space-between" },
                    ]}
                    testID="gate-field-priority"
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ListOrdered color={Colors.accent} size={16} />
                      <Text style={[styles.input, { color: Colors.text, paddingVertical: 0 }]}>
                        {form.displayPriority}
                      </Text>
                    </View>
                    <ChevronDown color={Colors.textSecondary} size={18} />
                  </TouchableOpacity>
                  {priorityOpen && (
                    <View style={[styles.dropdown, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                        {Array.from({ length: Math.max(gates.length + 1, 10) }, (_, i) => i + 1).map((n) => {
                          const selected = n === form.displayPriority;
                          return (
                            <TouchableOpacity
                              key={n}
                              onPress={() => {
                                setForm((p) => ({ ...p, displayPriority: n }));
                                setPriorityOpen(false);
                              }}
                              style={[
                                styles.dropdownItem,
                                selected && { backgroundColor: Colors.accent + "20" },
                              ]}
                              testID={`gate-priority-${n}`}
                            >
                              <Text style={[styles.dropdownText, { color: Colors.text, fontWeight: selected ? "800" : "500" }]}>
                                {n}
                              </Text>
                              {selected && <Check color={Colors.accent} size={16} />}
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                  <Text style={[styles.helperText, { color: Colors.textSecondary }]}>
                    Lower number shows first to users.
                  </Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Available For</Text>
                  <View style={styles.modeRow}>
                    {MODE_OPTIONS.map((opt) => {
                      const selected = form.mode === opt.id;
                      const OptIcon = opt.Icon;
                      return (
                        <TouchableOpacity
                          key={opt.id}
                          onPress={() => setForm((p) => ({ ...p, mode: opt.id }))}
                          style={[
                            styles.modeOption,
                            {
                              backgroundColor: selected ? Colors.accent + "20" : Colors.gray[100],
                              borderColor: selected ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`gate-mode-${opt.id}`}
                        >
                          <View
                            style={[
                              styles.radioOuter,
                              { borderColor: selected ? Colors.accent : Colors.border },
                            ]}
                          >
                            {selected ? (
                              <View style={[styles.radioInner, { backgroundColor: Colors.accent }]} />
                            ) : null}
                          </View>
                          <OptIcon color={selected ? Colors.accent : Colors.textSecondary} size={16} />
                          <Text
                            style={[
                              styles.modeLabel,
                              { color: selected ? Colors.accent : Colors.text, fontWeight: selected ? "800" : "600" },
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.helperText, { color: Colors.textSecondary }]}>
                    Controls when this gate appears in place search.
                  </Text>
                </View>

                {(form.mode === "both" || form.mode === "pickup") ? (
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Pickup Surcharge</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <DollarSign color={Colors.accent} size={16} />
                      <TextInput
                        value={form.pickupSurcharge}
                        onChangeText={(t) => setForm((p) => ({ ...p, pickupSurcharge: t }))}
                        placeholder="0.00"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text, marginLeft: 8 }]}
                        testID="gate-field-pickup-surcharge"
                      />
                    </View>
                    <Text style={[styles.helperText, { color: Colors.textSecondary }]}>
                      Extra fee added when this gate is used for pickup.
                    </Text>
                  </View>
                ) : null}

                {(form.mode === "both" || form.mode === "drop") ? (
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Drop Surcharge</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <DollarSign color={Colors.accent} size={16} />
                      <TextInput
                        value={form.dropSurcharge}
                        onChangeText={(t) => setForm((p) => ({ ...p, dropSurcharge: t }))}
                        placeholder="0.00"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text, marginLeft: 8 }]}
                        testID="gate-field-drop-surcharge"
                      />
                    </View>
                    <Text style={[styles.helperText, { color: Colors.textSecondary }]}>
                      Extra fee added when this gate is used for drop-off.
                    </Text>
                  </View>
                ) : null}

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={[styles.toggleIcon, { backgroundColor: (form.active ? Colors.accent : Colors.error) + "20" }]}>
                    <Power color={form.active ? Colors.accent : Colors.error} size={18} />
                  </View>
                  <View style={styles.toggleInfo}>
                    <Text style={[styles.toggleTitle, { color: Colors.text }]}>Status</Text>
                    <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>
                      {form.active ? "Visible to users" : "Hidden from users"}
                    </Text>
                  </View>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    trackColor={{ false: Colors.border, true: Colors.accent }}
                    thumbColor={Platform.OS === "android" ? Colors.secondary : undefined}
                    testID="gate-field-active"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="gate-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Gate"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={mapOpen} animationType="slide" onRequestClose={() => setMapOpen(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          {MapViewRN ? (
            <MapViewRN
              style={{ flex: 1 }}
              initialRegion={initialPickerRegion}
              onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
                const c = e.nativeEvent.coordinate;
                setForm((p) => ({ ...p, lat: c.latitude.toFixed(6), lon: c.longitude.toFixed(6) }));
              }}
            >
              {Number.isFinite(parseFloat(form.lat)) && Number.isFinite(parseFloat(form.lon)) ? (
                <MarkerRN
                  coordinate={{
                    latitude: parseFloat(form.lat),
                    longitude: parseFloat(form.lon),
                  }}
                  draggable
                  onDragEnd={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
                    const c = e.nativeEvent.coordinate;
                    setForm((p) => ({ ...p, lat: c.latitude.toFixed(6), lon: c.longitude.toFixed(6) }));
                  }}
                />
              ) : null}
            </MapViewRN>
          ) : (
            <View style={styles.webFallback}>
              <Text style={{ color: Colors.text, fontSize: 14, textAlign: "center" }}>
                Map picker isn&apos;t available on web. Please enter latitude and longitude manually.
              </Text>
            </View>
          )}

          <View style={[styles.mapTopBar, { backgroundColor: Colors.background, borderBottomColor: Colors.border }]}>
            <TouchableOpacity
              onPress={() => setMapOpen(false)}
              style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
              testID="gate-map-close"
            >
              <X color={Colors.text} size={20} />
            </TouchableOpacity>
            <View style={styles.mapTitleWrap}>
              <Text style={[styles.mapTitle, { color: Colors.text }]} numberOfLines={1}>
                Tap to set gate location
              </Text>
              <Text style={[styles.mapSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                {form.lat || "—"}, {form.lon || "—"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setMapOpen(false)}
              style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
              testID="gate-map-done"
            >
              <Save color={Colors.onAccent} size={18} />
            </TouchableOpacity>
          </View>

          <View style={[styles.mapPin, { pointerEvents: "none" }]}>
            <View style={[styles.mapPinDot, { backgroundColor: Colors.accent }]} />
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
  content: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    backgroundColor: "transparent",
  },
  reorderColumn: {
    width: 32,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 4,
    marginLeft: -2,
  },
  reorderBtn: {
    width: 28,
    height: 26,
    borderRadius: 8,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12 },
  coordsLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 2 },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 10,
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
  fieldGroup: { marginBottom: 12 },
  row2: { flexDirection: "row" as const, gap: 10 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 12 },
  pickBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  pickText: { fontSize: 13, fontWeight: "700" as const },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  priorityPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  priorityText: { fontSize: 11, fontWeight: "800" as const },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 4, flexWrap: "wrap" as const },
  statusBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
  dropdown: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  dropdownItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownText: { fontSize: 14 },
  helperText: { fontSize: 11, marginTop: 6 },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    marginBottom: 4,
  },
  toggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  toggleInfo: { flex: 1 },
  toggleTitle: { fontSize: 14, fontWeight: "700" as const },
  toggleDesc: { fontSize: 11, marginTop: 2 },
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
  mapTopBar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  mapTitleWrap: { flex: 1 },
  mapTitle: { fontSize: 14, fontWeight: "800" as const },
  mapSub: { fontSize: 11, marginTop: 2 },
  mapPin: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    marginLeft: -8,
    marginTop: -8,
    width: 16,
    height: 16,
  },
  mapPinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: "#fff",
  },
  modeRow: { flexDirection: "row" as const, gap: 8 },
  modeOption: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  modeLabel: { fontSize: 12 },
  webFallback: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
  },
});
