import React from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Check } from "lucide-react-native";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

export default function DarkModeScreen() {
  const router = useRouter();
  const { themeMode, setThemeMode } = useTheme();
  const Colors = useColors();

  const handleBack = () => {
    router.back();
  };

  const handleSelectMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    console.log("Dark mode changed to:", mode);
  };

  const options: { id: ThemeMode; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "always", label: "Always enabled" },
    { id: "system", label: "System" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      
      <SafeAreaView style={[styles.safeArea, { backgroundColor: Colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Dark mode</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        {options.map((option, index) => (
          <TouchableOpacity
            key={option.id}
            style={[
              styles.optionItem,
              { borderBottomColor: Colors.border },
              index === 0 && [styles.firstItem, { borderTopColor: Colors.border }],
            ]}
            onPress={() => handleSelectMode(option.id)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.optionLabel, { color: Colors.text }]}>{option.label}</Text>
            {themeMode === option.id && (
              <Check color={Colors.accentText} size={24} strokeWidth={3} />
            )}
          </TouchableOpacity>
        ))}
      </View>
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
  backButton: {
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
  content: {
    paddingTop: 8,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "#1F2937",
  },
  firstItem: {
    borderTopWidth: 0.5,
    borderTopColor: "#1F2937",
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: "400",
    color: "#FFFFFF",
  },
});
