import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PhoneOff, Mic, MicOff, Volume2, UserRound } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/utils/supabase";
import {
  fetchCall,
  updateCallStatus,
  fetchTicket,
  formatDuration,
  type SupportCall,
} from "@/utils/supportStore";

export default function SupportCallScreen() {
  const router = useRouter();
  const Colors = useColors();
  const params = useLocalSearchParams<{ callId?: string; role?: string }>();
  const callId = typeof params.callId === "string" ? params.callId : "";
  const role = params.role === "admin" ? "admin" : "user";

  const [call, setCall] = useState<SupportCall | null>(null);
  const [peerName, setPeerName] = useState<string>(role === "admin" ? "User" : "Support");
  const [peerAvatar, setPeerAvatar] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [muted, setMuted] = useState<boolean>(false);
  const [speaker, setSpeaker] = useState<boolean>(true);
  const endedRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goBack = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeout(() => router.back(), 600);
  }, [router]);

  // Load call + peer info.
  useEffect(() => {
    let active = true;
    (async () => {
      const c = await fetchCall(callId);
      if (!active) return;
      setCall(c);
      if (c) {
        if (role === "admin") {
          const t = c.ticket_id ? await fetchTicket(c.ticket_id) : null;
          if (active && t) {
            setPeerName(t.profile?.name || t.profile?.phone || "User");
            setPeerAvatar(t.profile?.avatar_url || t.profile?.profile_image || null);
          }
        } else {
          setPeerName(c.caller_name || "Support");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [callId, role]);

  // Realtime call status updates.
  useEffect(() => {
    if (!supabase || !callId) return;
    const channelName = `support_call_${callId}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "support_calls", filter: `id=eq.${callId}` },
        (payload) => {
          const row = payload.new as SupportCall;
          setCall(row);
          if (
            (row.status === "ended" || row.status === "declined" || row.status === "missed") &&
            !endedRef.current
          ) {
            endedRef.current = true;
            goBack();
          }
        }
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel);
    };
  }, [callId, goBack]);

  // Tick the duration timer once the call is accepted.
  useEffect(() => {
    if (call?.status === "accepted") {
      const base = call.started_at ? new Date(call.started_at).getTime() : Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000)));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [call?.status, call?.started_at]);

  const endCall = useCallback(async () => {
    if (endedRef.current) {
      router.back();
      return;
    }
    endedRef.current = true;
    await updateCallStatus(callId, "ended");
    goBack();
  }, [callId, goBack, router]);

  const statusLabel = (() => {
    if (!call) return "Connecting…";
    if (call.status === "ringing") return role === "admin" ? "Calling…" : "Incoming call";
    if (call.status === "accepted") return formatDuration(elapsed);
    if (call.status === "declined") return "Call declined";
    if (call.status === "missed") return "No answer";
    if (call.status === "ended") return "Call ended";
    return "";
  })();

  const initial = peerName.trim().charAt(0).toUpperCase() || "?";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.secondary }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <View style={[styles.avatar, { backgroundColor: Colors.accent + "30" }]}>
          {peerAvatar ? (
            <Image source={{ uri: peerAvatar }} style={styles.avatarImg} />
          ) : initial !== "?" ? (
            <Text style={[styles.avatarText, { color: Colors.accentText }]}>{initial}</Text>
          ) : (
            <UserRound color={Colors.accentText} size={48} />
          )}
        </View>
        <Text style={[styles.name, { color: Colors.text }]}>{peerName}</Text>
        <View style={styles.statusRow}>
          {call?.status === "ringing" ? <ActivityIndicator color={Colors.textSecondary} /> : null}
          <Text style={[styles.status, { color: Colors.textSecondary }]}>{statusLabel}</Text>
        </View>
        <Text style={[styles.note, { color: Colors.textSecondary }]}>Voice call</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: muted ? Colors.accent : Colors.gray[100] }]}
            onPress={() => setMuted((m) => !m)}
            accessibilityRole="button"
            accessibilityState={{ selected: muted }}
            accessibilityLabel={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff color="#fff" size={24} /> : <Mic color={Colors.text} size={24} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: speaker ? Colors.accent : Colors.gray[100] }]}
            onPress={() => setSpeaker((s) => !s)}
            accessibilityRole="button"
            accessibilityState={{ selected: speaker }}
            accessibilityLabel={speaker ? "Turn off speaker" : "Turn on speaker"}
          >
            <Volume2 color={speaker ? "#fff" : Colors.text} size={24} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.endBtn, { backgroundColor: Colors.error }]}
          onPress={endCall}
          accessibilityRole="button"
          accessibilityLabel="End call"
          testID="end-call"
        >
          <PhoneOff color="#fff" size={28} />
        </TouchableOpacity>
        <Text style={[styles.endLabel, { color: Colors.textSecondary }]}>End call</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "space-between" as const },
  top: { alignItems: "center" as const, marginTop: 80 },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
    marginBottom: 24,
  },
  avatarImg: { width: "100%" as const, height: "100%" as const },
  avatarText: { fontSize: 52, fontWeight: "700" as const },
  name: { fontSize: 26, fontWeight: "800" as const, marginBottom: 10 },
  statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  status: { fontSize: 16 },
  note: { fontSize: 13, marginTop: 6 },
  controls: { alignItems: "center" as const, paddingBottom: 50 },
  controlRow: { flexDirection: "row" as const, gap: 30, marginBottom: 40 },
  ctrlBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  endLabel: { fontSize: 13, marginTop: 10 },
});
