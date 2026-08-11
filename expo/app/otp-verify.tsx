import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ArrowLeft, AlertCircle } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

export default function OTPVerifyScreen() {
  const router = useRouter();
  const colors = useColors();
  const { phoneNumber, resetPin, resyncAuth, isChangeNumber, pinVerified, isNewUser } = useLocalSearchParams<{ phoneNumber: string; resetPin?: string; resyncAuth?: string; isChangeNumber?: string; pinVerified?: string; isNewUser?: string }>();
  const isNewUserFlow = isNewUser === "true";
  const isChangeNumberFlow = isChangeNumber === "true";
  const isPinVerifiedShortcut = pinVerified === "true";
  const { isSupabaseAuth, verifyOtp, sendOtp, hasPinSet, refreshProfile, resyncAuthPassword } = useAuth();

  // SMS OTPs are always 6 digits (Supabase). The local 4-digit fallback is
  // only kept for completely offline test runs where Supabase is disabled.
  const codeLength: number = isSupabaseAuth || isNewUserFlow ? 6 : 4;
  const initialCode = useMemo<string[]>(
    () => Array.from({ length: codeLength }, () => ""),
    [codeLength]
  );

  const [code, setCode] = useState<string[]>(initialCode);
  const [timer, setTimer] = useState<number>(50);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const LOCAL_VALID_OTP = "1111";

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleCodeChange = (text: string, index: number) => {
    if (text.length > 1) {
      text = text[text.length - 1];
    }

    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);
    setError(null);

    if (text && index < codeLength - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newCode.every((digit) => digit !== "")) {
      const enteredOtp = newCode.join("");
      setTimeout(async () => {
        if (isSupabaseAuth) {
          setIsVerifying(true);
          const res = await verifyOtp(phoneNumber || "", enteredOtp, {
            type: isChangeNumberFlow ? "phone_change" : "sms",
          });
          setIsVerifying(false);
          if (!res.ok) {
            setError(res.error ?? "Invalid OTP code. Please try again.");
            setCode(Array.from({ length: codeLength }, () => ""));
            inputRefs.current[0]?.focus();
            return;
          }
          console.log("OTP verified via Supabase, isNewUser:", res.isNewUser, "isChangeNumber:", isChangeNumberFlow, "pinVerified:", isPinVerifiedShortcut);
          // Pull the latest profile (including server-synced pin) so the
          // hasPinSet check below reflects PIN state from any device.
          try {
            await refreshProfile();
          } catch (e) {
            console.log("[otp-verify] refreshProfile failed", e);
          }
          // Auth state listener will flip authState; route based on profile.
          if (isChangeNumberFlow) {
            router.replace({
              pathname: "/edit-profile" as any,
              params: { numberChanged: "true", verified: isPinVerifiedShortcut ? "true" : "false", phoneNumber },
            });
          } else if (resyncAuth === "true") {
            // User's PIN was correct but auth password was out of sync.
            // Resync the auth password from the existing profile PIN using
            // the fresh OTP session, then go straight home — no pin-setup needed.
            const userId = res.userId ?? "";
            const synced = userId ? await resyncAuthPassword(userId) : false;
            if (synced) {
              console.log("[otp-verify] resyncAuth: auth password re-synced, going home");
              router.replace("/welcome-back" as any);
            } else {
              // Resync failed (e.g. no profile PIN) — fall back to pin-setup
              // so the user can establish a PIN and re-sync the auth password.
              console.log("[otp-verify] resyncAuth: resync failed, falling back to pin-setup");
              router.replace({ pathname: "/pin-setup" as any, params: { phoneNumber, firstName: res.name ?? "", isReset: "true" } });
            }
          } else if (resetPin === "true") {
            router.replace({ pathname: "/pin-setup" as any, params: { phoneNumber, firstName: res.name ?? "", isReset: "true" } });
          } else if (!res.hasName) {
            router.replace({ pathname: "/name-entry" as any, params: { phoneNumber } });
          } else if (!hasPinSet(phoneNumber || "")) {
            router.replace({ pathname: "/pin-setup" as any, params: { phoneNumber, firstName: res.name ?? "" } });
          } else {
            router.replace("/welcome-back" as any);
          }
          return;
        }

        if (enteredOtp === LOCAL_VALID_OTP) {
          if (isChangeNumberFlow) {
            router.replace({
              pathname: "/edit-profile" as any,
              params: { numberChanged: "true", verified: isPinVerifiedShortcut ? "true" : "false", phoneNumber },
            });
          } else if (resetPin === "true") {
            router.replace({ pathname: "/pin-setup" as any, params: { phoneNumber } });
          } else if (!hasPinSet(phoneNumber || "")) {
            router.replace({ pathname: "/name-entry" as any, params: { phoneNumber } });
          } else {
            router.replace("/welcome-back" as any);
          }
        } else {
          setError("Invalid OTP code. Please try again.");
          setCode(Array.from({ length: codeLength }, () => ""));
          inputRefs.current[0]?.focus();
        }
      }, 300);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (timer !== 0) return;
    if (isSupabaseAuth) {
      // For phone_change resends we don't have a way to re-trigger the change
      // OTP without calling updateUser again from the previous screen, so fall
      // back to a standard signInWithOtp which Supabase will accept for the
      // same number.
      const res = await sendOtp(phoneNumber || "", {
        shouldCreateUser: isNewUserFlow,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to resend code");
        return;
      }
    }
    setTimer(50);
    setCode(Array.from({ length: codeLength }, () => ""));
    setError(null);
    inputRefs.current[0]?.focus();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
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

      <View style={styles.content}>
        <View style={styles.topContent}>
          <Text style={[styles.title, { color: colors.text }]}>Enter the code</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            We sent your code via SMS to {phoneNumber || "+60 182000004"}
          </Text>

          <View style={[styles.codeContainer, codeLength === 6 && styles.codeContainerCompact]}>
            {code.map((digit, index) => (
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
                  editable={!isVerifying}
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
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <AlertCircle color={colors.error} size={16} />
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.resendButton,
              { backgroundColor: colors.text },
              timer > 0 && [styles.resendButtonDisabled, { backgroundColor: colors.gray[100] }],
            ]}
            onPress={handleResend}
            disabled={timer > 0}
            accessibilityRole="button"
            accessibilityLabel={timer > 0 ? `Resend code in ${timer} seconds` : "Resend code"}
            accessibilityState={{ disabled: timer > 0 }}
          >
            <Text
              style={[
                styles.resendButtonText,
                { color: colors.background },
                timer > 0 && [styles.resendButtonTextDisabled, { color: colors.textSecondary }],
              ]}
            >
              Resend code {formatTime(timer)}
            </Text>
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
    marginBottom: 60,
    gap: 16,
  },
  codeContainerCompact: {
    gap: 8,
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
  codeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  codeDotFilled: {},
  codeDotError: {
    backgroundColor: "#FF4444",
  },
  codeInputError: {
    color: "#FF4444",
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
  resendButton: {
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  resendButtonDisabled: {},
  resendButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  resendButtonTextDisabled: {},
});
