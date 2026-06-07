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
  Layers,
  ImageIcon,
  Upload,
  Download,
  ChevronUp,
  ChevronDown,
  ListOrdered,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "vehicle-services" as const;

interface NumField {
  key: string;
  label: string;
  suffix?: string;
  required?: boolean;
}

const NUMBER_FIELDS: NumField[] = [
  { key: "costPerKm", label: "Cost Per Km", required: true },
  { key: "costPerMin", label: "Cost Per Min", required: true },
  { key: "minOfferFarePct", label: "Minimum Offer Fare Amount", suffix: "%" },
  { key: "maxBidPct", label: "Max Bid Amount", suffix: "%" },
  { key: "maxBidOfferScreenPct", label: "Max Bid Amount Offer Screen", suffix: "%" },
  { key: "maxBidDriverPct", label: "Max Bid Amount Driver Bid", suffix: "%" },
  { key: "minFareAmount", label: "Minimum Fare Amount", required: true },
  { key: "displayPriority", label: "Display Priority" },
  { key: "maxPax", label: "Max Pax" },
  { key: "maxLuggage", label: "Max Luggage" },
  { key: "maxWeight", label: "Max Weight", suffix: "kg" },
  { key: "maxSize", label: "Max Size", suffix: "L" },
  { key: "maxVehicleAge", label: "Max Vehicle Age", suffix: "yrs" },
];

const FUEL_TYPES = ["Petrol", "Diesel", "Electric"] as const;

const MAP_ICON_PALETTE: string[] = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#F43F5E",
  "#111827",
  "#6B7280",
  "#FFFFFF",
];

type FormState = {
  iconUri: string;
  heroImageUri: string;
  mapIconUri: string;
  mapIconColor: string;
  name: string;
  description: string;
  shortDescription: string;
  serviceTypes: string[];
  fuelTypes: string[];
  status: boolean;
} & Record<string, string | number | boolean | string[]>;

const emptyForm = (): FormState => {
  const f: FormState = {
    iconUri: "",
    heroImageUri: "",
    mapIconUri: "",
    mapIconColor: "",
    name: "",
    description: "",
    shortDescription: "",
    serviceTypes: [],
    fuelTypes: [],
    status: true,
  };
  NUMBER_FIELDS.forEach((nf) => {
    f[nf.key] = "";
  });
  return f;
};

export default function AdminSettingsVehicleServicesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);
  const serviceSettingEntries = getEntries("service-settings");

  const serviceTypeOptions = useMemo<string[]>(() => {
    const sorted = [...serviceSettingEntries].sort((a, b) => {
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      return pa - pb;
    });
    const names = sorted
      .map((e) => String(e.values.name ?? "").trim())
      .filter((n) => n.length > 0);
    return names;
  }, [serviceSettingEntries]);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      return pa - pb;
    });
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedEntries;
    return sortedEntries.filter((e) =>
      Object.values(e.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sortedEntries, query]);

  const moveEntry = useCallback(
    (id: string, dir: -1 | 1) => {
      const ids = sortedEntries.map((g) => g.id);
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
        const g = sortedEntries.find((x) => x.id === gid);
        if (!g) return;
        const newPriority = idx + 1;
        if (Number(g.values.displayPriority ?? -1) !== newPriority) {
          updateEntry(STORAGE_KEY, gid, { ...g.values, displayPriority: newPriority });
        }
      });
    },
    [sortedEntries, updateEntry]
  );

  const openAdd = () => {
    const f = emptyForm();
    f.displayPriority = String(entries.length + 1);
    setForm(f);
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    const v = entry.values;
    const f: FormState = {
      iconUri: String(v.iconUri ?? ""),
      heroImageUri: String(v.heroImageUri ?? ""),
      mapIconUri: String(v.mapIconUri ?? ""),
      mapIconColor: String(v.mapIconColor ?? ""),
      name: String(v.name ?? ""),
      description: String(v.description ?? ""),
      shortDescription: String(v.shortDescription ?? ""),
      serviceTypes: Array.isArray(v.serviceTypes) ? (v.serviceTypes as string[]) : [],
      fuelTypes: Array.isArray(v.fuelTypes) ? (v.fuelTypes as string[]) : [],
      status: v.status === undefined ? true : Boolean(v.status),
    };
    NUMBER_FIELDS.forEach((nf) => {
      const val = v[nf.key];
      f[nf.key] = val === undefined || val === null || val === "" ? "" : String(val);
    });
    setForm(f);
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.name.trim()) {
      Alert.alert("Missing field", "Please fill in Service Name.");
      return;
    }
    for (const nf of NUMBER_FIELDS) {
      if (nf.required) {
        const v = form[nf.key];
        if (v === undefined || v === null || String(v).trim() === "") {
          Alert.alert("Missing field", `Please fill in ${nf.label}.`);
          return;
        }
      }
    }
    const cleaned: Record<string, string | number | boolean | string[]> = {
      iconUri: form.iconUri,
      heroImageUri: form.heroImageUri,
      mapIconUri: form.mapIconUri,
      mapIconColor: form.mapIconColor,
      name: form.name.trim(),
      description: form.description.trim(),
      shortDescription: form.shortDescription.trim(),
      serviceTypes: form.serviceTypes,
      fuelTypes: form.fuelTypes,
      status: Boolean(form.status),
    };
    NUMBER_FIELDS.forEach((nf) => {
      const raw = form[nf.key];
      const n = parseFloat(String(raw ?? ""));
      cleaned[nf.key] = Number.isFinite(n) ? n : 0;
    });
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, cleaned);
    } else {
      addEntry(STORAGE_KEY, cleaned);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this vehicle service?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const downloadImage = async (uri: string, baseName: string) => {
    try {
      if (!uri) {
        Alert.alert("No image", "There is no image to download.");
        return;
      }
      const extFromMime = (m: string) => {
        if (m.includes("png")) return "png";
        if (m.includes("webp")) return "webp";
        if (m.includes("gif")) return "gif";
        return "jpg";
      };
      let ext = "jpg";
      const dataMatch = uri.match(/^data:([^;]+);base64,(.*)$/);
      if (dataMatch) ext = extFromMime(dataMatch[1]);
      else if (uri.startsWith("http")) {
        const m = uri.split("?")[0].match(/\.([a-zA-Z0-9]{3,4})$/);
        if (m) ext = m[1].toLowerCase();
      }
      const fileName = `${baseName}-${Date.now()}.${ext}`;

      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = uri;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      const dest = new File(Paths.cache, fileName);
      if (dataMatch) {
        if (dest.exists) dest.delete();
        dest.create();
        dest.write(
          Uint8Array.from(atob(dataMatch[2]), (c) => c.charCodeAt(0))
        );
      } else if (uri.startsWith("http")) {
        await File.downloadFileAsync(uri, dest, { idempotent: true });
      } else {
        const src = new File(uri);
        if (dest.exists) dest.delete();
        src.copy(dest);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dest.uri, { dialogTitle: "Save image" });
      } else {
        Alert.alert("Saved", `Saved to ${dest.uri}`);
      }
    } catch (e) {
      console.log("download error", e);
      Alert.alert("Error", "Could not download image.");
    }
  };

  const pickImage = async (target: "iconUri" | "heroImageUri" | "mapIconUri") => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: target === "heroImageUri" ? [16, 9] : [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        setForm((p) => ({ ...p, [target]: uri }));
      }
    } catch (e) {
      console.log("image pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const renderRow = (entry: SettingEntry, index: number, total: number) => {
    const v = entry.values;
    const iconUri = String(v.iconUri ?? "");
    const name = String(v.name ?? "Untitled");
    const active = v.status === undefined ? true : Boolean(v.status);
    const priorityRaw = v.displayPriority;
    const priority = priorityRaw === undefined || priorityRaw === "" ? "-" : String(priorityRaw);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const meta = [
      v.costPerKm !== undefined && v.costPerKm !== "" ? `Km ${v.costPerKm}` : "",
      v.costPerMin !== undefined && v.costPerMin !== "" ? `Min ${v.costPerMin}` : "",
      v.minFareAmount !== undefined && v.minFareAmount !== "" ? `Min Fare ${v.minFareAmount}` : "",
    ]
      .filter(Boolean)
      .join(" • ");
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`vehicle-service-row-${entry.id}`}
      >
        <View style={styles.reorderColumn}>
          <TouchableOpacity
            onPress={() => moveEntry(entry.id, -1)}
            disabled={isFirst}
            style={[
              styles.reorderBtn,
              {
                backgroundColor: isFirst ? Colors.background : Colors.accent + "20",
                opacity: isFirst ? 0.4 : 1,
              },
            ]}
            testID={`vehicle-service-move-up-${entry.id}`}
            hitSlop={{ top: 4, bottom: 2, left: 4, right: 4 }}
          >
            <ChevronUp color={isFirst ? Colors.textSecondary : Colors.accent} size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => moveEntry(entry.id, 1)}
            disabled={isLast}
            style={[
              styles.reorderBtn,
              {
                backgroundColor: isLast ? Colors.background : Colors.accent + "20",
                opacity: isLast ? 0.4 : 1,
              },
            ]}
            testID={`vehicle-service-move-down-${entry.id}`}
            hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
          >
            <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
          </TouchableOpacity>
        </View>
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          {iconUri ? (
            <Image source={{ uri: iconUri }} style={styles.rowIconImage} />
          ) : (
            <Layers color={Colors.accent} size={18} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleRow}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
              <ListOrdered color={Colors.secondary} size={10} />
              <Text style={[styles.priorityText, { color: Colors.secondary }]}>{priority}</Text>
            </View>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: active ? Colors.success + "22" : Colors.error + "22",
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: active ? Colors.success : Colors.error },
                ]}
              >
                {active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
          {!!meta && (
            <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vehicle-service-edit-${entry.id}`}
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`vehicle-service-delete-${entry.id}`}
        >
          <Trash2 color={Colors.error} size={16} />
        </TouchableOpacity>
      </View>
    );
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
          testID="vehicle-service-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Layers color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Vehicle Services
            </Text>
          </View>
          <Text
            style={[styles.headerSubtitle, { color: Colors.textSecondary }]}
            numberOfLines={1}
          >
            Manage vehicle services
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="vehicle-service-add"
        >
          <Plus color={Colors.secondary} size={22} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.searchWrap,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
      >
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="vehicle-service-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View
            style={[
              styles.emptyBox,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a new vehicle service.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="vehicle-service-empty-add"
            >
              <Plus color={Colors.secondary} size={16} />
              <Text style={[styles.ctaText, { color: Colors.secondary }]}>
                Add Vehicle Service
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e, i) => renderRow(e, i, filtered.length))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>
                  {editing ? "Edit Vehicle Service" : "Add Vehicle Service"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="vehicle-service-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: 520 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Icon upload */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Vehicle Icon
                  </Text>
                  <View style={styles.iconRow}>
                    <View
                      style={[
                        styles.iconPreview,
                        { backgroundColor: Colors.accent + "22", borderColor: Colors.border },
                      ]}
                    >
                      {form.iconUri ? (
                        <Image
                          source={{ uri: form.iconUri }}
                          style={styles.iconPreviewImage}
                        />
                      ) : (
                        <ImageIcon color={Colors.accent} size={26} />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => pickImage("iconUri")}
                        style={[
                          styles.uploadBtn,
                          { backgroundColor: Colors.accent, borderColor: Colors.accent },
                        ]}
                        testID="vehicle-service-icon-upload"
                      >
                        <Upload color={Colors.secondary} size={16} />
                        <Text
                          style={[styles.uploadBtnText, { color: Colors.secondary }]}
                        >
                          {form.iconUri ? "Change Image" : "Upload Image"}
                        </Text>
                      </TouchableOpacity>
                      {!!form.iconUri && (
                        <TouchableOpacity
                          onPress={() => setForm((p) => ({ ...p, iconUri: "" }))}
                          style={[
                            styles.uploadBtn,
                            {
                              backgroundColor: Colors.gray[100],
                              borderColor: Colors.border,
                            },
                          ]}
                          testID="vehicle-service-icon-remove"
                        >
                          <X color={Colors.text} size={16} />
                          <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                            Remove
                          </Text>
                        </TouchableOpacity>
                      )}
                      {!!form.iconUri && (
                        <TouchableOpacity
                          onPress={() => downloadImage(form.iconUri, "vehicle-icon")}
                          style={[
                            styles.uploadBtn,
                            {
                              backgroundColor: Colors.gray[100],
                              borderColor: Colors.border,
                            },
                          ]}
                          testID="vehicle-service-icon-download"
                        >
                          <Download color={Colors.text} size={16} />
                          <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                            Download
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>

                {/* Hero image upload */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Hero Image
                  </Text>
                  <View
                    style={[
                      styles.heroPreview,
                      { backgroundColor: Colors.accent + "15", borderColor: Colors.border },
                    ]}
                  >
                    {form.heroImageUri ? (
                      <Image
                        source={{ uri: form.heroImageUri }}
                        style={styles.heroPreviewImage}
                      />
                    ) : (
                      <ImageIcon color={Colors.accent} size={32} />
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => pickImage("heroImageUri")}
                      style={[
                        styles.uploadBtn,
                        { backgroundColor: Colors.accent, borderColor: Colors.accent, flex: 1 },
                      ]}
                      testID="vehicle-service-hero-upload"
                    >
                      <Upload color={Colors.secondary} size={16} />
                      <Text style={[styles.uploadBtnText, { color: Colors.secondary }]}>
                        {form.heroImageUri ? "Change Hero" : "Upload Hero"}
                      </Text>
                    </TouchableOpacity>
                    {!!form.heroImageUri && (
                      <TouchableOpacity
                        onPress={() => setForm((p) => ({ ...p, heroImageUri: "" }))}
                        style={[
                          styles.uploadBtn,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: Colors.border,
                          },
                        ]}
                        testID="vehicle-service-hero-remove"
                      >
                        <X color={Colors.text} size={16} />
                        <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                          Remove
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!!form.heroImageUri && (
                      <TouchableOpacity
                        onPress={() => downloadImage(form.heroImageUri, "vehicle-hero")}
                        style={[
                          styles.uploadBtn,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: Colors.border,
                          },
                        ]}
                        testID="vehicle-service-hero-download"
                      >
                        <Download color={Colors.text} size={16} />
                        <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                          Download
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Map Icon */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Map Icon
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary, marginBottom: 8 }]}>
                    Pick a colour from the palette or upload a custom icon shown on the map.
                  </Text>
                  <View style={styles.iconRow}>
                    <View
                      style={[
                        styles.iconPreview,
                        {
                          backgroundColor: form.mapIconUri
                            ? Colors.gray[100]
                            : form.mapIconColor || Colors.accent + "22",
                          borderColor: Colors.border,
                        },
                      ]}
                    >
                      {form.mapIconUri ? (
                        <Image
                          source={{ uri: form.mapIconUri }}
                          style={styles.iconPreviewImage}
                        />
                      ) : (
                        <ImageIcon
                          color={form.mapIconColor ? Colors.secondary : Colors.accent}
                          size={26}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => pickImage("mapIconUri")}
                        style={[
                          styles.uploadBtn,
                          { backgroundColor: Colors.accent, borderColor: Colors.accent },
                        ]}
                        testID="vehicle-service-map-icon-upload"
                      >
                        <Upload color={Colors.secondary} size={16} />
                        <Text style={[styles.uploadBtnText, { color: Colors.secondary }]}>
                          {form.mapIconUri ? "Change Icon" : "Upload Icon"}
                        </Text>
                      </TouchableOpacity>
                      {!!form.mapIconUri && (
                        <TouchableOpacity
                          onPress={() => setForm((p) => ({ ...p, mapIconUri: "" }))}
                          style={[
                            styles.uploadBtn,
                            {
                              backgroundColor: Colors.gray[100],
                              borderColor: Colors.border,
                            },
                          ]}
                          testID="vehicle-service-map-icon-remove"
                        >
                          <X color={Colors.text} size={16} />
                          <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                            Remove
                          </Text>
                        </TouchableOpacity>
                      )}
                      {!!form.mapIconUri && (
                        <TouchableOpacity
                          onPress={() => downloadImage(form.mapIconUri, "vehicle-map-icon")}
                          style={[
                            styles.uploadBtn,
                            {
                              backgroundColor: Colors.gray[100],
                              borderColor: Colors.border,
                            },
                          ]}
                          testID="vehicle-service-map-icon-download"
                        >
                          <Download color={Colors.text} size={16} />
                          <Text style={[styles.uploadBtnText, { color: Colors.text }]}>
                            Download
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.label,
                      { color: Colors.textSecondary, marginTop: 12, marginBottom: 6 },
                    ]}
                  >
                    Colour Palette
                  </Text>
                  <View style={styles.swatchRow}>
                    <TouchableOpacity
                      onPress={() => setForm((p) => ({ ...p, mapIconColor: "" }))}
                      style={[
                        styles.swatch,
                        styles.swatchNone,
                        {
                          borderColor:
                            form.mapIconColor === "" ? Colors.accent : Colors.border,
                          backgroundColor: Colors.gray[100],
                        },
                      ]}
                      testID="vehicle-service-map-color-none"
                    >
                      <X color={Colors.textSecondary} size={14} />
                    </TouchableOpacity>
                    {MAP_ICON_PALETTE.map((c) => {
                      const selected = form.mapIconColor.toLowerCase() === c.toLowerCase();
                      return (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setForm((p) => ({ ...p, mapIconColor: c }))}
                          style={[
                            styles.swatch,
                            {
                              backgroundColor: c,
                              borderColor: selected ? Colors.accent : Colors.border,
                              borderWidth: selected ? 3 : 1,
                            },
                          ]}
                          testID={`vehicle-service-map-color-${c}`}
                        />
                      );
                    })}
                  </View>
                </View>

                {/* Service Name */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Service Name *
                  </Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.name}
                      onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                      placeholder="Express"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="vehicle-service-field-name"
                    />
                  </View>
                </View>

                {/* Description */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Description
                  </Text>
                  <View
                    style={[
                      styles.textareaWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.description}
                      onChangeText={(t) => setForm((p) => ({ ...p, description: t }))}
                      placeholder="Brief description of this service"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, styles.textarea, { color: Colors.text }]}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      testID="vehicle-service-field-description"
                    />
                  </View>
                </View>

                {/* Short Description */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Short Description
                  </Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.shortDescription}
                      onChangeText={(t) => setForm((p) => ({ ...p, shortDescription: t }))}
                      placeholder="One-liner shown in lists"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="vehicle-service-field-short-description"
                    />
                  </View>
                </View>

                {/* Service types multi-select */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Service Type Allowed
                  </Text>
                  {serviceTypeOptions.length === 0 ? (
                    <View
                      style={[
                        styles.noRecordBox,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                      testID="vehicle-service-service-no-record"
                    >
                      <Inbox color={Colors.textSecondary} size={18} />
                      <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                        No record. Add services in Service Settings first.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.chipsRow}>
                      {serviceTypeOptions.map((opt) => {
                        const selected = form.serviceTypes.includes(opt);
                        return (
                          <TouchableOpacity
                            key={opt}
                            onPress={() =>
                              setForm((p) => ({
                                ...p,
                                serviceTypes: selected
                                  ? p.serviceTypes.filter((s) => s !== opt)
                                  : [...p.serviceTypes, opt],
                              }))
                            }
                            style={[
                              styles.chip,
                              {
                                backgroundColor: selected ? Colors.accent : Colors.gray[100],
                                borderColor: selected ? Colors.accent : Colors.border,
                              },
                            ]}
                            testID={`vehicle-service-service-${opt}`}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                { color: selected ? Colors.secondary : Colors.text },
                              ]}
                            >
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* Fuel types multi-select */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>
                    Fuel Type
                  </Text>
                  <View style={styles.chipsRow}>
                    {FUEL_TYPES.map((opt) => {
                      const selected = form.fuelTypes.includes(opt);
                      return (
                        <TouchableOpacity
                          key={opt}
                          onPress={() =>
                            setForm((p) => ({
                              ...p,
                              fuelTypes: selected
                                ? p.fuelTypes.filter((s) => s !== opt)
                                : [...p.fuelTypes, opt],
                            }))
                          }
                          style={[
                            styles.chip,
                            {
                              backgroundColor: selected ? Colors.accent : Colors.gray[100],
                              borderColor: selected ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`vehicle-service-fuel-${opt}`}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              { color: selected ? Colors.secondary : Colors.text },
                            ]}
                          >
                            {opt}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Numeric fields */}
                {NUMBER_FIELDS.map((nf) => (
                  <View key={nf.key} style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>
                      {nf.label}
                      {nf.suffix ? ` (in ${nf.suffix})` : ""}
                      {nf.required ? " *" : ""}
                    </Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={String(form[nf.key] ?? "")}
                        onChangeText={(t) =>
                          setForm((p) => ({ ...p, [nf.key]: t }))
                        }
                        placeholder="0"
                        placeholderTextColor={Colors.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: Colors.text }]}
                        testID={`vehicle-service-field-${nf.key}`}
                      />
                      {!!nf.suffix && (
                        <Text style={[styles.suffix, { color: Colors.textSecondary }]}>
                          {nf.suffix}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}

                {/* Status */}
                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Status
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      {form.status ? "Active" : "Inactive"}
                    </Text>
                  </View>
                  <Switch
                    value={Boolean(form.status)}
                    onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}
                    testID="vehicle-service-field-status"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="vehicle-service-save"
              >
                <Save color={Colors.secondary} size={18} />
                <Text style={[styles.submitText, { color: Colors.secondary }]}>
                  {editing ? "Save changes" : "Add Vehicle Service"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
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
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  rowLabel: { fontSize: 15, fontWeight: "700" as const, flexShrink: 1 },
  rowMeta: { fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: { fontSize: 10, fontWeight: "800" as const },
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
  priorityPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  priorityText: { fontSize: 11, fontWeight: "800" as const },
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
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  helper: { fontSize: 11 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  suffix: { fontSize: 13, fontWeight: "700" as const, marginLeft: 8 },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  iconPreview: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    borderWidth: 1,
  },
  iconPreviewImage: {
    width: "100%" as const,
    height: "100%" as const,
    borderRadius: 14,
  },
  heroPreview: {
    width: "100%" as const,
    aspectRatio: 16 / 9,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  heroPreviewImage: {
    width: "100%" as const,
    height: "100%" as const,
  },
  textareaWrap: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 96,
  },
  textarea: {
    minHeight: 76,
  },
  rowIconImage: {
    width: "100%" as const,
    height: "100%" as const,
    borderRadius: 20,
  },
  uploadBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  uploadBtnText: { fontSize: 13, fontWeight: "700" as const },
  chipsRow: {
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
  swatchRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  swatchNone: {
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  noRecordBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
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
