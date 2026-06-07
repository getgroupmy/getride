import React, { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, X } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export default function NameEntryScreen() {
  const router = useRouter();
  const colors = useColors();
  const { phoneNumber } = useLocalSearchParams<{ phoneNumber: string }>();
  const [firstName, setFirstName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleNext = async () => {
    if (!firstName.trim()) return;

    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setIsLoading(false);

    console.log("Name entered:", firstName);
    console.log("Navigating to PIN setup with phone:", phoneNumber);

    router.push({
      pathname: "/role-selection",
      params: { phoneNumber, firstName: firstName.trim() },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <View style={styles.topContent}>
          <Text style={[styles.title, { color: colors.text }]}>What is your name?</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Enter your first name to personalize your experience
          </Text>

          <View style={styles.inputContainer}>
            <View style={[styles.inputWrapper, { backgroundColor: colors.gray[100], borderColor: colors.text }]}>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.textSecondary}
                autoFocus
                autoCapitalize="words"
                maxLength={50}
              />
              {firstName.length > 0 && (
                <TouchableOpacity
                  style={[styles.clearButton, { backgroundColor: colors.gray[200] }]}
                  onPress={() => setFirstName("")}
                >
                  <X color={colors.textSecondary} size={20} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <SafeAreaView edges={["bottom"]} style={styles.bottomContent}>
          <TouchableOpacity
            style={[
              styles.nextButton,
              { backgroundColor: colors.accent },
              (!firstName.trim() || isLoading) && styles.nextButtonDisabled,
            ]}
            onPress={handleNext}
            disabled={!firstName.trim() || isLoading}
          >
            {isLoading ? (
              <View style={[styles.loadingIndicator, { borderColor: colors.secondary, borderTopColor: "transparent" }]} />
            ) : (
              <Text style={[styles.nextButtonText, { color: colors.secondary }]}>Next</Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </KeyboardAvoidingView>
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
  topContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 40,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 2,
  },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomContent: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  nextButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  nextButtonDisabled: {
    opacity: 0.5,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  loadingIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
  },
});
