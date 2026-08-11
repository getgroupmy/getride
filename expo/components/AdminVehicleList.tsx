import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Search,
  Phone,
  CheckCircle2,
  XCircle,
  Ban,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  FileText,
  CarFront,
  Trash2,
  Palette,
  Pencil,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import {
  useAdminData,
  VehicleRecord,
  VehicleStatus,
} from "@/contexts/AdminDataContext";
import { checkVehicleDocsAllApproved } from "@/utils/vehicleDocumentsStore";

export type VehicleListStatus = VehicleStatus | "all";

interface Props {
  status: VehicleListStatus;
  title: string;
  subtitle: string;
  emptyText?: string;
}

export default function AdminVehicleList({ status, title, subtitle, emptyText }: Props) {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();
  const { vehicles, setVehicleStatus, removeVehicle } = useAdminData();
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const list =
      status === "all"
        ? vehicles
        : vehicles.filter((v) => {
            if (status === "unapproved-docs") return !v.documentsOk;
            if (status === "permit-pending") return v.permit === "pending";
            if (status === "permit-non-verified") return v.permit === "non-verified";
            if (status === "permit-verified") return v.permit === "verified";
            return v.status === status;
          });
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (v) =>
        v.plate.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        v.ownerName.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q)
    );
  }, [status, query, vehicles]);

  const statusMeta = (
    s: VehicleStatus
  ): { label: string; color: string; Icon: React.ComponentType<{ color?: string; size?: number }> } => {
    switch (s) {
      case "approved": return { label: "Approved", color: Colors.success, Icon: CheckCircle2 };
      case "unapproved": return { label: "Unapproved", color: Colors.warning, Icon: Clock };
      case "blocked": return { label: "Blocked", color: Colors.error, Icon: Ban };
      case "rejected": return { label: "Rejected", color: Colors.error, Icon: XCircle };
      case "unapproved-docs": return { label: "Docs Pending", color: Colors.warning, Icon: FileText };
      case "permit-pending": return { label: "Permit Pending", color: Colors.warning, Icon: ShieldAlert };
      case "permit-non-verified": return { label: "Permit Unverified", color: Colors.textSecondary, Icon: ShieldOff };
      case "permit-verified": return { label: "Permit Verified", color: Colors.success, Icon: ShieldCheck };
      default: return { label: "Vehicle", color: Colors.accent, Icon: CarFront };
    }
  };

  const primaryActions = (
    s: VehicleStatus
  ): { label: string; tone: "approve" | "danger" | "neutral"; nextStatus?: VehicleStatus }[] => {
    switch (s) {
      case "unapproved":
      case "unapproved-docs":
      case "permit-pending":
      case "permit-non-verified":
        return [
          { label: "Approve", tone: "approve", nextStatus: "approved" },
          { label: "Reject", tone: "danger", nextStatus: "rejected" },
        ];
      case "approved":
      case "permit-verified":
        return [
          { label: "Block", tone: "danger", nextStatus: "blocked" },
          { label: "Permit Verified", tone: "neutral", nextStatus: "permit-verified" },
        ];
      case "blocked":
        return [{ label: "Unblock", tone: "approve", nextStatus: "approved" }];
      case "rejected":
        return [{ label: "Re-open", tone: "approve", nextStatus: "unapproved" }];
      default:
        return [];
    }
  };

  const proceedToDocs = (v: VehicleRecord) => {
    router.push({ pathname: "/admin-documents-vehicles", params: { vehicleId: v.id } });
  };

  const runApprovalDocCheck = async (v: VehicleRecord, next: VehicleStatus) => {
    const check = await checkVehicleDocsAllApproved(v.id);
    if (check.unknown) {
      // No backend connection — fall back to the local documentsOk flag.
      if (!v.documentsOk) {
        Alert.alert(
          "Documents not verified",
          `${v.plate} has documents that still need review. Approve them first.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Review documents", onPress: () => proceedToDocs(v) },
          ]
        );
        return;
      }
      setVehicleStatus(v.id, next);
      return;
    }
    if (!check.hasAny) {
      Alert.alert(
        "No documents uploaded",
        `${v.plate} has no vehicle documents on file. Upload and approve the required documents first.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open documents", onPress: () => proceedToDocs(v) },
        ]
      );
      return;
    }
    if (!check.ok) {
      const parts: string[] = [];
      if (check.pending > 0) parts.push(`${check.pending} pending`);
      if (check.rejected > 0) parts.push(`${check.rejected} rejected`);
      if (check.expired > 0) parts.push(`${check.expired} expired`);
      if (check.failed > 0) parts.push(`${check.failed} failed`);
      const summary = parts.length ? ` (${parts.join(", ")})` : "";
      Alert.alert(
        "Documents not fully approved",
        `${check.approved}/${check.total} vehicle documents are approved${summary}. Review and approve them before approving the vehicle.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Review documents", onPress: () => proceedToDocs(v) },
        ]
      );
      return;
    }
    setVehicleStatus(v.id, next);
  };

  const handleAction = (vehicle: VehicleRecord, label: string, next?: VehicleStatus) => {
    if (!next) return;
    if (!guard()) return;
    Alert.alert(`${label}?`, `${vehicle.plate} (${vehicle.id})`, [
      { text: "Cancel", style: "cancel" },
      {
        text: label,
        onPress: () => {
          if (next === "approved") {
            void runApprovalDocCheck(vehicle, next);
          } else {
            setVehicleStatus(vehicle.id, next);
          }
        },
      },
    ]);
  };

  const onCall = (phone: string) => {
    const cleaned = phone.replace(/[^+\d]/g, "");
    if (Platform.OS === "web") {
      Alert.alert("Call", phone);
    } else {
      Linking.openURL(`tel:${cleaned}`).catch(() => Alert.alert("Call", phone));
    }
  };

  const onDelete = (v: VehicleRecord) => {
    if (!guard()) return;
    Alert.alert("Delete vehicle", `Remove ${v.plate}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => removeVehicle(v.id) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="vehicle-list-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: Colors.accent + "20" }]}>
          <Text style={[styles.countBadgeText, { color: Colors.accent }]}>{filtered.length}</Text>
        </View>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search plate, make, model or owner"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="vehicle-search"
          accessibilityLabel="Search plate, make, model or owner"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <CarFront color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No vehicles</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              {emptyText ?? "There are no vehicles in this category yet."}
            </Text>
          </View>
        ) : (
          filtered.map((v) => {
            const meta = statusMeta(v.status);
            const Icon = meta.Icon;
            const actions = primaryActions(v.status);
            return (
              <TouchableOpacity
                key={v.id}
                style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${v.plate}`}
                testID={`vehicle-card-${v.id}`}
                onPress={() => router.push({ pathname: "/admin-vehicle-edit", params: { id: v.id } })}
                activeOpacity={0.85}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}>
                    <CarFront color={Colors.accent} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.vehicleName, { color: Colors.text }]} numberOfLines={1}>
                        {v.make} {v.model}
                      </Text>
                      {!!v.vehicleType && (
                        <View style={[styles.typePill, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]}>
                          <Text style={[styles.typePillText, { color: Colors.accent }]} numberOfLines={1}>{v.vehicleType}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{v.id}</Text>
                      {!!v.year && (
                        <>
                          <View style={[styles.dot, { backgroundColor: Colors.textSecondary }]} />
                          <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{v.year}</Text>
                        </>
                      )}
                      {!!v.color && (
                        <>
                          <View style={[styles.dot, { backgroundColor: Colors.textSecondary }]} />
                          <Palette color={Colors.textSecondary} size={11} />
                          <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{v.color}</Text>
                        </>
                      )}
                    </View>
                  </View>
                  {editable ? (
                    <View style={styles.cardActions}>
                      <TouchableOpacity
                        onPress={() => router.push({ pathname: "/admin-vehicle-edit", params: { id: v.id } })}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${v.plate}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`vehicle-edit-${v.id}`}
                      >
                        <Pencil color={Colors.accent} size={16} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDelete(v)}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${v.plate}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`vehicle-del-${v.id}`}
                      >
                        <Trash2 color={Colors.error} size={16} />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.divider, { backgroundColor: Colors.border }]} />

                <View style={styles.infoRow}>
                  <Text style={[styles.infoText, { color: Colors.text }]} numberOfLines={1}>
                    {v.ownerName}
                  </Text>
                  <View style={[styles.platePill, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                    <Text style={[styles.plateText, { color: Colors.text }]}>{v.plate}</Text>
                  </View>
                </View>

                <View style={styles.statusRow}>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + "20" }]}>
                    <Icon color={meta.color} size={14} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={[styles.metaText, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {v.ownerPhone}
                  </Text>
                </View>

                {actions.length > 0 && editable && (
                  <View style={styles.actionsRow}>
                    {actions.map((a) => {
                      const tone =
                        a.tone === "approve" ? Colors.success : a.tone === "danger" ? Colors.error : Colors.accent;
                      return (
                        <TouchableOpacity
                          key={a.label}
                          onPress={() => handleAction(v, a.label, a.nextStatus)}
                          style={[styles.actionBtn, { backgroundColor: tone + "15", borderColor: tone + "40" }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${a.label} ${v.plate}`}
                          testID={`vehicle-action-${v.id}-${a.label}`}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.actionText, { color: tone }]}>{a.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      onPress={() => onCall(v.ownerPhone)}
                      style={[styles.callBtn, { backgroundColor: Colors.accent }]}
                      accessibilityRole="button"
                      accessibilityLabel="Call the owner"
                      testID={`vehicle-call-${v.id}`}
                    >
                      <Phone color={Colors.onAccent} size={16} />
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
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
    gap: 10,
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
  headerTitle: { fontSize: 17, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    minWidth: 36,
    alignItems: "center" as const,
  },
  countBadgeText: { fontSize: 12, fontWeight: "800" as const },
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
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  cardActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  vehicleName: { fontSize: 15, fontWeight: "800" as const, flexShrink: 1 },
  nameRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexWrap: "wrap" as const },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 140,
  },
  typePillText: { fontSize: 10, fontWeight: "800" as const },
  metaRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 3 },
  metaText: { fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  divider: { height: 1, marginVertical: 2 },
  infoRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  infoText: { flex: 1, fontSize: 13, fontWeight: "600" as const },
  platePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  plateText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 0.5 },
  statusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: { fontSize: 12, fontWeight: "700" as const },
  actionsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  actionText: { fontSize: 13, fontWeight: "700" as const },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  emptyBox: { padding: 24, borderRadius: 14, borderWidth: 1, alignItems: "center" as const, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
});
