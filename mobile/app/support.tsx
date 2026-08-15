import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  SUPPORT_STATUS_META,
  fetchTicketsForProfile,
  formatTicketNumber,
  getOrCreateTicket,
  type SupportTicket,
} from "@/utils/supportStore";

/**
 * The rider's support tickets.
 *
 * `getOrCreateTicket` reuses an open ticket rather than opening a second one,
 * so tapping "Get help" twice does not split a conversation in half.
 */
export default function Support() {
  const colors = useColors();
  const { authState } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!authState.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setTickets(await fetchTicketsForProfile(authState.userId));
    setLoading(false);
  }, [authState.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async () => {
    if (!authState.userId || opening) return;
    setOpening(true);
    const ticket = await getOrCreateTicket(authState.userId, "Support");
    setOpening(false);
    if (!ticket) {
      Alert.alert("Couldn't start a chat", "Please try again in a moment.");
      return;
    }
    router.push({ pathname: "/support-chat", params: { id: ticket.id } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        contentContainerStyle={tickets.length ? styles.list : styles.listEmpty}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        )}
        renderItem={({ item }) => {
          const meta = SUPPORT_STATUS_META[item.status];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ticket ${formatTicketNumber(item.ticket_number)}`}
              onPress={() =>
                router.push({ pathname: "/support-chat", params: { id: item.id } })
              }
              style={styles.row}
            >
              <View style={styles.rowMain}>
                <Text style={[styles.subject, { color: colors.text }]} numberOfLines={1}>
                  {item.subject || "Support"}
                </Text>
                <Text style={[styles.preview, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.last_message ?? "No messages yet"}
                </Text>
                <Text style={[styles.ticketNo, { color: colors.subtext }]}>
                  {formatTicketNumber(item.ticket_number)}
                </Text>
              </View>
              <View style={styles.rowSide}>
                <Text style={[styles.status, { color: colors.textSecondary }]}>
                  {meta?.label ?? item.status}
                </Text>
                {item.unread_user > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.badgeText, { color: colors.onAccent }]}>
                      {item.unread_user}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={[styles.subject, { color: colors.text }]}>No tickets yet</Text>
              <Text style={[styles.preview, { color: colors.textSecondary }]}>
                Start a chat and we&apos;ll get back to you.
              </Text>
            </View>
          )
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a support chat"
        onPress={open}
        disabled={opening}
        style={[styles.cta, { backgroundColor: opening ? colors.border : colors.primary }]}
      >
        {opening ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={[styles.ctaText, { color: colors.onAccent }]}>Get help</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  rowMain: { flex: 1, gap: 2 },
  rowSide: { alignItems: "flex-end", gap: 6 },
  subject: { fontSize: 15, fontWeight: "700" },
  preview: { fontSize: 13 },
  ticketNo: { fontSize: 12 },
  status: { fontSize: 12 },
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 11 },
  badgeText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  empty: { alignItems: "center", gap: 6, padding: 32 },
  cta: { margin: 16, borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
