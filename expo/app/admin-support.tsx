import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, Headphones, ChevronRight, UserRound, Inbox } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/utils/supabase";
import { fetchAllTickets, SUPPORT_STATUS_META, type SupportTicket } from "@/utils/supportStore";

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

export default function AdminSupportScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(async () => {
    const rows = await fetchAllTickets();
    setTickets(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live refresh when any ticket changes.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("admin_support_tickets")
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

  const totalUnread = tickets.reduce((sum, t) => sum + (t.unread_admin ?? 0), 0);

  const renderItem = useCallback(
    ({ item }: { item: SupportTicket }) => {
      const unread = item.unread_admin ?? 0;
      const name = item.profile?.name || item.profile?.phone || "User";
      const avatar = item.profile?.avatar_url || item.profile?.profile_image || null;
      return (
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100] }]}
          activeOpacity={0.85}
          onPress={() =>
            router.push({ pathname: "/admin-support-chat", params: { ticketId: item.id } } as never)
          }
        >
          <View style={[styles.avatar, { backgroundColor: Colors.accent + "25" }]}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImg} />
            ) : (
              <UserRound color={Colors.accent} size={22} />
            )}
          </View>
          <View style={styles.rowInfo}>
            <View style={styles.rowTitleLine}>
              <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.rowTime, { color: Colors.textSecondary }]}>{relTime(item.last_message_at)}</Text>
            </View>
            <View style={styles.rowMetaLine}>
              <View style={[styles.statusPill, { backgroundColor: SUPPORT_STATUS_META[item.status].color + "20" }]}>
                <Text style={[styles.statusPillText, { color: SUPPORT_STATUS_META[item.status].color }]}>
                  {SUPPORT_STATUS_META[item.status].label}
                </Text>
              </View>
              {item.assigned_admin_name ? (
                <Text style={[styles.assignedText, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {item.assigned_admin_name}
                </Text>
              ) : (
                <Text style={[styles.assignedText, { color: SUPPORT_STATUS_META.open.color }]} numberOfLines={1}>
                  Unassigned
                </Text>
              )}
            </View>
            <View style={styles.rowSubLine}>
              <Text style={[styles.rowSub, { color: unread > 0 ? Colors.text : Colors.textSecondary }]} numberOfLines={1}>
                {item.last_sender_role === "user" ? "" : "You: "}
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
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
            {totalUnread > 0 ? ` · ${totalUnread} unread` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/admin-support-pool" as never)}
          style={[styles.iconBtn, { backgroundColor: Colors.accent }]}
          testID="open-pool"
        >
          <Inbox color="#000000" size={20} />
        </TouchableOpacity>
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
              <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No support tickets yet.</Text>
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
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  avatarImg: { width: "100%" as const, height: "100%" as const },
  rowInfo: { flex: 1 },
  rowTitleLine: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  rowTitle: { fontSize: 15, fontWeight: "700" as const, flex: 1 },
  rowTime: { fontSize: 11, marginLeft: 8 },
  rowMetaLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9 },
  statusPillText: { fontSize: 10.5, fontWeight: "700" as const },
  assignedText: { fontSize: 11, flex: 1 },
  rowSubLine: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: 3, gap: 8 },
  rowSub: { fontSize: 13, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, justifyContent: "center" as const, alignItems: "center" as const },
  badgeText: { color: "#000000", fontSize: 11, fontWeight: "700" as const },
  emptyWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, paddingTop: 80 },
  emptyText: { fontSize: 14 },
});
