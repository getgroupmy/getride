import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArrowLeft,
  Database,
  Link2,
  KeyRound,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Save,
  Eye,
  EyeOff,
  Copy,
  Globe,
  ShieldCheck,
  Server,
  Activity,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

const STORAGE_KEY = "admin.supabase.settings.v1";

interface SupabaseSettings {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
  schema: string;
  autoRefreshToken: boolean;
  persistSession: boolean;
  realtimeEnabled: boolean;
}

const defaultSettings: SupabaseSettings = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  serviceRoleKey: "",
  projectRef: "",
  schema: "public",
  autoRefreshToken: true,
  persistSession: true,
  realtimeEnabled: true,
};

type Status = "idle" | "checking" | "ok" | "fail";

export default function AdminSettingsSupabaseScreen() {
  const router = useRouter();
  const Colors = useColors();

  const [settings, setSettings] = useState<SupabaseSettings>(defaultSettings);
  const [showAnon, setShowAnon] = useState<boolean>(false);
  const [showService, setShowService] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");

  const [checkStatus, setCheckStatus] = useState<Status>("idle");
  const [checkMsg, setCheckMsg] = useState<string>("");
  const [checkCount, setCheckCount] = useState<number | null>(null);
  const [checkLatency, setCheckLatency] = useState<number | null>(null);
  const [checkAt, setCheckAt] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SupabaseSettings>;
          setSettings((prev) => ({ ...prev, ...parsed }));
        }
      } catch (e) {
        console.log("[supabase-settings] load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const derivedRef = useMemo<string>(() => {
    try {
      if (!settings.url) return "";
      const u = settings.url.replace(/^https?:\/\//, "");
      const host = u.split("/")[0] ?? "";
      const ref = host.split(".")[0] ?? "";
      return ref;
    } catch {
      return "";
    }
  }, [settings.url]);

  const update = useCallback(<K extends keyof SupabaseSettings>(k: K, v: SupabaseSettings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }));
    setStatus("idle");
    setStatusMsg("");
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const payload: SupabaseSettings = {
        ...settings,
        projectRef: settings.projectRef || derivedRef,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      Alert.alert("Saved", "Supabase settings stored locally. Public URL/anon key still come from environment variables for the app bundle.");
    } catch (e) {
      console.log("[supabase-settings] save failed", e);
      Alert.alert("Error", "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }, [settings, derivedRef]);

  const testConnection = useCallback(async () => {
    setStatus("checking");
    setStatusMsg("");
    try {
      if (!settings.url || !settings.anonKey) {
        setStatus("fail");
        setStatusMsg("URL and anon key are required.");
        return;
      }
      const cleaned = settings.url.replace(/\/$/, "");
      const res = await fetch(`${cleaned}/auth/v1/health`, {
        method: "GET",
        headers: { apikey: settings.anonKey },
      });
      if (res.ok) {
        setStatus("ok");
        setStatusMsg(`Reachable (HTTP ${res.status})`);
      } else {
        setStatus("fail");
        setStatusMsg(`Endpoint responded HTTP ${res.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown network error";
      setStatus("fail");
      setStatusMsg(msg);
    }
  }, [settings.url, settings.anonKey]);

  const pingActiveClient = useCallback(async () => {
    setStatus("checking");
    setStatusMsg("");
    try {
      if (!supabase) {
        setStatus("fail");
        setStatusMsg("Active client not configured via env vars.");
        return;
      }
      const { error } = await supabase.auth.getSession();
      if (error) {
        setStatus("fail");
        setStatusMsg(error.message);
      } else {
        setStatus("ok");
        setStatusMsg("Active client responded successfully.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setStatus("fail");
      setStatusMsg(msg);
    }
  }, []);

  const runConnectionCheck = useCallback(async () => {
    setCheckStatus("checking");
    setCheckMsg("");
    setCheckCount(null);
    setCheckLatency(null);
    const started = Date.now();
    try {
      if (!supabase) {
        setCheckStatus("fail");
        setCheckMsg("Active client not configured via env vars.");
        return;
      }
      const { error, count } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });
      const elapsed = Date.now() - started;
      setCheckLatency(elapsed);
      setCheckAt(new Date().toLocaleTimeString());
      if (error) {
        setCheckStatus("fail");
        setCheckMsg(error.message);
        return;
      }
      setCheckStatus("ok");
      setCheckCount(typeof count === "number" ? count : 0);
      setCheckMsg("Read against profiles succeeded.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setCheckStatus("fail");
      setCheckMsg(msg);
      setCheckLatency(Date.now() - started);
    }
  }, []);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      if (!value) return;
      await Clipboard.setStringAsync(value);
      if (Platform.OS !== "web") Alert.alert("Copied", `${label} copied to clipboard.`);
    } catch (e) {
      console.log("[supabase-settings] copy failed", e);
    }
  }, []);

  const mask = (val: string) => {
    if (!val) return "";
    if (val.length <= 10) return "•".repeat(val.length);
    return `${val.slice(0, 6)}${"•".repeat(Math.max(8, val.length - 12))}${val.slice(-4)}`;
  };

  const statusColor =
    status === "ok" ? Colors.success : status === "fail" ? Colors.error : Colors.textSecondary;

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="supabase-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Database color={Colors.success} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Supabase</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Connection, project URL, keys & health</Text>
        </View>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: Colors.accent, opacity: saving ? 0.6 : 1 }]}
          testID="supabase-save"
        >
          {saving ? (
            <ActivityIndicator color="#000000" size="small" />
          ) : (
            <>
              <Save color="#000000" size={14} />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={[styles.statusDot, { backgroundColor: isSupabaseConfigured ? Colors.success : Colors.warning ?? "#F59E0B" }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: Colors.text }]}>
              {isSupabaseConfigured ? "Connected via environment" : "Not configured"}
            </Text>
            <Text style={[styles.statusSubtitle, { color: Colors.textSecondary }]}>
              {isSupabaseConfigured
                ? "EXPO_PUBLIC_SUPABASE_URL & EXPO_PUBLIC_SUPABASE_ANON_KEY are present in this build."
                : "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable the live client."}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Project</Text>
        <View style={styles.fieldGroup}>
          <Field
            label="Project URL"
            icon={<Globe color={Colors.accent} size={16} />}
            value={settings.url}
            placeholder="https://xxxxxxxx.supabase.co"
            onChangeText={(t) => update("url", t)}
            keyboardType="url"
            autoCapitalize="none"
            Colors={Colors}
            onCopy={() => copy("Project URL", settings.url)}
          />
          <Field
            label="Project Ref"
            icon={<Server color={Colors.textSecondary} size={16} />}
            value={settings.projectRef || derivedRef}
            placeholder="auto-derived from URL"
            onChangeText={(t) => update("projectRef", t)}
            autoCapitalize="none"
            Colors={Colors}
            onCopy={() => copy("Project Ref", settings.projectRef || derivedRef)}
          />
          <Field
            label="Default Schema"
            icon={<Database color={Colors.textSecondary} size={16} />}
            value={settings.schema}
            placeholder="public"
            onChangeText={(t) => update("schema", t)}
            autoCapitalize="none"
            Colors={Colors}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>API Keys</Text>
        <View style={styles.fieldGroup}>
          <Field
            label="Anon (public) Key"
            icon={<KeyRound color={Colors.accent} size={16} />}
            value={showAnon ? settings.anonKey : mask(settings.anonKey)}
            placeholder="eyJhbGciOi..."
            onChangeText={(t) => update("anonKey", t)}
            autoCapitalize="none"
            secureTextEntry={!showAnon}
            Colors={Colors}
            trailing={
              <TouchableOpacity onPress={() => setShowAnon((v) => !v)} style={styles.iconAction}>
                {showAnon ? <EyeOff color={Colors.textSecondary} size={16} /> : <Eye color={Colors.textSecondary} size={16} />}
              </TouchableOpacity>
            }
            onCopy={() => copy("Anon Key", settings.anonKey)}
          />
          <Field
            label="Service Role Key (server only)"
            icon={<ShieldCheck color={Colors.warning ?? "#F59E0B"} size={16} />}
            value={showService ? settings.serviceRoleKey : mask(settings.serviceRoleKey)}
            placeholder="eyJhbGciOi..."
            onChangeText={(t) => update("serviceRoleKey", t)}
            autoCapitalize="none"
            secureTextEntry={!showService}
            Colors={Colors}
            warningText="Never expose in client apps. Stored locally on this device only."
            trailing={
              <TouchableOpacity onPress={() => setShowService((v) => !v)} style={styles.iconAction}>
                {showService ? <EyeOff color={Colors.textSecondary} size={16} /> : <Eye color={Colors.textSecondary} size={16} />}
              </TouchableOpacity>
            }
            onCopy={() => copy("Service Role Key", settings.serviceRoleKey)}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Client Options</Text>
        <View style={styles.fieldGroup}>
          <ToggleRow
            label="Auto Refresh Token"
            description="Automatically refresh JWT before expiry"
            value={settings.autoRefreshToken}
            onValueChange={(v) => update("autoRefreshToken", v)}
            Colors={Colors}
          />
          <ToggleRow
            label="Persist Session"
            description="Keep user session in AsyncStorage between launches"
            value={settings.persistSession}
            onValueChange={(v) => update("persistSession", v)}
            Colors={Colors}
          />
          <ToggleRow
            label="Realtime"
            description="Enable Postgres changes & broadcast channels"
            value={settings.realtimeEnabled}
            onValueChange={(v) => update("realtimeEnabled", v)}
            Colors={Colors}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Health Check</Text>
        <View style={[styles.healthCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={styles.healthRow}>
            <View style={styles.healthLeft}>
              {status === "ok" ? (
                <CheckCircle2 color={Colors.success} size={18} />
              ) : status === "fail" ? (
                <XCircle color={Colors.error} size={18} />
              ) : status === "checking" ? (
                <ActivityIndicator color={Colors.accent} size="small" />
              ) : (
                <Link2 color={Colors.textSecondary} size={18} />
              )}
              <Text style={[styles.healthText, { color: statusColor }]} numberOfLines={2}>
                {status === "idle" ? "Run a check to verify your project." : statusMsg || (status === "checking" ? "Checking..." : "")}
              </Text>
            </View>
          </View>
          <View style={styles.healthActions}>
            <TouchableOpacity
              onPress={testConnection}
              style={[styles.actionBtn, { backgroundColor: Colors.accent }]}
              testID="supabase-test-url"
            >
              <RefreshCcw color="#000000" size={14} />
              <Text style={styles.actionBtnText}>Test URL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={pingActiveClient}
              style={[styles.actionBtn, { backgroundColor: Colors.success }]}
              testID="supabase-ping-client"
            >
              <Database color="#000000" size={14} />
              <Text style={styles.actionBtnText}>Ping Client</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Connection Check</Text>
        <View style={[styles.healthCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID="supabase-connection-check"
        >
          <View style={styles.healthRow}>
            <View style={styles.healthLeft}>
              {checkStatus === "ok" ? (
                <CheckCircle2 color={Colors.success} size={18} />
              ) : checkStatus === "fail" ? (
                <XCircle color={Colors.error} size={18} />
              ) : checkStatus === "checking" ? (
                <ActivityIndicator color={Colors.accent} size="small" />
              ) : (
                <Activity color={Colors.textSecondary} size={18} />
              )}
              <Text
                style={[
                  styles.healthText,
                  {
                    color:
                      checkStatus === "ok"
                        ? Colors.success
                        : checkStatus === "fail"
                        ? Colors.error
                        : Colors.textSecondary,
                  },
                ]}
                numberOfLines={2}
              >
                {checkStatus === "idle"
                  ? "Run a read against the profiles table to verify the live client."
                  : checkStatus === "checking"
                  ? "Querying profiles..."
                  : checkMsg}
              </Text>
            </View>
          </View>

          {checkStatus === "ok" || (checkStatus === "fail" && checkLatency !== null) ? (
            <View style={styles.statRow}>
              <View style={[styles.statPill, { backgroundColor: Colors.background, borderColor: Colors.border }]}> 
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Rows</Text>
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {checkCount === null ? "—" : checkCount.toLocaleString()}
                </Text>
              </View>
              <View style={[styles.statPill, { backgroundColor: Colors.background, borderColor: Colors.border }]}> 
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Latency</Text>
                <Text style={[styles.statValue, { color: Colors.text }]}>
                  {checkLatency === null ? "—" : `${checkLatency} ms`}
                </Text>
              </View>
              <View style={[styles.statPill, { backgroundColor: Colors.background, borderColor: Colors.border }]}> 
                <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Table</Text>
                <Text style={[styles.statValue, { color: Colors.text }]}>profiles</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.healthActions}>
            <TouchableOpacity
              onPress={runConnectionCheck}
              disabled={checkStatus === "checking"}
              style={[styles.actionBtn, { backgroundColor: Colors.accent, opacity: checkStatus === "checking" ? 0.7 : 1 }]}
              testID="supabase-connection-check-run"
            >
              {checkStatus === "checking" ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Activity color="#000000" size={14} />
              )}
              <Text style={styles.actionBtnText}>
                {checkStatus === "checking" ? "Checking..." : "Run Check"}
              </Text>
            </TouchableOpacity>
            {checkAt ? (
              <Text style={[styles.checkedAt, { color: Colors.textSecondary }]}>Last run {checkAt}</Text>
            ) : null}
          </View>
        </View>

        <Text style={[styles.helper, { color: Colors.textSecondary }]}>
          Note: The live app client reads URL & anon key from environment variables at build time. Use this screen to record the active project, document the service-role key safely, and verify connectivity.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  placeholder?: string;
  onChangeText: (t: string) => void;
  keyboardType?: "default" | "url" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secureTextEntry?: boolean;
  trailing?: React.ReactNode;
  warningText?: string;
  onCopy?: () => void;
  Colors: ReturnType<typeof useColors>;
}

function Field({ label, icon, value, placeholder, onChangeText, keyboardType, autoCapitalize, secureTextEntry, trailing, warningText, onCopy, Colors }: FieldProps) {
  return (
    <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
      <View style={styles.fieldHeader}>
        <View style={styles.fieldLabelRow}>
          {icon}
          <Text style={[styles.fieldLabel, { color: Colors.text }]}>{label}</Text>
        </View>
        {onCopy ? (
          <TouchableOpacity onPress={onCopy} style={styles.iconAction}>
            <Copy color={Colors.textSecondary} size={14} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          style={[styles.input, { color: Colors.text }]}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={autoCapitalize ?? "sentences"}
          secureTextEntry={secureTextEntry}
          autoCorrect={false}
        />
        {trailing}
      </View>
      {warningText ? (
        <Text style={[styles.warnText, { color: Colors.warning ?? "#F59E0B" }]}>{warningText}</Text>
      ) : null}
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  Colors: ReturnType<typeof useColors>;
}

function ToggleRow({ label, description, value, onValueChange, Colors }: ToggleRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onValueChange(!value)}
      activeOpacity={0.85}
      style={[styles.toggleRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: Colors.text }]}>{label}</Text>
        <Text style={[styles.toggleDesc, { color: Colors.textSecondary }]}>{description}</Text>
      </View>
      <View
        style={[
          styles.toggle,
          { backgroundColor: value ? Colors.accent : Colors.border },
        ]}
      >
        <View
          style={[
            styles.toggleKnob,
            { transform: [{ translateX: value ? 18 : 2 }] },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveBtnText: { color: "#000000", fontWeight: "700" as const, fontSize: 13 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  statusCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 18,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusTitle: { fontSize: 14, fontWeight: "700" as const },
  statusSubtitle: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "800" as const, marginBottom: 10, marginTop: 6 },
  fieldGroup: { gap: 10, marginBottom: 18 },
  field: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  fieldHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 8,
  },
  fieldLabelRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "700" as const },
  inputRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 6 },
  iconAction: { padding: 6 },
  warnText: { fontSize: 11, marginTop: 6 },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  toggleLabel: { fontSize: 14, fontWeight: "700" as const },
  toggleDesc: { fontSize: 12, marginTop: 2 },
  toggle: { width: 42, height: 24, borderRadius: 12, justifyContent: "center" as const },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  healthCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 12, marginBottom: 14 },
  healthRow: { flexDirection: "row" as const, alignItems: "center" as const },
  healthLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flex: 1 },
  healthText: { fontSize: 13, flex: 1 },
  healthActions: { flexDirection: "row" as const, gap: 10 },
  actionBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnText: { color: "#000000", fontWeight: "700" as const, fontSize: 13 },
  helper: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  statRow: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
  statPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 90,
  },
  statLabel: { fontSize: 10, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  statValue: { fontSize: 14, fontWeight: "800" as const, marginTop: 2 },
  checkedAt: { fontSize: 11, alignSelf: "center" as const },
});
