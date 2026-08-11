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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  X,
  FileText,
  Pencil,
  ZoomIn,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import {
  fetchAllProviderDocuments,
  setProviderDocumentStatus,
  computeDisplayStatus,
  updateProviderDocumentMetadata,
  deleteProviderDocument,
  type ProviderDocStatus,
  type ProviderDocumentRow,
} from "@/utils/providerDocumentsStore";
import { supabase } from "@/utils/supabase";
import DocumentViewerModal from "@/components/DocumentViewerModal";
import DocumentMetadataEditModal, { type EditableDocMetadata } from "@/components/DocumentMetadataEditModal";

const STATUS_TABS: { key: ProviderDocStatus | "All"; label: string }[] = [
  { key: "Pending Review", label: "Pending" },
  { key: "Approved", label: "Approved" },
  { key: "Rejected", label: "Rejected" },
  { key: "Expired", label: "Expired" },
  { key: "All", label: "All" },
];

function isPdfUri(u: string | null | undefined): boolean {
  if (!u) return false;
  return u.toLowerCase().split("?")[0].endsWith(".pdf");
}

export default function AdminDocumentsPartnersScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [tab, setTab] = useState<ProviderDocStatus | "All">("Pending Review");
  const [rows, setRows] = useState<ProviderDocumentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [partnerNames, setPartnerNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ProviderDocumentRow | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("");
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const load = useCallback(async () => {
    const data = await fetchAllProviderDocuments(tab === "All" ? null : tab);
    setRows(data);
    setLoading(false);

    const partnerIds = Array.from(new Set(data.map((r) => r.partner_id))).filter(Boolean);
    if (partnerIds.length > 0 && supabase) {
      const { data: partners } = await supabase
        .from("partners")
        .select("id, name, phone, display_id")
        .in("id", partnerIds);
      const map: Record<string, string> = {};
      (partners ?? []).forEach((p: { id: string; name: string | null; phone: string | null; display_id: string | null }) => {
        map[p.id] = p.name || p.phone || p.display_id || p.id.slice(0, 8);
      });
      setPartnerNames(map);
    }
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
    const c: Record<string, number> = { "Pending Review": 0, Approved: 0, Rejected: 0, Expired: 0 };
    rows.forEach((r) => {
      const s = computeDisplayStatus(r);
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  const statusColor = (s: ProviderDocStatus) => {
    if (s === "Approved") return Colors.success;
    if (s === "Rejected") return Colors.error;
    if (s === "Expired") return Colors.error;
    return Colors.warning ?? "#F59E0B";
  };

  const statusIcon = (s: ProviderDocStatus) => {
    if (s === "Approved") return CheckCircle2;
    if (s === "Rejected") return XCircle;
    if (s === "Expired") return AlertCircle;
    return Clock;
  };

  const handleDecide = async (status: "Approved" | "Rejected") => {
    if (!selected) return;
    if (status === "Rejected" && !notes.trim()) {
      Alert.alert("Reason required", "Please add a short note explaining the rejection.");
      return;
    }
    setSaving(true);
    const updated = await setProviderDocumentStatus(selected.id, status, notes.trim() || null);
    setSaving(false);
    if (!updated) {
      Alert.alert("Failed", "Could not update document. Please try again.");
      return;
    }
    setSelected(null);
    setNotes("");
    await load();
  };

  const handleSaveEdit = async (patch: EditableDocMetadata) => {
    if (!selected) return;
    setEditSaving(true);
    const updated = await updateProviderDocumentMetadata(selected.id, patch);
    setEditSaving(false);
    if (!updated) {
      Alert.alert("Failed", "Could not save changes.");
      return;
    }
    setSelected(updated);
    setEditOpen(false);
    await load();
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    const ok = await deleteProviderDocument(selected.id);
    setDeleting(false);
    if (!ok) {
      Alert.alert("Failed", "Could not delete document.");
      return;
    }
    setEditOpen(false);
    setSelected(null);
    setNotes("");
    await load();
  };

  const openDetail = (row: ProviderDocumentRow) => {
    setSelected(row);
    setNotes(row.reviewer_notes ?? "");
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
          testID="docs-partners-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Users color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Partner Documents</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {counts["Pending Review"] ?? 0} pending • {counts["Approved"] ?? 0} approved
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
              testID={`docs-partners-tab-${t.key}`}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.tabText, { color: isActive ? Colors.onAccent : Colors.text }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accentText} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          showsVerticalScrollIndicator={false}
        >
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No documents in this state.</Text>
            </View>
          ) : (
            rows.map((row) => {
              const s = computeDisplayStatus(row);
              const Icon = statusIcon(s);
              const color = statusColor(s);
              const owner = partnerNames[row.partner_id] ?? row.partner_id.slice(0, 8);
              const pdfRow = isPdfUri(row.file_url);
              return (
                <TouchableOpacity
                  key={row.id}
                  style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                  onPress={() => openDetail(row)}
                  activeOpacity={0.85}
                  testID={`docs-partners-row-${row.id}`}
                  accessibilityRole="button"
                >
                  {row.file_url && !pdfRow ? (
                    <Image source={{ uri: row.file_url }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: Colors.gray[200], justifyContent: "center", alignItems: "center" }]}>
                      {pdfRow ? (
                        <>
                          <FileText color={Colors.accentText} size={22} />
                          <Text style={{ color: Colors.textSecondary, fontSize: 9, marginTop: 2, fontWeight: "700" as const }}>PDF</Text>
                        </>
                      ) : (
                        <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>No file</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={1}>{row.doc_name}</Text>
                    <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>{owner}</Text>
                    <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {new Date(row.uploaded_at).toLocaleDateString()}
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

      <DocumentReviewModal
        visible={!!selected}
        row={selected}
        ownerLabel={selected ? partnerNames[selected.partner_id] ?? "" : ""}
        notes={notes}
        onNotesChange={setNotes}
        saving={saving}
        onClose={() => { setSelected(null); setNotes(""); }}
        onApprove={() => handleDecide("Approved")}
        onReject={() => handleDecide("Rejected")}
        onOpenFile={(url, title) => openViewer(url, title)}
        onEdit={() => setEditOpen(true)}
      />

      <DocumentViewerModal
        visible={!!viewerUrl}
        url={viewerUrl}
        title={viewerTitle}
        onClose={() => setViewerUrl(null)}
      />

      <DocumentMetadataEditModal
        visible={editOpen}
        initial={selected ? {
          doc_name: selected.doc_name,
          document_number: selected.document_number,
          insurance_provider_name: selected.insurance_provider_name,
          issuance_country: selected.issuance_country,
          start_date: selected.start_date,
          expiry_date: selected.expiry_date,
          is_pwd: selected.is_pwd,
        } : null}
        saving={editSaving}
        deleting={deleting}
        onClose={() => setEditOpen(false)}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
      />
    </SafeAreaView>
  );
}

interface ReviewModalProps {
  visible: boolean;
  row: ProviderDocumentRow | null;
  ownerLabel: string;
  notes: string;
  onNotesChange: (v: string) => void;
  saving: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onOpenFile: (url: string, title: string) => void;
  onEdit: () => void;
}

function DocumentReviewModal({
  visible,
  row,
  ownerLabel,
  notes,
  onNotesChange,
  saving,
  onClose,
  onApprove,
  onReject,
  onOpenFile,
  onEdit,
}: ReviewModalProps) {
  const Colors = useColors();
  if (!row) return null;
  const s = computeDisplayStatus(row);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={["bottom"]}>
        <View style={[styles.modalHeader, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity onPress={onClose} style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]} testID="docs-modal-close" accessibilityRole="button">
            <X color={Colors.text} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{row.doc_name}</Text>
            <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
              {ownerLabel || row.partner_id.slice(0, 8)} • {s}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onEdit}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            testID="docs-modal-edit"
            accessibilityRole="button"
            accessibilityLabel="Edit documents"
          >
            <Pencil color={Colors.text} size={18} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
          <FilePreview
            url={row.file_url}
            label="Front"
            onOpen={(u) => onOpenFile(u, `${row.doc_name} • Front`)}
          />
          {row.file_url_back ? (
            <View style={{ marginTop: 12 }}>
              <FilePreview
                url={row.file_url_back}
                label="Back"
                onOpen={(u) => onOpenFile(u, `${row.doc_name} • Back`)}
              />
            </View>
          ) : null}

          <View style={{ height: 16 }} />

          <DetailRow label="Document #" value={row.document_number ?? "—"} />
          <DetailRow label="Start date" value={row.start_date ?? "—"} />
          <DetailRow label="Expiry" value={row.expiry_date ?? "—"} />
          {row.insurance_provider_name ? <DetailRow label="Provider" value={row.insurance_provider_name} /> : null}
          {row.issuance_country ? <DetailRow label="Country" value={row.issuance_country} /> : null}
          {row.detected_document_name ? <DetailRow label="AI detected" value={row.detected_document_name} /> : null}
          {row.ai_verification ? (
            <DetailRow
              label="AI check"
              value={`${row.ai_verification.matchesTitle ? "Match" : "Mismatch"} • ${(row.ai_verification.confidence * 100).toFixed(0)}%`}
            />
          ) : null}
          <DetailRow label="Uploaded" value={new Date(row.uploaded_at).toLocaleString()} />
          {row.reviewed_at ? <DetailRow label="Reviewed" value={new Date(row.reviewed_at).toLocaleString()} /> : null}

          <TaxiPermitDetails permit={row.ai_verification?.extracted?.taxiPermit ?? null} />

          <TouchableOpacity
            onPress={onEdit}
            style={[styles.editBtn, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
            testID="docs-modal-edit-row"
            accessibilityRole="button"
          >
            <Pencil color={Colors.text} size={16} />
            <Text style={[styles.editBtnText, { color: Colors.text }]}>Edit details or remove document</Text>
          </TouchableOpacity>

          <Text style={[styles.notesLabel, { color: Colors.text }]}>Reviewer notes</Text>
          <TextInput
            value={notes}
            onChangeText={onNotesChange}
            placeholder="Reason / notes (required when rejecting)"
            placeholderTextColor={Colors.textSecondary}
            multiline
            style={[
              styles.notesInput,
              { backgroundColor: Colors.gray[100], color: Colors.text, borderColor: Colors.border },
            ]}
            testID="docs-modal-notes"
            accessibilityLabel="Reviewer notes"
          />
        </ScrollView>

        <View style={[styles.modalFooter, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
          <TouchableOpacity
            onPress={onReject}
            disabled={saving}
            style={[styles.actionBtn, { backgroundColor: Colors.error + "20", borderColor: Colors.error }]}
            testID="docs-modal-reject"
            accessibilityRole="button"
          >
            <XCircle color={Colors.errorText} size={18} />
            <Text style={[styles.actionText, { color: Colors.errorText }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onApprove}
            disabled={saving}
            style={[styles.actionBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]}
            testID="docs-modal-approve"
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={Colors.onAccent} size="small" />
            ) : (
              <>
                <CheckCircle2 color={Colors.onAccent} size={18} />
                <Text style={[styles.actionText, { color: Colors.onAccent }]}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function FilePreview({ url, label, onOpen }: { url: string | null; label: string; onOpen: (u: string) => void }) {
  const Colors = useColors();
  if (!url) {
    return (
      <View style={[styles.filePlaceholder, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Text style={{ color: Colors.textSecondary }}>No {label.toLowerCase()} file</Text>
      </View>
    );
  }
  const pdf = isPdfUri(url);
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onOpen(url)}
      style={styles.previewWrap}
      testID={`doc-preview-${label.toLowerCase()}`}
      accessibilityRole="button"
    >
      {pdf ? (
        <View style={[styles.modalImage, { backgroundColor: Colors.gray[100], justifyContent: "center" as const, alignItems: "center" as const, borderWidth: 1, borderColor: Colors.border }]}>
          <FileText color={Colors.accentText} size={42} />
          <Text style={{ color: Colors.text, fontWeight: "700" as const, marginTop: 8 }}>PDF document</Text>
          <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 4 }}>Tap to open & zoom</Text>
        </View>
      ) : (
        <Image source={{ uri: url }} style={styles.modalImage} resizeMode="contain" />
      )}
      <View style={styles.previewBadge}>
        <ZoomIn color="#fff" size={12} />
        <Text style={styles.previewBadgeText}>Tap to zoom</Text>
      </View>
      <View style={[styles.previewSideTag, { backgroundColor: Colors.accent }]}>
        <Text style={{ color: Colors.onAccent, fontSize: 11, fontWeight: "800" as const }}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function TaxiPermitDetails({
  permit,
}: {
  permit: NonNullable<NonNullable<ProviderDocumentRow["ai_verification"]>["extracted"]>["taxiPermit"];
}) {
  const Colors = useColors();
  if (!permit) return null;
  const fmtBool = (v: boolean | null | undefined): string =>
    v === true ? "Yes" : v === false ? "No" : "—";
  const fmt = (v: string | null | undefined): string => (v && v.trim() ? v : "—");
  const fields: { label: string; value: string }[] = [
    { label: "Name", value: fmt(permit.name) },
    { label: "ID number", value: fmt(permit.idNumber) },
    { label: "Validity from", value: fmt(permit.validityFrom) },
    { label: "Validity to", value: fmt(permit.validityTo) },
    { label: "Driver type", value: fmt(permit.driverType) },
    { label: "Licence ref. no.", value: fmt(permit.licenceReferenceNumber) },
    { label: "Vehicle number", value: fmt(permit.vehicleNumber) },
    { label: "Licence class", value: fmt(permit.licenceClass) },
    { label: "Company name", value: fmt(permit.companyName) },
    { label: "Address", value: fmt(permit.address) },
    { label: "Image on permit", value: fmtBool(permit.hasImageOnPermit) },
    { label: "QR code", value: fmtBool(permit.hasQrCode) },
  ];
  return (
    <View style={[styles.permitCard, { backgroundColor: Colors.accent + "12", borderColor: Colors.accent + "40" }]}>
      <View style={styles.permitHeader}>
        <FileText color={Colors.accentText} size={16} />
        <Text style={[styles.permitTitle, { color: Colors.text }]}>Captured permit fields</Text>
      </View>
      {fields.map((f) => (
        <DetailRow key={f.label} label={f.label} value={f.value} />
      ))}
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
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
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
  modalImage: {
    width: "100%" as const,
    height: 260,
    borderRadius: 12,
    backgroundColor: "#0001",
  },
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
  previewSideTag: {
    position: "absolute" as const,
    left: 10,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  filePlaceholder: {
    width: "100%" as const,
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  detailRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
    paddingVertical: 8,
    gap: 12,
  },
  detailLabel: { fontSize: 13 },
  detailValue: { fontSize: 14, fontWeight: "600" as const, flex: 1, textAlign: "right" as const },
  permitCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  permitHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 6,
  },
  permitTitle: { fontSize: 14, fontWeight: "800" as const },
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
