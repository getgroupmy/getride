import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Alert,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import SupportChatView from "@/components/SupportChatView";
import AdminTripAudioPanel from "@/components/AdminTripAudioPanel";
import { useColors } from "@/hooks/useColors";
import { useAdminAccess } from "@/contexts/AdminAccessContext";
import { supabase } from "@/utils/supabase";
import {
  fetchTicket,
  startCall,
  setTicketStatus,
  SUPPORT_STATUS_META,
  SUPPORT_STATUS_ORDER,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/utils/supportStore";

export default function AdminSupportChatScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { profileId, isSuper } = useAdminAccess();
  const params = useLocalSearchParams<{ ticketId?: string }>();
  const ticketId = typeof params.ticketId === "string" ? params.ticketId : "";
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [adminName, setAdminName] = useState<string>("Support");
  const [savingStatus, setSavingStatus] = useState<boolean>(false);

  const load = useCallback(async () => {
    const t = await fetchTicket(ticketId);
    setTicket(t);
    setLoading(false);
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve the replying admin's display name (for "who replied" labels).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!profileId || !supabase) {
        if (active) setAdminName(isSuper ? "Support Admin" : "Support");
        return;
      }
      try {
        const { data } = await supabase
          .from("profiles")
          .select("name, phone")
          .eq("id", profileId)
          .maybeSingle();
        if (active) {
          setAdminName(data?.name || data?.phone || "Support Agent");
        }
      } catch {
        if (active) setAdminName("Support Agent");
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, isSuper]);

  const handleChangeStatus = useCallback(
    async (next: SupportTicketStatus) => {
      if (!ticket || next === ticket.status) return;
      setSavingStatus(true);
      const ok = await setTicketStatus(ticket.id, next);
      setSavingStatus(false);
      if (ok) {
        setTicket((prev) => (prev ? { ...prev, status: next } : prev));
      } else {
        Alert.alert("Update failed", "Could not change the ticket status.");
      }
    },
    [ticket]
  );

  const handleCall = () => {
    if (!ticket) return;
    Alert.alert(
      "Call user",
      `Start a voice call with ${ticket.profile?.name || "this user"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Call",
          onPress: async () => {
            const call = await startCall({
              profileId: ticket.profile_id,
              ticketId: ticket.id,
              callerName: adminName,
              media: "voice",
            });
            if (call) {
              router.push({
                pathname: "/support-call",
                params: { callId: call.id, role: "admin" },
              } as never);
            } else {
              Alert.alert("Call failed", "Could not start the call. Please try again.");
            }
          },
        },
      ]
    );
  };

  const statusBar = useMemo(() => {
    if (!ticket) return null;
    return (
      <View style={[styles.statusBar, { borderBottomColor: Colors.border, backgroundColor: Colors.background }]}>
        <View style={styles.statusBarTop}>
          <Text style={[styles.statusBarLabel, { color: Colors.textSecondary }]}>STATUS</Text>
          {ticket.assigned_admin_name ? (
            <Text style={[styles.assignedText, { color: Colors.textSecondary }]} numberOfLines={1}>
              Assigned to {ticket.assigned_admin_name}
            </Text>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusChips}
        >
          {SUPPORT_STATUS_ORDER.map((s) => {
            const meta = SUPPORT_STATUS_META[s];
            const active = ticket.status === s;
            return (
              <TouchableOpacity
                key={s}
                disabled={savingStatus}
                onPress={() => handleChangeStatus(s)}
                activeOpacity={0.8}
                style={[
                  styles.statusChip,
                  {
                    backgroundColor: active ? meta.color : meta.color + "18",
                    borderColor: meta.color,
                  },
                ]}
                accessibilityRole="button"
              >
                {active ? <Check color="#fff" size={13} /> : null}
                <Text
                  style={[
                    styles.statusChipText,
                    { color: active ? "#fff" : meta.color },
                  ]}
                >
                  {meta.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }, [ticket, Colors, savingStatus, handleChangeStatus]);

  const headerAccessory = useMemo(() => {
    if (!ticket) return statusBar;
    return (
      <>
        {statusBar}
        <AdminTripAudioPanel
          profileId={ticket.profile_id}
          ticketId={ticket.id}
          adminId={profileId}
        />
      </>
    );
  }, [ticket, statusBar, profileId]);

  if (loading || !ticketId) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={Colors.accentText} />
      </View>
    );
  }

  const name = ticket?.profile?.name || ticket?.profile?.phone || "User";
  const avatar = ticket?.profile?.avatar_url || ticket?.profile?.profile_image || null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SupportChatView
        ticketId={ticketId}
        myRole="admin"
        myId={profileId}
        senderName={adminName}
        title={name}
        subtitle={ticket?.profile?.phone || undefined}
        avatarUri={avatar}
        onBack={() => router.back()}
        onCall={handleCall}
        headerAccessory={headerAccessory}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  statusBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  statusBarTop: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 8,
  },
  statusBarLabel: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 0.5 },
  assignedText: { fontSize: 11, flex: 1, textAlign: "right" as const, marginLeft: 10 },
  statusChips: { gap: 8, paddingRight: 4 },
  statusChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 13, fontWeight: "700" as const },
});
