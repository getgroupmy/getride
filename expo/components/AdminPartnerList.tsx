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
  MoreVertical,
  CheckCircle2,
  XCircle,
  Ban,
  Clock,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  FileText,
  Users,
  CarFront,
  Trash2,
  UserPlus,
  Pencil,
  Tag,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import {
  useAdminData,
  PartnerRecord,
  PartnerStatus as PStatus,
} from "@/contexts/AdminDataContext";

export type PartnerListStatus = PStatus | "all";

interface Props {
  status: PartnerListStatus;
  title: string;
  subtitle: string;
  emptyText?: string;
}

export default function AdminPartnerList({ status, title, subtitle, emptyText }: Props) {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();
  const { partners, setPartnerStatus, removePartner } = useAdminData();
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const list =
      status === "all"
        ? partners
        : partners.filter((d) => {
            if (status === "unapproved-docs") return !d.documentsOk;
            if (status === "permit-pending") return d.permit === "pending";
            if (status === "permit-non-verified") return d.permit === "non-verified";
            if (status === "permit-verified") return d.permit === "verified";
            return d.status === status;
          });
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.phone.toLowerCase().includes(q) ||
        d.plate.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
    );
  }, [status, query, partners]);

  const statusMeta = (
    s: PStatus
  ): { label: string; color: string; Icon: React.ComponentType<{ color?: string; size?: number }> } => {
    switch (s) {
      case "approved": return { label: "Approved", color: Colors.successText, Icon: CheckCircle2 };
      case "unapproved": return { label: "Unapproved", color: Colors.warningText, Icon: Clock };
      case "blocked": return { label: "Blocked", color: Colors.errorText, Icon: Ban };
      case "rejected": return { label: "Rejected", color: Colors.errorText, Icon: XCircle };
      case "unapproved-docs": return { label: "Docs Pending", color: Colors.warningText, Icon: FileText };
      case "permit-pending": return { label: "Permit Pending", color: Colors.warningText, Icon: ShieldAlert };
      case "permit-non-verified": return { label: "Permit Unverified", color: Colors.textSecondary, Icon: ShieldOff };
      case "permit-verified": return { label: "Permit Verified", color: Colors.successText, Icon: ShieldCheck };
      default: return { label: "Partner", color: Colors.accentText, Icon: Users };
    }
  };

  const primaryActions = (
    s: PStatus
  ): { label: string; tone: "approve" | "danger" | "neutral"; nextStatus?: PStatus }[] => {
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
        return [
          { label: "Unblock", tone: "approve", nextStatus: "approved" },
        ];
      case "rejected":
        return [
          { label: "Re-open", tone: "approve", nextStatus: "unapproved" },
        ];
      default:
        return [];
    }
  };

  const handleAction = (partner: PartnerRecord, label: string, next?: PStatus) => {
    if (!next) return;
    if (!guard()) return;
    Alert.alert(`${label}?`, `${partner.name} (${partner.id})`, [
      { text: "Cancel", style: "cancel" },
      {
        text: label,
        onPress: () => setPartnerStatus(partner.id, next),
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

  const onDelete = (d: PartnerRecord) => {
    if (!guard()) return;
    Alert.alert("Delete partner", `Remove ${d.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => removePartner(d.id) },
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
          testID="partner-list-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        {editable ? (
          <TouchableOpacity
            onPress={() => router.push("/admin-partner-add" as any)}
            style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Add a partner"
            testID="partner-list-add"
          >
            <UserPlus color={Colors.onAccent} size={20} />
          </TouchableOpacity>
        ) : null}
        <View style={[styles.countBadge, { backgroundColor: Colors.accent + "20" }]}>
          <Text style={[styles.countBadgeText, { color: Colors.accentText }]}>{filtered.length}</Text>
        </View>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, phone, plate or ID"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="partner-search"
          accessibilityLabel="Search name, phone, plate or ID"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Users color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No partners</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              {emptyText ?? "There are no partners in this category yet."}
            </Text>
          </View>
        ) : (
          filtered.map((d) => {
            const meta = statusMeta(d.status);
            const Icon = meta.Icon;
            const actions = primaryActions(d.status);
            return (
              <View
                key={d.id}
                style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`partner-card-${d.id}`}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}>
                    <Text style={[styles.avatarText, { color: Colors.accentText }]}>
                      {d.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.driverName, { color: Colors.text }]} numberOfLines={1}>{d.name}</Text>
                      {(d.partnerTypes && d.partnerTypes.length > 0
                        ? d.partnerTypes
                        : d.partnerType
                          ? [d.partnerType]
                          : []
                      ).map((t) => (
                        <View key={t} style={[styles.typePill, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]} testID={`partner-type-${d.id}-${t}`}>
                          <Tag color={Colors.accentText} size={10} />
                          <Text style={[styles.typePillText, { color: Colors.accentText }]} numberOfLines={1}>{t}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{d.id}</Text>
                      <View style={[styles.dot, { backgroundColor: Colors.textSecondary }]} />
                      <Text style={[styles.metaText, { color: Colors.textSecondary }]} numberOfLines={1}>{d.phone}</Text>
                    </View>
                  </View>
                  {editable ? (
                    <>
                      <TouchableOpacity
                        onPress={() => router.push({ pathname: "/admin-partner-edit", params: { id: d.id } } as any)}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${d.name}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`partner-edit-${d.id}`}
                      >
                        <Pencil color={Colors.accentText} size={16} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDelete(d)}
                        style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${d.name}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`partner-more-${d.id}`}
                      >
                        <Trash2 color={Colors.errorText} size={16} />
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>

                <View style={[styles.divider, { backgroundColor: Colors.border }]} />

                <View style={styles.infoRow}>
                  <CarFront color={Colors.textSecondary} size={16} />
                  <Text style={[styles.infoText, { color: Colors.text }]} numberOfLines={1}>
                    {d.vehicle}
                  </Text>
                  <View style={[styles.platePill, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                    <Text style={[styles.plateText, { color: Colors.text }]}>{d.plate}</Text>
                  </View>
                </View>

                <View style={styles.statusRow}>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + "20" }]}>
                    <Icon color={meta.color} size={14} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {d.totalRides > 0 && (
                    <Text style={[styles.metaText, { color: Colors.textSecondary }]}>
                      {d.totalRides} rides • ★ {d.rating.toFixed(2)}
                    </Text>
                  )}
                </View>

                {actions.length > 0 && editable && (
                  <View style={styles.actionsRow}>
                    {actions.map((a) => {
                      const tone =
                        a.tone === "approve" ? Colors.success : a.tone === "danger" ? Colors.error : Colors.accent;
                      return (
                        <TouchableOpacity
                          key={a.label}
                          onPress={() => handleAction(d, a.label, a.nextStatus)}
                          style={[styles.actionBtn, { backgroundColor: tone + "15", borderColor: tone + "40" }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${a.label} ${d.name}`}
                          testID={`partner-action-${d.id}-${a.label}`}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.actionText, { color: tone }]}>{a.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      onPress={() => onCall(d.phone)}
                      style={[styles.callBtn, { backgroundColor: Colors.accent }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${d.name}`}
                      testID={`partner-call-${d.id}`}
                    >
                      <Phone color={Colors.onAccent} size={16} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
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
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  avatarText: { fontSize: 14, fontWeight: "800" as const },
  driverName: { fontSize: 15, fontWeight: "800" as const, flexShrink: 1 },
  nameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flexWrap: "wrap" as const,
  },
  typePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 140,
  },
  typePillText: { fontSize: 10, fontWeight: "800" as const },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 3,
  },
  metaText: { fontSize: 12 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  divider: { height: 1, marginVertical: 2 },
  infoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  infoText: { flex: 1, fontSize: 13, fontWeight: "600" as const },
  platePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
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
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" as const },
  emptyDesc: { fontSize: 13, textAlign: "center" as const },
});
