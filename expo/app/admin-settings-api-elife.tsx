import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Switch,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Plug,
  ExternalLink,
  ShieldCheck,
  FileText,
  Eye,
  EyeOff,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Save,
  Trash2,
  CircleDot,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  loadElifeConfig,
  saveElifeConfig,
  subscribeElifeConfig,
  setElifeEnabled,
  testElifeConnection,
  clearElifeActivity,
  DEFAULT_ELIFE_CONFIG,
  type ElifeConnectionConfig,
  type ElifeConnectionStatus,
  type ElifeEnvironment,
} from "@/utils/elifeApiStore";

const ELIFE_DOCS_URL =
  "https://app.theneo.io/elifetransfer/suppliers/fleet-ride-management-api";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminSettingsApiElifeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-api-keys");

  const [config, setConfig] = useState<ElifeConnectionConfig>(DEFAULT_ELIFE_CONFIG);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [revealSecret, setRevealSecret] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);

  // Editable form fields (kept separate so realtime updates don't stomp typing).
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [tokenUrl, setTokenUrl] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [environment, setEnvironment] = useState<ElifeEnvironment>("sandbox");

  const hydrate = useCallback((cfg: ElifeConnectionConfig) => {
    setConfig(cfg);
    setBaseUrl(cfg.baseUrl);
    setTokenUrl(cfg.tokenUrl);
    setClientId(cfg.clientId);
    setClientSecret(cfg.clientSecret);
    setWebhookUrl(cfg.webhookUrl);
    setEnvironment(cfg.environment);
    setDirty(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await loadElifeConfig();
      hydrate(cfg);
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribeElifeConfig((cfg) => {
      // Only mirror status/activity live; don't clobber unsaved form edits.
      setConfig((prev) => ({
        ...cfg,
        baseUrl: dirty ? prev.baseUrl : cfg.baseUrl,
      }));
      if (!dirty) hydrate(cfg);
    });
    return unsubscribe;
  }, [dirty, hydrate]);

  useFocusEffect(
    useCallback(() => {
      if (!dirty) refresh();
    }, [dirty, refresh])
  );

  const statusMeta = useMemo((): {
    label: string;
    color: string;
    Icon: React.ComponentType<{ color?: string; size?: number }>;
  } => {
    const s: ElifeConnectionStatus = !config.enabled ? "disabled" : config.status;
    switch (s) {
      case "connected":
        return { label: "Connected", color: Colors.success, Icon: CheckCircle2 };
      case "error":
        return { label: "Connection error", color: Colors.error, Icon: XCircle };
      case "disabled":
        return { label: "Disabled", color: Colors.textSecondary, Icon: CircleDot };
      default:
        return { label: "Not tested", color: Colors.warning, Icon: AlertTriangle };
    }
  }, [config.enabled, config.status, Colors]);

  const onToggleEnabled = useCallback(
    async (value: boolean) => {
      if (!editable) return;
      const { config: next, write } = await setElifeEnabled(config, value);
      setConfig(next);
      if (!write.ok && !write.skipped) {
        Alert.alert("Couldn't save to Supabase", write.error);
      }
    },
    [config, editable]
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const onSave = useCallback(async () => {
    if (!editable) return;
    setSaving(true);
    try {
      const next: ElifeConnectionConfig = {
        ...config,
        baseUrl: baseUrl.trim(),
        tokenUrl: tokenUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        webhookUrl: webhookUrl.trim(),
        environment,
      };
      const write = await saveElifeConfig(next);
      setConfig(next);
      setDirty(false);
      if (!write.ok && !write.skipped) {
        Alert.alert("Couldn't save to Supabase", write.error);
      } else {
        Alert.alert("Saved", "Elife connection settings updated.");
      }
    } finally {
      setSaving(false);
    }
  }, [editable, config, baseUrl, tokenUrl, clientId, clientSecret, webhookUrl, environment]);

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const probe: ElifeConnectionConfig = {
        ...config,
        baseUrl: baseUrl.trim(),
        tokenUrl: tokenUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        webhookUrl: webhookUrl.trim(),
        environment,
      };
      const { result, mutation } = await testElifeConnection(probe);
      setConfig(mutation.config);
      setDirty(false);
      Alert.alert(
        result.ok ? "Connection OK" : "Connection failed",
        result.message + (result.body ? `\n\n${result.body}` : "")
      );
    } finally {
      setTesting(false);
    }
  }, [config, baseUrl, tokenUrl, clientId, clientSecret, webhookUrl, environment]);

  const onClearActivity = useCallback(async () => {
    if (!editable) return;
    const apply = async () => {
      const { config: next } = await clearElifeActivity(config);
      setConfig(next);
    };
    if (Platform.OS === "web") {
      apply();
      return;
    }
    Alert.alert("Clear activity log", "Remove all recorded events?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: apply },
    ]);
  }, [config, editable]);

  const openDocs = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(ELIFE_DOCS_URL);
      if (!supported) {
        Alert.alert("Can't open link", "No app is available to open this URL.");
        return;
      }
      await Linking.openURL(ELIFE_DOCS_URL);
    } catch {
      Alert.alert("Couldn't open documentation", "Please try again.");
    }
  }, []);

  const StatusIcon = statusMeta.Icon;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="elife-api-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Plug color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>
              Elife Connection
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Fleet & Ride Management · Control & Monitor
          </Text>
        </View>
        <TouchableOpacity
          onPress={openDocs}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="elife-open-docs-top"
        >
          <FileText color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* STATUS CARD */}
          <View
            style={[
              styles.statusCard,
              { backgroundColor: statusMeta.color + "14", borderColor: statusMeta.color + "44" },
            ]}
          >
            <View style={[styles.statusIcon, { backgroundColor: statusMeta.color + "22" }]}>
              <StatusIcon color={statusMeta.color} size={24} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusLabel, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
              <Text style={[styles.statusSub, { color: Colors.textSecondary }]}>
                {config.lastCheckedAt
                  ? `Last checked ${timeAgo(config.lastCheckedAt)}`
                  : "Never tested"}
                {"  ·  "}
                {config.environment === "production" ? "Production" : "Sandbox"}
              </Text>
              {config.lastError && config.status === "error" ? (
                <Text style={[styles.statusErr, { color: Colors.error }]} numberOfLines={2}>
                  {config.lastError}
                </Text>
              ) : null}
            </View>
          </View>

          {/* ENABLE TOGGLE */}
          <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Integration enabled</Text>
                <Text style={[styles.cardHint, { color: Colors.textSecondary }]}>
                  When off, no rides are dispatched to or accepted from Elife.
                </Text>
              </View>
              <Switch
                value={config.enabled}
                onValueChange={onToggleEnabled}
                disabled={!editable}
                trackColor={{ true: Colors.accent, false: Colors.border }}
                thumbColor="#fff"
                testID="elife-enabled-switch"
              />
            </View>
          </View>

          {/* ENVIRONMENT */}
          <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>ENVIRONMENT</Text>
          <View style={styles.segment}>
            {(["sandbox", "production"] as ElifeEnvironment[]).map((env) => {
              const active = environment === env;
              return (
                <TouchableOpacity
                  key={env}
                  disabled={!editable}
                  onPress={() => {
                    setEnvironment(env);
                    markDirty();
                  }}
                  style={[
                    styles.segmentBtn,
                    {
                      backgroundColor: active ? Colors.accent : Colors.gray[100],
                      borderColor: active ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`elife-env-${env}`}
                >
                  <Text
                    style={[
                      styles.segmentTxt,
                      { color: active ? "#000000" : Colors.text },
                    ]}
                  >
                    {env === "sandbox" ? "Sandbox" : "Production"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* CREDENTIALS */}
          <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>
            CONNECTION CREDENTIALS
          </Text>

          <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>API base URL</Text>
            <TextInput
              value={baseUrl}
              onChangeText={(t) => { setBaseUrl(t); markDirty(); }}
              editable={editable}
              placeholder="https://api.elifetransfer.com"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.fieldInput, { color: Colors.text }]}
              testID="elife-base-url"
            />
          </View>

          <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>OAuth token URL</Text>
            <TextInput
              value={tokenUrl}
              onChangeText={(t) => { setTokenUrl(t); markDirty(); }}
              editable={editable}
              placeholder="https://api.elifetransfer.com/oauth/token"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.fieldInput, { color: Colors.text }]}
              testID="elife-token-url"
            />
          </View>

          <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Client ID</Text>
            <TextInput
              value={clientId}
              onChangeText={(t) => { setClientId(t); markDirty(); }}
              editable={editable}
              placeholder="Enter client ID"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.fieldInput, { color: Colors.text }]}
              testID="elife-client-id"
            />
          </View>

          <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Client Secret</Text>
            <View style={styles.secretRow}>
              <TextInput
                value={clientSecret}
                onChangeText={(t) => { setClientSecret(t); markDirty(); }}
                editable={editable}
                placeholder="Enter client secret"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!revealSecret}
                style={[styles.fieldInput, { color: Colors.text, flex: 1 }]}
                testID="elife-client-secret"
              />
              <TouchableOpacity onPress={() => setRevealSecret((v) => !v)} hitSlop={8} style={styles.secretToggle}>
                {revealSecret ? (
                  <EyeOff color={Colors.textSecondary} size={18} />
                ) : (
                  <Eye color={Colors.textSecondary} size={18} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.field, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Webhook URL (optional)</Text>
            <TextInput
              value={webhookUrl}
              onChangeText={(t) => { setWebhookUrl(t); markDirty(); }}
              editable={editable}
              placeholder="https://your-domain.com/elife/webhook"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.fieldInput, { color: Colors.text }]}
              testID="elife-webhook-url"
            />
          </View>

          {/* ACTIONS */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              onPress={onTest}
              disabled={testing}
              style={[
                styles.actionBtn,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border, opacity: testing ? 0.6 : 1 },
              ]}
              testID="elife-test"
            >
              {testing ? (
                <ActivityIndicator color={Colors.accent} size="small" />
              ) : (
                <RefreshCw color={Colors.accent} size={18} />
              )}
              <Text style={[styles.actionTxt, { color: Colors.text }]}>Test connection</Text>
            </TouchableOpacity>

            {editable ? (
              <TouchableOpacity
                onPress={onSave}
                disabled={saving || !dirty}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: dirty ? Colors.accent : Colors.gray[100],
                    borderColor: dirty ? Colors.accent : Colors.border,
                    opacity: saving ? 0.6 : 1,
                  },
                ]}
                testID="elife-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                {saving ? (
                  <ActivityIndicator color={dirty ? "#000000" : Colors.accent} size="small" />
                ) : (
                  <Save color={dirty ? "#000000" : Colors.textSecondary} size={18} />
                )}
                <Text style={[styles.actionTxt, { color: dirty ? "#000000" : Colors.textSecondary }]}>
                  {dirty ? "Save changes" : "Saved"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* ACTIVITY LOG */}
          <View style={styles.activityHeader}>
            <View style={styles.headerTitleRow}>
              <Activity color={Colors.accent} size={16} />
              <Text style={[styles.sectionLabelInline, { color: Colors.text }]}>ACTIVITY</Text>
            </View>
            {config.activity.length > 0 && editable ? (
              <TouchableOpacity onPress={onClearActivity} hitSlop={8} style={styles.clearBtn} testID="elife-clear-activity">
                <Trash2 color={Colors.error} size={14} />
                <Text style={[styles.clearTxt, { color: Colors.error }]}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {config.activity.length === 0 ? (
            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Text style={[styles.cardHint, { color: Colors.textSecondary }]}>
                No activity yet. Run a connection test to record events here.
              </Text>
            </View>
          ) : (
            config.activity.map((evt) => (
              <View
                key={evt.id}
                style={[styles.eventRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
              >
                <View
                  style={[
                    styles.eventDot,
                    { backgroundColor: (evt.ok ? Colors.success : Colors.error) + "22" },
                  ]}
                >
                  {evt.ok ? (
                    <CheckCircle2 color={Colors.success} size={14} />
                  ) : (
                    <XCircle color={Colors.error} size={14} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventMsg, { color: Colors.text }]} numberOfLines={2}>
                    {evt.message}
                  </Text>
                  <Text style={[styles.eventMeta, { color: Colors.textSecondary }]}>
                    {evt.kind.toUpperCase()}
                    {evt.status ? ` · HTTP ${evt.status}` : ""} · {timeAgo(evt.at)}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* DOCS LINK */}
          <TouchableOpacity
            onPress={openDocs}
            style={[styles.linkRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            testID="elife-link-row"
          >
            <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
              <ShieldCheck color={Colors.accent} size={16} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: Colors.text }]}>API Documentation</Text>
              <Text style={[styles.linkUrl, { color: Colors.textSecondary }]} numberOfLines={1}>
                app.theneo.io/elifetransfer
              </Text>
            </View>
            <ExternalLink color={Colors.textSecondary} size={18} />
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  statusCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  statusLabel: { fontSize: 17, fontWeight: "800" as const },
  statusSub: { fontSize: 12, marginTop: 3 },
  statusErr: { fontSize: 12, marginTop: 4, fontWeight: "600" as const },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  toggleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700" as const },
  cardHint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  sectionLabelInline: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.8 },
  segment: { flexDirection: "row" as const, gap: 8, marginBottom: 16 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  segmentTxt: { fontSize: 14, fontWeight: "700" as const },
  field: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  fieldLabel: { fontSize: 11, fontWeight: "600" as const, marginBottom: 2 },
  fieldInput: {
    fontSize: 15,
    paddingVertical: Platform.OS === "ios" ? 6 : 2,
  },
  secretRow: { flexDirection: "row" as const, alignItems: "center" as const },
  secretToggle: { padding: 6 },
  actionsRow: { flexDirection: "row" as const, gap: 10, marginTop: 6, marginBottom: 20 },
  actionBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionTxt: { fontSize: 14, fontWeight: "800" as const },
  activityHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 10,
  },
  clearBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  clearTxt: { fontSize: 12, fontWeight: "700" as const },
  eventRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  eventDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  eventMsg: { fontSize: 13, fontWeight: "600" as const },
  eventMeta: { fontSize: 11, marginTop: 2 },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  linkRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
  },
  linkTitle: { fontSize: 15, fontWeight: "700" as const },
  linkUrl: { fontSize: 12, marginTop: 2 },
});
