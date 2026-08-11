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
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export default function RulesTermsScreen() {
  const router = useRouter();
  const Colors = useColors();

  const menuItems = [
    { id: "terms", label: "Terms and conditions" },
    { id: "licenses", label: "Licenses" },
    { id: "privacy", label: "Privacy Policy" },
  ];

  const handleBack = () => {
    router.back();
  };

  const handleItemPress = (id: string) => {
    console.log("Item pressed:", id);
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={Colors.background === "#000000" ? "light-content" : "dark-content"} />
      
      <SafeAreaView style={[styles.safeArea, { backgroundColor: Colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Rules and terms</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.menuItem,
              index === 0 && styles.firstItem,
            ]}
            onPress={() => handleItemPress(item.id)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.menuLabel, { color: Colors.text }]}>{item.label}</Text>
            <ChevronRight color={Colors.textSecondary} size={20} />
          </TouchableOpacity>
        ))}

        <Text style={[styles.versionText, { color: Colors.text }]}>
          Version: 5.152.0 (2512110931)
        </Text>
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
  },
  placeholder: {
    width: 24,
  },
  content: {
    paddingTop: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  firstItem: {},
  menuLabel: {
    fontSize: 17,
    fontWeight: "400",
  },
  versionText: {
    fontSize: 15,
    fontWeight: "400",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
