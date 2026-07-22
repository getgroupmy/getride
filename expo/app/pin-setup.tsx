import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check } from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  evaluateDeviceRegistration,
  isRegistrationBlockedError,
} from "@/utils/deviceGuard";

type Step = "create" | "confirm";

export default function PinSetupScreen() {
  const router = useRouter();
  const colors = useColors();
  const { phoneNumber, firstName, isReset } = useLocalSearchParams<{ phoneNumber: string; firstName?: string; isReset?: string }>();
  const isResetFlow = isReset === "true";
  const { login, registerUser, isSupabaseAuth, updateProfile } = useAuth();
  const [step, setStep] = useState<Step>("create");
  const [pin, setPin] = useState<string[]>(["", "", "", "", "", ""]);
  const [confirmPin, setConfirmPin] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const fadeAnimation = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (step === "confirm") {
      Animated.sequence([
        Animated.timing(fadeAnimation, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnimation, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
      setTimeout(() => inputRefs.current[0]?.focus(), 200);
    }
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

  const currentCode = step === "create" ? pin : confirmPin;
  const setCurrentCode = step === "create" ? setPin : setConfirmPin;

  const handleCodeChange = (text: string, index: number) => {
    if (text.length > 1) {
      text = text[text.length - 1];
    }

    const newCode = [...currentCode];
    newCode[index] = text;
    setCurrentCode(newCode);
    setError(null);

    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every((digit) => digit !== "")) {
      if (step === "create") {
        setTimeout(() => {
          setStep("confirm");
        }, 300);
      } else {
        const enteredPin = newCode.join("");
        const originalPin = pin.join("");
        
        setTimeout(async () => {
          if (enteredPin === originalPin) {
            // Device-based duplicate-account guard. Only for genuine new
            // sign-ups — the forgot-PIN reset (isResetFlow) is an existing user
            // re-securing their account and must never be blocked. The check
            // fails open, so infra problems never trap a legitimate user.
            if (!isResetFlow) {
              const guard = await evaluateDeviceRegistration();
              if (!guard.allowed) {
                const reason =
                  guard.blockEmulators && guard.isEmulator
                    ? "This device isn't supported for creating an account. Please " +
                      "sign up on a physical phone, or contact support if you think " +
                      "this is a mistake."
                    : "This device is already linked to several accounts, so a new " +
                      "account can't be created here. Please sign in to your existing " +
                      "account, or contact support if you think this is a mistake.";
                console.log(
                  "[pin-setup] registration blocked — prior:",
                  guard.priorAccounts,
                  "emulator:",
                  guard.isEmulator
                );
                setError(reason);
                shake();
                setConfirmPin(["", "", "", "", "", ""]);
                inputRefs.current[0]?.focus();
                return;
              }
            }
            console.log("PIN setup successful");
            try {
              await registerUser(phoneNumber || "", enteredPin, firstName || "");
            } catch (e) {
              // Server-side device guard rejected this sign-up (the client
              // pre-check above was bypassed or raced). Show the block and stop
              // — do not sign the user in.
              if (isRegistrationBlockedError(e)) {
                setError(
                  "This device can't be used to create a new account. Please sign " +
                    "in to your existing account, or contact support if you think " +
                    "this is a mistake."
                );
                shake();
                setConfirmPin(["", "", "", "", "", ""]);
                inputRefs.current[0]?.focus();
                return;
              }
              throw e;
            }
            if (!isResetFlow && isSupabaseAuth && firstName) {
              const saved = await updateProfile({ name: firstName });
              // updateProfile depends on authState.userId, which the supabase
              // auth listener may not have populated yet. Fall back to writing
              // directly using the current session user id so the name lands
              // in profiles regardless of listener timing.
              if (!saved && isSupabaseConfigured && supabase) {
                try {
                  const { data: u } = await supabase.auth.getUser();
                  const uid = u.user?.id;
                  if (uid) {
                    const { error } = await supabase
                      .from("profiles")
                      .update({ name: firstName })
                      .eq("id", uid);
                    if (error) console.log("[pin-setup] direct name save error", error.message);
                  }
                } catch (e) {
                  console.log("[pin-setup] direct name save threw", e);
                }
              }
            }
            if (isResetFlow) {
              // Forgot-PIN reset: user is already authenticated via OTP.
              // Go straight home — no profile-photo step for existing users.
              router.replace("/" as any);
            } else {
              await login(phoneNumber || "", firstName || undefined);
              router.replace({
                pathname: "/profile-photo" as any,
                params: { firstName: firstName || "" },
              });
            }
          } else {
            setError("PINs do not match. Please try again.");
            shake();
            setConfirmPin(["", "", "", "", "", ""]);
            inputRefs.current[0]?.focus();
          }
        }, 300);
      }
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !currentCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleBack = () => {
    if (step === "confirm") {
      setStep("create");
      setConfirmPin(["", "", "", "", "", ""]);
      setError(null);
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
          >
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.content, { opacity: fadeAnimation }]}>
        <View style={styles.topContent}>
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, styles.stepDotActive, { backgroundColor: colors.accent }]} />
            <View style={[styles.stepLine, { backgroundColor: colors.gray[200] }]} />
            <View style={[styles.stepDot, { backgroundColor: colors.gray[200] }, step === "confirm" && [styles.stepDotActive, { backgroundColor: colors.accent }]]} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {step === "create" ? "Create a PIN" : "Confirm your PIN"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {step === "create"
              ? "Create a 6-digit PIN to secure your account"
              : "Re-enter your PIN to confirm"}
          </Text>

          <Animated.View 
            style={[
              styles.codeContainer,
              { transform: [{ translateX: shakeAnimation }] }
            ]}
          >
            {currentCode.map((digit, index) => (
              <View key={index} style={styles.codeInputWrapper}>
                <TextInput
                  ref={(ref) => {
                    inputRefs.current[index] = ref;
                  }}
                  style={[
                    styles.codeInput,
                    { color: colors.text },
                    error && styles.codeInputError,
                  ]}
                  value={digit}
                  onChangeText={(text) => handleCodeChange(text, index)}
                  onKeyPress={(e) => handleKeyPress(e, index)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  secureTextEntry
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

          {step === "confirm" && !error && (
            <View style={styles.hintContainer}>
              <Check color={colors.accent} size={16} />
              <Text style={[styles.hintText, { color: colors.accent }]}>Almost done!</Text>
            </View>
          )}
        </View>
      </Animated.View>
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
  },
  topContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  stepIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stepDotActive: {},
  stepLine: {
    width: 40,
    height: 2,
    marginHorizontal: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 60,
  },
  codeContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  codeInputWrapper: {
    flex: 1,
    alignItems: "center",
  },
  codeInput: {
    width: "100%",
    height: 56,
    fontSize: 24,
    textAlign: "center",
    backgroundColor: "transparent",
  },
  codeInputError: {
    color: "#FF4444",
  },
  codeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 8,
  },
  codeDotFilled: {},
  codeDotError: {
    backgroundColor: "#FF4444",
  },
  errorContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  errorText: {
    fontSize: 14,
    fontWeight: "500",
  },
  hintContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  hintText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
