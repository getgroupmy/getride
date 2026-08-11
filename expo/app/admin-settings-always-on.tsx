import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Sun, Plus, Trash2, MonitorSmartphone, Save } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import {
  ALWAYS_ON_PAGE_CATALOG,
  DEFAULT_ALWAYS_ON_ROUTES,
  fetchAlwaysOnConfig,
  saveAlwaysOnConfig,
  normalizeRoute,
  type AlwaysOnPageOption,
  type AlwaysOnSource,
} from "@/utils/alwaysOnStore";
import { isKeepAwakeAvailable } from "@/utils/keepAwake";

interface DisplayRow extends AlwaysOnPageOption {
  /** True for routes added by the admin that aren't in the built-in catalog. */
  custom: boolean;
}

export default function AdminSettingsAlwaysOnScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [savedEnabled, setSavedEnabled] = useState<string[]>([]);
  const [customRoutes, setCustomRoutes] = useState<string[]>([]);
  const [newRoute, setNewRoute] = useState<string>("");
  const [source, setSource] = useState<AlwaysOnSource>("default");

  const nativeAvailable = useMemo(() => isKeepAwakeAvailable(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await fetchAlwaysOnConfig();
      if (cancelled) return;
      setEnabled(config.routes);
      setSavedEnabled(config.routes);
      // Any enabled route that isn't in the catalog becomes a custom row.
      const catalogRoutes = new Set(ALWAYS_ON_PAGE_CATALOG.map((p) => p.route));
      setCustomRoutes(config.routes.filter((r) => !catalogRoutes.has(r)));
      setSource(config.source);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<DisplayRow[]>(() => {
    const catalog: DisplayRow[] = ALWAYS_ON_PAGE_CATALOG.map((p) => ({ ...p, custom: false }));
    const custom: DisplayRow[] = customRoutes.map((route) => ({
      route,
      label: route,
      description: "Custom page added by an admin",
      custom: true,
    }));
    return [...catalog, ...custom];
  }, [customRoutes]);

  const isOn = useCallback((route: string) => enabled.includes(route), [enabled]);

  const dirty = useMemo(() => {
    if (enabled.length !== savedEnabled.length) return true;
    const a = [...enabled].sort();
    const b = [...savedEnabled].sort();
    return a.some((r, i) => r !== b[i]);
  }, [enabled, savedEnabled]);

  const toggle = (route: string, value: boolean) => {
    if (!guard()) return;
    setEnabled((prev) => {
      if (value) return prev.includes(route) ? prev : [...prev, route];
      return prev.filter((r) => r !== route);
    });
  };

  const addCustom = () => {
    if (!guard()) return;
    const route = normalizeRoute(newRoute);
    if (!route) {
      Alert.alert("Invalid page", "Enter a page route, e.g. “navigation” or “ride-running”.");
      return;
    }
    const catalogRoutes = new Set(ALWAYS_ON_PAGE_CATALOG.map((p) => p.route));
    if (catalogRoutes.has(route)) {
      // Already a known page — just turn it on and clear the field.
      setEnabled((prev) => (prev.includes(route) ? prev : [...prev, route]));
      setNewRoute("");
      return;
    }
    setCustomRoutes((prev) => (prev.includes(route) ? prev : [...prev, route]));
    setEnabled((prev) => (prev.includes(route) ? prev : [...prev, route]));
    setNewRoute("");
  };

  const removeCustom = (route: string) => {
    if (!guard()) return;
    setCustomRoutes((prev) => prev.filter((r) => r !== route));
    setEnabled((prev) => prev.filter((r) => r !== route));
  };

  const restoreDefaults = () => {
    if (!guard()) return;
    setEnabled([...DEFAULT_ALWAYS_ON_ROUTES]);
    const catalogRoutes = new Set(ALWAYS_ON_PAGE_CATALOG.map((p) => p.route));
    setCustomRoutes(DEFAULT_ALWAYS_ON_ROUTES.filter((r) => !catalogRoutes.has(r)));
  };

  const onSave = async () => {
    if (!guard()) return;
    setSaving(true);
    const result = await saveAlwaysOnConfig(enabled);
    setSaving(false);
    if (!result.ok) {
      Alert.alert("Save failed", result.error ?? "Please try again.");
      return;
    }
    const routes = result.config?.routes ?? enabled;
    setSavedEnabled(routes);
    setEnabled(routes);
    setSource(result.config?.source ?? "local");
    const msg =
      result.config?.source === "local"
        ? "Saved on this device. It will sync to Supabase when the database is reachable."
        : "Saved. Every device applies it within a few seconds.";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.alert(msg);
    } else {
      Alert.alert("Always ON updated", msg);
    }
  };

  const warning = Colors.warning ?? "#F59E0B";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="always-on-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Sun color={warning} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Always ON</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Keep the screen awake on selected pages
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.noteBox, { backgroundColor: warning + "12", borderColor: warning + "30" }]}>
            <MonitorSmartphone color={warning} size={18} />
            <Text style={[styles.noteText, { color: Colors.textSecondary }]}>
              On the pages you switch on, the device screen will never dim, lock or sleep while that
              page is open. The screen returns to normal auto-sleep as soon as the user leaves.
            </Text>
          </View>

          {!nativeAvailable && (
            <View style={[styles.noteBox, { backgroundColor: Colors.error + "12", borderColor: Colors.error + "30" }]}>
              <Text style={[styles.noteText, { color: Colors.error }]}>
                This build can’t hold the screen awake yet — the keep-awake module isn’t linked.
                A new native build is required for these settings to take effect on devices.
              </Text>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: Colors.text }]}>Pages</Text>
          <View style={styles.list}>
            {rows.map((row) => {
              const on = isOn(row.route);
              return (
                <View
                  key={row.route}
                  style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                  testID={`always-on-row-${row.route}`}
                >
                  <View style={[styles.rowIcon, { backgroundColor: (on ? warning : Colors.textSecondary) + "20" }]}>
                    <Sun color={on ? warning : Colors.textSecondary} size={20} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowLabel, { color: Colors.text }]}>{row.label}</Text>
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{row.description}</Text>
                    <View style={styles.rowMeta}>
                      <View style={[styles.routePill, { backgroundColor: Colors.accent + "15" }]}>
                        <Text style={[styles.routePillText, { color: Colors.accent }]}>/{row.route}</Text>
                      </View>
                      {row.custom && (
                        <TouchableOpacity
                          onPress={() => removeCustom(row.route)}
                          style={styles.removeBtn}
                          testID={`always-on-remove-${row.route}`}
                          hitSlop={8}
                        >
                          <Trash2 color={Colors.error} size={14} />
                          <Text style={[styles.removeText, { color: Colors.error }]}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(v) => toggle(row.route, v)}
                    disabled={!editable}
                    trackColor={{ false: Colors.gray[300], true: warning }}
                    thumbColor="#fff"
                    testID={`always-on-switch-${row.route}`}
                  />
                </View>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 22 }]}>Add a page</Text>
          <View style={[styles.addRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <TextInput
              value={newRoute}
              onChangeText={setNewRoute}
              placeholder="Page route, e.g. navigation"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              editable={editable}
              style={[styles.input, { color: Colors.text }]}
              testID="always-on-new-route"
              onSubmitEditing={addCustom}
            />
            <TouchableOpacity
              onPress={addCustom}
              style={[styles.addBtn, { backgroundColor: Colors.accent }]}
              testID="always-on-add"
            >
              <Plus color="#fff" size={18} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, { color: Colors.textSecondary }]}>
            Enter the page name from its URL (the part after the slash). Adding a page turns it on.
          </Text>

          <TouchableOpacity onPress={restoreDefaults} style={styles.restoreBtn} testID="always-on-restore">
            <Text style={[styles.restoreText, { color: Colors.accent }]}>Restore defaults</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSave}
            disabled={saving || !dirty || !editable}
            style={[
              styles.saveBtn,
              { backgroundColor: dirty && editable ? Colors.accent : Colors.gray[300] },
            ]}
            testID="always-on-save"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save color="#fff" size={18} />
                <Text style={styles.saveBtnText}>{dirty ? "Save changes" : "Saved"}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.sourceText, { color: Colors.textSecondary }]}>
            {source === "supabase"
              ? "Synced with Supabase — applies to every device."
              : source === "local"
              ? "Saved on this device only — will sync when the database is reachable."
              : "Using built-in defaults — save to apply your own set."}
          </Text>

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
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loading: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 10 },
  list: { gap: 10 },
  noteBox: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  noteText: { fontSize: 12, lineHeight: 17, flex: 1 },
  row: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  rowMeta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    marginTop: 6,
  },
  routePill: {
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  routePillText: { fontSize: 11, fontWeight: "700" as const },
  removeBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  removeText: { fontSize: 11, fontWeight: "700" as const },
  addRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 12,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 8 },
  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
  },
  addBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" as const },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  restoreBtn: { alignSelf: "flex-start" as const, marginTop: 16, paddingVertical: 6 },
  restoreText: { fontSize: 14, fontWeight: "700" as const },
  saveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 8,
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" as const },
  sourceText: { fontSize: 12, marginTop: 12, textAlign: "center" as const, lineHeight: 17 },
});
