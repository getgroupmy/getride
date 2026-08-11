import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  Sparkles,
  Save,
  Plus,
  Trash2,
  Clock,
  ListChecks,
  CircleCheck,
  CircleX,
  Power,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  loadFareAIConfig,
  saveFareAIConfig,
  subscribeFareAIConfig,
  providerLabel,
  makeFareAIKey,
  retryPolicyMs,
  DEFAULT_FARE_AI_CONFIG,
  FARE_AI_PROVIDERS,
  type FareAIConfig,
  type FareAIProvider,
  type FareAIKey,
  type RetryUnit,
} from "@/utils/fareProviderStore";
import {
  fetchKeyStates,
  isCoolingDown,
  type FareAIKeyState,
} from "@/utils/fareAiStats";

interface ProviderMeta {
  id: FareAIProvider;
  label: string;
  description: string;
  keyHint: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gemini",
    label: "Gemini (Google)",
    description: "Google Generative Language API",
    keyHint: "AIza... key. Leave list empty to use the app's built-in key",
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    description: "xAI Grok chat completions",
    keyHint: "xai-... API key from console.x.ai",
  },
  {
    id: "chatgpt",
    label: "ChatGPT (OpenAI)",
    description: "OpenAI chat completions",
    keyHint: "sk-... API key from platform.openai.com",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Groq fast LPU chat completions",
    keyHint: "gsk_... API key from console.groq.com",
  },
  {
    id: "claude",
    label: "Claude (Anthropic)",
    description: "Anthropic Claude messages API",
    keyHint: "sk-ant-... API key from console.anthropic.com",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "Perplexity Sonar chat completions",
    keyHint: "pplx-... API key from perplexity.ai",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    description: "Mistral chat completions",
    keyHint: "API key from console.mistral.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek chat completions",
    keyHint: "sk-... API key from platform.deepseek.com",
  },
  {
    id: "cohere",
    label: "Cohere",
    description: "Cohere Command (OpenAI-compatible)",
    keyHint: "API key from dashboard.cohere.com",
  },
  {
    id: "together",
    label: "Together AI",
    description: "Together AI chat completions",
    keyHint: "API key from api.together.xyz",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter unified chat completions",
    keyHint: "sk-or-... API key from openrouter.ai",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    description: "Fireworks chat completions",
    keyHint: "fw_... API key from fireworks.ai",
  },
];

const RETRY_UNITS: { id: RetryUnit; label: string }[] = [
  { id: "hour", label: "Hours" },
  { id: "day", label: "Days" },
  { id: "month", label: "Months" },
];

function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "(empty)";
  if (k.length <= 8) return `${k.slice(0, 2)}…`;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  let body: string;
  if (m < 1) body = "just now";
  else if (m < 60) body = `${m}m`;
  else if (h < 24) body = `${h}h`;
  else body = `${d}d`;
  if (body === "just now") return body;
  return diff >= 0 ? `in ${body}` : `${body} ago`;
}

export default function AdminSettingsFareAIScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-fare-ai");

  const [config, setConfig] = useState<FareAIConfig>(DEFAULT_FARE_AI_CONFIG);
  const [states, setStates] = useState<Record<string, FareAIKeyState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadFareAIConfig(), fetchKeyStates()])
      .then(([c, s]) => {
        if (!mounted) return;
        setConfig(c);
        setStates(s);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeFareAIConfig((c) => {
      setDirty((isDirty) => {
        if (!isDirty) setConfig(c);
        return isDirty;
      });
    });
    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchKeyStates().then(setStates).catch(() => {});
    }, [])
  );

  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await fetchKeyStates();
      setStates(s);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<FareAIConfig>) => {
      if (!editable) return;
      setConfig((prev) => ({ ...prev, ...patch }));
      setDirty(true);
    },
    [editable]
  );

  const activeMeta = useMemo(
    () => PROVIDERS.find((p) => p.id === config.provider) ?? PROVIDERS[0],
    [config.provider]
  );

  const activeKeys = config.keys[config.provider] ?? [];

  const setActiveKeys = useCallback(
    (next: FareAIKey[]) => {
      update({ keys: { ...config.keys, [config.provider]: next } });
    },
    [config.keys, config.provider, update]
  );

  const addKey = useCallback(() => {
    const n = activeKeys.length + 1;
    setActiveKeys([...activeKeys, makeFareAIKey({ label: `Key ${n}` })]);
  }, [activeKeys, setActiveKeys]);

  const patchKey = useCallback(
    (id: string, patch: Partial<FareAIKey>) => {
      setActiveKeys(activeKeys.map((k) => (k.id === id ? { ...k, ...patch } : k)));
    },
    [activeKeys, setActiveKeys]
  );

  const removeKey = useCallback(
    (id: string) => {
      setActiveKeys(activeKeys.filter((k) => k.id !== id));
    },
    [activeKeys, setActiveKeys]
  );

  const onSave = useCallback(async () => {
    if (!editable) return;
    setSaving(true);
    const result = await saveFareAIConfig(config);
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      Alert.alert("Saved", `Fare calculation now uses ${providerLabel(config.provider)} for all users.`);
    } else if (result.skipped) {
      setDirty(false);
      Alert.alert("Saved locally", "Supabase isn't configured, so this applies to this device only.");
    } else {
      Alert.alert("Couldn't save to Supabase", result.error);
    }
  }, [config, editable]);

  const retryLabel = useMemo(() => {
    const unit = RETRY_UNITS.find((u) => u.id === config.retryAfterUnit)?.label ?? "Hours";
    return `${config.retryAfterValue} ${unit.toLowerCase()}`;
  }, [config.retryAfterValue, config.retryAfterUnit]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="fare-ai-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <BrainCircuit color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Fare AI Provider</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Applies globally to all users
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/admin-settings-fare-ai-logs")}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="fare-ai-logs"
          accessibilityRole="button"
          accessibilityLabel="Fare AI logs"
        >
          <ListChecks color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refreshStats} tintColor={Colors.accent} />
            }
          >
            <Text
              style={[
                styles.note,
                { color: Colors.textSecondary, backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              Choose which AI estimates trip distance & traffic-aware time for fare calculation. Add multiple
              keys per provider — if one fails it&apos;s skipped for the retry window below and the next key is
              tried automatically. Pull down to refresh usage stats.
            </Text>

            {/* Service on/off */}
            <View
              style={[
                styles.serviceCard,
                {
                  backgroundColor: Colors.gray[100],
                  borderColor: config.serviceEnabled ? Colors.accent : Colors.border,
                },
              ]}
            >
              <View style={[styles.providerIcon, { backgroundColor: Colors.accent + "20" }]}>
                <Power color={config.serviceEnabled ? Colors.accent : Colors.textSecondary} size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.providerLabel, { color: Colors.text }]}>AI fare service</Text>
                <Text style={[styles.providerDesc, { color: Colors.textSecondary }]}>
                  {config.serviceEnabled
                    ? "AI estimates trip distance & time for fares"
                    : "Turned off — fares use the routing engine fallback"}
                </Text>
              </View>
              <Switch
                value={config.serviceEnabled}
                onValueChange={(v) => update({ serviceEnabled: v })}
                disabled={!editable}
                trackColor={{ true: Colors.accent, false: Colors.border }}
                thumbColor="#fff"
                testID="fare-ai-service-toggle"
                accessibilityLabel="AI fare service"
              />
            </View>

            {/* Provider selector */}
            <Text style={[styles.sectionTitle, { color: Colors.text, opacity: config.serviceEnabled ? 1 : 0.5 }]}>Provider</Text>
            {PROVIDERS.map((p) => {
              const selected = config.provider === p.id;
              const keyCount = (config.keys[p.id] ?? []).filter((k) => k.enabled && k.key.trim()).length;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => update({ provider: p.id })}
                  disabled={!editable}
                  activeOpacity={0.85}
                  style={[
                    styles.providerRow,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: selected ? Colors.accent : Colors.border,
                      borderWidth: selected ? 2 : 1,
                      opacity: editable ? 1 : 0.6,
                    },
                  ]}
                  testID={`fare-ai-provider-${p.id}`}
                  accessibilityRole="button"
                >
                  <View style={[styles.providerIcon, { backgroundColor: Colors.accent + "20" }]}>
                    <Sparkles color={Colors.accent} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.providerLabel, { color: Colors.text }]}>{p.label}</Text>
                    <Text style={[styles.providerDesc, { color: Colors.textSecondary }]}>
                      {keyCount} active key{keyCount === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: selected ? Colors.accent : Colors.border,
                        backgroundColor: selected ? Colors.accent : "transparent",
                      },
                    ]}
                  >
                    {selected ? <Check color="#000000" size={14} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Retry policy */}
            <View style={styles.sectionTitleRow}>
              <Clock color={Colors.text} size={15} />
              <Text style={[styles.sectionTitle, { color: Colors.text, marginBottom: 0 }]}>
                Retry failed keys after
              </Text>
            </View>
            <Text style={[styles.hint, { color: Colors.textSecondary, marginTop: 0, marginBottom: 10 }]}>
              A key that fails is paused for {retryLabel}, then automatically retried.
            </Text>
            <View style={styles.retryRow}>
              <TextInput
                value={String(config.retryAfterValue)}
                onChangeText={(v) => {
                  const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
                  update({ retryAfterValue: Number.isFinite(n) && n > 0 ? n : 1 });
                }}
                keyboardType="number-pad"
                editable={editable}
                style={[
                  styles.retryInput,
                  { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] },
                ]}
                testID="fare-ai-retry-value"
                accessibilityLabel="Retry failed keys after"
              />
              <View style={styles.unitRow}>
                {RETRY_UNITS.map((u) => {
                  const selected = config.retryAfterUnit === u.id;
                  return (
                    <TouchableOpacity
                      key={u.id}
                      onPress={() => update({ retryAfterUnit: u.id })}
                      disabled={!editable}
                      style={[
                        styles.unitChip,
                        {
                          backgroundColor: selected ? Colors.accent : Colors.gray[100],
                          borderColor: selected ? Colors.accent : Colors.border,
                        },
                      ]}
                      testID={`fare-ai-retry-unit-${u.id}`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.unitChipTxt, { color: selected ? "#000000" : Colors.text }]}>
                        {u.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Keys for the active provider */}
            <View style={[styles.sectionTitleRow, { marginTop: 22 }]}>
              <Text style={[styles.sectionTitle, { color: Colors.text, marginBottom: 0 }]}>
                {activeMeta.label} keys
              </Text>
              {editable ? (
                <TouchableOpacity onPress={addKey} style={styles.addBtn} testID="fare-ai-add-key" accessibilityRole="button">
                  <Plus color={Colors.accent} size={16} />
                  <Text style={[styles.addBtnTxt, { color: Colors.accent }]}>Add key</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={[styles.inputLabel, { color: Colors.textSecondary, marginBottom: 8 }]}>Model</Text>
            <TextInput
              value={config.models[config.provider]}
              onChangeText={(v) => update({ models: { ...config.models, [config.provider]: v } })}
              placeholder="model id"
              placeholderTextColor={Colors.textSecondary}
              editable={editable}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100], marginBottom: 14 },
              ]}
              testID="fare-ai-model"
              accessibilityLabel="Model"
            />

            {activeKeys.length === 0 ? (
              <View style={[styles.emptyKeys, { borderColor: Colors.border }]}>
                <Text style={[styles.hint, { color: Colors.textSecondary, marginTop: 0 }]}>
                  No keys yet. {config.provider === "gemini" ? "The app's built-in Gemini key will be used as a fallback. " : ""}
                  Tap &quot;Add key&quot; to add one.
                </Text>
              </View>
            ) : (
              activeKeys.map((k, idx) => {
                const st = states[k.id];
                const cooling = isCoolingDown(st);
                return (
                  <View
                    key={k.id}
                    style={[styles.keyCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                  >
                    <View style={styles.keyHeader}>
                      <TextInput
                        value={k.label}
                        onChangeText={(v) => patchKey(k.id, { label: v })}
                        placeholder={`Key ${idx + 1}`}
                        placeholderTextColor={Colors.textSecondary}
                        editable={editable}
                        style={[styles.keyLabelInput, { color: Colors.text }]}
                        testID={`fare-ai-key-label-${idx}`}
                        accessibilityLabel="Key label"
                      />
                      <Switch
                        value={k.enabled}
                        onValueChange={(v) => patchKey(k.id, { enabled: v })}
                        disabled={!editable}
                        trackColor={{ true: Colors.accent, false: Colors.border }}
                        thumbColor="#fff"
                        accessibilityLabel="Key enabled"
                      />
                      {editable ? (
                        <TouchableOpacity
                          onPress={() => removeKey(k.id)}
                          style={styles.deleteBtn}
                          testID={`fare-ai-key-delete-${idx}`}
                          accessibilityRole="button"
                          accessibilityLabel="Delete fare ai key"
                        >
                          <Trash2 color={Colors.danger ?? "#e5484d"} size={18} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <TextInput
                      value={k.key}
                      onChangeText={(v) => patchKey(k.id, { key: v })}
                      placeholder={activeMeta.keyHint}
                      placeholderTextColor={Colors.textSecondary}
                      editable={editable}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      style={[
                        styles.input,
                        { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.background },
                      ]}
                      testID={`fare-ai-key-value-${idx}`}
                      accessibilityLabel="API key"
                    />

                    {/* Stats */}
                    <View style={styles.statsRow}>
                      <View style={styles.statPill}>
                        <Text style={[styles.statNum, { color: Colors.text }]}>{st?.usageCount ?? 0}</Text>
                        <Text style={[styles.statLbl, { color: Colors.textSecondary }]}>used</Text>
                      </View>
                      <View style={styles.statPill}>
                        <CircleCheck color="#1f9d55" size={13} />
                        <Text style={[styles.statNum, { color: "#1f9d55" }]}>{st?.passCount ?? 0}</Text>
                        <Text style={[styles.statLbl, { color: Colors.textSecondary }]}>passed</Text>
                      </View>
                      <View style={styles.statPill}>
                        <CircleX color="#e5484d" size={13} />
                        <Text style={[styles.statNum, { color: "#e5484d" }]}>{st?.failCount ?? 0}</Text>
                        <Text style={[styles.statLbl, { color: Colors.textSecondary }]}>failed</Text>
                      </View>
                    </View>

                    <Text style={[styles.keyMeta, { color: Colors.textSecondary }]}>
                      {maskKey(k.key)} · last used {formatRelative(st?.lastUsedAt ?? null)}
                    </Text>

                    {cooling ? (
                      <View style={[styles.coolBadge, { backgroundColor: "#e5484d20" }]}>
                        <Clock color="#e5484d" size={12} />
                        <Text style={[styles.coolTxt, { color: "#e5484d" }]}>
                          Cooling down — retries {formatRelative(st?.disabledUntil ?? null)}
                        </Text>
                      </View>
                    ) : st?.lastError ? (
                      <Text style={[styles.errTxt, { color: "#e5484d" }]} numberOfLines={2}>
                        Last error: {st.lastError}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}

            {editable ? (
              <TouchableOpacity
                onPress={onSave}
                disabled={saving || !dirty}
                style={[
                  styles.saveBtn,
                  { backgroundColor: dirty ? Colors.accent : Colors.gray[300] ?? Colors.border, opacity: saving ? 0.7 : 1 },
                ]}
                testID="fare-ai-save"
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                {saving ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <>
                    <Save color="#000000" size={18} />
                    <Text style={styles.saveTxt}>{dirty ? "Save changes" : "Saved"}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <Text style={[styles.hint, { color: Colors.textSecondary, marginTop: 16 }]}>
                You have read-only access to this setting.
              </Text>
            )}

            <TouchableOpacity
              onPress={() => router.push("/admin-settings-fare-ai-logs")}
              style={[styles.logsBtn, { borderColor: Colors.border }]}
              testID="fare-ai-open-logs"
              accessibilityRole="button"
            >
              <ListChecks color={Colors.accent} size={18} />
              <Text style={[styles.logsTxt, { color: Colors.text }]}>View response log</Text>
            </TouchableOpacity>

            <View style={{ height: 220 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
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
  note: {
    fontSize: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800" as const,
    marginBottom: 10,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  sectionTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
    marginTop: 22,
    marginBottom: 6,
  },
  providerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  serviceCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    marginBottom: 20,
  },
  providerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  providerLabel: { fontSize: 15, fontWeight: "700" as const },
  providerDesc: { fontSize: 12, marginTop: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  retryRow: { gap: 10 },
  retryInput: {
    fontSize: 16,
    fontWeight: "700" as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    width: 90,
  },
  unitRow: { flexDirection: "row" as const, gap: 8 },
  unitChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  unitChipTxt: { fontSize: 13, fontWeight: "700" as const },
  addBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  addBtnTxt: { fontSize: 13, fontWeight: "700" as const },
  inputLabel: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  input: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  emptyKeys: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed" as const,
  },
  keyCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    gap: 10,
  },
  keyHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  keyLabelInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700" as const,
    paddingVertical: 2,
  },
  deleteBtn: { padding: 4 },
  statsRow: { flexDirection: "row" as const, gap: 10 },
  statPill: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  statNum: { fontSize: 15, fontWeight: "800" as const },
  statLbl: { fontSize: 12 },
  keyMeta: { fontSize: 11 },
  coolBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: "flex-start" as const,
  },
  coolTxt: { fontSize: 11, fontWeight: "700" as const },
  errTxt: { fontSize: 11 },
  hint: { fontSize: 11, marginTop: 6, lineHeight: 16 },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    padding: 15,
    borderRadius: 12,
    marginTop: 22,
  },
  saveTxt: { color: "#000000", fontSize: 15, fontWeight: "800" as const },
  logsBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  logsTxt: { fontSize: 14, fontWeight: "700" as const },
});
