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
  Switch,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
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
  Zap,
  ImagePlus,
  Palette,
  Sofa,
  Receipt,
  Sparkles,
  ShoppingBag,
  Car,
  Package,
  Lock,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "ev-vehicle-details";

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

interface TaxItem {
  id: string;
  name: string;
  description: string;
  amount: number | string;
  enabled: boolean;
}

type GalleryKey = "exteriorImages" | "interiorImages" | "storageImages";

interface FormValues {
  imageUri: string;
  make: string;
  model: string;
  price: number | string;
  exteriorColors: ColorItem[];
  interiorColors: ColorItem[];
  taxes: TaxItem[];
  features: PricedItem[];
  accessories: PricedItem[];
  exteriorImages: string[];
  interiorImages: string[];
  storageImages: string[];
}

const GALLERY_LIMITS: Record<GalleryKey, number> = {
  exteriorImages: 4,
  interiorImages: 4,
  storageImages: 2,
};

const uid = () => `i-${Math.random().toString(36).slice(2, 9)}`;

const emptyForm = (): FormValues => ({
  imageUri: "",
  make: "",
  model: "",
  price: "",
  exteriorColors: [],
  interiorColors: [],
  taxes: [],
  features: [],
  accessories: [],
  exteriorImages: [],
  interiorImages: [],
  storageImages: [],
});

const safeParse = <T,>(raw: string | number | boolean | undefined, fallback: T): T => {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    const v = JSON.parse(raw);
    return v as T;
  } catch {
    return fallback;
  }
};

export default function AdminSettingsEvVehicleDetailsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      `${e.values.make ?? ""} ${e.values.model ?? ""}`.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const openAdd = () => {
    setForm(emptyForm());
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setForm({
      imageUri: String(entry.values.imageUri ?? ""),
      make: String(entry.values.make ?? ""),
      model: String(entry.values.model ?? ""),
      price: entry.values.price === undefined ? "" : Number(entry.values.price),
      exteriorColors: safeParse<ColorItem[]>(entry.values.exteriorColors, []),
      interiorColors: safeParse<ColorItem[]>(entry.values.interiorColors, []),
      taxes: safeParse<TaxItem[]>(entry.values.taxes, []),
      features: safeParse<PricedItem[]>(entry.values.features, []),
      accessories: safeParse<PricedItem[]>(entry.values.accessories, []),
      exteriorImages: safeParse<string[]>(entry.values.exteriorImages, []),
      interiorImages: safeParse<string[]>(entry.values.interiorImages, []),
      storageImages: safeParse<string[]>(entry.values.storageImages, []),
    });
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [16, 10],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        setForm((p) => ({ ...p, imageUri: uri }));
      }
    } catch (e) {
      console.log("image pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const pickGalleryImage = async (key: GalleryKey, slotIndex: number) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        setForm((p) => {
          const list = [...p[key]];
          while (list.length <= slotIndex) list.push("");
          list[slotIndex] = uri;
          return { ...p, [key]: list.slice(0, GALLERY_LIMITS[key]) };
        });
      }
    } catch (e) {
      console.log("gallery pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const removeGalleryImage = (key: GalleryKey, slotIndex: number) => {
    setForm((p) => {
      const list = [...p[key]];
      list[slotIndex] = "";
      return { ...p, [key]: list };
    });
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.make.trim() || !form.model.trim()) {
      Alert.alert("Missing field", "Please fill in Make and Model.");
      return;
    }
    const priceNum = typeof form.price === "number" ? form.price : parseFloat(String(form.price ?? ""));
    const normColors = (arr: ColorItem[]) =>
      arr
        .filter((c) => c.name.trim() || c.code.trim())
        .map((c) => ({ id: c.id, name: c.name.trim(), code: c.code.trim(), enabled: c.enabled }));
    const normPriced = (arr: PricedItem[]) =>
      arr
        .filter((c) => c.name.trim())
        .map((c) => {
          const n = typeof c.price === "number" ? c.price : parseFloat(String(c.price ?? ""));
          return { id: c.id, name: c.name.trim(), price: Number.isFinite(n) ? n : 0, enabled: c.enabled };
        });
    const normTaxes = (arr: TaxItem[]) =>
      arr
        .filter((c) => c.name.trim())
        .map((c) => {
          const n = typeof c.amount === "number" ? c.amount : parseFloat(String(c.amount ?? ""));
          return {
            id: c.id,
            name: c.name.trim(),
            description: c.description.trim(),
            amount: Number.isFinite(n) ? n : 0,
            enabled: c.enabled,
          };
        });

    const cleaned: Record<string, string | number | boolean> = {
      imageUri: form.imageUri,
      make: form.make.trim(),
      model: form.model.trim(),
      price: Number.isFinite(priceNum) ? priceNum : 0,
      exteriorColors: JSON.stringify(normColors(form.exteriorColors)),
      interiorColors: JSON.stringify(normColors(form.interiorColors)),
      taxes: JSON.stringify(normTaxes(form.taxes)),
      features: JSON.stringify(normPriced(form.features)),
      accessories: JSON.stringify(normPriced(form.accessories)),
      exteriorImages: JSON.stringify(form.exteriorImages.filter((s) => !!s)),
      interiorImages: JSON.stringify(form.interiorImages.filter((s) => !!s)),
      storageImages: JSON.stringify(form.storageImages.filter((s) => !!s)),
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
    if (entry.values.isDefault) {
      Alert.alert("Locked", "Default vehicles can be edited but not deleted.");
      return;
    }
    Alert.alert("Delete", "Remove this vehicle?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  /* ----- list item helpers ----- */
  const addColor = (key: "exteriorColors" | "interiorColors") =>
    setForm((p) => ({ ...p, [key]: [...p[key], { id: uid(), name: "", code: "", enabled: true }] }));
  const removeColor = (key: "exteriorColors" | "interiorColors", id: string) =>
    setForm((p) => ({ ...p, [key]: p[key].filter((c) => c.id !== id) }));
  const updateColor = (
    key: "exteriorColors" | "interiorColors",
    id: string,
    patch: Partial<ColorItem>
  ) =>
    setForm((p) => ({
      ...p,
      [key]: p[key].map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const addPriced = (key: "features" | "accessories") =>
    setForm((p) => ({ ...p, [key]: [...p[key], { id: uid(), name: "", price: "", enabled: true }] }));
  const removePriced = (key: "features" | "accessories", id: string) =>
    setForm((p) => ({ ...p, [key]: p[key].filter((c) => c.id !== id) }));
  const updatePriced = (
    key: "features" | "accessories",
    id: string,
    patch: Partial<PricedItem>
  ) =>
    setForm((p) => ({
      ...p,
      [key]: p[key].map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const addTax = () =>
    setForm((p) => ({
      ...p,
      taxes: [...p.taxes, { id: uid(), name: "", description: "", amount: "", enabled: true }],
    }));
  const removeTax = (id: string) =>
    setForm((p) => ({ ...p, taxes: p.taxes.filter((c) => c.id !== id) }));
  const updateTax = (id: string, patch: Partial<TaxItem>) =>
    setForm((p) => ({
      ...p,
      taxes: p.taxes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const renderRow = (entry: SettingEntry) => {
    const make = String(entry.values.make ?? "");
    const model = String(entry.values.model ?? "");
    const price = Number(entry.values.price ?? 0);
    const imageUri = String(entry.values.imageUri ?? "");
    const exterior = safeParse<ColorItem[]>(entry.values.exteriorColors, []).filter((c) => c.enabled);
    const features = safeParse<PricedItem[]>(entry.values.features, []).filter((c) => c.enabled);
    const isDefault = !!entry.values.isDefault;
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, { backgroundColor: Colors.accent + "20", alignItems: "center", justifyContent: "center" }]}>
            <Zap color={Colors.accent} size={22} />
          </View>
        )}
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
            {make} {model}
          </Text>
          <View style={styles.rowSubRow}>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
              RM {price.toLocaleString()} • {exterior.length} colours • {features.length} features
            </Text>
            {isDefault ? (
              <View style={[styles.defaultPill, { backgroundColor: Colors.accent + "20" }]}>
                <Lock color={Colors.accent} size={10} />
                <Text style={[styles.defaultPillText, { color: Colors.accent }]}>Default</Text>
              </View>
            ) : null}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`ev-edit-${entry.id}`}
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        {isDefault ? null : (
          <TouchableOpacity
            onPress={() => onDelete(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            testID={`ev-delete-${entry.id}`}
          >
            <Trash2 color={Colors.error} size={16} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  /* ----- reusable section render ----- */
  const renderColorSection = (
    title: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    key: "exteriorColors" | "interiorColors"
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Icon color={Colors.accent} size={16} />
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
        </View>
        <TouchableOpacity
          onPress={() => addColor(key)}
          style={[styles.addBtn, { backgroundColor: Colors.accent + "20" }]}
          testID={`add-${key}`}
        >
          <Plus color={Colors.accent} size={14} />
          <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add</Text>
        </TouchableOpacity>
      </View>
      {form[key].length === 0 ? (
        <Text style={[styles.emptyHint, { color: Colors.textSecondary }]}>No colours added.</Text>
      ) : (
        form[key].map((c) => (
          <View
            key={c.id}
            style={[styles.itemCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          >
            <View style={styles.itemRow}>
              <View style={[styles.swatch, { backgroundColor: c.code || Colors.gray[200], borderColor: Colors.border }]} />
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1.4 }]}>
                <TextInput
                  value={c.name}
                  onChangeText={(t) => updateColor(key, c.id, { name: t })}
                  placeholder="Colour name"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1 }]}>
                <TextInput
                  value={c.code}
                  onChangeText={(t) => updateColor(key, c.id, { code: t })}
                  placeholder="#hex"
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="none"
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
            </View>
            <View style={styles.itemFooter}>
              <View style={styles.toggleInline}>
                <Switch
                  value={c.enabled}
                  onValueChange={(v) => updateColor(key, c.id, { enabled: v })}
                />
                <Text style={[styles.toggleLabel, { color: Colors.textSecondary }]}>
                  {c.enabled ? "Enabled" : "Disabled"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removeColor(key, c.id)}
                style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
              >
                <Trash2 color={Colors.error} size={14} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </View>
  );

  const renderPricedSection = (
    title: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    key: "features" | "accessories",
    placeholder: string
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Icon color={Colors.accent} size={16} />
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
        </View>
        <TouchableOpacity
          onPress={() => addPriced(key)}
          style={[styles.addBtn, { backgroundColor: Colors.accent + "20" }]}
          testID={`add-${key}`}
        >
          <Plus color={Colors.accent} size={14} />
          <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add</Text>
        </TouchableOpacity>
      </View>
      {form[key].length === 0 ? (
        <Text style={[styles.emptyHint, { color: Colors.textSecondary }]}>None added.</Text>
      ) : (
        form[key].map((c) => (
          <View
            key={c.id}
            style={[styles.itemCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          >
            <View style={styles.itemRow}>
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1.6 }]}>
                <TextInput
                  value={c.name}
                  onChangeText={(t) => updatePriced(key, c.id, { name: t })}
                  placeholder={placeholder}
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1 }]}>
                <TextInput
                  value={String(c.price ?? "")}
                  onChangeText={(t) => updatePriced(key, c.id, { price: t })}
                  placeholder="Price"
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
            </View>
            <View style={styles.itemFooter}>
              <View style={styles.toggleInline}>
                <Switch
                  value={c.enabled}
                  onValueChange={(v) => updatePriced(key, c.id, { enabled: v })}
                />
                <Text style={[styles.toggleLabel, { color: Colors.textSecondary }]}>
                  {c.enabled ? "Enabled" : "Disabled"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removePriced(key, c.id)}
                style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
              >
                <Trash2 color={Colors.error} size={14} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </View>
  );

  const renderGallerySection = (
    title: string,
    Icon: React.ComponentType<{ color?: string; size?: number }>,
    key: GalleryKey
  ) => {
    const limit = GALLERY_LIMITS[key];
    const items = form[key];
    const slots = Array.from({ length: limit }, (_, i) => items[i] ?? "");
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Icon color={Colors.accent} size={16} />
            <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
          </View>
          <Text style={[styles.galleryCount, { color: Colors.textSecondary }]}>
            {slots.filter((s) => !!s).length}/{limit}
          </Text>
        </View>
        <View style={styles.galleryGrid}>
          {slots.map((uri, idx) => (
            <TouchableOpacity
              key={`${key}-${idx}`}
              onPress={() => pickGalleryImage(key, idx)}
              activeOpacity={0.85}
              style={[
                styles.gallerySlot,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
              testID={`${key}-slot-${idx}`}
            >
              {uri ? (
                <>
                  <Image source={{ uri }} style={styles.gallerySlotImg} />
                  <TouchableOpacity
                    onPress={() => removeGalleryImage(key, idx)}
                    style={[styles.gallerySlotRemove, { backgroundColor: Colors.text + "CC" }]}
                    hitSlop={8}
                  >
                    <X color={Colors.background} size={12} />
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.gallerySlotEmpty}>
                  <ImagePlus color={Colors.accent} size={20} />
                  <Text style={[styles.gallerySlotHint, { color: Colors.textSecondary }]}>
                    Optional
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderTaxSection = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Receipt color={Colors.accent} size={16} />
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>Taxes</Text>
        </View>
        <TouchableOpacity
          onPress={addTax}
          style={[styles.addBtn, { backgroundColor: Colors.accent + "20" }]}
          testID="add-tax"
        >
          <Plus color={Colors.accent} size={14} />
          <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add</Text>
        </TouchableOpacity>
      </View>
      {form.taxes.length === 0 ? (
        <Text style={[styles.emptyHint, { color: Colors.textSecondary }]}>No taxes added.</Text>
      ) : (
        form.taxes.map((c) => (
          <View
            key={c.id}
            style={[styles.itemCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          >
            <View style={styles.itemRow}>
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1.4 }]}>
                <TextInput
                  value={c.name}
                  onChangeText={(t) => updateTax(c.id, { name: t })}
                  placeholder="Tax name (e.g. SST)"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
              <View style={[styles.inlineInput, { backgroundColor: Colors.background, borderColor: Colors.border, flex: 1 }]}>
                <TextInput
                  value={String(c.amount ?? "")}
                  onChangeText={(t) => updateTax(c.id, { amount: t })}
                  placeholder="Amount"
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: Colors.text }]}
                />
              </View>
            </View>
            <View
              style={[
                styles.inlineInput,
                { backgroundColor: Colors.background, borderColor: Colors.border, marginTop: 8 },
              ]}
            >
              <TextInput
                value={c.description}
                onChangeText={(t) => updateTax(c.id, { description: t })}
                placeholder="Description"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.input, { color: Colors.text }]}
              />
            </View>
            <View style={styles.itemFooter}>
              <View style={styles.toggleInline}>
                <Switch
                  value={c.enabled}
                  onValueChange={(v) => updateTax(c.id, { enabled: v })}
                />
                <Text style={[styles.toggleLabel, { color: Colors.textSecondary }]}>
                  {c.enabled ? "Enabled" : "Disabled"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => removeTax(c.id)}
                style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
              >
                <Trash2 color={Colors.error} size={14} />
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="ev-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Zap color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              EV Vehicle Details
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Models, colours, pricing & accessories
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="ev-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search make or model"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="ev-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No vehicles yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap + to add a new EV model.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="ev-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add Vehicle</Text>
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
                  {editing ? "Edit Vehicle" : "Add Vehicle"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="ev-modal-close"
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
                {/* Image upload + preview */}
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Vehicle Image</Text>
                <TouchableOpacity
                  onPress={pickImage}
                  activeOpacity={0.85}
                  style={[
                    styles.imagePreview,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                  testID="ev-image-pick"
                >
                  {form.imageUri ? (
                    <Image source={{ uri: form.imageUri }} style={styles.imagePreviewImg} />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <ImagePlus color={Colors.accent} size={28} />
                      <Text style={[styles.imageHint, { color: Colors.textSecondary }]}>
                        Tap to upload image
                      </Text>
                    </View>
                  )}
                  {form.imageUri ? (
                    <View style={[styles.imageOverlay, { backgroundColor: Colors.text + "AA" }]}>
                      <ImagePlus color={Colors.background} size={14} />
                      <Text style={[styles.imageOverlayText, { color: Colors.background }]}>
                        Change
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>

                {/* Gallery images */}
                {renderGallerySection("Exterior Images (optional)", Car, "exteriorImages")}
                {renderGallerySection("Interior Images (optional)", Sofa, "interiorImages")}
                {renderGallerySection("Storage Area Images (optional)", Package, "storageImages")}

                {/* Make / Model */}
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Make *</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={form.make}
                        onChangeText={(t) => setForm((p) => ({ ...p, make: t }))}
                        placeholder="TEKSI"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-make"
                      />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.textSecondary }]}>Model *</Text>
                    <View
                      style={[
                        styles.inputWrap,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <TextInput
                        value={form.model}
                        onChangeText={(t) => setForm((p) => ({ ...p, model: t }))}
                        placeholder="EV One"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text }]}
                        testID="ev-model"
                      />
                    </View>
                  </View>
                </View>

                {/* Price */}
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Price (RM)</Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <TextInput
                    value={String(form.price ?? "")}
                    onChangeText={(t) => setForm((p) => ({ ...p, price: t }))}
                    placeholder="150000"
                    placeholderTextColor={Colors.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: Colors.text }]}
                    testID="ev-price"
                  />
                </View>

                {renderColorSection("Exterior Colours", Palette, "exteriorColors")}
                {renderColorSection("Interior Colours", Sofa, "interiorColors")}
                {renderTaxSection()}
                {renderPricedSection("Add-on Features", Sparkles, "features", "Feature name")}
                {renderPricedSection("Optional Accessories", ShoppingBag, "accessories", "Accessory name")}
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="ev-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add Vehicle"}
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
  rowDesc: { fontSize: 12, marginTop: 2, flexShrink: 1 },
  rowSubRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 2 },
  defaultPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  defaultPillText: { fontSize: 10, fontWeight: "800" as const },
  galleryCount: { fontSize: 11, fontWeight: "600" as const },
  galleryGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  gallerySlot: {
    width: "23.5%" as const,
    aspectRatio: 4 / 3,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  gallerySlotImg: { width: "100%" as const, height: "100%" as const },
  gallerySlotEmpty: { alignItems: "center" as const, gap: 4 },
  gallerySlotHint: { fontSize: 10 },
  gallerySlotRemove: {
    position: "absolute" as const,
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
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
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  fieldRow: { flexDirection: "row" as const, gap: 10 },
  imagePreview: {
    width: "100%" as const,
    aspectRatio: 16 / 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  imagePreviewImg: { width: "100%" as const, height: "100%" as const },
  imagePlaceholder: { alignItems: "center" as const, gap: 8 },
  imageHint: { fontSize: 12 },
  imageOverlay: {
    position: "absolute" as const,
    bottom: 10,
    right: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  imageOverlayText: { fontSize: 11, fontWeight: "700" as const },
  section: { marginTop: 14 },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 8,
  },
  sectionTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "800" as const },
  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addBtnText: { fontSize: 12, fontWeight: "700" as const },
  emptyHint: { fontSize: 12, fontStyle: "italic" as const, paddingVertical: 4 },
  itemCard: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  itemRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  itemFooter: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 8,
  },
  swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: 1 },
  inlineInput: {
    paddingHorizontal: 10,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center" as const,
  },
  toggleInline: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  toggleLabel: { fontSize: 12, fontWeight: "600" as const },
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
