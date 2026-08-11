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
  Menu,
  Users,
  Car,
  DollarSign,
  TrendingUp,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  LogOut,
  MapPin,
  Settings as SettingsIcon,
  Package,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import AdminSideSheet from "@/components/AdminSideSheet";

interface Stat {
  id: string;
  label: string;
  value: string;
  delta: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  tone: "up" | "down" | "neutral";
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
}

interface Activity {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  type: "ride" | "driver" | "alert" | "payment";
}

export default function AdminDashboardScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [sideSheetVisible, setSideSheetVisible] = useState<boolean>(false);

  const stats = useMemo<Stat[]>(
    () => [
      { id: "rides", label: "Active rides", value: "128", delta: "+12%", icon: Car, tone: "up" },
      { id: "drivers", label: "Online partners", value: "342", delta: "+5%", icon: Users, tone: "up" },
      { id: "revenue", label: "Today's revenue", value: "$8,420", delta: "+18%", icon: DollarSign, tone: "up" },
      { id: "issues", label: "Open issues", value: "7", delta: "-2", icon: AlertTriangle, tone: "down" },
    ],
    []
  );

  const quickActions: QuickAction[] = [
    { id: "drivers", label: "Manage partners", description: "Approve, suspend, view documents", icon: Users },
    { id: "vehicles", label: "Manage vehicles", description: "Approve, block & verify permits", icon: Car },
    { id: "orders", label: "EV Orders", description: "Review orders & assign Delivery Advisors", icon: Package },
    { id: "rides", label: "Live rides", description: "Monitor ongoing trips", icon: MapPin },
    { id: "payments", label: "Payments", description: "Payouts & transactions", icon: DollarSign },
    { id: "settings", label: "App settings", description: "Pricing, zones, surge", icon: SettingsIcon },
  ];

  const activities: Activity[] = [
    { id: "1", title: "New partner application", subtitle: "Aarav S. submitted documents", time: "2m", type: "driver" },
    { id: "2", title: "Ride flagged", subtitle: "Trip #4821 reported by rider", time: "8m", type: "alert" },
    { id: "3", title: "Payout processed", subtitle: "$1,240 to 18 partners", time: "32m", type: "payment" },
    { id: "4", title: "Surge enabled", subtitle: "Downtown — 1.4x", time: "1h", type: "ride" },
  ];

  const handleLogout = () => {
    Alert.alert("Sign out", "Sign out of admin?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => router.replace("/" as any),
      },
    ]);
  };

  const toneColor = (tone: Stat["tone"]) =>
    tone === "up" ? Colors.success : tone === "down" ? Colors.error : Colors.textSecondary;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => setSideSheetVisible(true)}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="admin-menu"
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Menu color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <ShieldCheck color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Admin Dashboard</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Overview</Text>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="admin-logout"
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <LogOut color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statsGrid}>
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <View
                key={s.id}
                style={[
                  styles.statCard,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
              >
                <View style={styles.statTopRow}>
                  <View style={[styles.statIconWrap, { backgroundColor: Colors.accent + "20" }]}>
                    <Icon color={Colors.accent} size={18} />
                  </View>
                  <View style={[styles.deltaPill, { backgroundColor: toneColor(s.tone) + "20" }]}>
                    <TrendingUp color={toneColor(s.tone)} size={12} />
                    <Text style={[styles.deltaText, { color: toneColor(s.tone) }]}>{s.delta}</Text>
                  </View>
                </View>
                <Text style={[styles.statValue, { color: Colors.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>{s.label}</Text>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Quick actions</Text>
        <View style={styles.actionsList}>
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <TouchableOpacity
                key={a.id}
                style={[styles.actionRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                onPress={() => {
                  if (a.id === "drivers") router.push("/admin-partners" as any);
                  else if (a.id === "vehicles") router.push("/admin-vehicles" as any);
                  else if (a.id === "orders") router.push("/admin-orders" as any);
                  else if (a.id === "settings") router.push("/admin-settings" as any);
                  else Alert.alert(a.label, "Coming soon");
                }}
                testID={`admin-action-${a.id}`}
                accessibilityRole="button"
              >
                <View style={[styles.actionIcon, { backgroundColor: Colors.accent + "20" }]}>
                  <Icon color={Colors.accent} size={20} />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={[styles.actionLabel, { color: Colors.text }]}>{a.label}</Text>
                  <Text style={[styles.actionDesc, { color: Colors.textSecondary }]}>{a.description}</Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Recent activity</Text>
        <View style={[styles.activityCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          {activities.map((a, idx) => (
            <View
              key={a.id}
              style={[
                styles.activityRow,
                idx < activities.length - 1 && { borderBottomColor: Colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={[styles.activityDot, { backgroundColor: Colors.accent }]} />
              <View style={styles.activityInfo}>
                <Text style={[styles.activityTitle, { color: Colors.text }]}>{a.title}</Text>
                <Text style={[styles.activitySub, { color: Colors.textSecondary }]}>{a.subtitle}</Text>
              </View>
              <Text style={[styles.activityTime, { color: Colors.textSecondary }]}>{a.time}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      <AdminSideSheet
        visible={sideSheetVisible}
        onClose={() => setSideSheetVisible(false)}
      />
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  statsGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 12,
    marginBottom: 8,
  },
  statCard: {
    flexBasis: "48%" as const,
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  statTopRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  deltaPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaText: {
    fontSize: 11,
    fontWeight: "700" as const,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800" as const,
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800" as const,
    marginTop: 20,
    marginBottom: 10,
  },
  actionsList: { gap: 10 },
  actionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  actionInfo: { flex: 1 },
  actionLabel: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  actionDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  activityCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  activityRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 14,
    gap: 12,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activityInfo: { flex: 1 },
  activityTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  activitySub: {
    fontSize: 12,
    marginTop: 2,
  },
  activityTime: {
    fontSize: 12,
  },
});
