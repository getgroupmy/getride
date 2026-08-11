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
  FileClock,
  FileSearch,
  FileCheck2,
  Users,
  ChevronRight,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";

interface PartnerItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  count?: number;
  tone?: "accent" | "success" | "warning" | "error" | "neutral";
}

export default function AdminPartnersScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { partners, counts } = useAdminData();
  const [active, setActive] = useState<string | null>(null);

  const docsPending = useMemo(
    () => partners.filter((d) => !d.documentsOk).length,
    [partners]
  );
  const permitPending = useMemo(() => partners.filter((d) => d.permit === "pending").length, [partners]);
  const permitNonVerified = useMemo(() => partners.filter((d) => d.permit === "non-verified").length, [partners]);
  const permitVerified = useMemo(() => partners.filter((d) => d.permit === "verified").length, [partners]);

  const partnersItems = useMemo<PartnerItem[]>(
    () => [
      { id: "add", label: "Add Partner", description: "Onboard a new partner", icon: UserPlus, tone: "accent" },
      { id: "approved", label: "Approved Partners", description: "Active and verified", icon: UserCheck, count: counts.partnerByStatus.approved, tone: "success" },
      { id: "unapproved", label: "Un-Approved Partners", description: "Awaiting approval", icon: UserMinus, count: counts.partnerByStatus.unapproved, tone: "warning" },
      { id: "blocked", label: "Blocked Partners", description: "Temporarily blocked", icon: Ban, count: counts.partnerByStatus.blocked, tone: "error" },
      { id: "rejected", label: "Reject Partners", description: "Application rejected", icon: UserX, count: counts.partnerByStatus.rejected, tone: "error" },
      { id: "unapproved-docs", label: "Un-approved Documents", description: "Pending document review", icon: FileX, count: docsPending, tone: "warning" },
    ],
    [counts, docsPending]
  );

  const permitItems = useMemo<PartnerItem[]>(
    () => [
      { id: "permit-pending", label: "Pending Permit Partners", description: "Permit awaiting check", icon: FileClock, count: permitPending, tone: "warning" },
      { id: "permit-non-verified", label: "Non-Verified Permit Partners", description: "Permit not verified", icon: FileSearch, count: permitNonVerified, tone: "neutral" },
      { id: "permit-verified", label: "Verified Permit Partners", description: "Permit confirmed", icon: FileCheck2, count: permitVerified, tone: "success" },
      { id: "all", label: "All Partners", description: "Complete partner list", icon: Users, count: counts.totalPartners, tone: "accent" },
    ],
    [counts, permitPending, permitNonVerified, permitVerified]
  );

  const toneColor = (tone?: PartnerItem["tone"]) => {
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

  const handlePress = (item: PartnerItem) => {
    setActive(item.id);
    const routes: Record<string, string> = {
      add: "/admin-partner-add",
      approved: "/admin-partners-approved",
      unapproved: "/admin-partners-unapproved",
      blocked: "/admin-partners-blocked",
      rejected: "/admin-partners-rejected",
      "unapproved-docs": "/admin-partners-unapproved-docs",
      "permit-pending": "/admin-partners-permit-pending",
      "permit-non-verified": "/admin-partners-permit-non-verified",
      "permit-verified": "/admin-partners-permit-verified",
      all: "/admin-partners-all",
    };
    const path = routes[item.id];
    if (path) {
      router.push(path as any);
    } else {
      Alert.alert(item.label, "Coming soon");
    }
  };

  const renderRow = (item: PartnerItem) => {
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
        testID={`partner-row-${item.id}`}
        activeOpacity={0.85}
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
          testID="partners-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Users color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Partners</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Manage all partners</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Partners</Text>
        <View style={styles.list}>{partnersItems.map(renderRow)}</View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 22 }]}>Permits</Text>
        <View style={styles.list}>{permitItems.map(renderRow)}</View>

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
