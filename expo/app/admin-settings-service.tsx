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
import * as Haptics from "expo-haptics";
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
  ChevronUp,
  ChevronDown,
  ListOrdered,
  Wrench,
  Upload,
  Lock,
  ImagePlus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "service-settings";

type FormValues = {
  name: string;
  description: string;
  iconUri: string;
  displayPriority: number | string;
  active: boolean;
};

export default function AdminSettingsServiceScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<FormValues>({
    name: "",
    description: "",
    iconUri: "",
    displayPriority: "",
    active: true,
  });

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
    setForm({
      name: "",
      description: "",
      iconUri: "",
      displayPriority: entries.length + 1,
      active: true,
    });
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    setForm({
      name: String(entry.values.name ?? ""),
      description: String(entry.values.description ?? ""),
      iconUri: String(entry.values.iconUri ?? ""),
      displayPriority:
        entry.values.displayPriority === undefined
          ? ""
          : Number(entry.values.displayPriority),
      active: entry.values.active === undefined ? true : Boolean(entry.values.active),
    });
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const pickIcon = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an icon.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        setForm((p) => ({ ...p, iconUri: uri }));
      }
    } catch (e) {
      console.log("icon pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const onSave = () => {
    if (!guard()) return;
    if (!form.name.trim()) {
      Alert.alert("Missing field", "Please fill in Service Name.");
      return;
    }
    const priorityNum =
      typeof form.displayPriority === "number"
        ? form.displayPriority
        : parseFloat(String(form.displayPriority ?? ""));
    const cleaned: Record<string, string | number | boolean> = {
      name: form.name.trim(),
      description: form.description.trim(),
      iconUri: form.iconUri,
      displayPriority: Number.isFinite(priorityNum) ? priorityNum : entries.length + 1,
      active: form.active,
    };
    if (editing) {
      const isDefault = Boolean(editing.values.isDefault);
      updateEntry(STORAGE_KEY, editing.id, { ...cleaned, isDefault });
    } else {
      addEntry(STORAGE_KEY, { ...cleaned, isDefault: false });
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    if (entry.values.isDefault) {
      Alert.alert("Cannot delete", "Default services cannot be deleted. You can edit them instead.");
      return;
    }
    Alert.alert("Delete", "Remove this service?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
  };

  const renderRow = (entry: SettingEntry, index: number, total: number) => {
    const v = entry.values;
    const name = String(v.name ?? "Untitled");
    const desc = String(v.description ?? "");
    const iconUri = String(v.iconUri ?? "");
    const isDefault = Boolean(v.isDefault);
    const active = v.active === undefined ? true : Boolean(v.active);
    const priorityRaw = v.displayPriority;
    const priority = priorityRaw === undefined || priorityRaw === "" ? "-" : String(priorityRaw);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`service-row-${entry.id}`}
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
            hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
          >
            <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
          </TouchableOpacity>
        </View>
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          {iconUri ? (
            <Image source={{ uri: iconUri }} style={styles.rowIconImg} resizeMode="cover" />
          ) : (
            <Wrench color={Colors.accent} size={18} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
              <ListOrdered color={Colors.secondary} size={10} />
              <Text style={[styles.priorityText, { color: Colors.secondary }]}>{priority}</Text>
            </View>
            {isDefault ? (
              <View style={[styles.defaultPill, { backgroundColor: Colors.gray[200] }]}>
                <Lock color={Colors.textSecondary} size={10} />
                <Text style={[styles.defaultText, { color: Colors.textSecondary }]}>Default</Text>
              </View>
            ) : null}
          </View>
          {!!desc && (
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
              {desc}
            </Text>
          )}
          <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {active ? "Active" : "Inactive"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => openEdit(entry)}
          style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
          testID={`service-edit-${entry.id}`}
        >
          <Pencil color={Colors.accent} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(entry)}
          style={[
            styles.iconBtnSmall,
            { backgroundColor: Colors.background, opacity: isDefault ? 0.5 : 1 },
          ]}
          disabled={isDefault}
          testID={`service-delete-${entry.id}`}
        >
          <Trash2 color={isDefault ? Colors.textSecondary : Colors.error} size={16} />
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
          testID="service-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Wrench color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Service Settings
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Core service configuration
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="service-add"
        >
          <Plus color={Colors.secondary} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="service-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No services yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a new service.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="service-empty-add"
            >
              <Plus color={Colors.secondary} size={16} />
              <Text style={[styles.ctaText, { color: Colors.secondary }]}>Add Service</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e, i) => renderRow(e, i, filtered.length))
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
                  {editing ? "Edit Service" : "Add Service"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="service-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 500 }} contentContainerStyle={{ paddingBottom: 12 }}>
                {/* Icon uploader */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Icon</Text>
                  <View style={styles.iconUploadRow}>
                    <View
                      style={[
                        styles.iconPreview,
                        { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                      ]}
                    >
                      {form.iconUri ? (
                        <Image source={{ uri: form.iconUri }} style={styles.iconPreviewImg} resizeMode="cover" />
                      ) : (
                        <ImagePlus color={Colors.textSecondary} size={26} />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 8 }}>
                      <TouchableOpacity
                        onPress={pickIcon}
                        style={[styles.uploadBtn, { backgroundColor: Colors.accent }]}
                        testID="service-icon-upload"
                      >
                        <Upload color={Colors.secondary} size={16} />
                        <Text style={[styles.uploadBtnText, { color: Colors.secondary }]}>
                          {form.iconUri ? "Replace icon" : "Upload icon"}
                        </Text>
                      </TouchableOpacity>
                      {form.iconUri ? (
                        <TouchableOpacity
                          onPress={() => setForm((p) => ({ ...p, iconUri: "" }))}
                          style={[
                            styles.uploadBtn,
                            { backgroundColor: Colors.gray[100], borderWidth: 1, borderColor: Colors.border },
                          ]}
                          testID="service-icon-remove"
                        >
                          <Trash2 color={Colors.error} size={16} />
                          <Text style={[styles.uploadBtnText, { color: Colors.error }]}>Remove</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>

                {/* Name */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Service Name *</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.name}
                      onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
                      placeholder="e.g. Car"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="service-field-name"
                    />
                  </View>
                </View>

                {/* Description */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Description</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={form.description}
                      onChangeText={(t) => setForm((p) => ({ ...p, description: t }))}
                      placeholder="Short description"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="service-field-description"
                    />
                  </View>
                </View>

                {/* Display Priority */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Display Priority</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={String(form.displayPriority ?? "")}
                      onChangeText={(t) => setForm((p) => ({ ...p, displayPriority: t }))}
                      placeholder="1"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      keyboardType="decimal-pad"
                      testID="service-field-priority"
                    />
                  </View>
                </View>

                {/* Active */}
                <View
                  style={[
                    styles.toggleRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <Text style={[styles.label, { color: Colors.text, marginBottom: 0 }]}>Active</Text>
                  <Switch
                    value={form.active}
                    onValueChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    testID="service-field-active"
                  />
                </View>

                {editing?.values.isDefault ? (
                  <View
                    style={[
                      styles.noticeBox,
                      { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" },
                    ]}
                  >
                    <Lock color={Colors.accent} size={14} />
                    <Text style={[styles.noticeText, { color: Colors.text }]}>
                      This is a default service. It can be edited but not deleted.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="service-save"
              >
                <Save color={Colors.secondary} size={18} />
                <Text style={[styles.submitText, { color: Colors.secondary }]}>
                  {editing ? "Save changes" : "Add Service"}
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
    overflow: "hidden" as const,
  },
  rowIconImg: { width: "100%", height: "100%" },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
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
  rowTitleLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexWrap: "wrap" as const,
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
  defaultPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  defaultText: { fontSize: 10, fontWeight: "700" as const },
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
  inputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    height: 48,
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
    marginBottom: 12,
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
  iconUploadRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  iconPreview: {
    width: 80,
    height: 80,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  iconPreviewImg: { width: "100%", height: "100%" },
  uploadBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  uploadBtnText: { fontSize: 13, fontWeight: "700" as const },
  noticeBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  noticeText: { fontSize: 12, flex: 1 },
});
