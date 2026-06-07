import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  User,
  Users,
  Car,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface CategoryItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  route: string;
  tone: "accent" | "success" | "warning";
}

export default function AdminDocumentsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [active, setActive] = useState<string | null>(null);

  const items: CategoryItem[] = [
    {
      id: "users",
      label: "User Documents",
      description: "Review user identity verification",
      icon: User,
      route: "/admin-documents-users",
      tone: "accent",
    },
    {
      id: "partners",
      label: "Provider / Partner Documents",
      description: "Approve or reject partner uploads",
      icon: Users,
      route: "/admin-documents-partners",
      tone: "warning",
    },
    {
      id: "vehicles",
      label: "Vehicle Documents",
      description: "Approve or reject vehicle uploads",
      icon: Car,
      route: "/admin-documents-vehicles",
      tone: "success",
    },
  ];

  const toneColor = (tone: CategoryItem["tone"]) => {
    if (tone === "success") return Colors.success;
    if (tone === "warning") return Colors.warning ?? "#F59E0B";
    return Colors.accent;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="admin-documents-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <FileText color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Documents</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Review and approve uploads</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Categories</Text>
        <View style={styles.list}>
          {items.map((item) => {
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
                onPress={() => {
                  setActive(item.id);
                  router.push(item.route as any);
                }}
                testID={`admin-documents-${item.id}`}
                activeOpacity={0.85}
              >
                <View style={[styles.rowIcon, { backgroundColor: color + "20" }]}>
                  <Icon color={color} size={20} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            );
          })}
        </View>
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
});
