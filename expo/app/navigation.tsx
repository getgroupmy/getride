import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

type NavigationApp = "apple" | "google" | "waze";

export default function NavigationScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [selectedApp, setSelectedApp] = useState<NavigationApp | null>(null);

  const handleBack = () => {
    router.back();
  };

  const handleSelectApp = (app: NavigationApp) => {
    setSelectedApp(app);
    console.log("Selected navigation app:", app);
  };

  const navigationApps = [
    { id: "apple" as NavigationApp, name: "Apple Maps", icon: "apple" },
    { id: "google" as NavigationApp, name: "Google Maps", icon: "google" },
    { id: "waze" as NavigationApp, name: "Waze", icon: "waze" },
  ];

  const renderAppIcon = (icon: string) => {
    if (icon === "apple") {
      return (
        <View style={styles.iconContainer}>
          <Image
            source={{ uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/o0ukqxm76kagtwoiklfc8" }}
            style={styles.appleMapIcon}
            resizeMode="contain"
          />
        </View>
      );
    }
    if (icon === "google") {
      return (
        <View style={styles.iconContainer}>
          <Image
            source={{ uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/ncb503riip7m2y5m91uy1" }}
            style={styles.googleMapIcon}
            resizeMode="contain"
          />
        </View>
      );
    }
    if (icon === "waze") {
      return (
        <View style={styles.iconContainer}>
          <Image
            source={{ uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/panfn1qg242atw9to748b" }}
            style={styles.wazeMapIcon}
            resizeMode="contain"
          />
        </View>
      );
    }
    return null;
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
            <ChevronLeft color={Colors.text} size={28} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Navigation</Text>
          <View style={styles.placeholder} />
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        <View style={[styles.descriptionContainer, { backgroundColor: Colors.gray[100] }]}>
          <Text style={[styles.descriptionText, { color: Colors.text }]}>
            Select an app to guide you along the route.{"\n"}For drivers and couriers only
          </Text>
        </View>

        <View style={styles.optionsContainer}>
          {navigationApps.map((app) => (
            <TouchableOpacity
              key={app.id}
              style={styles.optionItem}
              onPress={() => handleSelectApp(app.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              {renderAppIcon(app.icon)}
              <Text style={[styles.optionLabel, { color: Colors.text }]}>{app.name}</Text>
              <View
                style={[
                  styles.radioOuter,
                  { borderColor: Colors.gray[300] },
                  selectedApp === app.id && { borderColor: Colors.primary },
                ]}
              >
                {selectedApp === app.id && (
                  <View style={[styles.radioInner, { backgroundColor: Colors.primary }]} />
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
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
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backButton: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  placeholder: {
    width: 28,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  descriptionContainer: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  descriptionText: {
    fontSize: 16,
    lineHeight: 22,
  },
  optionsContainer: {
    gap: 8,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  iconContainer: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  appleMapIcon: {
    width: 28,
    height: 28,
  },
  googleMapIcon: {
    width: 28,
    height: 28,
  },
  wazeMapIcon: {
    width: 28,
    height: 28,
  },
  optionLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: "400",
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
