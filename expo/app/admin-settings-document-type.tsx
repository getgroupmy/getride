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
  FileBadge2,
  ShieldCheck,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "document-type" as const;

interface DocumentTypeForm {
  name: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_DOCUMENT_TYPES: { name: string; description: string }[] = [
  { name: "Partner", description: "Documents shown to partners (partner-documents). Narrow further via Partner Types." },
  { name: "User", description: "Documents shown to end users" },
  { name: "Vehicle", description: "Documents tied to a vehicle" },
  { name: "Admin-Partner", description: "Admin-side partner documents" },
  { name: "Admin-User", description: "Admin-side user documents" },
  { name: "Admin-Vehicle", description: "Admin-side vehicle documents" },
];

const DEFAULT_NAMES_LC = new Set(
  DEFAULT_DOCUMENT_TYPES.map((d) => d.name.toLowerCase())
);

const haptic = () => {
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
};

export default function AdminSettingsDocumentTypeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { isHydrated, getEntries, addEntry, updateEntry, removeEntry } = useAdminData();

  const entries = getEntries(STORAGE_KEY);
  const [seeded, setSeeded] = useState<boolean>(false);

  useEffect(() => {
    if (!isHydrated || seeded) return;
    // One-time migration: remove legacy default categories (Teksi, Delivery,
    // Merchant, Fleet, Service Provider, etc.) that have no uploads — they are
    // superseded by the fixed Partner / User / Vehicle / Admin-* set. Custom
    // (non-default) types are left untouched.
    entries.forEach((e) => {
      if (!Boolean(e.values.isDefault)) return;
      const n = String(e.values.name ?? "").trim().toLowerCase();
      if (!DEFAULT_NAMES_LC.has(n)) {
        removeEntry(STORAGE_KEY, e.id);
      }
    });
    const existingLc = new Set(
      entries
        .map((e) => String(e.values.name ?? "").trim().toLowerCase())
        .filter((n) => n.length > 0)
    );
    DEFAULT_DOCUMENT_TYPES.forEach((d) => {
      if (!existingLc.has(d.name.toLowerCase())) {
        addEntry(STORAGE_KEY, {
          name: d.name,
          description: d.description,
          isDefault: true,
          enabled: true,
        });
      }
    });
    setSeeded(true);
  }, [isHydrated, seeded, entries, addEntry, removeEntry]);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<DocumentTypeForm>({
    name: "",
    description: "",
    enabled: true,
  });

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const ad = Boolean(a.values.isDefault) ? 0 : 1;
      const bd = Boolean(b.values.isDefault) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""));
    });
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

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", description: "", enabled: true });
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setEditing(entry);
    setForm({
      name: String(entry.values.name ?? ""),
      description: String(entry.values.description ?? ""),
      enabled: Boolean(entry.values.enabled ?? true),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    const name = form.name.trim();
    if (!name) {
      Alert.alert("Missing field", "Please enter a document type name.");
      return;
    }
    const dupe = entries.find(
      (e) =>
        String(e.values.name ?? "").toLowerCase() === name.toLowerCase() &&
        e.id !== editing?.id
    );
    if (dupe) {
      Alert.alert("Duplicate", "A document type with this name already exists.");
      return;
    }
    const values: Record<string, string | number | boolean> = {
      name,
      description: form.description.trim(),
      isDefault: Boolean(editing?.values.isDefault ?? false),
      enabled: form.enabled,
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, values);
    } else {
      addEntry(STORAGE_KEY, values);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    if (Boolean(entry.values.isDefault)) {
      Alert.alert("Cannot delete", "Default document types cannot be deleted, only edited.");
      return;
    }
    Alert.alert("Delete document type", `Remove "${String(entry.values.name)}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const toggleEnabled = (entry: SettingEntry) => {
    const next = !Boolean(entry.values.enabled ?? true);
    updateEntry(STORAGE_KEY, entry.id, { ...entry.values, enabled: next });
    haptic();
  };

  const renderRow = (entry: SettingEntry) => {
    const name = String(entry.values.name ?? "");
    const description = String(entry.values.description ?? "");
    const isDefault = Boolean(entry.values.isDefault);
    const enabled = Boolean(entry.values.enabled ?? true);

    return (
      <View
        key={entry.id}
        style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`document-type-row-${entry.id}`}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
            <FileBadge2 color={Colors.accent} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              {isDefault ? (
                <View style={[styles.badge, { backgroundColor: Colors.accent }]}>
                  <ShieldCheck color={Colors.onAccent} size={10} />
                  <Text style={[styles.badgeText, { color: Colors.onAccent }]}>Default</Text>
                </View>
              ) : null}
            </View>
            {description ? (
              <Text style={[styles.cardMeta, { color: Colors.textSecondary }]} numberOfLines={2}>
                {description}
              </Text>
            ) : null}
          </View>
          <Switch
            value={enabled}
            onValueChange={() => toggleEnabled(entry)}
            testID={`document-type-toggle-${entry.id}`}
          />
        </View>

        <View style={styles.cardActions}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => openEdit(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            testID={`document-type-edit-${entry.id}`}
          >
            <Pencil color={Colors.accent} size={16} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(entry)}
            disabled={isDefault}
            style={[
              styles.iconBtnSmall,
              { backgroundColor: Colors.background, opacity: isDefault ? 0.4 : 1 },
            ]}
            testID={`document-type-delete-${entry.id}`}
          >
            <Trash2 color={isDefault ? Colors.textSecondary : Colors.error} size={16} />
          </TouchableOpacity>
        </View>
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
          testID="document-type-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <FileBadge2 color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Document Type
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Categorize required documents
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="document-type-add"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search document types"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="document-type-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No document types</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to create one.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="document-type-empty-add"
            >
              <Plus color={Colors.onAccent} size={16} />
              <Text style={[styles.ctaText, { color: Colors.onAccent }]}>Add document type</Text>
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
            <View style={[styles.modalSheet, { backgroundColor: Colors.background }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: Colors.text }]}>
                    {editing ? "Edit Document Type" : "Add Document Type"}
                  </Text>
                  {editing && Boolean(editing.values.isDefault) ? (
                    <Text style={[styles.modalSubtitle, { color: Colors.textSecondary }]}>
                      Default type — name & description can be edited.
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="document-type-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <Text style={[styles.label, { color: Colors.textSecondary }]}>Name *</Text>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <TextInput
                    value={form.name}
                    onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                    placeholder="e.g. Vehicle"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text }]}
                    testID="document-type-field-name"
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
                    testID="document-type-field-description"
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
                      Enabled
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      Visible & selectable when assigning documents.
                    </Text>
                  </View>
                  <Switch
                    value={form.enabled}
                    onValueChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
                    testID="document-type-field-enabled"
                  />
                </View>
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="document-type-save"
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : "Add document type"}
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
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
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
  badge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { fontSize: 10, fontWeight: "800" as const },
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
  modalSubtitle: { fontSize: 12, marginTop: 4 },
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
