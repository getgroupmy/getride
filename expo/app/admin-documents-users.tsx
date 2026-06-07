import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  User,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  FileText,
  Pencil,
  ZoomIn,
  Trash2,
  Save,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/utils/supabase";
import DocumentViewerModal from "@/components/DocumentViewerModal";

type IdStatus = "Verified" | "Failed" | "Pending" | "Expired";

interface ProfileRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  ic: string | null;
  id_image: string | null;
  id_verified: "Verified" | "Failed" | "Expired" | null;
  id_expiry_date: string | null;
  documents_ok: boolean;
  nationality: string | null;
  updated_at: string;
}

const STATUS_TABS: { key: IdStatus | "All"; label: string }[] = [
  { key: "Pending", label: "Pending" },
  { key: "Verified", label: "Verified" },
  { key: "Failed", label: "Failed" },
  { key: "Expired", label: "Expired" },
  { key: "All", label: "All" },
];

function isExpired(p: ProfileRow): boolean {
  if (!p.id_expiry_date) return false;
  return new Date(p.id_expiry_date).getTime() < Date.now();
}

function displayStatus(p: ProfileRow): IdStatus {
  if (p.id_verified === "Expired" || isExpired(p)) return "Expired";
  if (p.id_verified === "Verified") return "Verified";
  if (p.id_verified === "Failed") return "Failed";
  return "Pending";
}

function isPdfUri(u: string | null | undefined): boolean {
  if (!u) return false;
  return u.toLowerCase().split("?")[0].endsWith(".pdf");
}

export default function AdminDocumentsUsersScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [tab, setTab] = useState<IdStatus | "All">("Pending");
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selected, setSelected] = useState<ProfileRow | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("");
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editPhone, setEditPhone] = useState<string>("");
  const [editEmail, setEditEmail] = useState<string>("");
  const [editIc, setEditIc] = useState<string>("");
  const [editNationality, setEditNationality] = useState<string>("");
  const [editDocsOk, setEditDocsOk] = useState<boolean>(false);
  const [editIdExpiry, setEditIdExpiry] = useState<string>("");
  const [removingImage, setRemovingImage] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setRows([]);
      setLoading(false);
      return;
    }
    let query = supabase
      .from("profiles")
      .select("id, name, phone, email, ic, id_image, id_verified, id_expiry_date, documents_ok, nationality, updated_at")
      .not("id_image", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (tab === "Verified") query = query.eq("id_verified", "Verified");
    else if (tab === "Failed") query = query.eq("id_verified", "Failed");
    else if (tab === "Expired") query = query.eq("id_verified", "Expired");
    else if (tab === "Pending") query = query.is("id_verified", null);

    const { data, error } = await query;
    if (error) {
      console.log("[admin-docs-users] fetch error", error.message);
      setRows([]);
    } else {
      setRows((data as ProfileRow[]) ?? []);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<IdStatus, number> = { Verified: 0, Failed: 0, Pending: 0, Expired: 0 };
    rows.forEach((r) => {
      c[displayStatus(r)] += 1;
    });
    return c;
  }, [rows]);

  const statusColor = (s: IdStatus) => {
    if (s === "Verified") return Colors.success;
    if (s === "Failed") return Colors.error;
    if (s === "Expired") return "#9CA3AF";
    return Colors.warning ?? "#F59E0B";
  };
  const statusIcon = (s: IdStatus) => {
    if (s === "Verified") return CheckCircle2;
    if (s === "Failed") return XCircle;
    if (s === "Expired") return Clock;
    return Clock;
  };

  const openEdit = () => {
    if (!selected) return;
    setEditName(selected.name ?? "");
    setEditPhone(selected.phone ?? "");
    setEditEmail(selected.email ?? "");
    setEditIc(selected.ic ?? "");
    setEditNationality(selected.nationality ?? "");
    setEditDocsOk(selected.documents_ok);
    setEditIdExpiry(selected.id_expiry_date ?? "");
    setEditOpen(true);
  };

  const handleDecide = async (decision: "Verified" | "Failed") => {
    if (!selected || !supabase) return;
    if (decision === "Failed" && !notes.trim()) {
      Alert.alert("Reason required", "Please add a short note explaining the rejection.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ id_verified: decision })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      console.log("[admin-docs-users] update error", error.message);
      Alert.alert("Failed", "Could not update verification status.");
      return;
    }
    setSelected(null);
    setNotes("");
    await load();
  };

  const handleSaveProfile = async () => {
    if (!selected || !supabase) return;
    setEditSaving(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        ic: editIc.trim() || null,
        nationality: editNationality.trim() || null,
        documents_ok: editDocsOk,
        id_expiry_date: editIdExpiry.trim() || null,
      })
      .eq("id", selected.id)
      .select("*")
      .single();
    setEditSaving(false);
    if (error) {
      console.log("[admin-docs-users] save profile error", error.message);
      Alert.alert("Failed", "Could not save changes.");
      return;
    }
    setSelected(data as ProfileRow);
    setEditOpen(false);
    await load();
  };

  const handleRemoveIdImage = async () => {
    if (!selected || !supabase) return;
    Alert.alert("Remove ID image?", "This clears the uploaded ID file from the user record.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRemovingImage(true);
          const { data, error } = await supabase!
            .from("profiles")
            .update({ id_image: null, id_verified: null })
            .eq("id", selected.id)
            .select("*")
            .single();
          setRemovingImage(false);
          if (error) {
            Alert.alert("Failed", "Could not remove the ID image.");
            return;
          }
          setSelected(data as ProfileRow);
          await load();
        },
      },
    ]);
  };

  const openViewer = (url: string | null, title: string) => {
    if (!url) return;
    setViewerUrl(url);
    setViewerTitle(title);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="docs-users-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <User color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>User Documents</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {counts.Pending} pending • {counts.Verified} verified
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContent}
        style={styles.tabs}
      >
        {STATUS_TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? Colors.accent : Colors.gray[100],
                  borderColor: isActive ? Colors.accent : Colors.border,
                },
              ]}
              testID={`docs-users-tab-${t.key}`}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, { color: isActive ? Colors.secondary : Colors.text }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          showsVerticalScrollIndicator={false}
        >
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No users in this state.</Text>
            </View>
          ) : (
            rows.map((row) => {
              const s = displayStatus(row);
              const Icon = statusIcon(s);
              const color = statusColor(s);
              const pdfRow = isPdfUri(row.id_image);
              return (
                <TouchableOpacity
                  key={row.id}
                  style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                  onPress={() => { setSelected(row); setNotes(""); }}
                  activeOpacity={0.85}
                  testID={`docs-users-row-${row.id}`}
                >
                  {row.id_image && !pdfRow ? (
                    <Image source={{ uri: row.id_image }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: Colors.gray[200], justifyContent: "center", alignItems: "center" }]}>
                      {pdfRow ? (
                        <>
                          <FileText color={Colors.accent} size={22} />
                          <Text style={{ color: Colors.textSecondary, fontSize: 9, marginTop: 2, fontWeight: "700" as const }}>PDF</Text>
                        </>
                      ) : (
                        <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>No ID</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>
                      {row.name || row.phone || row.email || row.id.slice(0, 8)}
                    </Text>
                    <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {row.ic ? `IC ${row.ic}` : row.phone || ""}
                    </Text>
                    <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      Updated {new Date(row.updated_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: color + "20" }]}>
                    <Icon color={color} size={14} />
                    <Text style={[styles.statusText, { color }]}>{s}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => { setSelected(null); setNotes(""); }}
        presentationStyle="pageSheet"
      >
        {selected ? (
          <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={["bottom"]}>
            <View style={[styles.modalHeader, { borderBottomColor: Colors.border }]}>
              <TouchableOpacity
                onPress={() => { setSelected(null); setNotes(""); }}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="docs-users-modal-close"
              >
                <X color={Colors.text} size={22} />
              </TouchableOpacity>
              <View style={styles.headerCenter}>
                <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
                  {selected.name || selected.phone || "User"}
                </Text>
                <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
                  ID Verification • {displayStatus(selected)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={openEdit}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="docs-users-modal-edit"
              >
                <Pencil color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {selected.id_image ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => openViewer(selected.id_image, "ID image")}
                  style={styles.previewWrap}
                  testID="docs-users-preview"
                >
                  {isPdfUri(selected.id_image) ? (
                    <View style={[styles.modalImage, { backgroundColor: Colors.gray[100], justifyContent: "center" as const, alignItems: "center" as const, borderWidth: 1, borderColor: Colors.border }]}>
                      <FileText color={Colors.accent} size={42} />
                      <Text style={{ color: Colors.text, fontWeight: "700" as const, marginTop: 8 }}>PDF document</Text>
                      <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 4 }}>Tap to open & zoom</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: selected.id_image }} style={styles.modalImage} resizeMode="contain" />
                  )}
                  <View style={styles.previewBadge}>
                    <ZoomIn color="#fff" size={12} />
                    <Text style={styles.previewBadgeText}>Tap to zoom</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[styles.modalImage, { justifyContent: "center", alignItems: "center" }]}>
                  <Text style={{ color: Colors.textSecondary }}>No ID image</Text>
                </View>
              )}

              {selected.id_image ? (
                <TouchableOpacity
                  onPress={handleRemoveIdImage}
                  disabled={removingImage}
                  style={[styles.removeImgBtn, { borderColor: Colors.error, backgroundColor: Colors.error + "12" }]}
                  testID="docs-users-modal-remove-image"
                >
                  {removingImage ? (
                    <ActivityIndicator color={Colors.error} size="small" />
                  ) : (
                    <>
                      <Trash2 color={Colors.error} size={16} />
                      <Text style={[styles.removeImgText, { color: Colors.error }]}>Remove ID image</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}

              <View style={{ height: 16 }} />

              <DetailRow label="Name" value={selected.name ?? "—"} />
              <DetailRow label="Phone" value={selected.phone ?? "—"} />
              <DetailRow label="Email" value={selected.email ?? "—"} />
              <DetailRow label="IC" value={selected.ic ?? "—"} />
              <DetailRow label="Nationality" value={selected.nationality ?? "—"} />
              <DetailRow
                label="ID Expiry"
                value={selected.id_expiry_date ? new Date(selected.id_expiry_date).toLocaleDateString() : "—"}
              />
              <DetailRow label="Documents OK" value={selected.documents_ok ? "Yes" : "No"} />

              <TouchableOpacity
                onPress={openEdit}
                style={[styles.editBtn, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                testID="docs-users-modal-edit-row"
              >
                <Pencil color={Colors.text} size={16} />
                <Text style={[styles.editBtnText, { color: Colors.text }]}>Edit user profile</Text>
              </TouchableOpacity>

              <Text style={[styles.notesLabel, { color: Colors.text }]}>Reviewer notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Reason / notes (required when rejecting)"
                placeholderTextColor={Colors.textSecondary}
                multiline
                style={[
                  styles.notesInput,
                  { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border },
                ]}
                testID="docs-users-modal-notes"
              />
            </ScrollView>

            <View style={[styles.modalFooter, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
              <TouchableOpacity
                onPress={() => handleDecide("Failed")}
                disabled={saving}
                style={[styles.actionBtn, { backgroundColor: Colors.error + "20", borderColor: Colors.error }]}
                testID="docs-users-modal-reject"
              >
                <XCircle color={Colors.error} size={18} />
                <Text style={[styles.actionText, { color: Colors.error }]}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDecide("Verified")}
                disabled={saving}
                style={[styles.actionBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]}
                testID="docs-users-modal-approve"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.secondary} size="small" />
                ) : (
                  <>
                    <CheckCircle2 color={Colors.secondary} size={18} />
                    <Text style={[styles.actionText, { color: Colors.secondary }]}>Approve</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        ) : null}
      </Modal>

      <DocumentViewerModal
        visible={!!viewerUrl}
        url={viewerUrl}
        title={viewerTitle}
        onClose={() => setViewerUrl(null)}
      />

      <Modal
        visible={editOpen}
        animationType="slide"
        onRequestClose={() => setEditOpen(false)}
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={["bottom"]}>
          <View style={[styles.modalHeader, { borderBottomColor: Colors.border }]}>
            <TouchableOpacity
              onPress={() => setEditOpen(false)}
              style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
              testID="docs-users-edit-close"
            >
              <X color={Colors.text} size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: Colors.text }]}>Edit profile</Text>
              <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Update user details.</Text>
            </View>
            <View style={styles.iconBtn} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <EditField label="Full name" value={editName} onChange={setEditName} testID="docs-users-edit-name" />
            <EditField label="Phone" value={editPhone} onChange={setEditPhone} testID="docs-users-edit-phone" keyboardType="phone-pad" />
            <EditField label="Email" value={editEmail} onChange={setEditEmail} testID="docs-users-edit-email" keyboardType="email-address" autoCapitalize="none" />
            <EditField label="IC / ID number" value={editIc} onChange={setEditIc} testID="docs-users-edit-ic" autoCapitalize="characters" />
            <EditField label="Nationality" value={editNationality} onChange={setEditNationality} testID="docs-users-edit-nationality" />
            <EditField
              label="ID Expiry Date (YYYY-MM-DD)"
              value={editIdExpiry}
              onChange={setEditIdExpiry}
              testID="docs-users-edit-id-expiry"
              autoCapitalize="none"
            />

            <View style={[styles.switchRow, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchLabel, { color: Colors.text }]}>Documents OK</Text>
                <Text style={[styles.switchHint, { color: Colors.textSecondary }]}>Marks the user as having submitted required docs.</Text>
              </View>
              <Switch value={editDocsOk} onValueChange={setEditDocsOk} testID="docs-users-edit-docs-ok" />
            </View>
          </ScrollView>
          <View style={[styles.modalFooter, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
            <TouchableOpacity
              onPress={() => setEditOpen(false)}
              disabled={editSaving}
              style={[styles.actionBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
              testID="docs-users-edit-cancel"
            >
              <X color={Colors.text} size={18} />
              <Text style={[styles.actionText, { color: Colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveProfile}
              disabled={editSaving}
              style={[styles.actionBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
              testID="docs-users-edit-save"
            >
              {editSaving ? (
                <ActivityIndicator color={Colors.secondary} size="small" />
              ) : (
                <>
                  <Save color={Colors.secondary} size={18} />
                  <Text style={[styles.actionText, { color: Colors.secondary }]}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

interface EditFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}

function EditField({ label, value, onChange, testID, keyboardType, autoCapitalize }: EditFieldProps) {
  const Colors = useColors();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.editFieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        placeholderTextColor={Colors.textSecondary}
        style={[styles.editInput, { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border }]}
        testID={testID}
      />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const Colors = useColors();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: Colors.text }]} numberOfLines={2}>{value}</Text>
    </View>
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
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  tabs: { maxHeight: 56 },
  tabsContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  tabText: { fontSize: 13, fontWeight: "700" as const },
  listContent: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  empty: { paddingVertical: 64, alignItems: "center" as const },
  emptyText: { fontSize: 14 },
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#0001", justifyContent: "center" as const, alignItems: "center" as const },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700" as const },
  cardSub: { fontSize: 12 },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: "700" as const },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  modalContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  previewWrap: { position: "relative" as const },
  modalImage: { width: "100%" as const, height: 260, borderRadius: 12, backgroundColor: "#0001" },
  previewBadge: {
    position: "absolute" as const,
    right: 10,
    bottom: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  previewBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" as const },
  removeImgBtn: {
    marginTop: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  removeImgText: { fontSize: 13, fontWeight: "700" as const },
  detailRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
    paddingVertical: 8,
    gap: 12,
  },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 14, fontWeight: "600" as const, flex: 1, textAlign: "right" as const },
  editBtn: {
    marginTop: 16,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  editBtnText: { fontSize: 14, fontWeight: "700" as const },
  notesLabel: { fontSize: 14, fontWeight: "700" as const, marginTop: 16, marginBottom: 8 },
  notesInput: {
    minHeight: 90,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    textAlignVertical: "top" as const,
    fontSize: 14,
  },
  editFieldLabel: { fontSize: 12, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 6 },
  editInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  switchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  switchLabel: { fontSize: 14, fontWeight: "700" as const },
  switchHint: { fontSize: 12, marginTop: 2 },
  modalFooter: {
    flexDirection: "row" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionText: { fontSize: 15, fontWeight: "800" as const },
});
