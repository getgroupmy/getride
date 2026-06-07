import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Animated,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type Step = "verify" | "create" | "confirm";

const STEP_TITLE: Record<Step, string> = {
  verify: "Enter current PIN",
  create: "Create new PIN",
  confirm: "Confirm new PIN",
};

const STEP_SUB: Record<Step, string> = {
  verify: "Enter your existing 6-digit sign-in PIN",
  create: "Choose a new 6-digit PIN to secure your account",
  confirm: "Re-enter your new PIN to confirm",
};

const EMPTY: string[] = ["", "", "", "", "", ""];

/**
 * Change PIN flow. Verifies the current sign-in PIN, then asks for a new PIN
 * twice before persisting it via AuthContext.registerUser.
 */
export default function ChangePinScreen() {
  const router = useRouter();
  const colors = useColors();
  const { authState, verifyPin, registerUser } = useAuth();

  const [step, setStep] = useState<Step>("verify");
  const [currentPin, setCurrentPin] = useState<string[]>(EMPTY);
  const [newPin, setNewPin] = useState<string[]>(EMPTY);
  const [confirmPin, setConfirmPin] = useState<string[]>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const fadeAnimation = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 150);
  }, []);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(fadeAnimation, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnimation, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setTimeout(() => inputRefs.current[0]?.focus(), 200);
  }, [step, fadeAnimation]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const currentCode =
    step === "verify" ? currentPin : step === "create" ? newPin : confirmPin;
  const setCurrentCode =
    step === "verify" ? setCurrentPin : step === "create" ? setNewPin : setConfirmPin;

  const handleCodeChange = (text: string, index: number) => {
    if (text.length > 1) text = text[text.length - 1];
    const next = [...currentCode];
    next[index] = text;
    setCurrentCode(next);
    setError(null);

    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== "")) {
      const code = next.join("");
      if (step === "verify") {
        setTimeout(() => {
          if (verifyPin(authState.phoneNumber ?? "", code)) {
            setStep("create");
          } else {
            setError("Incorrect PIN. Please try again.");
            shake();
            setCurrentPin(EMPTY);
            inputRefs.current[0]?.focus();
          }
        }, 250);
      } else if (step === "create") {
        setTimeout(() => setStep("confirm"), 250);
      } else {
        const original = newPin.join("");
        setTimeout(async () => {
          if (code !== original) {
            setError("PINs do not match. Please try again.");
            shake();
            setConfirmPin(EMPTY);
            inputRefs.current[0]?.focus();
            return;
          }
          if (code === currentPin.join("")) {
            setError("New PIN must be different from current PIN.");
            shake();
            setNewPin(EMPTY);
            setConfirmPin(EMPTY);
            setStep("create");
            return;
          }
          try {
            const result = await registerUser(authState.phoneNumber ?? "", code);
            if (result?.loginPinSaved) {
              setDone(true);
              setShowSuccessModal(true);
            } else {
              setError("Could not update PIN. Please try again.");
              shake();
            }
          } catch (e) {
            console.log("[change-pin] save failed", e);
            setError("Could not update PIN. Please try again.");
            shake();
          }
        }, 250);
      }
    }
  };

  const handleKeyPress = (e: { nativeEvent: { key: string } }, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !currentCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleBack = () => {
    if (step === "confirm") {
      setStep("create");
      setConfirmPin(EMPTY);
      setError(null);
    } else if (step === "create") {
      setStep("verify");
      setNewPin(EMPTY);
      setError(null);
    } else {
      router.back();
    }
  };

  const stepIndex = step === "verify" ? 0 : step === "create" ? 1 : 2;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={{ backgroundColor: colors.background }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack} testID="change-pin-back">
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.content, { opacity: fadeAnimation }]}>
        <View style={styles.topContent}>
          <View style={styles.stepIndicator}>
            {[0, 1, 2].map((i) => (
              <React.Fragment key={i}>
                <View
                  style={[
                    styles.stepDot,
                    { backgroundColor: i <= stepIndex ? colors.accent : colors.gray[200] },
                  ]}
                />
                {i < 2 && (
                  <View
                    style={[
                      styles.stepLine,
                      { backgroundColor: i < stepIndex ? colors.accent : colors.gray[200] },
                    ]}
                  />
                )}
              </React.Fragment>
            ))}
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{STEP_TITLE[step]}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{STEP_SUB[step]}</Text>

          <Animated.View
            style={[styles.codeContainer, { transform: [{ translateX: shakeAnimation }] }]}
          >
            {currentCode.map((digit, index) => (
              <View key={index} style={styles.codeInputWrapper}>
                <TextInput
                  ref={(ref) => {
                    inputRefs.current[index] = ref;
                  }}
                  style={[styles.codeInput, { color: colors.text }, error && styles.codeInputError]}
                  value={digit}
                  onChangeText={(text) => handleCodeChange(text, index)}
                  onKeyPress={(e) => handleKeyPress(e, index)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  secureTextEntry
                  editable={!done}
                  testID={`change-pin-digit-${index}`}
                />
                <View
                  style={[
                    styles.codeDot,
                    { backgroundColor: colors.gray[200] },
                    digit && [styles.codeDotFilled, { backgroundColor: colors.text }],
                    error && styles.codeDotError,
                  ]}
                />
              </View>
            ))}
          </Animated.View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          {done && (
            <View style={styles.hintContainer}>
              <ShieldCheck color={colors.accent} size={18} />
              <Text style={[styles.hintText, { color: colors.accent }]}>PIN updated</Text>
            </View>
          )}

          {!error && !done && step === "confirm" && (
            <View style={styles.hintContainer}>
              <Check color={colors.accent} size={16} />
              <Text style={[styles.hintText, { color: colors.accent }]}>Almost done!</Text>
            </View>
          )}
        </View>
      </Animated.View>

      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSuccessModal(false);
          router.back();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <View style={[styles.modalIcon, { backgroundColor: colors.accent + "22" }]}>
              <ShieldCheck color={colors.accent} size={32} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New Pin Has Been Updated</Text>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.accent }]}
              onPress={() => {
                setShowSuccessModal(false);
                router.back();
              }}
              testID="change-pin-success-close"
            >
              <Text style={styles.modalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  backButton: { width: 44, height: 44, justifyContent: "center" as const },
  content: { flex: 1 },
  topContent: { paddingHorizontal: 28, paddingTop: 20 },
  stepIndicator: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 32,
  },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  stepLine: { width: 32, height: 2, marginHorizontal: 8 },
  title: { fontSize: 28, fontWeight: "700" as const, marginBottom: 12 },
  subtitle: { fontSize: 16, marginBottom: 60 },
  codeContainer: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    marginBottom: 24,
    gap: 12,
  },
  codeInputWrapper: { flex: 1, alignItems: "center" as const },
  codeInput: {
    width: "100%" as const,
    height: 56,
    fontSize: 24,
    textAlign: "center" as const,
    backgroundColor: "transparent" as const,
  },
  codeInputError: { color: "#FF4444" },
  codeDot: { width: 14, height: 14, borderRadius: 7, marginTop: 8 },
  codeDotFilled: {},
  codeDotError: { backgroundColor: "#FF4444" },
  errorContainer: { alignItems: "center" as const, marginBottom: 24 },
  errorText: { fontSize: 14, fontWeight: "500" as const },
  hintContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  hintText: { fontSize: 14, fontWeight: "500" as const },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 32,
  },
  modalCard: {
    width: "100%" as const,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: "center" as const,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    textAlign: "center" as const,
    marginBottom: 24,
  },
  modalButton: {
    width: "100%" as const,
    height: 50,
    borderRadius: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600" as const,
  },
});
