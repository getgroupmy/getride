import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  MessageCircle,
  ChevronRight,
  Plus,
  Headphones,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchTicketsForProfile,
  getOrCreateTicket,
  SUPPORT_STATUS_META,
  formatTicketNumber,
  type SupportTicket,
} from "@/utils/supportStore";

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function SupportScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const userId = authState.userId ?? null;
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!userId) {
      setTickets([]);
      setLoading(false);
      return;
    }
    const rows = await fetchTicketsForProfile(userId);
    setTickets(rows);
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const startNew = useCallback(async () => {
    if (!userId) return;
    const ticket = await getOrCreateTicket(userId);
    if (ticket) {
      router.push({ pathname: "/support-chat", params: { ticketId: ticket.id } } as never);
    }
  }, [userId, router]);

  const renderItem = useCallback(
    ({ item }: { item: SupportTicket }) => {
      const unread = item.unread_user ?? 0;
      return (
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100] }]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${item.subject ?? "Support ticket"}${unread > 0 ? `, ${unread} unread` : ""}`}
          onPress={() =>
            router.push({ pathname: "/support-chat", params: { ticketId: item.id } } as never)
          }
        >
          <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
            <MessageCircle color={Colors.accent} size={22} />
          </View>
          <View style={styles.rowInfo}>
            <View style={styles.rowTitleLine}>
              <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
                {item.subject || "Support"}
              </Text>
              <Text style={[styles.rowTime, { color: Colors.textSecondary }]}>
                {relTime(item.last_message_at)}
              </Text>
            </View>
            <Text style={[styles.rowTicketNo, { color: Colors.textSecondary }]} numberOfLines={1}>
              {formatTicketNumber(item.ticket_number)}
            </Text>
            <View style={styles.statusLine}>
              <View style={[styles.statusPill, { backgroundColor: SUPPORT_STATUS_META[item.status].color + "20" }]}>
                <Text style={[styles.statusPillText, { color: SUPPORT_STATUS_META[item.status].color }]}>
                  {SUPPORT_STATUS_META[item.status].label}
                </Text>
              </View>
            </View>
            <View style={styles.rowSubLine}>
              <Text style={[styles.rowSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                {item.last_message || "No messages yet"}
              </Text>
              {unread > 0 ? (
                <View style={[styles.badge, { backgroundColor: Colors.accent }]}>
                  <Text style={styles.badgeText}>{unread}</Text>
                </View>
              ) : (
                <ChevronRight color={Colors.textSecondary} size={18} />
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [Colors, router]
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
            <Headphones color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Support</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Chat with our team</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
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
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={[styles.emptyIcon, { backgroundColor: Colors.accent + "15" }]}>
                <MessageCircle color={Colors.accent} size={34} />
              </View>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>Need a hand?</Text>
              <Text style={[styles.emptySub, { color: Colors.textSecondary }]}>
                Start a conversation and our support team will reply right here.
              </Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: Colors.accent }]}
        onPress={startNew}
        activeOpacity={0.9}
        testID="support-new"
        accessibilityRole="button"
      >
        <Plus color="#000000" size={22} />
        <Text style={styles.fabText}>New chat</Text>
      </TouchableOpacity>
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
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  rowTitle: { fontSize: 15, fontWeight: "700" as const, flex: 1 },
  rowTime: { fontSize: 11, marginLeft: 8 },
  rowTicketNo: { fontSize: 12, marginTop: 2 },
  statusLine: { flexDirection: "row" as const, marginTop: 5 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9 },
  statusPillText: { fontSize: 10.5, fontWeight: "700" as const },
  rowSubLine: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: 3, gap: 8 },
  rowSub: { fontSize: 13, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, justifyContent: "center" as const, alignItems: "center" as const },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" as const },
  emptyWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, paddingHorizontal: 40, paddingTop: 60 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, justifyContent: "center" as const, alignItems: "center" as const, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: "800" as const, marginBottom: 6 },
  emptySub: { fontSize: 14, textAlign: "center" as const, lineHeight: 20 },
  fab: {
    position: "absolute" as const,
    right: 20,
    bottom: 28,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 26,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "700" as const },
});
