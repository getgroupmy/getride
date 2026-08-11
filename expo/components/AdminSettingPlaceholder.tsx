import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, ChevronRight, Plus, Search, Settings as SettingsIcon } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  description?: string;
  primaryAction?: string;
  testID?: string;
}

export default function AdminSettingPlaceholder({
  title,
  subtitle,
  Icon,
  description,
  primaryAction,
  testID,
}: Props) {
  const router = useRouter();
  const Colors = useColors();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID={`${testID ?? "setting"}-back`}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Icon color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>{title}</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {subtitle}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID={`${testID ?? "setting"}-search`}
          accessibilityRole="button"
          accessibilityLabel="Search"
        >
          <Search color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.hero,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <View style={[styles.heroIcon, { backgroundColor: Colors.accent + "20" }]}>
            <Icon color={Colors.accent} size={28} />
          </View>
          <Text style={[styles.heroTitle, { color: Colors.text }]}>{title}</Text>
          <Text style={[styles.heroDesc, { color: Colors.textSecondary }]}>
            {description ??
              `Manage ${title.toLowerCase()} for your platform. Configure options, review entries, and keep things organized.`}
          </Text>

          <TouchableOpacity
            style={[styles.cta, { backgroundColor: Colors.accent }]}
            activeOpacity={0.9}
            testID={`${testID ?? "setting"}-cta`}
          >
            <Plus color="#000000" size={18} />
            <Text style={[styles.ctaText, { color: "#000000" }]}>{primaryAction ?? `Add ${title}`}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Recent</Text>
        <View style={styles.list}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.row,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <View
                style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}
              >
                <SettingsIcon color={Colors.accent} size={18} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowLabel, { color: Colors.text }]}>
                  {title} item #{i}
                </Text>
                <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                  Tap to view or edit
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </View>
          ))}
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
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  hero: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: "center" as const,
    marginBottom: 22,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 12,
  },
  heroTitle: { fontSize: 18, fontWeight: "800" as const, marginBottom: 6 },
  heroDesc: {
    fontSize: 13,
    textAlign: "center" as const,
    lineHeight: 18,
    marginBottom: 14,
  },
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "800" as const },
  sectionTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 10 },
  list: { gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
});
