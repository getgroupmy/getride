import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  Check,
  X as XIcon,
  Clock,
  Copy,
  Play,
} from "lucide-react-native";

type Status = "idle" | "running" | "pass" | "fail";

interface CheckResult {
  id: string;
  label: string;
  status: Status;
  detail?: string;
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

function maskKey(k: string): string {
  if (!k) return "(empty)";
  if (k.length <= 12) return "***";
  return `${k.slice(0, 6)}…${k.slice(-4)} (len=${k.length})`;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return "(invalid url)";
  }
}

export default function AuthDiagnosticsScreen() {
  const router = useRouter();
  const colors = useColors();

  const [phone, setPhone] = useState<string>("+60");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState<boolean>(false);

  const initialChecks = useMemo<CheckResult[]>(
    () => [
      { id: "env", label: "1. Environment variables", status: "idle" as const },
      { id: "net", label: "2. Internet reachability", status: "idle" as const },
      { id: "health", label: "3. Supabase /auth/v1/health", status: "idle" as const },
      { id: "anon", label: "4. Anon key (read profiles)", status: "idle" as const },
      { id: "raw", label: "5. Raw POST /auth/v1/otp", status: "idle" as const },
      { id: "sdk", label: "6. SDK signInWithOtp", status: "idle" as const },
    ],
    []
  );

  const setStep = useCallback(
    (id: string, status: Status, detail?: string) => {
      setResults((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status, detail } : r))
      );
    },
    []
  );

  const runAllRef = useRef<(() => Promise<void>) | null>(null);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults(initialChecks);

    // 1. Env
    setStep("env", "running");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStep(
        "env",
        "fail",
        `URL=${SUPABASE_URL || "(empty)"}\nANON=${maskKey(SUPABASE_ANON_KEY)}`
      );
      setRunning(false);
      return;
    }
    setStep(
      "env",
      "pass",
      `host=${hostOf(SUPABASE_URL)}\nanon=${maskKey(SUPABASE_ANON_KEY)}\nplatform=${Platform.OS}`
    );

    // 2. Network reachability
    setStep("net", "running");
    try {
      const t0 = Date.now();
      const r = await fetch("https://www.google.com/generate_204", {
        method: "GET",
      });
      setStep(
        "net",
        r.ok || r.status === 204 ? "pass" : "fail",
        `HTTP ${r.status} in ${Date.now() - t0}ms`
      );
    } catch (e) {
      setStep("net", "fail", `fetch threw: ${(e as Error).message}`);
    }

    // 3. Supabase health
    setStep("health", "running");
    try {
      const t0 = Date.now();
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
        method: "GET",
        headers: { apikey: SUPABASE_ANON_KEY },
      });
      const body = await r.text();
      setStep(
        "health",
        r.ok ? "pass" : "fail",
        `HTTP ${r.status} in ${Date.now() - t0}ms\n${body.slice(0, 300)}`
      );
    } catch (e) {
      setStep("health", "fail", `fetch threw: ${(e as Error).message}`);
    }

    // 4. Anon key sanity
    setStep("anon", "running");
    try {
      if (!supabase) throw new Error("supabase client is null");
      const { error, count } = await supabase
        .from("profiles")
        .select("id", { head: true, count: "exact" });
      if (error) {
        setStep("anon", "fail", `${error.message}`);
      } else {
        setStep("anon", "pass", `profiles reachable, count=${count ?? "n/a"}`);
      }
    } catch (e) {
      setStep("anon", "fail", `threw: ${(e as Error).message}`);
    }

    // 5. Raw OTP request
    setStep("raw", "running");
    const phoneClean = phone.trim().replace(/\s|-/g, "");
    if (!/^\+\d{6,15}$/.test(phoneClean)) {
      setStep("raw", "fail", `Phone must be E.164 like +60123456789. Got: ${phoneClean}`);
    } else {
      try {
        const t0 = Date.now();
        const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            phone: phoneClean,
            create_user: true,
          }),
        });
        const text = await r.text();
        let pretty = text;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {}
        setStep(
          "raw",
          r.ok ? "pass" : "fail",
          `HTTP ${r.status} in ${Date.now() - t0}ms\nphone=${phoneClean}\n${pretty.slice(0, 800)}`
        );
      } catch (e) {
        setStep("raw", "fail", `fetch threw: ${(e as Error).message}`);
      }
    }

    // 6. SDK path
    setStep("sdk", "running");
    if (!supabase) {
      setStep("sdk", "fail", "supabase client is null");
    } else if (!/^\+\d{6,15}$/.test(phoneClean)) {
      setStep("sdk", "fail", `invalid phone ${phoneClean}`);
    } else {
      try {
        const t0 = Date.now();
        const { data, error } = await supabase.auth.signInWithOtp({
          phone: phoneClean,
          options: { shouldCreateUser: true },
        });
        const ms = Date.now() - t0;
        if (error) {
          setStep(
            "sdk",
            "fail",
            `${ms}ms\nname=${error.name}\nstatus=${
              (error as unknown as { status?: number }).status ?? "?"
            }\nmessage=${error.message}`
          );
        } else {
          setStep("sdk", "pass", `${ms}ms\n${JSON.stringify(data).slice(0, 200)}`);
        }
      } catch (e) {
        setStep("sdk", "fail", `threw: ${(e as Error).message}`);
      }
    }

    setRunning(false);
  }, [initialChecks, phone, setStep]);

  useEffect(() => {
    runAllRef.current = runAll;
  }, [runAll]);

  useEffect(() => {
    const fn = runAllRef.current;
    if (fn) void fn();
    // Run once on mount with the initial phone value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildReport = useCallback((): string => {
    const lines: string[] = [];
    lines.push("=== Auth Diagnostics Report ===");
    lines.push(`when: ${new Date().toISOString()}`);
    lines.push(`platform: ${Platform.OS}`);
    lines.push(`supabase host: ${hostOf(SUPABASE_URL)}`);
    lines.push(`anon key: ${maskKey(SUPABASE_ANON_KEY)}`);
    lines.push(`isSupabaseConfigured: ${isSupabaseConfigured}`);
    lines.push(`phone tested: ${phone}`);
    lines.push("");
    for (const r of results) {
      lines.push(`[${r.status.toUpperCase()}] ${r.label}`);
      if (r.detail) {
        for (const l of r.detail.split("\n")) lines.push(`    ${l}`);
      }
    }
    return lines.join("\n");
  }, [phone, results]);

  const copyReport = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(buildReport());
      if (Platform.OS === "web") {
        console.log("[diag] report copied");
      } else {
        Alert.alert("Copied", "Diagnostic report copied to clipboard.");
      }
    } catch (e) {
      Alert.alert("Copy failed", (e as Error).message);
    }
  }, [buildReport]);

  const renderIcon = (s: Status) => {
    if (s === "pass") return <Check color={colors.success ?? "#22c55e"} size={20} />;
    if (s === "fail") return <XIcon color={colors.error ?? "#ef4444"} size={20} />;
    if (s === "running") return <Clock color={colors.textSecondary} size={20} />;
    return <View style={[styles.idleDot, { backgroundColor: colors.gray[200] }]} />;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Auth Diagnostics
          </Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Tests where the OTP request fails. Enter your number in E.164 form
          (with leading +) and tap Run.
        </Text>

        <View
          style={[
            styles.inputRow,
            { backgroundColor: colors.gray[100], borderColor: colors.gray[200] },
          ]}
        >
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+60123456789"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text }]}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.runBtn,
            { backgroundColor: colors.accent },
            running && { opacity: 0.6 },
          ]}
          onPress={runAll}
          disabled={running}
          accessibilityRole="button"
        >
          <Play color={colors.secondary} size={18} />
          <Text style={[styles.runBtnText, { color: colors.secondary }]}>
            {running ? "Running…" : "Run all checks"}
          </Text>
        </TouchableOpacity>

        <View style={styles.results}>
          {(results.length ? results : initialChecks).map((r) => (
            <View
              key={r.id}
              style={[
                styles.resultCard,
                {
                  backgroundColor: colors.gray[50],
                  borderColor: colors.gray[200],
                },
              ]}
            >
              <View style={styles.resultHeader}>
                {renderIcon(r.status)}
                <Text style={[styles.resultLabel, { color: colors.text }]}>
                  {r.label}
                </Text>
              </View>
              {r.detail ? (
                <Text
                  style={[styles.resultDetail, { color: colors.textSecondary }]}
                  selectable
                >
                  {r.detail}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.copyBtn,
            { borderColor: colors.gray[200], backgroundColor: colors.gray[50] },
          ]}
          onPress={copyReport}
          accessibilityRole="button"
        >
          <Copy color={colors.text} size={18} />
          <Text style={[styles.copyBtnText, { color: colors.text }]}>
            Copy report
          </Text>
        </TouchableOpacity>

        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Tip: if Check 5 returns HTTP 200 but you still get no SMS, the issue
          is between Supabase and MessageBird (originator, country routing, or
          credit). If it returns 4xx, the body shows the exact reason.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 60 },
  subtitle: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  inputRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  input: { fontSize: 16, padding: 0 },
  runBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 20,
  },
  runBtnText: { fontSize: 16, fontWeight: "600" },
  results: { gap: 10, marginBottom: 20 },
  resultCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  resultLabel: { fontSize: 15, fontWeight: "600", flex: 1 },
  resultDetail: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    marginTop: 6,
    lineHeight: 16,
  },
  idleDot: { width: 10, height: 10, borderRadius: 5 },
  copyBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
  },
  copyBtnText: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12, lineHeight: 18, textAlign: "center" },
});
