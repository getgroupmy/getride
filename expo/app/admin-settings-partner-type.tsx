import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { uploadPartnerTypeIcon } from "@/utils/partnerTypeIconStore";
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
  Users2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  Sparkles,
  ListOrdered,
  FileBadge2,
  Check,
  ImagePlus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const STORAGE_KEY = "partner-type" as const;
const DOC_TYPE_KEY = "document-type" as const;
const ALL_TOKEN = "__ALL__" as const;
const MAX_DEPTH = 3 as const;

interface SubService {
  id: string;
  name: string;
  enabled: boolean;
  children: SubService[];
}

interface PartnerTypeForm {
  name: string;
  shortInfo: string;
  iconUrl: string;
  enabled: boolean;
  subServicesEnabled: boolean;
  vehicleRequired: boolean;
  tree: SubService[];
  docTypes: string[];
}

// All partner-type data (defaults + custom) lives in Supabase.
// Defaults are seeded server-side via supabase/seed.sql and
// migration 0011_partner_type_defaults.sql, tagged isDefault=true so
// they cannot be deleted from this UI. To remove a default, delete
// the row directly in Supabase. Nothing about partner types is
// hardcoded in the app.

const newId = () => `S-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const haptic = () => {
  if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
};

const parseDocTypes = (raw: unknown): string[] => {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
};

const parseTree = (raw: unknown): SubService[] => {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const sanitize = (n: unknown): SubService | null => {
      if (!n || typeof n !== "object") return null;
      const obj = n as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name : "";
      if (!name.trim()) return null;
      const id = typeof obj.id === "string" ? obj.id : newId();
      const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
      const childrenRaw = Array.isArray(obj.children) ? (obj.children as unknown[]) : [];
      const children = childrenRaw
        .map(sanitize)
        .filter((c): c is SubService => c !== null);
      return { id, name, enabled, children };
    };
    return parsed
      .map(sanitize)
      .filter((c): c is SubService => c !== null);
  } catch {
    return [];
  }
};

const countNodes = (tree: SubService[]): number => {
  let n = 0;
  const walk = (list: SubService[]) => {
    list.forEach((s) => {
      n += 1;
      if (s.children.length) walk(s.children);
    });
  };
  walk(tree);
  return n;
};

export default function AdminSettingsPartnerTypeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { guard } = useReadOnlyGuard();
  const {
    isHydrated,
    getEntries,
    addEntry,
    updateEntry,
    removeEntry,
  } = useAdminData();

  const entries = getEntries(STORAGE_KEY);
  const docTypeEntries = getEntries(DOC_TYPE_KEY);

  const enabledDocTypes = useMemo(() => {
    return [...docTypeEntries]
      .filter((d) => Boolean(d.values.enabled ?? true))
      .sort((a, b) =>
        String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""))
      );
  }, [docTypeEntries]);

  const [query, setQuery] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [form, setForm] = useState<PartnerTypeForm>({
    name: "",
    shortInfo: "",
    iconUrl: "",
    enabled: true,
    subServicesEnabled: false,
    vehicleRequired: false,
    tree: [],
    docTypes: [],
  });
  const [uploadingIcon, setUploadingIcon] = useState<boolean>(false);

  const [renameNode, setRenameNode] = useState<{ path: number[]; value: string } | null>(null);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      if (pa !== pb) return pa - pb;
      return String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""));
    });
  }, [entries]);

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
      haptic();
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedEntries;
    return sortedEntries.filter((e) => {
      const name = String(e.values.name ?? "").toLowerCase();
      if (name.includes(q)) return true;
      const tree = parseTree(e.values.subServicesJson);
      const matches = (list: SubService[]): boolean =>
        list.some((s) => s.name.toLowerCase().includes(q) || matches(s.children));
      return matches(tree);
    });
  }, [sortedEntries, query]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", shortInfo: "", iconUrl: "", enabled: true, subServicesEnabled: false, vehicleRequired: false, tree: [], docTypes: [] });
    setModalOpen(true);
  };

  const pickIcon = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission required", "Photo library access is needed to upload an icon.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const localUri = res.assets[0].uri;
      setUploadingIcon(true);
      const publicUrl = await uploadPartnerTypeIcon(localUri);
      setUploadingIcon(false);
      if (!publicUrl) {
        Alert.alert("Upload failed", "Could not upload icon. Check your connection and try again.");
        return;
      }
      setForm((p) => ({ ...p, iconUrl: publicUrl }));
      haptic();
    } catch (e) {
      setUploadingIcon(false);
      console.log("[partner-type] pick icon error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  }, []);

  const clearIcon = () => {
    setForm((p) => ({ ...p, iconUrl: "" }));
    haptic();
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

  const openEdit = (entry: SettingEntry) => {
    setEditing(entry);
    setForm({
      name: String(entry.values.name ?? ""),
      shortInfo: String(entry.values.shortInfo ?? ""),
      iconUrl: String(entry.values.iconUrl ?? ""),
      enabled: Boolean(entry.values.enabled ?? true),
      subServicesEnabled: Boolean(entry.values.subServicesEnabled ?? false),
      vehicleRequired: Boolean(entry.values.vehicleRequired ?? false),
      tree: parseTree(entry.values.subServicesJson),
      docTypes: parseDocTypes(entry.values.docTypes),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setRenameNode(null);
  };

  const onSave = () => {
    if (!guard()) return;
    const name = form.name.trim();
    if (!name) {
      Alert.alert("Missing field", "Please enter a partner type name.");
      return;
    }
    const dupe = entries.find(
      (e) =>
        String(e.values.name ?? "").toLowerCase() === name.toLowerCase() &&
        e.id !== editing?.id
    );
    if (dupe) {
      Alert.alert("Duplicate", "A partner type with this name already exists.");
      return;
    }
    const values: Record<string, string | number | boolean> = {
      name,
      shortInfo: (form.shortInfo ?? "").trim(),
      iconUrl: (form.iconUrl ?? "").trim(),
      isDefault: Boolean(editing?.values.isDefault ?? false),
      enabled: form.enabled,
      subServicesEnabled: form.subServicesEnabled,
      vehicleRequired: form.vehicleRequired,
      subServicesJson: JSON.stringify(form.tree),
      docTypes: JSON.stringify(form.docTypes),
    };
    if (editing) {
      const prevPriority = editing.values.displayPriority;
      updateEntry(STORAGE_KEY, editing.id, {
        ...values,
        displayPriority: prevPriority === undefined ? entries.length : Number(prevPriority),
      });
    } else {
      addEntry(STORAGE_KEY, { ...values, displayPriority: entries.length + 1 });
    }
    closeModal();
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    if (Boolean(entry.values.isDefault)) {
      Alert.alert("Cannot delete", "Default partner types cannot be deleted, only edited.");
      return;
    }
    Alert.alert("Delete partner type", `Remove "${String(entry.values.name)}"?`, [
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

  // ---- Sub-service tree mutations -------------------------------------------------

  const updateAtPath = useCallback(
    (path: number[], mutator: (list: SubService[]) => SubService[]): void => {
      setForm((prev) => {
        const cloneTree = (list: SubService[]): SubService[] =>
          list.map((n) => ({ ...n, children: cloneTree(n.children) }));
        const next = cloneTree(prev.tree);
        if (path.length === 0) {
          return { ...prev, tree: mutator(next) };
        }
        let parent: SubService[] = next;
        for (let i = 0; i < path.length - 1; i++) {
          parent = parent[path[i]].children;
        }
        const idx = path[path.length - 1];
        parent[idx].children = mutator(parent[idx].children);
        return { ...prev, tree: next };
      });
    },
    []
  );

  const addChild = (path: number[]) => {
    const depth = path.length; // depth of the parent; 0 means top-level
    if (depth >= MAX_DEPTH) return;
    setRenameNode({ path: [...path, -1], value: "" });
  };

  const renameAtPath = (path: number[], current: string) => {
    setRenameNode({ path, value: current });
  };

  const commitRename = () => {
    if (!renameNode) return;
    const value = renameNode.value.trim();
    if (!value) {
      setRenameNode(null);
      return;
    }
    const path = renameNode.path;
    const isAdd = path[path.length - 1] === -1;
    if (isAdd) {
      const parentPath = path.slice(0, -1);
      updateAtPath(parentPath, (list) => [
        ...list,
        { id: newId(), name: value, enabled: true, children: [] },
      ]);
    } else {
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1];
      updateAtPath(parentPath, (list) =>
        list.map((n, i) => (i === idx ? { ...n, name: value } : n))
      );
    }
    setRenameNode(null);
    haptic();
  };

  const removeAtPath = (path: number[]) => {
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1];
    updateAtPath(parentPath, (list) => list.filter((_, i) => i !== idx));
    haptic();
  };

  const toggleAtPath = (path: number[]) => {
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1];
    updateAtPath(parentPath, (list) =>
      list.map((n, i) => (i === idx ? { ...n, enabled: !n.enabled } : n))
    );
    haptic();
  };

  // ---- Render helpers --------------------------------------------------------------

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => {
    setExpandedRows((p) => ({ ...p, [id]: !p[id] }));
    haptic();
  };

  const renderListRow = (entry: SettingEntry, index: number, total: number) => {
    const name = String(entry.values.name ?? "");
    const isDefault = Boolean(entry.values.isDefault);
    const enabled = Boolean(entry.values.enabled ?? true);
    const subOn = Boolean(entry.values.subServicesEnabled);
    const tree = parseTree(entry.values.subServicesJson);
    const subCount = countNodes(tree);
    const expanded = Boolean(expandedRows[entry.id]);
    const priorityRaw = entry.values.displayPriority;
    const priority =
      priorityRaw === undefined || priorityRaw === "" ? "-" : String(priorityRaw);
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const disableReorder = query.trim().length > 0;

    return (
      <View
        key={entry.id}
        style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`partner-type-row-${entry.id}`}
      >
        <View style={styles.cardHeader}>
          <View style={styles.reorderColumn}>
            <TouchableOpacity
              onPress={() => moveEntry(entry.id, -1)}
              disabled={isFirst || disableReorder}
              style={[
                styles.reorderBtn,
                {
                  backgroundColor:
                    isFirst || disableReorder ? Colors.background : Colors.accent + "20",
                  opacity: isFirst || disableReorder ? 0.4 : 1,
                },
              ]}
              hitSlop={{ top: 4, bottom: 2, left: 4, right: 4 }}
              testID={`partner-type-move-up-${entry.id}`}
            >
              <ChevronUp
                color={isFirst || disableReorder ? Colors.textSecondary : Colors.accent}
                size={16}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => moveEntry(entry.id, 1)}
              disabled={isLast || disableReorder}
              style={[
                styles.reorderBtn,
                {
                  backgroundColor:
                    isLast || disableReorder ? Colors.background : Colors.accent + "20",
                  opacity: isLast || disableReorder ? 0.4 : 1,
                },
              ]}
              hitSlop={{ top: 2, bottom: 4, left: 4, right: 4 }}
              testID={`partner-type-move-down-${entry.id}`}
            >
              <ChevronDown
                color={isLast || disableReorder ? Colors.textSecondary : Colors.accent}
                size={16}
              />
            </TouchableOpacity>
          </View>
          <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20", overflow: "hidden" as const }]}>
            {String(entry.values.iconUrl ?? "").trim() ? (
              <Image
                source={{ uri: String(entry.values.iconUrl) }}
                style={{ width: 40, height: 40 }}
                resizeMode="cover"
              />
            ) : (
              <Users2 color={Colors.accent} size={20} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>
                {name}
              </Text>
              <View style={[styles.priorityPill, { backgroundColor: Colors.accent }]}>
                <ListOrdered color={Colors.secondary} size={10} />
                <Text style={[styles.priorityText, { color: Colors.secondary }]}>{priority}</Text>
              </View>
              {isDefault ? (
                <View style={[styles.badge, { backgroundColor: Colors.accent }]}>
                  <ShieldCheck color={Colors.secondary} size={10} />
                  <Text style={[styles.badgeText, { color: Colors.secondary }]}>Default</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.cardMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
              {subOn
                ? `${subCount} sub-service${subCount === 1 ? "" : "s"} • up to ${MAX_DEPTH} levels`
                : "Sub-services off"}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={() => toggleEnabled(entry)}
            testID={`partner-type-toggle-${entry.id}`}
          />
        </View>

        <View style={styles.cardActions}>
          {subOn && subCount > 0 ? (
            <TouchableOpacity
              onPress={() => toggleExpanded(entry.id)}
              style={[styles.actionPill, { backgroundColor: Colors.background, borderColor: Colors.border }]}
              testID={`partner-type-expand-${entry.id}`}
            >
              {expanded ? (
                <ChevronDown color={Colors.text} size={14} />
              ) : (
                <ChevronRight color={Colors.text} size={14} />
              )}
              <Text style={[styles.actionPillText, { color: Colors.text }]}>
                {expanded ? "Hide" : "View"} sub-services
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <TouchableOpacity
            onPress={() => openEdit(entry)}
            style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
            testID={`partner-type-edit-${entry.id}`}
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
            testID={`partner-type-delete-${entry.id}`}
          >
            <Trash2 color={isDefault ? Colors.textSecondary : Colors.error} size={16} />
          </TouchableOpacity>
        </View>

        {expanded && subOn && subCount > 0 ? (
          <View style={[styles.previewBox, { borderTopColor: Colors.border }]}>
            {renderPreview(tree, 0)}
          </View>
        ) : null}
      </View>
    );
  };

  const renderPreview = (list: SubService[], depth: number): React.ReactNode => {
    return list.map((node) => (
      <View key={node.id} style={{ marginLeft: depth * 14, marginTop: 6 }}>
        <View style={styles.previewRow}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: node.enabled ? Colors.success : Colors.textSecondary,
              },
            ]}
          />
          <Text
            style={[
              styles.previewText,
              {
                color: node.enabled ? Colors.text : Colors.textSecondary,
                textDecorationLine: node.enabled ? ("none" as const) : ("line-through" as const),
              },
            ]}
            numberOfLines={1}
          >
            {node.name}
          </Text>
          <View style={[styles.levelChip, { backgroundColor: Colors.accent + "20" }]}>
            <Text style={[styles.levelChipText, { color: Colors.accent }]}>L{depth + 1}</Text>
          </View>
        </View>
        {node.children.length ? renderPreview(node.children, depth + 1) : null}
      </View>
    ));
  };

  const renderEditableNode = (node: SubService, path: number[]): React.ReactNode => {
    const depth = path.length - 1; // depth of THIS node (0-based)
    const canAddChild = path.length < MAX_DEPTH; // child depth = path.length
    return (
      <View key={node.id} style={{ marginTop: 8 }}>
        <View
          style={[
            styles.nodeRow,
            {
              backgroundColor: Colors.gray[100],
              borderColor: Colors.border,
              marginLeft: depth * 12,
            },
          ]}
        >
          <View style={[styles.levelChip, { backgroundColor: Colors.accent + "20" }]}>
            <Text style={[styles.levelChipText, { color: Colors.accent }]}>L{depth + 1}</Text>
          </View>
          <Text style={[styles.nodeName, { color: Colors.text }]} numberOfLines={1}>
            {node.name}
          </Text>
          <Switch value={node.enabled} onValueChange={() => toggleAtPath(path)} />
          <TouchableOpacity
            onPress={() => renameAtPath(path, node.name)}
            style={[styles.nodeBtn, { backgroundColor: Colors.background }]}
            testID={`partner-type-node-edit-${node.id}`}
          >
            <Pencil color={Colors.accent} size={14} />
          </TouchableOpacity>
          {canAddChild ? (
            <TouchableOpacity
              onPress={() => addChild(path)}
              style={[styles.nodeBtn, { backgroundColor: Colors.background }]}
              testID={`partner-type-node-add-${node.id}`}
            >
              <Plus color={Colors.success} size={14} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => removeAtPath(path)}
            style={[styles.nodeBtn, { backgroundColor: Colors.background }]}
            testID={`partner-type-node-delete-${node.id}`}
          >
            <Trash2 color={Colors.error} size={14} />
          </TouchableOpacity>
        </View>
        {node.children.map((c, i) => renderEditableNode(c, [...path, i]))}
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
          testID="partner-type-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Users2 color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Partner Type
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Categories & nested sub-services
          </Text>
        </View>
        <TouchableOpacity
          onPress={openAdd}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="partner-type-add"
        >
          <Plus color={Colors.secondary} size={22} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search partner types or sub-services"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="partner-type-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No partner types</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Tap the + button to create one.
            </Text>
            <TouchableOpacity
              onPress={openAdd}
              style={[styles.cta, { backgroundColor: Colors.accent }]}
              testID="partner-type-empty-add"
            >
              <Plus color={Colors.secondary} size={16} />
              <Text style={[styles.ctaText, { color: Colors.secondary }]}>Add partner type</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((e, i) => renderListRow(e, i, filtered.length))
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
                    {editing ? "Edit Partner Type" : "Add Partner Type"}
                  </Text>
                  {editing && Boolean(editing.values.isDefault) ? (
                    <Text style={[styles.modalSubtitle, { color: Colors.textSecondary }]}>
                      Default type — name & sub-services can be edited.
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="partner-type-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 12 }}>
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
                    placeholder="Partner type name"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text }]}
                    testID="partner-type-field-name"
                  />
                </View>

                <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 12 }]}>
                  Short Information (optional)
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: Colors.border,
                      height: 72,
                      alignItems: "flex-start" as const,
                      paddingVertical: 10,
                    },
                  ]}
                >
                  <TextInput
                    value={form.shortInfo}
                    onChangeText={(t) => setForm((p) => ({ ...p, shortInfo: t }))}
                    placeholder="Shown as subtitle in the Select your service popup"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.input, { color: Colors.text, textAlignVertical: "top" as const }]}
                    multiline
                    maxLength={140}
                    testID="partner-type-field-short-info"
                  />
                </View>
                <Text style={[styles.helper, { color: Colors.textSecondary, marginTop: 4 }]}>
                  {(form.shortInfo ?? "").trim().length}/140 — appears below the partner type name when users pick a service.
                </Text>

                <Text style={[styles.label, { color: Colors.textSecondary, marginTop: 12 }]}>
                  Icon (optional)
                </Text>
                <View
                  style={[
                    styles.iconRow,
                    { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                  ]}
                >
                  <View style={[styles.iconPreview, { backgroundColor: Colors.accent + "20", borderColor: Colors.border }]}>
                    {uploadingIcon ? (
                      <ActivityIndicator color={Colors.accent} />
                    ) : form.iconUrl ? (
                      <Image source={{ uri: form.iconUrl }} style={{ width: 56, height: 56 }} resizeMode="cover" />
                    ) : (
                      <ImagePlus color={Colors.accent} size={22} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: Colors.text, marginBottom: 2 }]}>
                      Partner type icon
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      Square image. Shown globally in the "Select your service" popup.
                    </Text>
                    <View style={styles.iconBtnsRow}>
                      <TouchableOpacity
                        onPress={pickIcon}
                        disabled={uploadingIcon}
                        style={[styles.iconActionBtn, { backgroundColor: Colors.accent, opacity: uploadingIcon ? 0.6 : 1 }]}
                        testID="partner-type-field-icon-upload"
                      >
                        <ImagePlus color={Colors.secondary} size={14} />
                        <Text style={[styles.iconActionText, { color: Colors.secondary }]}>
                          {form.iconUrl ? "Replace" : "Upload"}
                        </Text>
                      </TouchableOpacity>
                      {form.iconUrl ? (
                        <TouchableOpacity
                          onPress={clearIcon}
                          disabled={uploadingIcon}
                          style={[styles.iconActionBtn, { backgroundColor: Colors.background, borderColor: Colors.border, borderWidth: 1 }]}
                          testID="partner-type-field-icon-clear"
                        >
                          <Trash2 color={Colors.error} size={14} />
                          <Text style={[styles.iconActionText, { color: Colors.error }]}>Remove</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>

                <View style={styles.docTypesHeader}>
                  <View style={styles.titleRow}>
                    <FileBadge2 color={Colors.accent} size={14} />
                    <Text style={[styles.label, { color: Colors.textSecondary, marginBottom: 0 }]}>
                      Document Types
                    </Text>
                  </View>
                  <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                    Choose "All" or pick multiple
                  </Text>
                </View>

                <View style={styles.pillsWrap}>
                  {(() => {
                    const allSelected = form.docTypes.includes(ALL_TOKEN);
                    return (
                      <>
                        <TouchableOpacity
                          onPress={() => toggleDocType(ALL_TOKEN)}
                          style={[
                            styles.pill,
                            {
                              backgroundColor: allSelected ? Colors.accent : Colors.gray[100],
                              borderColor: allSelected ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID="partner-type-doctype-all"
                        >
                          {allSelected ? <Check color={Colors.secondary} size={13} /> : null}
                          <Text
                            style={[
                              styles.pillText,
                              { color: allSelected ? Colors.secondary : Colors.text },
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
                                testID={`partner-type-doctype-${id}`}
                              >
                                {checked ? <Check color={Colors.secondary} size={13} /> : null}
                                <Text
                                  style={[
                                    styles.pillText,
                                    { color: checked ? Colors.secondary : Colors.text },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {tname}
                                </Text>
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </>
                    );
                  })()}
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
                      Visible & selectable in the app.
                    </Text>
                  </View>
                  <Switch
                    value={form.enabled}
                    onValueChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
                    testID="partner-type-field-enabled"
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
                      Vehicle required
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      Partners of this type must register a vehicle.
                    </Text>
                  </View>
                  <Switch
                    value={form.vehicleRequired}
                    onValueChange={(v) => setForm((p) => ({ ...p, vehicleRequired: v }))}
                    testID="partner-type-field-vehicle-required"
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
                      Sub-services
                    </Text>
                    <Text style={[styles.helper, { color: Colors.textSecondary }]}>
                      Organize offerings up to {MAX_DEPTH} levels deep.
                    </Text>
                  </View>
                  <Switch
                    value={form.subServicesEnabled}
                    onValueChange={(v) => setForm((p) => ({ ...p, subServicesEnabled: v }))}
                    testID="partner-type-field-sub-enabled"
                  />
                </View>

                {form.subServicesEnabled ? (
                  <View
                    style={[
                      styles.treePanel,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <View style={styles.treeHeader}>
                      <View style={styles.titleRow}>
                        <Layers color={Colors.accent} size={16} />
                        <Text style={[styles.treeTitle, { color: Colors.text }]}>Sub-services</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => addChild([])}
                        style={[styles.addRootBtn, { backgroundColor: Colors.accent }]}
                        testID="partner-type-add-root"
                      >
                        <Plus color={Colors.secondary} size={14} />
                        <Text style={[styles.addRootText, { color: Colors.secondary }]}>
                          Add level 1
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {form.tree.length === 0 ? (
                      <View style={styles.treeEmpty}>
                        <Sparkles color={Colors.textSecondary} size={18} />
                        <Text style={[styles.helper, { color: Colors.textSecondary, textAlign: "center" }]}>
                          No sub-services yet. Tap "Add level 1" to get started.
                        </Text>
                      </View>
                    ) : (
                      form.tree.map((n, i) => renderEditableNode(n, [i]))
                    )}
                  </View>
                ) : null}
              </ScrollView>

              <TouchableOpacity
                onPress={onSave}
                style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                testID="partner-type-save"
              >
                <Save color={Colors.secondary} size={18} />
                <Text style={[styles.submitText, { color: Colors.secondary }]}>
                  {editing ? "Save changes" : "Add partner type"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>

          <Modal
            visible={renameNode !== null}
            animationType="fade"
            transparent
            onRequestClose={() => setRenameNode(null)}
          >
            <View style={styles.modalBackdrop}>
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={{ width: "100%" }}
              >
                <View style={[styles.renameSheet, { backgroundColor: Colors.background }]}>
                  <Text style={[styles.modalTitle, { color: Colors.text }]}>
                    {renameNode && renameNode.path[renameNode.path.length - 1] === -1
                      ? "Add sub-service"
                      : "Rename sub-service"}
                  </Text>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 12 },
                    ]}
                  >
                    <TextInput
                      value={renameNode?.value ?? ""}
                      onChangeText={(t) =>
                        setRenameNode((p) => (p ? { ...p, value: t } : p))
                      }
                      placeholder="Sub-service name"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      autoFocus
                      testID="partner-type-rename-input"
                    />
                  </View>
                  <View style={styles.renameActions}>
                    <TouchableOpacity
                      onPress={() => setRenameNode(null)}
                      style={[styles.renameBtn, { backgroundColor: Colors.gray[100] }]}
                      testID="partner-type-rename-cancel"
                    >
                      <Text style={[styles.renameBtnText, { color: Colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={commitRename}
                      style={[styles.renameBtn, { backgroundColor: Colors.accent }]}
                      testID="partner-type-rename-save"
                    >
                      <Text style={[styles.renameBtnText, { color: Colors.secondary }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  iconRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconPreview: {
    width: 56,
    height: 56,
    borderRadius: 14,
    overflow: "hidden" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    borderWidth: 1,
  },
  iconBtnsRow: {
    flexDirection: "row" as const,
    gap: 8,
    marginTop: 8,
  },
  iconActionBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  iconActionText: { fontSize: 12, fontWeight: "800" as const },
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
  cardActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  actionPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionPillText: { fontSize: 12, fontWeight: "700" as const },
  previewBox: {
    borderTopWidth: 1,
    paddingTop: 8,
  },
  previewRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  previewText: { fontSize: 13, flex: 1 },
  levelChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  levelChipText: { fontSize: 10, fontWeight: "800" as const },
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
    marginTop: 12,
    gap: 12,
  },
  treePanel: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  treeHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
  },
  treeTitle: { fontSize: 14, fontWeight: "800" as const },
  treeEmpty: {
    paddingVertical: 16,
    alignItems: "center" as const,
    gap: 6,
  },
  addRootBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addRootText: { fontSize: 12, fontWeight: "800" as const },
  nodeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  nodeName: { fontSize: 13, fontWeight: "700" as const, flex: 1 },
  nodeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    marginTop: 6,
  },
  submitText: { fontSize: 15, fontWeight: "800" as const },
  renameSheet: {
    margin: 16,
    padding: 18,
    borderRadius: 18,
  },
  renameActions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 14,
  },
  renameBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  renameBtnText: { fontSize: 14, fontWeight: "800" as const },
  docTypesHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 14,
    marginBottom: 8,
    gap: 8,
  },
  pillsWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: "700" as const },
  emptyTypes: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
});
