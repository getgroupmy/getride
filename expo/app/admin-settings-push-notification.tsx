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
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Bell,
  Plus,
  Pencil,
  Trash2,
  X,
  Send,
  Inbox,
  Save,
  Users,
  Smartphone,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";
import { countPushTokens, sendPushNotification } from "@/utils/adminSync";

const STORAGE_KEY = "push-notification";

type Audience = "all" | "drivers" | "users";
const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "drivers", label: "Drivers" },
  { key: "users", label: "Users" },
];

function normalizeAudience(value: unknown): Audience {
  const v = String(value ?? "all").toLowerCase();
  if (v === "drivers" || v === "users") return v;
  return "all";
}

export default function AdminSettingsPushNotificationScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();
  const { getEntries, addEntry, updateEntry, removeEntry } = useAdminData();
  const entries = getEntries(STORAGE_KEY);

  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<SettingEntry | null>(null);
  const [title, setTitle] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [audience, setAudience] = useState<Audience>("all");
  const [sendingId, setSendingId] = useState<string | null>(null);

  const refreshCount = useCallback(() => {
    countPushTokens()
      .then(setDeviceCount)
      .catch(() => setDeviceCount(null));
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) =>
        String(b.values.updatedAt ?? "").localeCompare(String(a.values.updatedAt ?? ""))
      ),
    [entries]
  );

  const openCompose = (entry?: SettingEntry) => {
    if (!guard()) return;
    if (entry) {
      setEditing(entry);
      setTitle(String(entry.values.title ?? ""));
      setBody(String(entry.values.body ?? ""));
      setAudience(normalizeAudience(entry.values.audience));
    } else {
      setEditing(null);
      setTitle("");
      setBody("");
      setAudience("all");
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const validate = (): boolean => {
    if (!title.trim()) {
      Alert.alert("Missing field", "Please enter a title.");
      return false;
    }
    if (!body.trim()) {
      Alert.alert("Missing field", "Please enter a message.");
      return false;
    }
    return true;
  };

  const persist = (): string | null => {
    const values = {
      title: title.trim(),
      body: body.trim(),
      audience,
      updatedAt: new Date().toISOString(),
    };
    if (editing) {
      updateEntry(STORAGE_KEY, editing.id, { ...editing.values, ...values });
      return editing.id;
    }
    addEntry(STORAGE_KEY, values);
    return null;
  };

  const onSaveTemplate = () => {
    if (!guard() || !validate()) return;
    persist();
    closeModal();
  };

  const dispatch = useCallback(
    async (t: string, b: string, aud: Audience) => {
      const audienceLabel =
        AUDIENCES.find((a) => a.key === aud)?.label ?? "Everyone";
      const result = await sendPushNotification(t, b, aud);
      refreshCount();
      if (!result.ok) {
        Alert.alert("Send failed", result.error ?? "Could not send notification.");
        return;
      }
      if (result.recipients === 0) {
        Alert.alert(
          "No recipients",
          `No registered devices match the “${audienceLabel}” audience yet.`
        );
        return;
      }
      Alert.alert(
        "Notification sent",
        `Delivered to ${result.sent} of ${result.recipients} device(s)` +
          (result.failed ? `\n${result.failed} failed.` : ".")
      );
    },
    [refreshCount]
  );

  const onSendFromModal = async () => {
    if (!guard() || !validate()) return;
    persist();
    closeModal();
    await dispatch(title.trim(), body.trim(), audience);
  };

  const onSendRow = (entry: SettingEntry) => {
    if (!guard()) return;
    const t = String(entry.values.title ?? "").trim();
    const b = String(entry.values.body ?? "").trim();
    const aud = normalizeAudience(entry.values.audience);
    if (!t || !b) {
      Alert.alert("Incomplete", "This notification is missing a title or message.");
      return;
    }
    const audienceLabel = AUDIENCES.find((a) => a.key === aud)?.label ?? "Everyone";
    Alert.alert("Send notification", `Send “${t}” to ${audienceLabel}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: async () => {
          setSendingId(entry.id);
          await dispatch(t, b, aud);
          setSendingId(null);
        },
      },
    ]);
  };

  const onDelete = (entry: SettingEntry) => {
    if (!guard()) return;
    Alert.alert("Delete", "Remove this notification?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeEntry(STORAGE_KEY, entry.id),
      },
    ]);
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
          testID="push-notification-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Bell color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
              Push Notification
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            Send push messages
          </Text>
        </View>
        {editable ? (
          <TouchableOpacity
            onPress={() => openCompose()}
            style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
            testID="push-notification-add"
          >
            <Plus color={Colors.secondary} size={22} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]} />
        )}
      </View>

      {!editable ? (
        <View
          style={[
            styles.readOnlyBanner,
            { backgroundColor: Colors.warning + "22", borderColor: Colors.warning + "55" },
          ]}
        >
          <Text style={[styles.readOnlyText, { color: Colors.warning }]}>Read-only access</Text>
        </View>
      ) : null}

      <View style={[styles.statCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <View style={[styles.statIcon, { backgroundColor: Colors.accent + "20" }]}>
          <Smartphone color={Colors.accent} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statValue, { color: Colors.text }]}>
            {deviceCount === null ? "—" : deviceCount}
          </Text>
          <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>
            Registered devices
          </Text>
        </View>
        <TouchableOpacity
          onPress={refreshCount}
          style={[styles.refreshBtn, { borderColor: Colors.border }]}
          testID="push-notification-refresh"
        >
          <Text style={[styles.refreshText, { color: Colors.accent }]}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Inbox color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No notifications yet</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              Compose a message and send it to your users.
            </Text>
            {editable ? (
              <TouchableOpacity
                onPress={() => openCompose()}
                style={[styles.cta, { backgroundColor: Colors.accent }]}
                testID="push-notification-empty-add"
              >
                <Plus color={Colors.secondary} size={16} />
                <Text style={[styles.ctaText, { color: Colors.secondary }]}>Add Notification</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          sorted.map((entry) => {
            const aud = normalizeAudience(entry.values.audience);
            const audienceLabel = AUDIENCES.find((a) => a.key === aud)?.label ?? "Everyone";
            return (
              <View
                key={entry.id}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`push-notification-row-${entry.id}`}
              >
                <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Bell color={Colors.accent} size={18} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
                    {String(entry.values.title ?? "Untitled")}
                  </Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {String(entry.values.body ?? "")}
                  </Text>
                  <View style={[styles.audiencePill, { backgroundColor: Colors.accent + "18" }]}>
                    <Users color={Colors.accent} size={11} />
                    <Text style={[styles.audiencePillText, { color: Colors.accent }]}>
                      {audienceLabel}
                    </Text>
                  </View>
                </View>
                {editable ? (
                  <View style={styles.rowActions}>
                    <TouchableOpacity
                      onPress={() => onSendRow(entry)}
                      disabled={sendingId === entry.id}
                      style={[styles.sendBtn, { backgroundColor: Colors.accent }]}
                      testID={`push-notification-send-${entry.id}`}
                    >
                      {sendingId === entry.id ? (
                        <ActivityIndicator color={Colors.secondary} size="small" />
                      ) : (
                        <Send color={Colors.secondary} size={15} />
                      )}
                    </TouchableOpacity>
                    <View style={styles.rowActionsBottom}>
                      <TouchableOpacity
                        onPress={() => openCompose(entry)}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        testID={`push-notification-edit-${entry.id}`}
                      >
                        <Pencil color={Colors.accent} size={15} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDelete(entry)}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        testID={`push-notification-delete-${entry.id}`}
                      >
                        <Trash2 color={Colors.error} size={15} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
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
                  {editing ? "Edit Notification" : "New Notification"}
                </Text>
                <TouchableOpacity
                  onPress={closeModal}
                  style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                  testID="push-notification-modal-close"
                >
                  <X color={Colors.text} size={20} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Title *</Text>
                  <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder="Notification title"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, { color: Colors.text }]}
                      testID="push-notification-field-title"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Message *</Text>
                  <View
                    style={[
                      styles.inputWrap,
                      styles.inputWrapMultiline,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <TextInput
                      value={body}
                      onChangeText={setBody}
                      placeholder="What do you want to say?"
                      placeholderTextColor={Colors.textSecondary}
                      style={[styles.input, styles.inputMultiline, { color: Colors.text }]}
                      multiline
                      testID="push-notification-field-body"
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: Colors.textSecondary }]}>Audience</Text>
                  <View style={styles.segmented}>
                    {AUDIENCES.map((a) => {
                      const active = audience === a.key;
                      return (
                        <TouchableOpacity
                          key={a.key}
                          onPress={() => setAudience(a.key)}
                          style={[
                            styles.segment,
                            {
                              backgroundColor: active ? Colors.accent : Colors.gray[100],
                              borderColor: active ? Colors.accent : Colors.border,
                            },
                          ]}
                          testID={`push-notification-audience-${a.key}`}
                        >
                          <Text
                            style={[
                              styles.segmentText,
                              { color: active ? Colors.secondary : Colors.text },
                            ]}
                          >
                            {a.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={onSaveTemplate}
                  style={[styles.secondaryBtn, { borderColor: Colors.accent }]}
                  testID="push-notification-save"
                >
                  <Save color={Colors.accent} size={18} />
                  <Text style={[styles.secondaryText, { color: Colors.accent }]}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onSendFromModal}
                  style={[styles.submitBtn, { backgroundColor: Colors.accent }]}
                  testID="push-notification-send-now"
                >
                  <Send color={Colors.secondary} size={18} />
                  <Text style={[styles.submitText, { color: Colors.secondary }]}>Send now</Text>
                </TouchableOpacity>
              </View>
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  iconBtnSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  readOnlyBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  readOnlyText: { fontSize: 12, fontWeight: "800" },
  statCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "800" },
  statLabel: { fontSize: 12, marginTop: 1 },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  refreshText: { fontSize: 12, fontWeight: "700" },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowInfo: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 15, fontWeight: "700" },
  rowDesc: { fontSize: 12 },
  audiencePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 2,
  },
  audiencePillText: { fontSize: 11, fontWeight: "700" },
  rowActions: { alignItems: "center", gap: 8 },
  rowActionsBottom: { flexDirection: "row", gap: 6 },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 70,
    height: 32,
    borderRadius: 16,
  },
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" },
  emptyDesc: { fontSize: 13, textAlign: "center" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  ctaText: { fontSize: 13, fontWeight: "800" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: "800" },
  fieldGroup: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  inputWrapMultiline: { height: 110, alignItems: "flex-start", paddingVertical: 10 },
  input: { flex: 1, fontSize: 14 },
  inputMultiline: { height: "100%", textAlignVertical: "top" },
  segmented: { flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  segmentText: { fontSize: 13, fontWeight: "700" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 18,
  },
  secondaryText: { fontSize: 15, fontWeight: "800" },
  submitBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 14,
  },
  submitText: { fontSize: 15, fontWeight: "800" },
});
