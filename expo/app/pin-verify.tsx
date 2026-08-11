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
import { ArrowLeft, AlertCircle } from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function PinVerifyScreen() {
  const router = useRouter();
  const colors = useColors();
  const { phoneNumber, nextRoute, mode } = useLocalSearchParams<{ phoneNumber: string; nextRoute?: string; mode?: string }>();
  const { login, verifyPin, signInTestAccountToSupabase, isTestAccountPhone, isSupabaseAuth, sendOtp, signInWithPin, refreshProfile } = useAuth();
  const [isSendingOtp, setIsSendingOtp] = useState<boolean>(false);
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleCodeChange = (text: string, index: number) => {
    if (text.length > 1) {
      text = text[text.length - 1];
    }

    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);
    setError(null);

    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every((digit) => digit !== "")) {
      const enteredPin = newCode.join("");
      setTimeout(async () => {
        const failPin = (msg?: string) => {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setError(
            newAttempts >= 3
              ? "Too many attempts. Please try again later."
              : msg ?? "Incorrect PIN. Please try again."
          );
          shake();
          setCode(["", "", "", "", "", ""]);
          inputRefs.current[0]?.focus();
        };

        // Test account keeps its dedicated bridge path so dev logins still work.
        if (isTestAccountPhone(phoneNumber || "")) {
          if (!verifyPin(phoneNumber || "", enteredPin)) {
            failPin();
            return;
          }
          const ok = await signInTestAccountToSupabase();
          console.log("[pin-verify] test → supabase session", ok);
          if (!ok) {
            setError("This test account has no Supabase record. Please register first.");
            setCode(["", "", "", "", "", ""]);
            setTimeout(() => {
              router.replace({
                pathname: "/otp-verify" as any,
                params: { phoneNumber: phoneNumber || "", isNewUser: "true" },
              });
            }, 800);
            return;
          }
        } else if (isSupabaseAuth) {
          // Mint a real Supabase session via phone+password (password mirrors
          // the PIN). This is what makes RLS-protected reads work after the
          // user logs in via PIN without OTP.
          const res = await signInWithPin(phoneNumber || "", enteredPin);
          console.log("[pin-verify] signInWithPin result", res);
          if (!res.ok) {
            if (res.profilePinMatched) {
              // The entered PIN matches the PIN saved in the user's profile,
              // so it IS correct — the Supabase Auth password just drifted and
              // couldn't be re-synced without a session. Route through OTP to
              // mint a fresh session, then resyncAuth re-syncs the password
              // directly without making the user re-enter their PIN.
              console.log("[pin-verify] profile PIN matched — OTP re-sync via resyncAuth");
              setError("Verify via SMS once to finish syncing your PIN login.");
              setCode(["", "", "", "", "", ""]);
              setTimeout(() => {
                router.replace({
                  pathname: "/otp-verify" as any,
                  params: { phoneNumber: phoneNumber || "", resyncAuth: "true" },
                });
              }, 1000);
              return;
            }
            if (res.needsOtp) {
              // Legacy account predating password-sync — do one OTP login so
              // the password gets synced, then PIN login will work next time.
              setError("Please verify via SMS once to enable PIN login.");
              setCode(["", "", "", "", "", ""]);
              setTimeout(() => {
                router.replace({
                  pathname: "/otp-verify" as any,
                  params: { phoneNumber: phoneNumber || "" },
                });
              }, 1000);
              return;
            }
            failPin(res.error);
            return;
          }
          try {
            await refreshProfile();
          } catch (e) {
            console.log("[pin-verify] refreshProfile failed", e);
          }
        } else {
          // Offline / Supabase disabled: legacy local PIN check only.
          if (!verifyPin(phoneNumber || "", enteredPin)) {
            failPin();
            return;
          }
        }

        console.log("PIN verified successfully");
        if (nextRoute) {
          router.replace({ pathname: nextRoute as any, params: { phoneNumber: phoneNumber || "", verified: "true" } });
        } else if (mode === "verifyOnly") {
          router.back();
        } else {
          // For real Supabase PIN logins, the auth-state listener has already
          // populated authState (userId, isSupabaseSession=true). Calling the
          // legacy local `login()` here would overwrite that state with stale
          // closure values (userId=null, isSupabaseSession=false) and break
          // RLS-protected reads on the profile screen. Only fall back to
          // legacy login when we're not on the Supabase path.
          const usedSupabasePin =
            isSupabaseAuth && !isTestAccountPhone(phoneNumber || "");
          if (!usedSupabasePin) {
            await login(phoneNumber || "");
          }
          router.replace("/welcome-back" as any);
        }
      }, 300);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleForgotPin = async () => {
    if (isSupabaseAuth) {
      setIsSendingOtp(true);
      const res = await sendOtp(phoneNumber || "", { shouldCreateUser: false });
      setIsSendingOtp(false);
      if (!res.ok) {
        setError(res.error ?? "Failed to send code");
        return;
      }
    }
    router.push({
      pathname: "/otp-verify" as any,
      params: { phoneNumber, resetPin: "true" },
    });
  };

  const maskedPhone = phoneNumber 
    ? phoneNumber.replace(/(\d{2})(\d+)(\d{2})/, "$1****$3")
    : "";

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
        <View style={styles.topContent}>
          <Text style={[styles.title, { color: colors.text }]}>Enter your PIN</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Enter your 6-digit PIN for {maskedPhone || phoneNumber}
          </Text>

          <Animated.View 
            style={[
              styles.codeContainer,
              { transform: [{ translateX: shakeAnimation }] }
            ]}
          >
            {code.map((digit, index) => (
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
                  accessibilityLabel={`PIN digit ${index + 1} of ${code.length}`}
                  editable={attempts < 3}
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
              <AlertCircle color={colors.error} size={16} />
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.forgotButton}
            onPress={handleForgotPin}
            disabled={isSendingOtp}
          >
            <Text style={[styles.forgotButtonText, { color: colors.accent }]}>{isSendingOtp ? "Sending code\u2026" : "Forgot PIN?"}</Text>
          </TouchableOpacity>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    fontWeight: "500",
  },
  forgotButton: {
    alignItems: "center",
    paddingVertical: 16,
  },
  forgotButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
