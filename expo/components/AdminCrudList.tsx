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
  ChevronRight,
  ListOrdered,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

export type FieldType = "text" | "number" | "boolean";

export interface CrudField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
}

interface Props {
  storageKey: string;
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  primaryAction?: string;
  fields: CrudField[];
  /** keys to show as the row title and subtitle, default uses first two text fields */
  primaryDisplayKey?: string;
  secondaryDisplayKey?: string;
  testID?: string;
  /** When true, sorts entries by `displayPriority` and shows up/down reorder buttons. */
  reorderable?: boolean;
  /** Field key used for ordering when `reorderable` is true. Defaults to `displayPriority`. */
  priorityKey?: string;
  /** Filter entries by predicate (e.g., scope by parent id). */
  filter?: (entry: SettingEntry) => boolean;
  /** When provided, tapping the row triggers this drill-down handler. */
  onRowPress?: (entry: SettingEntry) => void;
  /** Extra fixed values added to every new entry (e.g., parentId). */
  extraDefaults?: Record<string, string | number | boolean>;
  /** Default seed entries inserted automatically when scope is empty. */
  seedDefaults?: Record<string, string | number | boolean>[];
}

export default function AdminCrudList({
  storageKey,
  title,
  subtitle,
  Icon,
  primaryAction,
  fields,
  primaryDisplayKey,
  secondaryDisplayKey,
  testID,
  reorderable,
  priorityKey = "displayPriority",
  filter,
  onRowPress,
  extraDefaults,
  seedDefaults,
}: Props) {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const allEntries = getEntries(storageKey);
  const entries = useMemo(
    () => (filter ? allEntries.filter(filter) : allEntries),
    [allEntries, filter]
  );

  const [seeded, setSeeded] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (seeded) return;
    if (entries.length === 0 && seedDefaults && seedDefaults.length > 0) {
      seedDefaults.forEach((vals) => {
        addEntry(storageKey, { ...(extraDefaults ?? {}), ...vals, isDefault: true });
      });
    }
    setSeeded(true);
  }, [seeded, entries.length, seedDefaults, addEntry, storageKey, extraDefaults]);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<Record<string, string | number | boolean>>({});

  const textFields = fields.filter((f) => f.type === "text").map((f) => f.key);
  const titleKey = primaryDisplayKey ?? textFields[0] ?? fields[0]?.key ?? "";
  const subKey = secondaryDisplayKey ?? textFields[1] ?? fields[1]?.key ?? "";

  const sortedEntries = useMemo(() => {
    if (!reorderable) return entries;
    return [...entries].sort((a, b) => {
      const pa = Number(a.values[priorityKey] ?? 9999);
      const pb = Number(b.values[priorityKey] ?? 9999);
      return pa - pb;
    });
  }, [entries, reorderable, priorityKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedEntries;
    return sortedEntries.filter((e) =>
      Object.values(e.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sortedEntries, query]);

  const moveEntry = useCallback(
    (id: string, dir: -1 | 1) => {
      if (!guard()) return;
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
        if (Number(g.values[priorityKey] ?? -1) !== newPriority) {
          updateEntry(storageKey, gid, { ...g.values, [priorityKey]: newPriority });
        }
      });
    },
    [sortedEntries, updateEntry, storageKey, priorityKey, guard]
  );

  const openAdd = () => {
    if (!guard()) return;
    const initial: Record<string, string | number | boolean> = {};
    fields.forEach((f) => {
      initial[f.key] = f.type === "boolean" ? false : f.type === "number" ? "" : "";
    });
    if (reorderable) {
      initial[priorityKey] = entries.length + 1;
    }
    if (extraDefaults) {
      Object.entries(extraDefaults).forEach(([k, v]) => {
        if (initial[k] === undefined) initial[k] = v;
      });
    }
    setForm(initial);
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SettingEntry) => {
    if (!guard()) return;
    const initial: Record<string, string | number | boolean> = {};
    fields.forEach((f) => {
      const v = entry.values[f.key];
      initial[f.key] = v ?? (f.type === "boolean" ? false : "");
    });
    setForm(initial);
    setEditing(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const onSave = () => {
    if (!guard()) return;
    for (const f of fields) {
      if (f.required) {
        const v = form[f.key];
        if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
          Alert.alert("Missing field", `Please fill in ${f.label}.`);
          return;
        }
      }
    }
    const cleaned: Record<string, string | number | boolean> = {};
    fields.forEach((f) => {
      const v = form[f.key];
      if (f.type === "number") {
        const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
        cleaned[f.key] = Number.isFinite(n) ? n : 0;
      } else if (f.type === "boolean") {
        cleaned[f.key] = Boolean(v);
      } else {
        cleaned[f.key] = String(v ?? "").trim();
      }
    });
    const merged: Record<string, string | number | boolean> = {
      ...(extraDefaults ?? {}),
      ...cleaned,
    };
    if (editing) {
      updateEntry(storageKey, editing.id, { ...editing.values, ...merged });
    } else {
      addEntry(storageKey, merged);
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(storageKey, entry.id),
      },
    ]);
  };

  const renderRow = (entry: SettingEntry, index: number, total: number) => {
    const titleVal = String(entry.values[titleKey] ?? "Untitled");
    const subVal = subKey ? String(entry.values[subKey] ?? "") : "";
    const otherEntries = fields
      .filter((f) => f.key !== titleKey && f.key !== subKey && !(reorderable && f.key === priorityKey))
      .slice(0, 3)
      .map((f) => {
        const v = entry.values[f.key];
        const display = f.type === "boolean" ? (v ? "Yes" : "No") : String(v ?? "");
        return `${f.label}: ${display}`;
      })
      .join(" • ");
    const priorityRaw = entry.values[priorityKey];
    const priority = priorityRaw === undefined ? "-" : String(priorityRaw);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    return (
      <View
        key={entry.id}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`${testID ?? "crud"}-row-${entry.id}`}
      >
        {reorderable && editable ? (
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
              testID={`${testID ?? "crud"}-move-up-${entry.id}`}
              hitSlop={{ top: 8, bottom: 6, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Move ${titleVal} up`}
              accessibilityState={{ disabled: isFirst }}
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
              testID={`${testID ?? "crud"}-move-down-${entry.id}`}
              hitSlop={{ top: 6, bottom: 8, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`Move ${titleVal} down`}
              accessibilityState={{ disabled: isLast }}
            >
              <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
          <Icon color={Colors.accent} size={18} />
        </View>
        <TouchableOpacity
          activeOpacity={onRowPress ? 0.7 : 1}
          disabled={!onRowPress}
          onPress={() => onRowPress?.(entry)}
          style={styles.rowInfo}
          accessibilityRole={onRowPress ? "button" : undefined}
          accessibilityLabel={onRowPress ? `Open ${titleVal}` : undefined}
          testID={`${testID ?? "crud"}-open-${entry.id}`}
        >
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
              {titleVal}
            </Text>
            {reorderable ? (
              <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
                <ListOrdered color={Colors.secondary} size={10} />
                <Text style={[styles.priorityText, { color: Colors.secondary }]}>{priority}</Text>
              </View>
            ) : null}
          </View>
          {!!subVal && (
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
              {subVal}
            </Text>
          )}
          {!!otherEntries && (
            <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
              {otherEntries}
            </Text>
          )}
        </TouchableOpacity>
        {onRowPress ? (
          <TouchableOpacity
            onPress={() => onRowPress(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${titleVal}`}
            testID={`${testID ?? "crud"}-chevron-${entry.id}`}
          >
            <ChevronRight color={Colors.accent} size={16} />
          </TouchableOpacity>
        ) : null}
        {editable ? (
          <>
            <TouchableOpacity
              onPress={() => openEdit(entry)}
              style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${titleVal}`}
              testID={`${testID ?? "crud"}-edit-${entry.id}`}
            >
              <Pencil color={Colors.accent} size={16} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete(entry)}
              style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${titleVal}`}
              testID={`${testID ?? "crud"}-delete-${entry.id}`}
            >
              <Trash2 color={Colors.error} size={16} />
            </TouchableOpacity>
          </>
        ) : null}
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
          testID={`${testID ?? "crud"}-back`}
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Icon color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        {editable ? (
          <TouchableOpacity
            onPress={openAdd}
            style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
            testID={`${testID ?? "crud"}-add`}
          >
            <Plus color={Colors.onAccent} size={22} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]} testID={`${testID ?? "crud"}-readonly`} />
        )}
      </View>
      {!editable ? (
        <View style={[styles.readOnlyBanner, { backgroundColor: Colors.warning + "22", borderColor: Colors.warning + "55" }]} testID={`${testID ?? "crud"}-readonly-banner`}>
          <Text style={[styles.readOnlyText, { color: Colors.warning }]}>Read-only access</Text>
        </View>
      ) : null}

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID={`${testID ?? "crud"}-search`}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No entries yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to add a new entry.
            </Text>
            {editable ? (
              <TouchableOpacity
                onPress={openAdd}
                style={[styles.cta, { backgroundColor: Colors.accent }]}
                testID={`${testID ?? "crud"}-empty-add`}
              >
                <Plus color={Colors.onAccent} size={16} />
                <Text style={[styles.ctaText, { color: Colors.onAccent }]}>{primaryAction ?? "Add new"}</Text>
              </TouchableOpacity>
            ) : null}
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
                  {editing ? `Edit ${title}` : `Add ${title}`}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID={`${testID ?? "crud"}-modal-close`}
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
                {fields.map((f) => {
                  if (f.type === "boolean") {
                    return (
                      <View
                        key={f.key}
                        style={[
                          styles.toggleRow,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <Text style={[styles.label, { color: Colors.text, marginBottom: 0 }]}>{f.label}</Text>
                        <Switch
                          value={Boolean(form[f.key])}
                          onValueChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))}
                          testID={`${testID ?? "crud"}-field-${f.key}`}
                        />
                      </View>
                    );
                  }
                  return (
                    <View key={f.key} style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: Colors.textSecondary }]}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </Text>
                      <View
                        style={[
                          styles.inputWrap,
                          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                        ]}
                      >
                        <TextInput
                          value={String(form[f.key] ?? "")}
                          onChangeText={(t) => setForm((p) => ({ ...p, [f.key]: t }))}
                          placeholder={f.placeholder ?? f.label}
                          placeholderTextColor={Colors.textSecondary}
                          style={[styles.input, { color: Colors.text }]}
                          keyboardType={f.type === "number" ? "decimal-pad" : "default"}
                          testID={`${testID ?? "crud"}-field-${f.key}`}
                        />
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID={`${testID ?? "crud"}-save`}
              >
                <Save color={Colors.onAccent} size={18} />
                <Text style={[styles.submitText, { color: Colors.onAccent }]}>
                  {editing ? "Save changes" : primaryAction ?? "Add entry"}
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
  readOnlyBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  readOnlyText: { fontSize: 12, fontWeight: "800" as const },
});
