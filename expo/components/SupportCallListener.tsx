import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from "react-native";
import { useRouter } from "expo-router";
import { Phone, PhoneOff, UserRound } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/utils/supabase";
import { updateCallStatus, type SupportCall } from "@/utils/supportStore";

/**
 * Global listener mounted at the root. Subscribes to `support_calls` rows
 * targeting the signed-in user and shows a full-screen incoming-call prompt
 * when an admin rings. Users can only *receive* calls — they never initiate.
 */
export default function SupportCallListener() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const userId = authState.userId ?? null;
  const [incoming, setIncoming] = useState<SupportCall | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!supabase || !userId) return;
    const channelName = `incoming_calls_${userId}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_calls",
          filter: `profile_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as SupportCall;
          if (row?.status === "ringing") {
            setIncoming(row);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "support_calls",
          filter: `profile_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as SupportCall;
          // If the admin cancels before we answer, dismiss the prompt.
          setIncoming((prev) =>
            prev && prev.id === row.id && row.status !== "ringing" ? null : prev
          );
        }
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (incoming) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.12, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    return undefined;
  }, [incoming, pulse]);

  const accept = async () => {
    if (!incoming) return;
    const id = incoming.id;
    setIncoming(null);
    await updateCallStatus(id, "accepted");
    router.push({ pathname: "/support-call", params: { callId: id, role: "user" } } as never);
  };

  const decline = async () => {
    if (!incoming) return;
    const id = incoming.id;
    setIncoming(null);
    await updateCallStatus(id, "declined");
  };

  if (!incoming) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: Colors.secondary }]}>
        <View style={styles.top}>
          <Animated.View
            style={[styles.avatar, { backgroundColor: Colors.accent + "30", transform: [{ scale: pulse }] }]}
          >
            <UserRound color={Colors.accent} size={52} />
          </Animated.View>
          <Text style={[styles.name, { color: Colors.text }]}>{incoming.caller_name || "Support"}</Text>
          <Text style={[styles.sub, { color: Colors.textSecondary }]}>Incoming support call…</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: Colors.error }]} onPress={decline} testID="decline-call">
              <PhoneOff color="#fff" size={28} />
            </TouchableOpacity>
            <Text style={[styles.btnLabel, { color: Colors.textSecondary }]}>Decline</Text>
          </View>
          <View style={styles.actionCol}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: Colors.success }]} onPress={accept} testID="accept-call">
              <Phone color="#fff" size={28} />
            </TouchableOpacity>
            <Text style={[styles.btnLabel, { color: Colors.textSecondary }]}>Accept</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "space-between" as const, paddingTop: 120, paddingBottom: 70 },
  top: { alignItems: "center" as const },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 24,
  },
  name: { fontSize: 26, fontWeight: "800" as const, marginBottom: 8 },
  sub: { fontSize: 15 },
  actions: { flexDirection: "row" as const, justifyContent: "space-around" as const, paddingHorizontal: 40 },
  actionCol: { alignItems: "center" as const },
  btn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  btnLabel: { fontSize: 13, marginTop: 10 },
});
