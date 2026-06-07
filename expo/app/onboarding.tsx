import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useColors } from "@/hooks/useColors";

const { width, height } = Dimensions.get("window");

const onboardingData = [
  {
    id: 1,
    image: "https://rork.app/pa/qezn11y2m3m0xeqzbetvu/splash-logo",
    title: "Your app for fair deals",
    subtitle: "Choose rides that are right for you",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useColors();
  const [currentIndex] = useState(0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <View style={[styles.logoCircle, { backgroundColor: colors.accent }]}>
              <Text style={[styles.logoText, { color: colors.secondary }]}>G</Text>
            </View>
            <Text style={[styles.logoName, { color: colors.text }]}>GET</Text>
          </View>

          <View style={styles.illustrationContainer}>
            <Image
              source={{
                uri: onboardingData[currentIndex].image,
              }}
              style={styles.illustration}
              contentFit="contain"
            />
          </View>

          <View style={styles.textContainer}>
            <Text style={[styles.title, { color: colors.text }]}>{onboardingData[currentIndex].title}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {onboardingData[currentIndex].subtitle}
            </Text>
          </View>

          <View style={styles.pagination}>
            {onboardingData.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.paginationDot,
                  { backgroundColor: colors.gray[200] },
                  index === currentIndex && [styles.paginationDotActive, { backgroundColor: colors.text }],
                ]}
              />
            ))}
            <View style={[styles.paginationDot, { backgroundColor: colors.gray[200] }]} />
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              onPress={() => router.push("/phone-auth" as any)}
            >
              <Text style={[styles.primaryButtonText, { color: colors.secondary }]}>Continue with phone</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: colors.gray[100] }]}>
              <View style={styles.passkeyIcon}>
                <Text style={styles.passkeyIconText}>🔑</Text>
              </View>
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Continue with PIN</Text>
            </TouchableOpacity>

            <Text style={[styles.terms, { color: colors.textSecondary }]}>
              Joining our app means you agree with our{" "}
              <Text style={styles.termsLink}>Terms of Use</Text> and{" "}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
  },
  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
  },
  logoCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  logoText: {
    fontSize: 18,
    fontWeight: "700",
  },
  logoName: {
    fontSize: 20,
    fontWeight: "600",
  },
  illustrationContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 40,
  },
  illustration: {
    width: width * 0.7,
    height: height * 0.35,
  },
  textContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40,
    gap: 8,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  paginationDotActive: {},
  buttonContainer: {
    gap: 16,
    marginBottom: 20,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
  },
  passkeyIcon: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  passkeyIconText: {
    fontSize: 18,
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  terms: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  termsLink: {
    textDecorationLine: "underline",
  },
});
