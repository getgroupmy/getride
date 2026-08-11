import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, ListChecks, CircleCheck, CircleX, Trash2, ChevronDown, ChevronRight } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  fetchRecentResponses,
  clearResponses,
  type FareAIResponseRow,
} from "@/utils/fareAiStats";
import { providerLabel, type FareAIProvider } from "@/utils/fareProviderStore";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function providerName(p: string): string {
  if (p === "gemini" || p === "grok" || p === "chatgpt" || p === "groq") {
    return providerLabel(p as FareAIProvider);
  }
  return p || "—";
}

export default function AdminSettingsFareAILogsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { canEdit } = useAdminAccess();
  const editable = canEdit("admin-settings-fare-ai");

  const [rows, setRows] = useState<FareAIResponseRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const load = useCallback(async () => {
    const data = await fetchRecentResponses(150);
    setRows(data);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onClear = useCallback(() => {
    if (!editable) return;
    Alert.alert("Clear response log?", "This permanently deletes all recorded responses.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          const ok = await clearResponses();
          if (ok) setRows([]);
          else Alert.alert("Couldn't clear", "The response log could not be cleared.");
        },
      },
    ]);
  }, [editable]);

  const summary = useMemo(() => {
    const total = rows.length;
    const passed = rows.filter((r) => r.success).length;
    return { total, passed, failed: total - passed };
  }, [rows]);

  const renderItem = useCallback(
    ({ item }: { item: FareAIResponseRow }) => (
      <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <View style={styles.cardHead}>
          {item.success ? (
            <CircleCheck color={Colors.successText} size={16} />
          ) : (
            <CircleX color={Colors.errorText} size={16} />
          )}
          <Text style={[styles.provider, { color: Colors.text }]} numberOfLines={1}>
            {providerName(item.provider)}
            {item.keyLabel ? ` · ${item.keyLabel}` : ""}
          </Text>
          <Text style={[styles.time, { color: Colors.textSecondary }]}>{formatTime(item.createdAt)}</Text>
        </View>

        {item.success ? (
          <Text style={[styles.result, { color: Colors.text }]}>
            {item.distanceKm ?? "?"} km · {item.durationMin ?? "?"} min
            {item.summary ? ` — ${item.summary}` : ""}
          </Text>
        ) : (
          <Text style={[styles.errText, { color: Colors.errorText }]} numberOfLines={3}>
            {item.error ?? "Failed"}
          </Text>
        )}

        <View style={styles.metaRow}>
          {item.model ? (
            <Text style={[styles.meta, { color: Colors.textSecondary }]}>{item.model}</Text>
          ) : null}
          {item.httpStatus != null ? (
            <Text style={[styles.meta, { color: Colors.textSecondary }]}>HTTP {item.httpStatus}</Text>
          ) : null}
          {item.latencyMs != null ? (
            <Text style={[styles.meta, { color: Colors.textSecondary }]}>{item.latencyMs}ms</Text>
          ) : null}
        </View>

        {(item.tollCount != null && item.tollCount > 0) ||
        (item.tollTotal != null && item.tollTotal > 0) ||
        (item.tolls && item.tolls.length > 0) ? (
          <View style={[styles.tollBox, { borderColor: Colors.border }]}>
            <Text style={[styles.tollHead, { color: Colors.text }]}>
              Tolls: {item.tollCount ?? item.tolls?.length ?? 0} booth
              {(item.tollCount ?? item.tolls?.length ?? 0) === 1 ? "" : "s"}
              {item.tollTotal != null ? ` · ${item.tollTotal} total` : ""}
            </Text>
            {item.tolls?.map((t, i) => (
              <Text key={`${item.id}-toll-${i}`} style={[styles.tollRow, { color: Colors.textSecondary }]}>
                • {t.name ?? "Toll booth"} — {t.charge}
              </Text>
            ))}
          </View>
        ) : null}

        {item.originLat != null && item.destLat != null ? (
          <Text style={[styles.route, { color: Colors.textSecondary }]} numberOfLines={1}>
            {item.originLat.toFixed(4)},{item.originLng?.toFixed(4)} → {item.destLat.toFixed(4)},
            {item.destLng?.toFixed(4)}
          </Text>
        ) : null}

        {item.rawResponse ? (
          <View>
            <TouchableOpacity
              onPress={() => toggleExpanded(item.id)}
              style={styles.rawToggle}
              testID={`fare-ai-log-raw-${item.id}`}
              accessibilityRole="button"
            >
              {expanded[item.id] ? (
                <ChevronDown color={Colors.accentText} size={14} />
              ) : (
                <ChevronRight color={Colors.accentText} size={14} />
              )}
              <Text style={[styles.rawToggleText, { color: Colors.accentText }]}>
                {expanded[item.id] ? "Hide raw response" : "Show raw response"}
              </Text>
            </TouchableOpacity>
            {expanded[item.id] ? (
              <View style={[styles.rawBox, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                <Text style={[styles.rawText, { color: Colors.text }]} selectable>
                  {item.rawResponse}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    ),
    [Colors, expanded, toggleExpanded]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="fare-ai-logs-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <ListChecks color={Colors.accentText} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Response Log</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {summary.total} records · {summary.passed} passed · {summary.failed} failed
          </Text>
        </View>
        {editable ? (
          <TouchableOpacity
            onPress={onClear}
            style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
            testID="fare-ai-logs-clear"
            accessibilityRole="button"
            accessibilityLabel="Clear"
          >
            <Trash2 color={Colors.danger ?? "#e5484d"} size={20} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accentText} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <ListChecks color={Colors.textSecondary} size={40} />
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>No responses yet</Text>
              <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                AI fare estimates will appear here as soon as rides are calculated.
              </Text>
            </View>
          }
        />
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
  list: { padding: 16, gap: 10 },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  cardHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  provider: { flex: 1, fontSize: 14, fontWeight: "700" as const },
  time: { fontSize: 11 },
  result: { fontSize: 14, fontWeight: "600" as const, lineHeight: 19 },
  errText: { fontSize: 12, lineHeight: 17 },
  metaRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
  meta: { fontSize: 11 },
  route: { fontSize: 11 },
  tollBox: { borderTopWidth: 1, paddingTop: 8, gap: 3 },
  tollHead: { fontSize: 12, fontWeight: "700" as const },
  tollRow: { fontSize: 11, lineHeight: 16 },
  rawToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingVertical: 4 },
  rawToggleText: { fontSize: 12, fontWeight: "600" as const },
  rawBox: { marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1 },
  rawText: { fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  empty: { alignItems: "center" as const, paddingTop: 80, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "700" as const },
  emptyText: { fontSize: 13, textAlign: "center" as const, lineHeight: 19 },
});
