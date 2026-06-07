import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import SupportChatView from "@/components/SupportChatView";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { fetchTicket, SUPPORT_STATUS_META, type SupportTicket } from "@/utils/supportStore";

export default function SupportChatScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const params = useLocalSearchParams<{ ticketId?: string }>();
  const ticketId = typeof params.ticketId === "string" ? params.ticketId : "";
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const t = await fetchTicket(ticketId);
      if (active) {
        setTicket(t);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [ticketId]);

  const statusBanner = useMemo(() => {
    if (!ticket) return null;
    const meta = SUPPORT_STATUS_META[ticket.status];
    return (
      <View style={[styles.banner, { backgroundColor: meta.color + "14", borderBottomColor: Colors.border }]}>
        <View style={styles.bannerTop}>
          <View style={[styles.dot, { backgroundColor: meta.color }]} />
          <Text style={[styles.bannerTitle, { color: meta.color }]}>{meta.label}</Text>
          {ticket.assigned_admin_name ? (
            <Text style={[styles.bannerAgent, { color: Colors.textSecondary }]} numberOfLines={1}>
              {ticket.assigned_admin_name}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.bannerDesc, { color: Colors.textSecondary }]}>{meta.description}</Text>
      </View>
    );
  }, [ticket, Colors]);

  if (loading || !ticketId) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SupportChatView
        ticketId={ticketId}
        myRole="user"
        myId={authState.userId ?? null}
        title={ticket?.subject || "Support"}
        subtitle="Our team typically replies quickly"
        onBack={() => router.back()}
        headerAccessory={statusBanner}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  banner: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  bannerTop: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bannerTitle: { fontSize: 13, fontWeight: "800" as const },
  bannerAgent: { fontSize: 12, flex: 1, textAlign: "right" as const, marginLeft: 8 },
  bannerDesc: { fontSize: 12, marginTop: 4, lineHeight: 16 },
});
