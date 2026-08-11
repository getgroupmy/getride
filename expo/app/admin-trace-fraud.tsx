import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ChevronLeft,
  Search,
  RefreshCcw,
  Download,
  ShieldAlert,
  Smartphone,
  Users,
  Globe,
  MapPinOff,
  Gauge,
  Repeat,
  XCircle,
  Gift,
} from "lucide-react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  runFraudScan,
  type FraudFinding,
  type FraudSeverity,
  type FraudCategory,
  type SessionSignal,
  type RideSignal,
  type WalletTxSignal,
  type TransferSignal,
} from "@/utils/fraudDetection";

const CATEGORY_META: Record<
  FraudCategory,
  { label: string; icon: React.ComponentType<{ color?: string; size?: number }> }
> = {
  multi_device_account: { label: "Multi-device account", icon: Smartphone },
  shared_device: { label: "Shared device", icon: Users },
  ip_cluster: { label: "IP cluster", icon: Globe },
  location_mismatch: { label: "Fake pickup/drop-off", icon: MapPinOff },
  implausible_trip: { label: "Implausible trip", icon: Gauge },
  collusion_pair: { label: "Fake bookings / collusion", icon: Repeat },
  excessive_cancellations: { label: "Excessive cancellations", icon: XCircle },
  promotion_abuse: { label: "Promotion / incentive abuse", icon: Gift },
};

const SEVERITY_FILTERS: readonly ("all" | FraudSeverity)[] = ["all", "high", "medium", "low"];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((c) => csvEscape(String(c))).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}

async function exportCsv(filename: string, csv: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!dir) {
      Alert.alert("Export failed", "No writable directory available.");
      return;
    }
    const safeDir = dir.endsWith("/") ? dir : dir + "/";
    const uri = safeDir + filename;
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: "text/csv",
        dialogTitle: filename,
        UTI: "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("Saved", `CSV written to ${uri}`);
    }
  } catch (e) {
    console.log("[fraud-export] failed", e);
    Alert.alert("Export failed", e instanceof Error ? e.message : String(e));
  }
}

/** Rows loaded eagerly enough to spot patterns without pulling entire tables. */
const SESSION_LIMIT = 3000;
const RIDE_LIMIT = 3000;
const WALLET_TX_LIMIT = 3000;
const TRANSFER_LIMIT = 2000;

interface SuspectInfo {
  name: string | null;
  phone: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A finding's `subjects` are account keys (`uid:<id>` / `phone:<phone>`) or raw ids/phones. */
function normalizeSubject(subject: string): string {
  if (subject.startsWith("uid:")) return subject.slice(4);
  if (subject.startsWith("phone:")) return subject.slice(6);
  return subject;
}

function suspectsForFinding(finding: FraudFinding, directory: Map<string, SuspectInfo>): SuspectInfo[] {
  const seen = new Set<string>();
  const suspects: SuspectInfo[] = [];
  for (const subject of finding.subjects) {
    const info = directory.get(normalizeSubject(subject));
    if (!info) continue;
    const dedupeKey = `${info.name ?? ""}|${info.phone ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    suspects.push(info);
  }
  return suspects;
}

export default function AdminTraceFraudScreen() {
  const router = useRouter();
  const Colors = useColors();

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [findings, setFindings] = useState<FraudFinding[]>([]);
  const [suspectDirectory, setSuspectDirectory] = useState<Map<string, SuspectInfo>>(new Map());
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<"all" | FraudSeverity>("all");
  const [categoryFilter, setCategoryFilter] = useState<FraudCategory | "all">("all");

  const runScan = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setFindings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [sessionsRes, ridesRes, walletTxRes, transfersRes] = await Promise.all([
        supabase
          .from("user_sessions")
          .select("user_id, phone, device_id, public_ip, captured_at, os_name, device_model_name")
          .order("captured_at", { ascending: false })
          .limit(SESSION_LIMIT),
        supabase
          .from("ride_requests")
          .select(
            "id, rider_id, rider_phone, partner_id, partner_phone, status, distance_km, duration_min, fare, pickup_lat, pickup_lng, drop_lat, drop_lng, partner_arrive_lat, partner_arrive_lng, partner_drop_lat, partner_drop_lng, user_drop_lat, user_drop_lng, cancel_reason, cancel_requested_by, created_at, completed_at, cancelled_at"
          )
          .order("created_at", { ascending: false })
          .limit(RIDE_LIMIT),
        supabase
          .from("wallet_transactions")
          .select("id, user_id, wallet_type, kind, amount, created_at")
          .order("created_at", { ascending: false })
          .limit(WALLET_TX_LIMIT),
        supabase
          .from("wallet_transfer_requests")
          .select("id, from_user_id, to_user_id, coins, status, created_at")
          .order("created_at", { ascending: false })
          .limit(TRANSFER_LIMIT),
      ]);

      if (sessionsRes.error) console.log("[trace-fraud] sessions error", sessionsRes.error.message);
      if (ridesRes.error) console.log("[trace-fraud] rides error", ridesRes.error.message);
      if (walletTxRes.error) console.log("[trace-fraud] wallet_tx error", walletTxRes.error.message);
      if (transfersRes.error) console.log("[trace-fraud] transfers error", transfersRes.error.message);

      const result = runFraudScan({
        sessions: (sessionsRes.data ?? []) as SessionSignal[],
        rides: (ridesRes.data ?? []) as RideSignal[],
        walletTx: (walletTxRes.data ?? []) as WalletTxSignal[],
        transfers: (transfersRes.data ?? []) as TransferSignal[],
      });

      const candidateIds = new Set<string>();
      const candidatePhones = new Set<string>();
      for (const f of result) {
        for (const subject of f.subjects) {
          const normalized = normalizeSubject(subject);
          if (!normalized) continue;
          if (UUID_RE.test(normalized)) candidateIds.add(normalized);
          else candidatePhones.add(normalized);
        }
      }
      const idList = Array.from(candidateIds);
      const phoneList = Array.from(candidatePhones);

      const directory = new Map<string, SuspectInfo>();
      if (idList.length > 0 || phoneList.length > 0) {
        const [profilesById, profilesByPhone, partnersById, partnersByAuthId, partnersByPhone] = await Promise.all([
          idList.length ? supabase.from("profiles").select("id, name, phone").in("id", idList) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null }[] }),
          phoneList.length ? supabase.from("profiles").select("id, name, phone").in("phone", phoneList) : Promise.resolve({ data: [] as { id: string; name: string | null; phone: string | null }[] }),
          idList.length ? supabase.from("partners").select("id, auth_user_id, name, phone").in("id", idList) : Promise.resolve({ data: [] as { id: string; auth_user_id: string | null; name: string | null; phone: string | null }[] }),
          idList.length ? supabase.from("partners").select("id, auth_user_id, name, phone").in("auth_user_id", idList) : Promise.resolve({ data: [] as { id: string; auth_user_id: string | null; name: string | null; phone: string | null }[] }),
          phoneList.length ? supabase.from("partners").select("id, auth_user_id, name, phone").in("phone", phoneList) : Promise.resolve({ data: [] as { id: string; auth_user_id: string | null; name: string | null; phone: string | null }[] }),
        ]);

        for (const p of profilesById.data ?? []) {
          const info: SuspectInfo = { name: p.name, phone: p.phone };
          directory.set(p.id, info);
          if (p.phone) directory.set(p.phone, info);
        }
        for (const p of profilesByPhone.data ?? []) {
          const info: SuspectInfo = { name: p.name, phone: p.phone };
          if (!directory.has(p.id)) directory.set(p.id, info);
          if (p.phone && !directory.has(p.phone)) directory.set(p.phone, info);
        }
        for (const p of [...(partnersById.data ?? []), ...(partnersByAuthId.data ?? []), ...(partnersByPhone.data ?? [])]) {
          const info: SuspectInfo = { name: p.name, phone: p.phone };
          if (!directory.has(p.id)) directory.set(p.id, info);
          if (p.auth_user_id && !directory.has(p.auth_user_id)) directory.set(p.auth_user_id, info);
          if (p.phone && !directory.has(p.phone)) directory.set(p.phone, info);
        }
      }

      setFindings(result);
      setSuspectDirectory(directory);
      setScannedAt(new Date());
    } catch (e) {
      console.log("[trace-fraud] scan threw", e);
      Alert.alert("Scan failed", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void runScan();
  }, [runScan]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const f of findings) c[f.severity] += 1;
    return c;
  }, [findings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && f.category !== categoryFilter) return false;
      if (!q) return true;
      const suspects = suspectsForFinding(f, suspectDirectory);
      const haystack = [
        f.title,
        f.description,
        ...f.subjects,
        JSON.stringify(f.evidence),
        ...suspects.map((s) => `${s.name ?? ""} ${s.phone ?? ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [findings, severityFilter, categoryFilter, query, suspectDirectory]);

  const categoriesPresent = useMemo(() => {
    const set = new Set<FraudCategory>();
    for (const f of findings) set.add(f.category);
    return Array.from(set);
  }, [findings]);

  const exportFindings = useCallback(async () => {
    if (filtered.length === 0) {
      Alert.alert("Nothing to export", "No findings match the current filters.");
      return;
    }
    const csv = rowsToCsv(
      filtered.map((f) => {
        const suspects = suspectsForFinding(f, suspectDirectory);
        return {
          category: CATEGORY_META[f.category].label,
          severity: f.severity,
          title: f.title,
          description: f.description,
          suspectNames: suspects.map((s) => s.name ?? "Unknown").join(" | "),
          suspectPhones: suspects.map((s) => s.phone ?? "").join(" | "),
          subjects: f.subjects.join(" | "),
          evidence: f.evidence,
        };
      }),
      ["category", "severity", "title", "description", "suspectNames", "suspectPhones", "subjects", "evidence"]
    );
    await exportCsv(`fraud-findings-${Date.now()}.csv`, csv);
  }, [filtered, suspectDirectory]);

  const showEvidence = useCallback((f: FraudFinding) => {
    Alert.alert(f.title, JSON.stringify(f.evidence, null, 2));
  }, []);

  const severityColor = useCallback(
    (s: FraudSeverity) => (s === "high" ? Colors.error : s === "medium" ? Colors.warning : Colors.textSecondary),
    [Colors]
  );

  const renderFinding = ({ item }: { item: FraudFinding }) => {
    const meta = CATEGORY_META[item.category];
    const Icon = meta.icon;
    const color = severityColor(item.severity);
    const suspects = suspectsForFinding(item, suspectDirectory);
    return (
      <TouchableOpacity
        onPress={() => showEvidence(item)}
        style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
        testID={`finding-${item.id}`}
      >
        <View style={styles.cardHeaderRow}>
          <View style={[styles.iconWrap, { backgroundColor: color + "20" }]}>
            <Icon color={color} size={18} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: Colors.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.cardCategory, { color: Colors.textSecondary }]}>{meta.label}</Text>
          </View>
          <View style={[styles.severityPill, { backgroundColor: color + "20" }]}>
            <Text style={[styles.severityText, { color }]}>{item.severity}</Text>
          </View>
        </View>
        <Text style={[styles.cardDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
        {suspects.length > 0 && (
          <View style={styles.suspectsWrap}>
            {suspects.map((s, idx) => (
              <View key={`${item.id}-suspect-${idx}`} style={[styles.suspectPill, { backgroundColor: Colors.gray[200] }]}>
                <Text style={[styles.suspectText, { color: Colors.text }]} numberOfLines={1}>
                  {s.name?.trim() || "Unnamed"} · {s.phone?.trim() || "No registered number"}
                </Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <ShieldAlert color={Colors.error} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Trace Fraud</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {findings.length} finding{findings.length === 1 ? "" : "s"}
            {scannedAt ? ` · scanned ${scannedAt.toLocaleTimeString()}` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={exportFindings}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="export"
        >
          <Download color={Colors.text} size={20} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRefresh}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="refresh"
        >
          <RefreshCcw color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statPill, { backgroundColor: Colors.error + "15", borderColor: Colors.error + "40" }]}>
          <Text style={[styles.statValue, { color: Colors.error }]}>{counts.high}</Text>
          <Text style={[styles.statLabel, { color: Colors.error }]}>High</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: Colors.warning + "15", borderColor: Colors.warning + "40" }]}>
          <Text style={[styles.statValue, { color: Colors.warning }]}>{counts.medium}</Text>
          <Text style={[styles.statLabel, { color: Colors.warning }]}>Medium</Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: Colors.gray[200], borderColor: Colors.border }]}>
          <Text style={[styles.statValue, { color: Colors.textSecondary }]}>{counts.low}</Text>
          <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Low</Text>
        </View>
      </View>

      <View
        style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
      >
        <Search color={Colors.textSecondary} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search phone, account, ride id…"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.searchInput, { color: Colors.text }]}
          testID="search"
        />
      </View>

      <View style={styles.filterRow}>
        {SEVERITY_FILTERS.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSeverityFilter(s)}
            style={[
              styles.filterChip,
              {
                backgroundColor: severityFilter === s ? Colors.accent : Colors.gray[100],
                borderColor: severityFilter === s ? Colors.accent : Colors.border,
              },
            ]}
            testID={`filter-severity-${s}`}
          >
            <Text style={[styles.filterChipText, { color: severityFilter === s ? "#000000" : Colors.text }]}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {categoriesPresent.length > 0 && (
        <FlatList
          data={["all" as const, ...categoriesPresent]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(c) => c}
          style={styles.categoryFilterList}
          contentContainerStyle={styles.categoryFilterContent}
          renderItem={({ item: c }) => {
            const active = categoryFilter === c;
            const label = c === "all" ? "All types" : CATEGORY_META[c].label;
            return (
              <TouchableOpacity
                onPress={() => setCategoryFilter(c)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? Colors.text : Colors.gray[100],
                    borderColor: active ? Colors.text : Colors.border,
                  },
                ]}
                testID={`filter-category-${c}`}
              >
                <Text style={[styles.filterChipText, { color: active ? Colors.background : Colors.text }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !isSupabaseConfigured ? (
        <View style={styles.center}>
          <Text style={[styles.muted, { color: Colors.textSecondary }]}>Supabase is not configured.</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <ShieldAlert color={Colors.textSecondary} size={28} />
          <Text style={[styles.muted, { color: Colors.textSecondary, marginTop: 8 }]}>
            {findings.length === 0
              ? "No fraud signals detected."
              : "No findings match the current filters."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.id}
          renderItem={renderFinding}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
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
  statsRow: {
    flexDirection: "row" as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  statPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center" as const,
  },
  statValue: { fontSize: 20, fontWeight: "800" as const },
  statLabel: { fontSize: 11, fontWeight: "700" as const, marginTop: 2, textTransform: "uppercase" as const },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  filterRow: {
    flexDirection: "row" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  categoryFilterList: {
    flexGrow: 0,
  },
  categoryFilterContent: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    alignItems: "center" as const,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontWeight: "700" as const },
  center: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, padding: 24 },
  muted: { fontSize: 13, textAlign: "center" as const },
  listContent: { padding: 16 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    marginBottom: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  cardTitle: { fontSize: 14, fontWeight: "700" as const },
  cardCategory: { fontSize: 11, marginTop: 2 },
  severityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  severityText: { fontSize: 11, fontWeight: "800" as const, textTransform: "uppercase" as const },
  cardDesc: { fontSize: 13, lineHeight: 18 },
  suspectsWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 10,
  },
  suspectPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  suspectText: { fontSize: 11, fontWeight: "700" as const },
});
