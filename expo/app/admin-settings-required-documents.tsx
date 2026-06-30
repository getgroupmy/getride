import React, { useEffect, useMemo, useState } from "react";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
  FileCheck2,
  Check,
  Globe2,
  MapPin,
  CalendarClock,
  CalendarRange,
  Hash,
  ShieldAlert,
  Accessibility,
  Copy as CopyIcon,
  FileText,
  Car,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "required-documents" as const;
const DOC_TYPE_KEY = "document-type" as const;
const REGIONS_KEY = "country-states-cities" as const;
const PARTNER_TYPE_KEY = "partner-type" as const;
const ALL_TOKEN = "__ALL__" as const;

interface RegionSelection {
  key: string;
  type: "country" | "state";
  country: string;
  state?: string;
  label: string;
  compulsory: boolean;
}

interface RequiredDocForm {
  name: string;
  description: string;
  docTypes: string[];
  partnerTypes: string[];
  required: boolean;
  active: boolean;
  regionsGlobal: boolean;
  regionsGlobalCompulsory: boolean;
  regions: RegionSelection[];
  requireStartDate: boolean;
  requireExpiryDate: boolean;
  requireDocumentNumber: boolean;
  requireInsuranceProvider: boolean;
  isPwd: boolean;
  requireFrontBack: boolean;
  allowPdfUpload: boolean;
  isTaxiPermit: boolean;
}

const haptic = () => {
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
};

export default function AdminSettingsRequiredDocumentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();

  const entries = getEntries(STORAGE_KEY);
  const docTypes = getEntries(DOC_TYPE_KEY);
  const regionEntries = getEntries(REGIONS_KEY);
  const partnerTypeEntries = getEntries(PARTNER_TYPE_KEY);

  const enabledDocTypes = useMemo(() => {
    return [...docTypes]
      .filter((d) => Boolean(d.values.enabled ?? true))
      .sort((a, b) =>
        String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""))
      );
  }, [docTypes]);

  const enabledPartnerTypes = useMemo(() => {
    return [...partnerTypeEntries]
      .filter((d) => Boolean(d.values.enabled ?? d.values.active ?? true))
      .map((d) => String(d.values.name ?? "").trim())
      .filter((n) => n.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }, [partnerTypeEntries]);

  const availableCountries = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; country: string; label: string }[] = [];
    for (const r of regionEntries) {
      const country = String(r.values.country ?? "").trim();
      const state = String(r.values.state ?? "").trim();
      const city = String(r.values.city ?? "").trim();
      const suburb = String(r.values.suburb ?? "").trim();
      if (!country || state || city || suburb) continue;
      const key = `country:${country}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, country, label: country });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [regionEntries]);

  const availableStates = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; country: string; state: string; label: string }[] = [];
    for (const r of regionEntries) {
      const country = String(r.values.country ?? "").trim();
      const state = String(r.values.state ?? "").trim();
      const city = String(r.values.city ?? "").trim();
      const suburb = String(r.values.suburb ?? "").trim();
      if (!country || !state || city || suburb) continue;
      const key = `state:${country}|${state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, country, state, label: `${state}, ${country}` });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [regionEntries]);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [form, setForm] = useState<RequiredDocForm>({
    name: "",
    description: "",
    docTypes: [],
    partnerTypes: [],
    required: true,
    active: true,
    regionsGlobal: true,
    regionsGlobalCompulsory: true,
    regions: [],
    requireStartDate: false,
    requireExpiryDate: false,
    requireDocumentNumber: false,
    requireInsuranceProvider: false,
    isPwd: false,
    requireFrontBack: false,
    allowPdfUpload: false,
    isTaxiPermit: false,
  });

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) =>
      String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""))
    );
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedEntries;
    return sortedEntries.filter((e) => {
      const name = String(e.values.name ?? "").toLowerCase();
      const desc = String(e.values.description ?? "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [sortedEntries, query]);

  const parseDocTypes = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      } catch {
        return raw.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const parseRegions = (raw: unknown): RegionSelection[] => {
    const fromArray = (arr: unknown[]): RegionSelection[] =>
      arr
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const o = r as Record<string, unknown>;
          const type = o.type === "state" ? "state" : "country";
          const country = String(o.country ?? "").trim();
          const state = String(o.state ?? "").trim();
          if (!country) return null;
          if (type === "state" && !state) return null;
          const key =
            type === "country"
              ? `country:${country}`
              : `state:${country}|${state}`;
          const label = type === "country" ? country : `${state}, ${country}`;
          const item: RegionSelection = {
            key,
            type,
            country,
            state: type === "state" ? state : undefined,
            label,
            compulsory: Boolean(o.compulsory ?? true),
          };
          return item;
        })
        .filter((x): x is RegionSelection => x !== null);

    if (Array.isArray(raw)) return fromArray(raw);
    if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return fromArray(parsed);
      } catch {
        return [];
      }
    }
    return [];
  };

  const docTypeNameById = (id: string): string => {
    if (id === ALL_TOKEN) return "All";
    const t = docTypes.find((d) => d.id === id);
    return t ? String(t.values.name ?? "Unknown") : "Unknown";
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: "",
      description: "",
      docTypes: [],
      partnerTypes: [],
      required: true,
      active: true,
      regionsGlobal: true,
      regionsGlobalCompulsory: true,
      regions: [],
      requireStartDate: false,
      requireExpiryDate: false,
      requireDocumentNumber: false,
      requireInsuranceProvider: false,
      isPwd: false,
      requireFrontBack: false,
      allowPdfUpload: false,
      isTaxiPermit: false,
    });
    setRegionFilter("");
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setEditing(entry);
    const parsedRegions = parseRegions(entry.values.regions);
    const hasGlobalFlag = entry.values.regionsGlobal !== undefined;
    setForm({
      name: String(entry.values.name ?? ""),
      description: String(entry.values.description ?? ""),
      docTypes: parseDocTypes(entry.values.docTypes),
      partnerTypes: parseDocTypes(entry.values.partnerTypes),
      required: Boolean(entry.values.required ?? true),
      active: Boolean(entry.values.active ?? true),
      regionsGlobal: hasGlobalFlag
        ? Boolean(entry.values.regionsGlobal)
        : parsedRegions.length === 0,
      regionsGlobalCompulsory: Boolean(
        entry.values.regionsGlobalCompulsory ?? entry.values.required ?? true
      ),
      regions: parsedRegions,
      requireStartDate: Boolean(entry.values.requireStartDate ?? false),
      requireExpiryDate: Boolean(entry.values.requireExpiryDate ?? false),
      requireDocumentNumber: Boolean(entry.values.requireDocumentNumber ?? false),
      requireInsuranceProvider: Boolean(entry.values.requireInsuranceProvider ?? false),
      isPwd: Boolean(entry.values.isPwd ?? false),
      requireFrontBack: Boolean(entry.values.requireFrontBack ?? false),
      allowPdfUpload: Boolean(entry.values.allowPdfUpload ?? false),
      isTaxiPermit: Boolean(entry.values.isTaxiPermit ?? false),
    });
    setRegionFilter("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const toggleRegion = (item: {
    key: string;
    type: "country" | "state";
    country: string;
    state?: string;
    label: string;
  }) => {
    haptic();
    setForm((p) => {
      const exists = p.regions.find((r) => r.key === item.key);
      if (exists) {
        return { ...p, regions: p.regions.filter((r) => r.key !== item.key) };
      }
      const next: RegionSelection = {
        key: item.key,
        type: item.type,
        country: item.country,
        state: item.state,
        label: item.label,
        compulsory: true,
      };
      return { ...p, regions: [...p.regions, next] };
    });
  };

  const cycleRegionCompulsory = (key: string) => {
    haptic();
    setForm((p) => ({
      ...p,
      regions: p.regions.map((r) =>
        r.key === key ? { ...r, compulsory: !r.compulsory } : r
      ),
    }));
  };

  const toggleRegionsGlobal = () => {
    haptic();
    setForm((p) => ({ ...p, regionsGlobal: !p.regionsGlobal }));
  };

  const cycleGlobalCompulsory = () => {
    haptic();
    setForm((p) => ({
      ...p,
      regionsGlobalCompulsory: !p.regionsGlobalCompulsory,
    }));
  };

  const toggleDocType = (id: string) => {
    haptic();
    setForm((p) => {
      if (id === ALL_TOKEN) {
        return { ...p, docTypes: p.docTypes.includes(ALL_TOKEN) ? [] : [ALL_TOKEN] };
      }
      const next = p.docTypes.filter((x) => x !== ALL_TOKEN);
      if (next.includes(id)) {
        return { ...p, docTypes: next.filter((x) => x !== id) };
      }
      return { ...p, docTypes: [...next, id] };
    });
  };

  const togglePartnerType = (name: string) => {
    haptic();
    setForm((p) => {
      if (name === ALL_TOKEN) {
        return {
          ...p,
          partnerTypes: p.partnerTypes.includes(ALL_TOKEN) ? [] : [ALL_TOKEN],
        };
      }
      const next = p.partnerTypes.filter((x) => x !== ALL_TOKEN);
      if (next.includes(name)) {
        return { ...p, partnerTypes: next.filter((x) => x !== name) };
      }
      return { ...p, partnerTypes: [...next, name] };
    });
  };

  const onSave = () => {
    if (!guard()) return;
    const name = form.name.trim();
    if (!name) {
      Alert.alert("Missing field", "Please enter a document name.");
      return;
    }
    if (!form.regionsGlobal && form.regions.length === 0) {
      Alert.alert(
        "Missing region",
        "Select at least one country/state or enable Global."
      );
      return;
    }
    const dupe = entries.find(
      (e) =>
        String(e.values.name ?? "").toLowerCase() === name.toLowerCase() &&
        e.id !== editing?.id
    );
    if (dupe) {
      Alert.alert("Duplicate", "A document with this name already exists.");
      return;
    }
    const values: Record<string, string | number | boolean> = {
      name,
      description: form.description.trim(),
      docTypes: JSON.stringify(form.docTypes),
      partnerTypes: JSON.stringify(form.partnerTypes),
      required: form.required,
      active: form.active,
      regionsGlobal: form.regionsGlobal,
      regionsGlobalCompulsory: form.regionsGlobalCompulsory,
      regions: JSON.stringify(
        form.regions.map((r) => ({
          type: r.type,
          country: r.country,
          state: r.state ?? "",
          compulsory: r.compulsory,
        }))
      ),
      requireStartDate: form.requireStartDate,
      requireExpiryDate: form.requireExpiryDate,
      requireDocumentNumber: form.requireDocumentNumber,
      requireInsuranceProvider: form.requireInsuranceProvider,
      isPwd: form.isPwd,
      requireFrontBack: form.requireFrontBack,
      allowPdfUpload: form.allowPdfUpload,
      isTaxiPermit: form.isTaxiPermit,
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, { ...editing.values, ...values });
    } else {
      addEntry(STORAGE_KEY, values);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete document", `Remove "${String(entry.values.name)}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const toggleActive = (entry: SettingEntry) => {
    const next = !Boolean(entry.values.active ?? true);
    updateEntry(STORAGE_KEY, entry.id, { ...entry.values, active: next });
    haptic();
  };

  useEffect(() => {
    // no-op effect for parity; data hydration handled by AdminDataContext
  }, []);

  const renderRegionSummary = (entry: SettingEntry): string => {
    const global = entry.values.regionsGlobal;
    if (global === true || (global === undefined && !entry.values.regions)) {
      return "Global";
    }
    const list = parseRegions(entry.values.regions);
    if (list.length === 0) return "Global";
    return `${list.length} region${list.length === 1 ? "" : "s"}`;
  };

  const renderRow = (entry: SettingEntry) => {
    const name = String(entry.values.name ?? "");
    const description = String(entry.values.description ?? "");
    const active = Boolean(entry.values.active ?? true);
    const required = Boolean(entry.values.required ?? true);
    const types = parseDocTypes(entry.values.docTypes);
    const typeLabels =
      types.includes(ALL_TOKEN)
        ? ["All"]
        : types.map(docTypeNameById);
    const pTypes = parseDocTypes(entry.values.partnerTypes);
    const partnerTypeLabels =
      pTypes.length === 0
        ? []
        : pTypes.includes(ALL_TOKEN)
          ? ["All partner types"]
          : pTypes;
    const regionSummary = renderRegionSummary(entry);

    return (
      <View
        key={entry.id}
        style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`required-documents-row-${entry.id}`}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
            <FileCheck2 color={Colors.accent} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: required ? Colors.accent + "20" : Colors.gray[200] },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: required ? Colors.accent : Colors.textSecondary },
                  ]}
                >
                  {required ? "Required" : "Optional"}
                </Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: active ? Colors.success + "20" : Colors.gray[200] },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: active ? Colors.success : Colors.textSecondary },
                  ]}
                >
                  {active ? "Active" : "Not active"}
                </Text>
              </View>
            </View>
            {description ? (
              <Text style={[styles.cardMeta, { color: Colors.textSecondary }]} numberOfLines={2}>
                {description}
              </Text>
            ) : null}
            <View style={styles.chipWrap}>
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: Colors.accent + "10",
                    borderColor: Colors.accent + "30",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  },
                ]}
              >
                {regionSummary === "Global" ? (
                  <Globe2 color={Colors.accent} size={11} />
                ) : (
                  <MapPin color={Colors.accent} size={11} />
                )}
                <Text style={[styles.chipText, { color: Colors.accent }]}>
                  {regionSummary}
                </Text>
              </View>
              {typeLabels.slice(0, 5).map((t, i) => (
                <View
                  key={`${entry.id}-tag-${i}`}
                  style={[styles.chip, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]}
                >
                  <Text style={[styles.chipText, { color: Colors.accent }]} numberOfLines={1}>
                    {t}
                  </Text>
                </View>
              ))}
              {typeLabels.length > 5 ? (
                <View style={[styles.chip, { backgroundColor: Colors.gray[200], borderColor: Colors.border }]}>
                  <Text style={[styles.chipText, { color: Colors.textSecondary }]}>
                    +{typeLabels.length - 5}
                  </Text>
                </View>
              ) : null}
              {partnerTypeLabels.slice(0, 5).map((t, i) => (
                <View
                  key={`${entry.id}-pt-${i}`}
                  style={[styles.chip, { backgroundColor: Colors.success + "15", borderColor: Colors.success + "40" }]}
                >
                  <Text style={[styles.chipText, { color: Colors.success }]} numberOfLines={1}>
                    {t}
                  </Text>
                </View>
              ))}
              {partnerTypeLabels.length > 5 ? (
                <View style={[styles.chip, { backgroundColor: Colors.gray[200], borderColor: Colors.border }]}>
                  <Text style={[styles.chipText, { color: Colors.textSecondary }]}>
                    +{partnerTypeLabels.length - 5}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <Switch
            value={active}
            onValueChange={() => toggleActive(entry)}
            testID={`required-documents-toggle-${entry.id}`}
          />
        </View>

        <View style={styles.cardActions}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => openEdit(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            testID={`required-documents-edit-${entry.id}`}
          >
            <Pencil color={Colors.accent} size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            testID={`required-documents-delete-${entry.id}`}
          >
            <Trash2 color={Colors.error} size={16} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const allSelected = form.docTypes.includes(ALL_TOKEN);
  const selectedRegionKeys = useMemo(
    () => new Set(form.regions.map((r) => r.key)),
    [form.regions]
  );

  const filteredCountries = useMemo(() => {
    const q = regionFilter.trim().toLowerCase();
    if (!q) return availableCountries;
    return availableCountries.filter((c) => c.label.toLowerCase().includes(q));
  }, [availableCountries, regionFilter]);

  const filteredStates = useMemo(() => {
    const q = regionFilter.trim().toLowerCase();
    if (!q) return availableStates;
    return availableStates.filter((s) => s.label.toLowerCase().includes(q));
  }, [availableStates, regionFilter]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="required-documents-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <FileCheck2 color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Required Documents
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Partner onboarding docs
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="required-documents-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search documents"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="required-documents-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No documents</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a required document.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="required-documents-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add document</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map(renderRow)
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={[styles.modalSheet, { backgroundColor: Colors.background, paddingTop: Math.max(insets.top + 8, 18), maxHeight: "92%" }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: Colors.text }]}>
                    {editing ? "Edit Document" : "Add Document"}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="required-documents-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Document Name *</Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <TextInput
                    value={form.name}
                    onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                    placeholder="e.g. Driving License"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text }]}
                    testID="required-documents-field-name"
                  />
                </View>

                <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 12 }]}>
                  Description
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border, height: 80 },
                  ]}
                >
                  <TextInput
                    value={form.description}
                    onChangeText={(t) => setForm((p) => ({ ...p, description: t }))}
                    placeholder="Short description"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text, height: 80, textAlignVertical: "top" }]}
                    multiline
                    testID="required-documents-field-description"
                  />
                </View>

                <View style={styles.docTypesHeader}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                    Document Type *
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    Choose &quot;All&quot; or pick multiple
                  </Text>
                </View>

                <View style={styles.pillsWrap}>
                  <TouchableOpacity
                    onPress={() => toggleDocType(ALL_TOKEN)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: allSelected ? Colors.accent : Colors.gray[100],
                        borderColor: allSelected ? Colors.accent : Colors.border,
                      },
                    ]}
                    testID="required-documents-doctype-all"
                  >
                    {allSelected ? <Check color={Colors.onAccent} size={13} /> : null}
                    <Text
                      style={[
                        styles.pillText,
                        { color: allSelected ? Colors.onAccent : Colors.text },
                      ]}
                    >
                      All
                    </Text>
                  </TouchableOpacity>

                  {enabledDocTypes.length === 0 ? (
                    <View
                      style={[
                        styles.emptyTypes,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text style={[styles.helper, { color: Colors.textSecondary, textAlign: "center" }]}>
                        No document types yet. Add some in Document Type settings.
                      </Text>
                    </View>
                  ) : (
                    enabledDocTypes.map((t) => {
                      const id = t.id;
                      const checked = !allSelected && form.docTypes.includes(id);
                      const disabled = allSelected;
                      const tname = String(t.values.name ?? "");
                      return (
                        <TouchableOpacity
                          key={id}
                          onPress={() => !disabled && toggleDocType(id)}
                          disabled={disabled}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: checked ? Colors.accent : Colors.gray[100],
                              borderColor: checked ? Colors.accent : Colors.border,
                              opacity: disabled ? 0.45 : 1,
                            },
                          ]}
                          testID={`required-documents-doctype-${id}`}
                        >
                          {checked ? <Check color={Colors.onAccent} size={13} /> : null}
                          <Text
                            style={[
                              styles.pillText,
                              { color: checked ? Colors.onAccent : Colors.text },
                            ]}
                            numberOfLines={1}
                          >
                            {tname}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>

                <View style={styles.docTypesHeader}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                    Partner Types *
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    Choose &quot;All&quot; or pick specific partner types
                  </Text>
                </View>

                <View style={styles.pillsWrap}>
                  <TouchableOpacity
                    onPress={() => togglePartnerType(ALL_TOKEN)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: form.partnerTypes.includes(ALL_TOKEN)
                          ? Colors.accent
                          : Colors.gray[100],
                        borderColor: form.partnerTypes.includes(ALL_TOKEN)
                          ? Colors.accent
                          : Colors.border,
                      },
                    ]}
                    testID="required-documents-partnertype-all"
                  >
                    {form.partnerTypes.includes(ALL_TOKEN) ? (
                      <Check color={Colors.onAccent} size={13} />
                    ) : null}
                    <Text
                      style={[
                        styles.pillText,
                        {
                          color: form.partnerTypes.includes(ALL_TOKEN)
                            ? Colors.onAccent
                            : Colors.text,
                        },
                      ]}
                    >
                      All
                    </Text>
                  </TouchableOpacity>

                  {enabledPartnerTypes.length === 0 ? (
                    <View
                      style={[
                        styles.emptyTypes,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.helper,
                          { color: Colors.textSecondary, textAlign: "center" },
                        ]}
                      >
                        No partner types yet. Add some in Partner Type settings.
                      </Text>
                    </View>
                  ) : (
                    enabledPartnerTypes.map((name) => {
                      const allOn = form.partnerTypes.includes(ALL_TOKEN);
                      const checked = !allOn && form.partnerTypes.includes(name);
                      return (
                        <TouchableOpacity
                          key={`pt-${name}`}
                          onPress={() => !allOn && togglePartnerType(name)}
                          disabled={allOn}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: checked ? Colors.accent : Colors.gray[100],
                              borderColor: checked ? Colors.accent : Colors.border,
                              opacity: allOn ? 0.45 : 1,
                            },
                          ]}
                          testID={`required-documents-partnertype-${name}`}
                        >
                          {checked ? <Check color={Colors.onAccent} size={13} /> : null}
                          <Text
                            style={[
                              styles.pillText,
                              { color: checked ? Colors.onAccent : Colors.text },
                            ]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>

                <View style={styles.docTypesHeader}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                    Applies to *
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    Tap a region to cycle compulsory / optional
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={toggleRegionsGlobal}
                  style={[
                    styles.globalRow,
                    {
                      backgroundColor: form.regionsGlobal
                        ? Colors.accent + "15"
                        : Colors.gray[100],
                      borderColor: form.regionsGlobal ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID="required-documents-region-global"
                >
                  <View
                    style={[
                      styles.globalIcon,
                      {
                        backgroundColor: form.regionsGlobal
                          ? Colors.accent
                          : Colors.gray[200],
                      },
                    ]}
                  >
                    <Globe2
                      color={form.regionsGlobal ? Colors.onAccent : Colors.textSecondary}
                      size={16}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      All country & state (Global)
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      {form.regionsGlobal
                        ? "Applies everywhere"
                        : "Pick specific countries / states below"}
                    </Text>
                  </View>
                  {form.regionsGlobal ? (
                    <TouchableOpacity
                      onPress={cycleGlobalCompulsory}
                      style={[
                        styles.compulsoryPill,
                        {
                          backgroundColor: form.regionsGlobalCompulsory
                            ? Colors.success + "20"
                            : Colors.gray[200],
                          borderColor: form.regionsGlobalCompulsory
                            ? Colors.success
                            : Colors.border,
                        },
                      ]}
                      testID="required-documents-region-global-cycle"
                    >
                      <Text
                        style={[
                          styles.compulsoryText,
                          {
                            color: form.regionsGlobalCompulsory
                              ? Colors.success
                              : Colors.textSecondary,
                          },
                        ]}
                      >
                        {form.regionsGlobalCompulsory ? "Compulsory" : "Optional"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: Colors.border,
                          backgroundColor: Colors.background,
                        },
                      ]}
                    />
                  )}
                </TouchableOpacity>

                {!form.regionsGlobal ? (
                  <View style={{ marginTop: 12 }}>
                    <View
                      style={[
                        styles.searchWrapInline,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      <Search color={Colors.textSecondary} size={16} />
                      <TextInput
                        value={regionFilter}
                        onChangeText={setRegionFilter}
                        placeholder="Search countries / states"
                        placeholderTextColor={Colors.textSecondary}
                        style={[styles.input, { color: Colors.text, height: 40 }]}
                        testID="required-documents-region-search"
                      />
                    </View>

                    {form.regions.length > 0 ? (
                      <>
                        <Text
                          style={[
                            styles.label,
                            { color: Colors.textSecondary, marginTop: 12 },
                          ]}
                        >
                          Selected ({form.regions.length})
                        </Text>
                        <View style={styles.pillsWrap}>
                          {form.regions.map((r) => (
                            <TouchableOpacity
                              key={`sel-${r.key}`}
                              onPress={() => cycleRegionCompulsory(r.key)}
                              onLongPress={() =>
                                toggleRegion({
                                  key: r.key,
                                  type: r.type,
                                  country: r.country,
                                  state: r.state,
                                  label: r.label,
                                })
                              }
                              style={[
                                styles.regionChip,
                                {
                                  backgroundColor: r.compulsory
                                    ? Colors.success + "15"
                                    : Colors.gray[100],
                                  borderColor: r.compulsory
                                    ? Colors.success
                                    : Colors.border,
                                },
                              ]}
                              testID={`required-documents-region-selected-${r.key}`}
                            >
                              {r.type === "country" ? (
                                <Globe2
                                  color={
                                    r.compulsory ? Colors.success : Colors.textSecondary
                                  }
                                  size={12}
                                />
                              ) : (
                                <MapPin
                                  color={
                                    r.compulsory ? Colors.success : Colors.textSecondary
                                  }
                                  size={12}
                                />
                              )}
                              <Text
                                style={[
                                  styles.pillText,
                                  { color: Colors.text },
                                ]}
                                numberOfLines={1}
                              >
                                {r.label}
                              </Text>
                              <View
                                style={[
                                  styles.compulsoryPillSm,
                                  {
                                    backgroundColor: r.compulsory
                                      ? Colors.success
                                      : Colors.gray[200],
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.compulsoryTextSm,
                                    {
                                      color: r.compulsory
                                        ? Colors.onAccent
                                        : Colors.textSecondary,
                                    },
                                  ]}
                                >
                                  {r.compulsory ? "Compulsory" : "Optional"}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text
                          style={[
                            styles.helper,
                            { color: Colors.textSecondary, marginTop: 4 },
                          ]}
                        >
                          Tap to cycle • long-press to remove
                        </Text>
                      </>
                    ) : null}

                    <Text
                      style={[
                        styles.label,
                        { color: Colors.textSecondary, marginTop: 12 },
                      ]}
                    >
                      Countries ({filteredCountries.length})
                    </Text>
                    {filteredCountries.length === 0 ? (
                      <View
                        style={[
                          styles.emptyTypes,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.helper,
                            { color: Colors.textSecondary, textAlign: "center" },
                          ]}
                        >
                          No countries found. Add them in Country / States / Cities.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.pillsWrap}>
                        {filteredCountries.map((c) => {
                          const checked = selectedRegionKeys.has(c.key);
                          return (
                            <TouchableOpacity
                              key={c.key}
                              onPress={() =>
                                toggleRegion({
                                  key: c.key,
                                  type: "country",
                                  country: c.country,
                                  label: c.label,
                                })
                              }
                              style={[
                                styles.pill,
                                {
                                  backgroundColor: checked
                                    ? Colors.accent
                                    : Colors.gray[100],
                                  borderColor: checked ? Colors.accent : Colors.border,
                                },
                              ]}
                              testID={`required-documents-region-country-${c.key}`}
                            >
                              <Globe2
                                color={checked ? Colors.onAccent : Colors.textSecondary}
                                size={12}
                              />
                              <Text
                                style={[
                                  styles.pillText,
                                  { color: checked ? Colors.onAccent : Colors.text },
                                ]}
                                numberOfLines={1}
                              >
                                {c.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    <Text
                      style={[
                        styles.label,
                        { color: Colors.textSecondary, marginTop: 12 },
                      ]}
                    >
                      States ({filteredStates.length})
                    </Text>
                    {filteredStates.length === 0 ? (
                      <View
                        style={[
                          styles.emptyTypes,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.helper,
                            { color: Colors.textSecondary, textAlign: "center" },
                          ]}
                        >
                          No states found.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.pillsWrap}>
                        {filteredStates.map((s) => {
                          const checked = selectedRegionKeys.has(s.key);
                          return (
                            <TouchableOpacity
                              key={s.key}
                              onPress={() =>
                                toggleRegion({
                                  key: s.key,
                                  type: "state",
                                  country: s.country,
                                  state: s.state,
                                  label: s.label,
                                })
                              }
                              style={[
                                styles.pill,
                                {
                                  backgroundColor: checked
                                    ? Colors.accent
                                    : Colors.gray[100],
                                  borderColor: checked ? Colors.accent : Colors.border,
                                },
                              ]}
                              testID={`required-documents-region-state-${s.key}`}
                            >
                              <MapPin
                                color={checked ? Colors.onAccent : Colors.textSecondary}
                                size={12}
                              />
                              <Text
                                style={[
                                  styles.pillText,
                                  { color: checked ? Colors.onAccent : Colors.text },
                                ]}
                                numberOfLines={1}
                              >
                                {s.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                ) : null}

                <View style={styles.docTypesHeader}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                    Upload Requirements
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    Fields partners must fill at every upload
                  </Text>
                </View>

                {[
                  {
                    key: "requireStartDate" as const,
                    title: "Start Date",
                    desc: "Partner enters the document start date",
                    Icon: CalendarClock,
                  },
                  {
                    key: "requireExpiryDate" as const,
                    title: "Expiry Date",
                    desc: "Recorded with document — expired docs require re-upload",
                    Icon: CalendarRange,
                  },
                  {
                    key: "requireDocumentNumber" as const,
                    title: "Document Number",
                    desc: "Required at every upload",
                    Icon: Hash,
                  },
                  {
                    key: "requireInsuranceProvider" as const,
                    title: "Select Insurance Provider",
                    desc: "Partner picks from Insurance Providers at every upload",
                    Icon: ShieldAlert,
                  },
                  {
                    key: "isPwd" as const,
                    title: "For PWD (People with Disability)",
                    desc: "Mark this document as a PWD document",
                    Icon: Accessibility,
                  },
                  {
                    key: "requireFrontBack" as const,
                    title: "Front & Back Required",
                    desc: "Partner must upload both sides of the document",
                    Icon: CopyIcon,
                  },
                  {
                    key: "allowPdfUpload" as const,
                    title: "Allow PDF Upload",
                    desc: "Partners can upload PDF documents — AI analyses them like images",
                    Icon: FileText,
                  },
                ].map(({ key, title, desc, Icon }) => {
                  const v = form[key];
                  return (
                    <View
                      key={`opt-${key}`}
                      style={[
                        styles.optionRow,
                        {
                          backgroundColor: Colors.gray[100],
                          borderColor: v ? Colors.accent : Colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.optionIcon,
                          {
                            backgroundColor: v ? Colors.accent : Colors.gray[200],
                          },
                        ]}
                      >
                        <Icon
                          color={v ? Colors.onAccent : Colors.textSecondary}
                          size={16}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                          {title}
                        </Text>
                        <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                          {desc}
                        </Text>
                      </View>
                      <Switch
                        value={v}
                        onValueChange={(nv) =>
                          setForm((p) => ({ ...p, [key]: nv }))
                        }
                        testID={`required-documents-field-${key}`}
                      />
                    </View>
                  );
                })}

                <View style={styles.docTypesHeader}>
                  <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                    Taxi Driver Permit
                  </Text>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    For partner-teksi driver permit
                  </Text>
                </View>

                <View
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: form.isTaxiPermit ? Colors.accent : Colors.border,
                      alignItems: "flex-start" as const,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.optionIcon,
                      { backgroundColor: form.isTaxiPermit ? Colors.accent : Colors.gray[200] },
                    ]}
                  >
                    <Car
                      color={form.isTaxiPermit ? Colors.onAccent : Colors.textSecondary}
                      size={16}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Taxi Driver Permit display
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      When on, this document is treated as the taxi driver permit. The uploaded image is scanned to capture: ID Number, Validity From & To, Driver Type, Licence Reference Number, Vehicle Number, Licence Class, Company Name, Address, Image on Permit and QR Code.
                    </Text>
                  </View>
                  <Switch
                    value={form.isTaxiPermit}
                    onValueChange={(v) => setForm((p) => ({ ...p, isTaxiPermit: v }))}
                    testID="required-documents-field-isTaxiPermit"
                  />
                </View>

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Default Required
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      {form.required ? "Compulsory for partners" : "Optional for partners"}
                    </Text>
                  </View>
                  <Switch
                    value={form.required}
                    onValueChange={(v) => setForm((p) => ({ ...p, required: v }))}
                    testID="required-documents-field-required"
                  />
                </View>

                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 10 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Status
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      {form.active ? "Active — visible to partners" : "Not active — hidden"}
                    </Text>
                  </View>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    testID="required-documents-field-active"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="required-documents-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add document"}
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
  searchWrapInline: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800" as const, flexShrink: 1 },
  cardMeta: { fontSize: 12, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: { fontSize: 10, fontWeight: "800" as const },
  chipWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 11, fontWeight: "700" as const },
  cardActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
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
    alignItems: "flex-start" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" as const },
  label: { fontSize: 12, fontWeight: "700" as const, marginBottom: 6 },
  helper: { fontSize: 11 },
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 14 },
  docTypesHeader: {
    flexDirection: "row" as const,
    alignItems: "baseline" as const,
    justifyContent: "space-between" as const,
    marginTop: 14,
    marginBottom: 8,
    gap: 8,
  },
  pillsWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
    marginBottom: 4,
  },
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  regionChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: "700" as const },
  emptyTypes: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    gap: 12,
  },
  globalRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  globalIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  compulsoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  compulsoryText: { fontSize: 11, fontWeight: "800" as const },
  compulsoryPillSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  compulsoryTextSm: { fontSize: 10, fontWeight: "800" as const },
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
