import React, { useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Menu, ChevronRight } from "lucide-react-native";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useIsPartner } from "@/hooks/useIsPartner";
import { describeAdapter, loadCanbusAdapters, loadSelectedAdapterId, pickDefaultAdapter } from "@/utils/canbusAdapterStore";

export default function SettingsScreen() {
  const router = useRouter();
  const { themeMode } = useTheme();
  const { authState } = useAuth();
  const Colors = useColors();
  // The OBD-II reader row is partner-only: it links the app to the vehicle's
  // diagnostics port, which is meaningless in plain rider mode.
  const { isPartner } = useIsPartner();
  const [obdSummary, setObdSummary] = useState<string | null>(null);

  // Refresh on focus so the row reflects a reader added/removed on the
  // OBD-II screen the moment the user comes back here.
  useFocusEffect(
    React.useCallback(() => {
      if (!isPartner) {
        setObdSummary(null);
        return;
      }
      let cancelled = false;
      (async () => {
        const [adapters, selectedId] = await Promise.all([
          loadCanbusAdapters(),
          loadSelectedAdapterId(),
        ]);
        if (cancelled) return;
        const adapter = pickDefaultAdapter(adapters, selectedId);
        setObdSummary(adapter ? describeAdapter(adapter) : "Not set up");
      })();
      return () => {
        cancelled = true;
      };
    }, [isPartner])
  );

  const phoneDisplay = useMemo(() => {
    const raw = authState.phoneNumber?.trim();
    if (!raw) return "Not set";
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length < 4) return raw;
    const last2 = digits.slice(-2);
    const masked = `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${last2}`;
    return masked;
  }, [authState.phoneNumber]);

  const themeModeLabel = useMemo(() => {
    if (themeMode === "off") return "Off";
    if (themeMode === "always") return "Always enabled";
    return "System";
  }, [themeMode]);

  const settingsOptions = useMemo(() => {
    const options: { id: string; label: string; value: string | null; hasChevron: boolean }[] = [
      { id: "phone", label: "Phone number", value: phoneDisplay, hasChevron: true },
      { id: "language", label: "Language", value: null, hasChevron: true },
      { id: "distances", label: "Distances", value: null, hasChevron: true },
      { id: "darkMode", label: "Dark mode", value: themeModeLabel, hasChevron: true },
      { id: "navigation", label: "Navigation", value: null, hasChevron: true },
    ];
    if (isPartner) {
      options.push({
        id: "obd2",
        label: "OBD-II (CANBus) reader",
        value: obdSummary,
        hasChevron: true,
      });
    }
    options.push({ id: "rules", label: "Rules and terms", value: null, hasChevron: true });
    return options;
  }, [isPartner, obdSummary, phoneDisplay, themeModeLabel]);

  const handleBack = () => {
    router.back();
  };

  const handleLogout = () => {
    console.log("Logout pressed");
  };

  const handleDeleteAccount = () => {
    console.log("Delete account pressed");
  };

  const handleSettingPress = (id: string) => {
    if (id === "darkMode") {
      router.push("/dark-mode");
    } else if (id === "language") {
      router.push("/language");
    } else if (id === "distances") {
      router.push("/distances");
    } else if (id === "navigation") {
      router.push("/navigation");
    } else if (id === "rules") {
      router.push("/rules-terms");
    } else if (id === "phone") {
      router.push("/change-number");
    } else if (id === "obd2") {
      router.push("/obd2-reader");
    }
    console.log("Setting pressed:", id);
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      
      <SafeAreaView style={[styles.safeArea, { backgroundColor: Colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={handleBack}
          >
            <Menu color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Settings</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {settingsOptions.map((option, index) => (
            <TouchableOpacity
              key={option.id}
              style={styles.settingItem}
              onPress={() => handleSettingPress(option.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.settingLabel, { color: Colors.text }]} numberOfLines={1}>
                {option.label}
              </Text>
              <View style={styles.settingRight}>
                {option.value && (
                  <Text
                    style={[styles.settingValue, { color: Colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {option.value}
                  </Text>
                )}
                {option.hasChevron && (
                  <ChevronRight color={Colors.textSecondary} size={20} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <SafeAreaView style={[styles.bottomContainer, { backgroundColor: Colors.background }]} edges={["bottom"]}>
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: Colors.gray[100] }]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={[styles.logoutText, { color: Colors.text }]}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.deleteButton, { backgroundColor: Colors.gray[100] }]}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
        >
          <Text style={[styles.deleteText, { color: Colors.error }]}>Delete my account</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  menuButton: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  placeholder: {
    width: 24,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 8,
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  settingLabel: {
    fontSize: 17,
    fontWeight: "400",
    color: "#FFFFFF",
    flexShrink: 1,
    marginRight: 12,
  },
  settingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  settingValue: {
    fontSize: 17,
    fontWeight: "400",
    color: "#6B7280",
    maxWidth: 190,
  },
  bottomContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: "#000000",
  },
  logoutButton: {
    backgroundColor: "#374151",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  logoutText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  deleteButton: {
    backgroundColor: "#374151",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
  },
  deleteText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#EF4444",
  },
});
