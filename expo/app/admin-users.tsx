import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  UserPlus,
  UserCheck,
  UserX,
  UserMinus,
  Ban,
  FileX,
  Users,
  ChevronRight,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";

interface UserItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  count?: number;
  tone?: "accent" | "success" | "warning" | "error" | "neutral";
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { users, counts } = useAdminData();
  const [active, setActive] = useState<string | null>(null);

  const docsPending = useMemo(() => users.filter((u) => u.idVerified === "failed").length, [users]);

  const usersItems = useMemo<UserItem[]>(
    () => [
      { id: "add", label: "Add User", description: "Onboard a new user", icon: UserPlus, tone: "accent" },
      { id: "approved", label: "Approved User", description: "Active and verified", icon: UserCheck, count: counts.userByStatus.approved, tone: "success" },
      { id: "unapproved", label: "Un-Approved User", description: "Awaiting approval", icon: UserMinus, count: counts.userByStatus.unapproved, tone: "warning" },
      { id: "blocked", label: "Blocked User", description: "Temporarily blocked", icon: Ban, count: counts.userByStatus.blocked, tone: "error" },
      { id: "rejected", label: "Reject User", description: "Application rejected", icon: UserX, count: counts.userByStatus.rejected, tone: "error" },
      { id: "deleted", label: "Deleted User", description: "Marked as deleted", icon: UserMinus, count: counts.userByStatus.deleted, tone: "neutral" },
      { id: "unapproved-docs", label: "Un-approved Documents User", description: "Failed ID verification", icon: FileX, count: docsPending, tone: "warning" },
    ],
    [counts, docsPending]
  );

  const allUsersItems = useMemo<UserItem[]>(
    () => [
      { id: "all", label: "All User", description: "Complete user list", icon: Users, count: counts.totalUsers, tone: "accent" },
    ],
    [counts]
  );

  const toneColor = (tone?: UserItem["tone"]) => {
    switch (tone) {
      case "success":
        return Colors.success;
      case "warning":
        return Colors.warning ?? "#F59E0B";
      case "error":
        return Colors.error;
      case "neutral":
        return Colors.textSecondary;
      case "accent":
      default:
        return Colors.accent;
    }
  };

  const handlePress = (item: UserItem) => {
    setActive(item.id);
    const routes: Record<string, string> = {
      add: "/admin-user-add",
      approved: "/admin-users-approved",
      unapproved: "/admin-users-unapproved",
      blocked: "/admin-users-blocked",
      rejected: "/admin-users-rejected",
      deleted: "/admin-users-deleted",
      "unapproved-docs": "/admin-users-unapproved-docs",
      all: "/admin-users-all",
    };
    const path = routes[item.id];
    if (path) {
      router.push(path as any);
    } else {
      Alert.alert(item.label, "Coming soon");
    }
  };

  const renderRow = (item: UserItem) => {
    const Icon = item.icon;
    const color = toneColor(item.tone);
    const isActive = active === item.id;
    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.row,
          {
            backgroundColor: Colors.gray[100],
            borderColor: isActive ? color : Colors.border,
            borderWidth: isActive ? 1.5 : 1,
          },
        ]}
        onPress={() => handlePress(item)}
        testID={`user-row-${item.id}`}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[styles.rowIcon, { backgroundColor: color + "20" }]}>
          <Icon color={color} size={20} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
        </View>
        {typeof item.count === "number" && (
          <View style={[styles.countPill, { backgroundColor: color + "20" }]}>
            <Text style={[styles.countText, { color }]}>{item.count}</Text>
          </View>
        )}
        <ChevronRight color={Colors.textSecondary} size={18} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="users-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Users color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Users</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Manage all users</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Users</Text>
        <View style={styles.list}>{usersItems.map(renderRow)}</View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 22 }]}>Directory</Text>
        <View style={styles.list}>{allUsersItems.map(renderRow)}</View>

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
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 10 },
  list: { gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    gap: 12,
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
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 4,
  },
  countText: { fontSize: 12, fontWeight: "700" as const },
});
