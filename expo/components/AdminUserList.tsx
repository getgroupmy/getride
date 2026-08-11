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
  FileText,
  Users,
  Mail,
  Trash2,
  UserPlus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import {
  useAdminData,
  UserRecord,
  UserStatus as UStatus,
} from "@/contexts/AdminDataContext";

export type UserStatus = UStatus | "all";

interface Props {
  status: UserStatus;
  title: string;
  subtitle: string;
  emptyText?: string;
}

export default function AdminUserList({ status, title, subtitle, emptyText }: Props) {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();
  const { users, setUserStatus, removeUser } = useAdminData();
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const list =
      status === "all"
        ? users
        : users.filter((u) => {
            if (status === "unapproved-docs") return u.idVerified === "failed";
            return u.status === status;
          });
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [status, query, users]);

  const statusMeta = (
    s: UStatus
  ): { label: string; color: string; Icon: React.ComponentType<{ color?: string; size?: number }> } => {
    switch (s) {
      case "approved": return { label: "Approved", color: Colors.success, Icon: CheckCircle2 };
      case "unapproved": return { label: "Unapproved", color: Colors.warning, Icon: Clock };
      case "blocked": return { label: "Blocked", color: Colors.error, Icon: Ban };
      case "rejected": return { label: "Rejected", color: Colors.error, Icon: XCircle };
      case "unapproved-docs": return { label: "Docs Pending", color: Colors.warning, Icon: FileText };
      default: return { label: "User", color: Colors.accent, Icon: Users };
    }
  };

  const primaryActions = (
    s: UStatus
  ): { label: string; tone: "approve" | "danger" | "neutral"; nextStatus?: UStatus }[] => {
    switch (s) {
      case "unapproved":
      case "unapproved-docs":
        return [
          { label: "Approve", tone: "approve", nextStatus: "approved" },
          { label: "Reject", tone: "danger", nextStatus: "rejected" },
        ];
      case "approved":
        return [
          { label: "Block", tone: "danger", nextStatus: "blocked" },
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

  const handleAction = (user: UserRecord, label: string, next?: UStatus) => {
    if (!next) return;
    if (!guard()) return;
    Alert.alert(`${label}?`, `${user.name} (${user.id})`, [
      { text: "Cancel", style: "cancel" },
      { text: label, onPress: () => setUserStatus(user.id, next) },
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

  const onDelete = (u: UserRecord) => {
    if (!guard()) return;
    Alert.alert("Delete user", `Remove ${u.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => removeUser(u.id) },
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
          testID="user-list-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        </View>
        {editable ? (
          <TouchableOpacity
            onPress={() => router.push("/admin-user-add" as any)}
            style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Add a user"
            testID="user-list-add"
          >
            <UserPlus color={Colors.onAccent} size={20} />
          </TouchableOpacity>
        ) : null}
        <View style={[styles.countBadge, { backgroundColor: Colors.accent + "20" }]}>
          <Text style={[styles.countBadgeText, { color: Colors.accent }]}>{filtered.length}</Text>
        </View>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, phone, email or ID"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="user-search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Users color={Colors.textSecondary} size={28} />
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No users</Text>
            <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>
              {emptyText ?? "There are no users in this category yet."}
            </Text>
          </View>
        ) : (
          filtered.map((u) => {
            const meta = statusMeta(u.status);
            const Icon = meta.Icon;
            const actions = primaryActions(u.status);
            return (
              <TouchableOpacity
                key={u.id}
                style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${u.name}`}
                testID={`user-card-${u.id}`}
                onPress={() => router.push({ pathname: "/admin-user-edit" as any, params: { id: u.id } })}
                activeOpacity={0.85}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}>
                    <Text style={[styles.avatarText, { color: Colors.accent }]}>
                      {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.userName, { color: Colors.text }]} numberOfLines={1}>{u.name}</Text>
                    <View style={styles.metaRow}>
                      <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{u.id}</Text>
                      <View style={[styles.dot, { backgroundColor: Colors.textSecondary }]} />
                      <Text style={[styles.metaText, { color: Colors.textSecondary }]} numberOfLines={1}>{u.phone}</Text>
                    </View>
                  </View>
                  {editable ? (
                    <TouchableOpacity
                      onPress={() => onDelete(u)}
                      style={[styles.iconBtnSmall, { backgroundColor: Colors.background }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${u.name}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      testID={`user-more-${u.id}`}
                    >
                      <Trash2 color={Colors.error} size={16} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={[styles.divider, { backgroundColor: Colors.border }]} />

                <View style={styles.infoRow}>
                  <Mail color={Colors.textSecondary} size={16} />
                  <Text style={[styles.infoText, { color: Colors.text }]} numberOfLines={1}>
                    {u.email}
                  </Text>
                </View>

                <View style={styles.statusRow}>
                  <View style={[styles.statusPill, { backgroundColor: meta.color + "20" }]}>
                    <Icon color={meta.color} size={14} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {u.totalRides > 0 && (
                    <Text style={[styles.metaText, { color: Colors.textSecondary }]}>
                      {u.totalRides} rides
                    </Text>
                  )}
                </View>

                {actions.length > 0 && editable && (
                  <View style={styles.actionsRow} onStartShouldSetResponder={() => true}>
                    {actions.map((a) => {
                      const tone =
                        a.tone === "approve" ? Colors.success : a.tone === "danger" ? Colors.error : Colors.accent;
                      return (
                        <TouchableOpacity
                          key={a.label}
                          onPress={() => handleAction(u, a.label, a.nextStatus)}
                          style={[styles.actionBtn, { backgroundColor: tone + "15", borderColor: tone + "40" }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${a.label} ${u.name}`}
                          testID={`user-action-${u.id}-${a.label}`}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.actionText, { color: tone }]}>{a.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity
                      onPress={() => onCall(u.phone)}
                      style={[styles.callBtn, { backgroundColor: Colors.accent }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${u.name}`}
                      testID={`user-call-${u.id}`}
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
  userName: { fontSize: 15, fontWeight: "800" as const },
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
