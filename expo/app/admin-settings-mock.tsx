import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  FlaskConical,
  Users,
  Car,
  Route,
  Radar,
  Power,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useDisplaySettings, DisplaySettings } from "@/contexts/DisplaySettingsContext";

type MockKey = Extract<
  keyof DisplaySettings,
  "userMockEnabled" | "partnerMockEnabled" | "riderTripSimEnabled" | "partnerDriveSimEnabled"
>;

interface MockToggle {
  key: MockKey;
  label: string;
  description: string;
  screen: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
}

interface MockSection {
  title: string;
  items: MockToggle[];
}

const SECTIONS: MockSection[] = [
  {
    title: "Passenger (User) side",
    items: [
      {
        key: "userMockEnabled",
        label: "Mock driver offers & viewers",
        description:
          "Demo driver bids, available drivers and \u201Cviewing\u201D avatars shown while searching for a ride",
        screen: "Ride Confirm",
        icon: Users,
      },
      {
        key: "riderTripSimEnabled",
        label: "Simulated driver movement",
        description:
          "Animated car on the map plus automatic phase changes (arriving \u2192 arrived \u2192 on trip \u2192 completed). When off, the screen follows the real ride status updated by the partner",
        screen: "Ride Tracking",
        icon: Route,
      },
    ],
  },
  {
    title: "Partner (Driver) side",
    items: [
      {
        key: "partnerMockEnabled",
        label: "Mock incoming ride requests",
        description:
          "Auto-generated demo ride requests that pop up while the partner is online. When off, only real passenger requests appear",
        screen: "Partner eHailing",
        icon: Radar,
      },
      {
        key: "partnerDriveSimEnabled",
        label: "Simulated driving & auto-arrival",
        description:
          "Animated car along the route and automatic arrival at pickup/destination. When off, the partner advances the trip manually with the action button",
        screen: "Ride Running",
        icon: Car,
      },
    ],
  },
];

const ALL_KEYS: MockKey[] = [
  "userMockEnabled",
  "riderTripSimEnabled",
  "partnerMockEnabled",
  "partnerDriveSimEnabled",
];

export default function AdminSettingsMockScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { settings, update } = useDisplaySettings();

  const anyEnabled = useMemo<boolean>(
    () => ALL_KEYS.some((k) => settings[k]),
    [settings]
  );

  const setAll = (enabled: boolean) => {
    console.log(`[MockSettings] set all mocks -> ${enabled}`);
    ALL_KEYS.forEach((k) => {
      if (settings[k] !== enabled) void update(k, enabled);
    });
  };

  const renderRow = (item: MockToggle) => {
    const Icon = item.icon;
    const enabled = settings[item.key];
    return (
      <View
        key={item.key}
        style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`mock-row-${item.key}`}
      >
        <View style={[styles.rowIcon, { backgroundColor: (enabled ? Colors.accent : Colors.textSecondary) + "20" }]}>
          <Icon color={enabled ? Colors.accent : Colors.textSecondary} size={20} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
          <View style={[styles.screenPill, { backgroundColor: Colors.accent + "15" }]}>
            <Text style={[styles.screenPillText, { color: Colors.accent }]}>{item.screen}</Text>
          </View>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => {
            console.log(`[MockSettings] ${item.key} -> ${v}`);
            void update(item.key, v);
          }}
          trackColor={{ false: Colors.gray[300], true: Colors.accent }}
          thumbColor="#fff"
          testID={`mock-switch-${item.key}`}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="mock-settings-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <FlaskConical color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Mock / Simulation</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Turn demo & simulated behavior on or off per feature
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[styles.masterRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID="mock-row-master"
        >
          <View style={[styles.rowIcon, { backgroundColor: (anyEnabled ? Colors.warning ?? "#F59E0B" : Colors.success) + "20" }]}>
            <Power color={anyEnabled ? Colors.warning ?? "#F59E0B" : Colors.success} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>All mocks & simulations</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Master switch — flips every toggle below at once
            </Text>
          </View>
          <Switch
            value={anyEnabled}
            onValueChange={(v) => setAll(v)}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="mock-switch-master"
          />
        </View>

        {SECTIONS.map((section) => (
          <View key={section.title} style={{ marginTop: 22 }}>
            <Text style={[styles.sectionTitle, { color: Colors.text }]}>{section.title}</Text>
            <View style={styles.list}>{section.items.map(renderRow)}</View>
          </View>
        ))}

        <View style={[styles.noteBox, { backgroundColor: Colors.accent + "10", borderColor: Colors.accent + "30" }]}>
          <Text style={[styles.noteText, { color: Colors.textSecondary }]}>
            These switches apply globally to every device within a few seconds. Rides already in
            progress pick up the change on their next screen open.
          </Text>
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
  sectionTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 10 },
  list: { gap: 10 },
  masterRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  row: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
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
  rowDesc: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  screenPill: {
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  screenPillText: { fontSize: 11, fontWeight: "700" as const },
  noteBox: {
    marginTop: 22,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  noteText: { fontSize: 12, lineHeight: 17 },
});
