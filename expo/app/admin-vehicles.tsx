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
  Car,
  CarFront,
  CheckCircle2,
  XCircle,
  Ban,
  FileX,
  FileClock,
  FileSearch,
  FileCheck2,
  Clock,
  ChevronRight,
  Plus,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData } from "@/contexts/AdminDataContext";

interface VehicleItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  count?: number;
  tone?: "accent" | "success" | "warning" | "error" | "neutral";
}

export default function AdminVehiclesScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { vehicles, counts } = useAdminData();
  const [active, setActive] = useState<string | null>(null);

  const docsPending = useMemo(() => vehicles.filter((v) => !v.documentsOk).length, [vehicles]);
  const permitPending = useMemo(() => vehicles.filter((v) => v.permit === "pending").length, [vehicles]);
  const permitNonVerified = useMemo(() => vehicles.filter((v) => v.permit === "non-verified").length, [vehicles]);
  const permitVerified = useMemo(() => vehicles.filter((v) => v.permit === "verified").length, [vehicles]);

  const vehicleItems = useMemo<VehicleItem[]>(
    () => [
      { id: "approved", label: "Approved Vehicles", description: "Active and verified", icon: CheckCircle2, count: counts.vehicleByStatus.approved, tone: "success" },
      { id: "unapproved", label: "Un-Approved Vehicles", description: "Awaiting approval", icon: Clock, count: counts.vehicleByStatus.unapproved, tone: "warning" },
      { id: "blocked", label: "Blocked Vehicles", description: "Temporarily blocked", icon: Ban, count: counts.vehicleByStatus.blocked, tone: "error" },
      { id: "rejected", label: "Reject Vehicles", description: "Application rejected", icon: XCircle, count: counts.vehicleByStatus.rejected, tone: "error" },
      { id: "unapproved-docs", label: "Un-approved Documents", description: "Pending document review", icon: FileX, count: docsPending, tone: "warning" },
    ],
    [counts, docsPending]
  );

  const permitItems = useMemo<VehicleItem[]>(
    () => [
      { id: "permit-pending", label: "Pending Permit Vehicles", description: "Permit awaiting check", icon: FileClock, count: permitPending, tone: "warning" },
      { id: "permit-non-verified", label: "Non-Verified Permit Vehicles", description: "Permit not verified", icon: FileSearch, count: permitNonVerified, tone: "neutral" },
      { id: "permit-verified", label: "Verified Permit Vehicles", description: "Permit confirmed", icon: FileCheck2, count: permitVerified, tone: "success" },
      { id: "all", label: "All Vehicles", description: "Complete vehicle list", icon: CarFront, count: counts.totalVehicles, tone: "accent" },
    ],
    [counts, permitPending, permitNonVerified, permitVerified]
  );

  const toneColor = (tone?: VehicleItem["tone"]) => {
    switch (tone) {
      case "success": return Colors.success;
      case "warning": return Colors.warning ?? "#F59E0B";
      case "error": return Colors.error;
      case "neutral": return Colors.textSecondary;
      case "accent":
      default: return Colors.accent;
    }
  };

  const handlePress = (item: VehicleItem) => {
    setActive(item.id);
    const routes: Record<string, string> = {
      approved: "/admin-vehicles-approved",
      unapproved: "/admin-vehicles-unapproved",
      blocked: "/admin-vehicles-blocked",
      rejected: "/admin-vehicles-rejected",
      "unapproved-docs": "/admin-vehicles-unapproved-docs",
      "permit-pending": "/admin-vehicles-permit-pending",
      "permit-non-verified": "/admin-vehicles-permit-non-verified",
      "permit-verified": "/admin-vehicles-permit-verified",
      all: "/admin-vehicles-all",
    };
    const path = routes[item.id];
    if (path) {
      router.push(path as any);
    } else {
      Alert.alert(item.label, "Coming soon");
    }
  };

  const renderRow = (item: VehicleItem) => {
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
        testID={`vehicle-row-${item.id}`}
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
          testID="vehicles-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Car color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Vehicles</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Manage all vehicles</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/admin-vehicle-add")}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="vehicles-add"
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add vehicles"
        >
          <Plus color={Colors.onAccent} size={22} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => router.push("/admin-vehicle-add")}
          style={[styles.addCta, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}
          activeOpacity={0.85}
          testID="vehicles-add-cta"
        >
          <View style={[styles.addCtaIcon, { backgroundColor: Colors.accent }]}>
            <Plus color={Colors.onAccent} size={18} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.addCtaTitle, { color: Colors.text }]}>Add Vehicle</Text>
            <Text style={[styles.addCtaDesc, { color: Colors.textSecondary }]}>Register a new vehicle to the fleet</Text>
          </View>
          <ChevronRight color={Colors.accent} size={18} />
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 16 }]}>Vehicles</Text>
        <View style={styles.list}>{vehicleItems.map(renderRow)}</View>

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
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
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
  addCta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  addCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  addCtaTitle: { fontSize: 15, fontWeight: "800" as const },
  addCtaDesc: { fontSize: 12, marginTop: 2 },
});
