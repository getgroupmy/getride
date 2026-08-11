import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export default function RoleSelectionScreen() {
  const router = useRouter();
  const colors = useColors();
  const { phoneNumber, firstName } = useLocalSearchParams<{
    phoneNumber: string;
    firstName: string;
  }>();
  const [isLoading, setIsLoading] = useState(false);

  const handleRoleSelect = async (role: "passenger" | "driver") => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setIsLoading(false);

    console.log("Role selected:", role);
    console.log("Navigating to PIN setup with phone:", phoneNumber, "name:", firstName);

    router.push({
      pathname: "/pin-setup",
      params: { phoneNumber, firstName, role },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        <View style={styles.illustrationContainer}>
          <Image
            source={{ uri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/qygpv69lzjm575rwwh6x2" }}
            style={styles.illustration}
            resizeMode="contain"
          />
        </View>

        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]}>Are you a passenger or{"\n"}a driver?</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>You can change the mode later</Text>
        </View>

        <SafeAreaView edges={["bottom"]} style={styles.bottomContent}>
          <TouchableOpacity
            style={[styles.passengerButton, { backgroundColor: colors.accent }, isLoading && styles.buttonDisabled]}
            onPress={() => handleRoleSelect("passenger")}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Passenger"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            <Text style={[styles.passengerButtonText, { color: colors.secondary }]}>Passenger</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.driverButton, { backgroundColor: colors.gray[100] }, isLoading && styles.buttonDisabled]}
            onPress={() => handleRoleSelect("driver")}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Driver"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            <Text style={[styles.driverButtonText, { color: colors.text }]}>Driver</Text>
          </TouchableOpacity>
        </SafeAreaView>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
  },
  illustrationContainer: {
    alignItems: "center",
    paddingTop: 40,
  },
  illustration: {
    width: 280,
    height: 240,
  },
  textContainer: {
    alignItems: "center",
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
  },
  bottomContent: {
    paddingHorizontal: 28,
    paddingBottom: 20,
    gap: 12,
  },
  passengerButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  driverButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  passengerButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  driverButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
