import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Inbox,
  UserRound,
  Clock,
  UserCheck,
  X,
  Check,
  UserPlus,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  RotateCcw,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/utils/supabase";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import {
  fetchAllTickets,
  fetchSupportAgents,
  assignTicket,
  setTicketStatus,
  SUPPORT_STATUS_META,
  formatTicketNumber,
  type SupportTicket,
  type SupportTicketStatus,
  type SupportAgent,
} from "@/utils/supportStore";

type ActiveStatusFilter = "all" | "open" | "in_progress" | "pending";

const STATUS_FILTERS: { key: ActiveStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: SUPPORT_STATUS_META.open.label },
  { key: "in_progress", label: SUPPORT_STATUS_META.in_progress.label },
  { key: "pending", label: SUPPORT_STATUS_META.pending.label },
];

function ageLabel(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m old`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h old`;
  const d = Math.floor(h / 24);
  return `${d}d old`;
}

/** Older tickets glow warmer to flag SLA risk. */
function ageColor(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours >= 24) return "#EF4444";
  if (hours >= 4) return "#F59E0B";
  return fallback;
}

export default function AdminSupportPoolScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { profileId, isSuper } = useAdminAccess();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [agents, setAgents] = useState<SupportAgent[]>([]);
  const [myName, setMyName] = useState<string>("Me");
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [assignTarget, setAssignTarget] = useState<SupportTicket | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>("all");

  const load = useCallback(async () => {
    const [rows, ags] = await Promise.all([fetchAllTickets(), fetchSupportAgents()]);
    setTickets(rows);
    setAgents(ags);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("admin_support_pool")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!profileId || !supabase) {
        if (active) setMyName(isSuper ? "Support Admin" : "Me");
        return;
      }
      try {
        const { data } = await supabase
          .from("profiles")
          .select("name, phone")
          .eq("id", profileId)
          .maybeSingle();
        if (active) setMyName(data?.name || data?.phone || "Me");
      } catch {
        if (active) setMyName("Me");
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, isSuper]);

  const matchesFilter = useCallback(
    (t: SupportTicket) =>
      statusFilter === "all" ? t.status !== "closed" : t.status === statusFilter,
    [statusFilter]
  );
  const unassigned = useMemo(
    () => tickets.filter((t) => !t.assigned_admin_id && matchesFilter(t)),
    [tickets, matchesFilter]
  );
  const assigned = useMemo(
    () => tickets.filter((t) => t.assigned_admin_id && matchesFilter(t)),
    [tickets, matchesFilter]
  );
  const closed = useMemo(
    () => tickets.filter((t) => t.status === "closed"),
    [tickets]
  );

  const doAssign = useCallback(
    async (ticket: SupportTicket, agent: { profile_id: string | null; name: string | null }) => {
      setAssignTarget(null);
      const ok = await assignTicket(ticket.id, agent);
      if (ok) {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticket.id
              ? {
                  ...t,
                  assigned_admin_id: agent.profile_id,
                  assigned_admin_name: agent.name,
                  assigned_at: new Date().toISOString(),
                }
              : t
          )
        );
      }
    },
    []
  );

  const doReopen = useCallback(async (ticket: SupportTicket) => {
    const ok = await setTicketStatus(ticket.id, "open");
    if (ok) {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticket.id ? { ...t, status: "open" } : t))
      );
    }
  }, []);

  const renderTicket = useCallback(
    ({ item }: { item: SupportTicket }) => {
      const name = item.profile?.name || item.profile?.phone || "User";
      const avatar = item.profile?.avatar_url || item.profile?.profile_image || null;
      const meta = SUPPORT_STATUS_META[item.status];
      const ageCol = ageColor(item.created_at, Colors.textSecondary);
      return (
        <View style={[styles.card, { backgroundColor: Colors.gray[100] }]}>
          <TouchableOpacity
            style={styles.cardMain}
            activeOpacity={0.85}
            onPress={() =>
              router.push({ pathname: "/admin-support-chat", params: { ticketId: item.id } } as never)
            }
            accessibilityRole="button"
          >
            <View style={[styles.avatar, { backgroundColor: Colors.accent + "25" }]}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatarImg} />
              ) : (
                <UserRound color={Colors.accent} size={20} />
              )}
            </View>
            <View style={styles.cardInfo}>
              <View style={styles.cardTitleRow}>
                <View style={styles.cardNameWrap}>
                  <Text style={[styles.cardName, { color: Colors.text }]} numberOfLines={1}>{name}</Text>
                  <Text style={[styles.cardTicketNo, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {formatTicketNumber(item.ticket_number)}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: meta.color + "20" }]}>
                  <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={[styles.cardMsg, { color: Colors.textSecondary }]} numberOfLines={1}>
                {item.last_message || "No messages yet"}
              </Text>
              <View style={styles.cardMetaRow}>
                <Clock color={ageCol} size={12} />
                <Text style={[styles.cardAge, { color: ageCol }]}>{ageLabel(item.created_at)}</Text>
                {item.assigned_admin_name ? (
                  <>
                    <UserCheck color={Colors.textSecondary} size={12} style={styles.metaSep} />
                    <Text style={[styles.cardAssigned, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {item.assigned_admin_name}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.cardActions}>
            {item.status === "closed" ? (
              <TouchableOpacity
                style={[styles.reopenBtn, { borderColor: Colors.accent }]}
                onPress={() => doReopen(item)}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <RotateCcw color={Colors.accent} size={16} />
                <Text style={[styles.reopenBtnText, { color: Colors.accent }]}>Reopen</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.assignBtn, { backgroundColor: Colors.accent }]}
              onPress={() => setAssignTarget(item)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <UserPlus color="#000000" size={16} />
              <Text style={styles.assignBtnText}>{item.assigned_admin_id ? "Reassign" : "Assign"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [Colors, router, doReopen]
  );

  const sections = useMemo(
    () => [
      { key: "unassigned", title: `Unassigned · ${unassigned.length}`, data: unassigned },
      { key: "assigned", title: `Assigned · ${assigned.length}`, data: assigned },
    ],
    [unassigned, assigned]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Inbox color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Assignment Pool</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {unassigned.length} unassigned · {assigned.length} active
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          const tint = f.key === "all" ? Colors.accent : SUPPORT_STATUS_META[f.key as SupportTicketStatus].color;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterChip,
                { borderColor: tint, backgroundColor: active ? tint : "transparent" },
              ]}
              onPress={() => setStatusFilter(f.key)}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={[styles.filterChipText, { color: active ? "#000000" : tint }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(s) => s.key}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={Colors.accent}
            />
          }
          renderItem={({ item: section }) => (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>{section.title}</Text>
              {section.data.length === 0 ? (
                <Text style={[styles.sectionEmpty, { color: Colors.textSecondary }]}>Nothing here.</Text>
              ) : (
                section.data.map((t) => (
                  <View key={t.id}>{renderTicket({ item: t })}</View>
                ))
              )}
            </View>
          )}
          ListFooterComponent={
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.historyHeader}
                activeOpacity={0.7}
                onPress={() => setShowHistory((v) => !v)}
                accessibilityRole="button"
              >
                {showHistory ? (
                  <ChevronDown color={Colors.textSecondary} size={16} />
                ) : (
                  <ChevronRight color={Colors.textSecondary} size={16} />
                )}
                <CheckCircle2 color={SUPPORT_STATUS_META.closed.color} size={15} />
                <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>
                  {`Resolved history \u00b7 ${closed.length}`}
                </Text>
              </TouchableOpacity>
              {showHistory ? (
                closed.length === 0 ? (
                  <Text style={[styles.sectionEmpty, { color: Colors.textSecondary }]}>
                    No resolved tickets yet.
                  </Text>
                ) : (
                  closed.map((t) => (
                    <View key={t.id}>{renderTicket({ item: t })}</View>
                  ))
                )
              ) : null}
            </View>
          }
        />
      )}

      {/* Assign / reassign sheet */}
      <Modal
        visible={!!assignTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignTarget(null)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setAssignTarget(null)} accessibilityRole="button">
          <Pressable style={[styles.sheet, { backgroundColor: Colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: Colors.text }]}>Assign ticket</Text>
              <TouchableOpacity onPress={() => setAssignTarget(null)} accessibilityRole="button">
                <X color={Colors.textSecondary} size={22} />
              </TouchableOpacity>
            </View>

            {(profileId || isSuper) ? (
              <TouchableOpacity
                style={[styles.agentRow, { borderColor: Colors.border }]}
                onPress={() =>
                  assignTarget &&
                  doAssign(assignTarget, { profile_id: profileId, name: myName })
                }
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <View style={[styles.agentAvatar, { backgroundColor: Colors.accent }]}>
                  <UserCheck color="#000000" size={18} />
                </View>
                <Text style={[styles.agentName, { color: Colors.text }]}>Assign to me ({myName})</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={[styles.agentSectionLabel, { color: Colors.textSecondary }]}>AGENTS</Text>
            <FlatList
              data={agents}
              keyExtractor={(a) => a.profile_id}
              style={styles.agentList}
              ListEmptyComponent={
                <Text style={[styles.sectionEmpty, { color: Colors.textSecondary }]}>
                  No agents tagged. Set the “support” order in admin access.
                </Text>
              }
              renderItem={({ item: agent }) => {
                const selected = assignTarget?.assigned_admin_id === agent.profile_id;
                return (
                  <TouchableOpacity
                    style={[styles.agentRow, { borderColor: Colors.border }]}
                    onPress={() =>
                      assignTarget &&
                      doAssign(assignTarget, { profile_id: agent.profile_id, name: agent.name })
                    }
                    activeOpacity={0.8}
                    accessibilityRole="button"
                  >
                    <View style={[styles.agentAvatar, { backgroundColor: Colors.accent + "25" }]}>
                      {agent.avatar_url ? (
                        <Image source={{ uri: agent.avatar_url }} style={styles.agentAvatarImg} />
                      ) : (
                        <UserRound color={Colors.accent} size={18} />
                      )}
                    </View>
                    <View style={styles.agentInfo}>
                      <Text style={[styles.agentName, { color: Colors.text }]} numberOfLines={1}>{agent.name}</Text>
                      {agent.priority != null ? (
                        <Text style={[styles.agentPriority, { color: Colors.textSecondary }]}>
                          Priority {agent.priority}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? <Check color={Colors.accent} size={18} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  listContent: { padding: 16, gap: 18, flexGrow: 1 },
  section: { gap: 10 },
  historyHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 0.5 },
  sectionEmpty: { fontSize: 13, paddingVertical: 6 },
  card: {
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  cardMain: { flexDirection: "row" as const, gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  avatarImg: { width: "100%" as const, height: "100%" as const },
  cardInfo: { flex: 1 },
  cardTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  cardNameWrap: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "700" as const },
  cardTicketNo: { fontSize: 11, fontWeight: "600" as const, marginTop: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusPillText: { fontSize: 11, fontWeight: "700" as const },
  cardMsg: { fontSize: 13, marginTop: 3 },
  cardMetaRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 6 },
  cardAge: { fontSize: 11, fontWeight: "600" as const },
  metaSep: { marginLeft: 6 },
  cardAssigned: { fontSize: 11, flex: 1 },
  cardActions: { flexDirection: "row" as const, gap: 8 },
  assignBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    height: 38,
    borderRadius: 10,
  },
  assignBtnText: { color: "#000000", fontSize: 13, fontWeight: "700" as const },
  reopenBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    height: 38,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  reopenBtnText: { fontSize: 13, fontWeight: "700" as const },
  filterRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  filterChipText: { fontSize: 13, fontWeight: "700" as const },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" as const },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
    maxHeight: "80%" as const,
  },
  sheetHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: "800" as const },
  agentSectionLabel: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 0.5, marginTop: 14, marginBottom: 8 },
  agentList: { flexGrow: 0 },
  agentRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  agentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  agentAvatarImg: { width: "100%" as const, height: "100%" as const },
  agentInfo: { flex: 1 },
  agentName: { fontSize: 15, fontWeight: "600" as const },
  agentPriority: { fontSize: 12, marginTop: 1 },
});
