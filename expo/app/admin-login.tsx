import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Eye, EyeOff, ShieldCheck, Lock, User, Delete, KeyRound } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { markSuperAdminSession } from "@/contexts/AdminAccessContext";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const ADMIN_PIN = "522337";

type Mode = "pin" | "credentials";

export default function AdminLoginScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [mode, setMode] = useState<Mode>("pin");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const handleCredentialsLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Missing fields", "Please enter username and password");
      return;
    }
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      if (
        username.trim().toLowerCase() === ADMIN_USERNAME &&
        password === ADMIN_PASSWORD
      ) {
        console.log("Admin login success (credentials)");
        await markSuperAdminSession();
        router.replace("/admin-dashboard" as any);
      } else {
        Alert.alert("Invalid credentials", "Username or password is incorrect");
      }
    } catch (e) {
      console.log("Admin login error", e);
      Alert.alert("Error", "Could not sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async (value: string) => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 300));
      if (value === ADMIN_PIN) {
        console.log("Admin login success (pin)");
        await markSuperAdminSession();
        router.replace("/admin-dashboard" as any);
      } else {
        Alert.alert("Invalid PIN", "The PIN you entered is incorrect");
        setPin("");
      }
    } catch (e) {
      console.log("Admin pin login error", e);
      Alert.alert("Error", "Could not sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const onPressDigit = (d: string) => {
    if (loading) return;
    setPin((prev) => {
      if (prev.length >= ADMIN_PIN.length) return prev;
      const next = prev + d;
      if (next.length === ADMIN_PIN.length) {
        submitPin(next);
      }
      return next;
    });
  };

  const onPressDelete = () => {
    if (loading) return;
    setPin((prev) => prev.slice(0, -1));
  };

  const dots = useMemo(() => {
    return Array.from({ length: ADMIN_PIN.length }).map((_, i) => i < pin.length);
  }, [pin]);

  const keypad: (string | "del" | "")[] = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "", "0", "del",
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: Colors.gray[100] }]}
          testID="admin-login-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.iconWrap, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent + "40" }]}>
            <ShieldCheck color={Colors.accent} size={36} />
          </View>
          <Text style={[styles.title, { color: Colors.text }]}>Admin Login</Text>
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
            Sign in to access the admin dashboard
          </Text>

          <View style={[styles.tabs, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <TouchableOpacity
              style={[
                styles.tabBtn,
                mode === "pin" && { backgroundColor: Colors.accent },
              ]}
              onPress={() => setMode("pin")}
              testID="admin-tab-pin"
            >
              <KeyRound color={mode === "pin" ? Colors.secondary : Colors.textSecondary} size={16} />
              <Text
                style={[
                  styles.tabText,
                  { color: mode === "pin" ? Colors.secondary : Colors.textSecondary },
                ]}
              >
                PIN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tabBtn,
                mode === "credentials" && { backgroundColor: Colors.accent },
              ]}
              onPress={() => setMode("credentials")}
              testID="admin-tab-credentials"
            >
              <User color={mode === "credentials" ? Colors.secondary : Colors.textSecondary} size={16} />
              <Text
                style={[
                  styles.tabText,
                  { color: mode === "credentials" ? Colors.secondary : Colors.textSecondary },
                ]}
              >
                User ID / Password
              </Text>
            </TouchableOpacity>
          </View>

          {mode === "pin" ? (
            <View style={styles.pinSection} testID="admin-pin-section">
              <View style={styles.dotsRow}>
                {dots.map((filled, i) => (
                  <View
                    key={`dot-${i}`}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: filled ? Colors.accent : "transparent",
                        borderColor: filled ? Colors.accent : Colors.border,
                      },
                    ]}
                  />
                ))}
              </View>

              <View style={styles.keypad}>
                {keypad.map((k, idx) => {
                  if (k === "") {
                    return <View key={`k-${idx}`} style={styles.key} />;
                  }
                  if (k === "del") {
                    return (
                      <TouchableOpacity
                        key={`k-${idx}`}
                        style={[styles.key, { backgroundColor: Colors.gray[100] }]}
                        onPress={onPressDelete}
                        disabled={loading}
                        testID="admin-pin-delete"
                      >
                        <Delete color={Colors.text} size={22} />
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={`k-${idx}`}
                      style={[styles.key, { backgroundColor: Colors.gray[100] }]}
                      onPress={() => onPressDigit(k)}
                      disabled={loading}
                      testID={`admin-pin-${k}`}
                    >
                      <Text style={[styles.keyText, { color: Colors.text }]}>{k}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {loading ? (
                <ActivityIndicator color={Colors.accent} style={{ marginTop: 12 }} />
              ) : null}
            </View>
          ) : (
            <View style={{ width: "100%" }} testID="admin-credentials-section">
              <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <User color={Colors.textSecondary} size={18} />
                <TextInput
                  style={[styles.input, { color: Colors.text }]}
                  placeholder="Username"
                  placeholderTextColor={Colors.textSecondary}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="admin-username"
                />
              </View>

              <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Lock color={Colors.textSecondary} size={18} />
                <TextInput
                  style={[styles.input, { color: Colors.text }]}
                  placeholder="Password"
                  placeholderTextColor={Colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="admin-password"
                />
                <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                  {showPassword ? (
                    <EyeOff color={Colors.textSecondary} size={18} />
                  ) : (
                    <Eye color={Colors.textSecondary} size={18} />
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.loginBtn,
                  { backgroundColor: Colors.accent, opacity: loading ? 0.7 : 1 },
                ]}
                onPress={handleCredentialsLogin}
                disabled={loading}
                testID="admin-login-submit"
              >
                {loading ? (
                  <ActivityIndicator color={Colors.secondary} />
                ) : (
                  <Text style={[styles.loginText, { color: Colors.secondary }]}>Sign in</Text>
                )}
              </TouchableOpacity>

              <Text style={[styles.hint, { color: Colors.textSecondary }]}>
                Demo credentials: admin / admin123
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "800" as const,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: "center" as const,
  },
  tabs: {
    flexDirection: "row" as const,
    width: "100%" as const,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  pinSection: {
    width: "100%" as const,
    alignItems: "center" as const,
  },
  dotsRow: {
    flexDirection: "row" as const,
    gap: 12,
    marginBottom: 24,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  keypad: {
    width: "100%" as const,
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "space-between" as const,
    rowGap: 12,
  },
  key: {
    width: "31%" as const,
    aspectRatio: 1.6,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  keyText: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700" as const,
    textAlign: "center" as const,
    includeFontPadding: false,
    textAlignVertical: "center" as const,
  },
  inputWrap: {
    width: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  loginBtn: {
    width: "100%" as const,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center" as const,
    marginTop: 8,
  },
  loginText: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  hint: {
    fontSize: 12,
    marginTop: 16,
    textAlign: "center" as const,
  },
});
