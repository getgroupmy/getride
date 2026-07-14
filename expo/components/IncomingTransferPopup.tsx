import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Coins, Check, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { formatCoins } from "@/utils/getCoinStore";
import {
  fetchPendingIncomingRequests,
  respondToTransferRequest,
  subscribeIncomingTransferRequests,
  isRequestExpired,
  type WalletTransferRequest,
} from "@/utils/transferRequestsStore";

const COIN_YELLOW = "#EAB308";
const GAIN_GREEN = "#16A34A";
const LOSS_RED = "#DC2626";

/**
 * Global listener mounted at the root. Watches `wallet_transfer_requests`
 * rows addressed to the signed-in account and pops up an approval prompt:
 * who is sending, how much GC, and Accept / Decline buttons. Coins only move
 * once the recipient accepts.
 */
export default function IncomingTransferPopup() {
  const Colors = useColors();
  const { authState } = useAuth();
  const userId = authState.userId ?? null;

  const [queue, setQueue] = useState<WalletTransferRequest[]>([]);
  const [responding, setResponding] = useState<boolean>(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const respondingRef = useRef<boolean>(false);

  const enqueue = useCallback((req: WalletTransferRequest) => {
    setQueue((prev) => (prev.some((r) => r.id === req.id) ? prev : [...prev, req]));
  }, []);

  useEffect(() => {
    if (!userId) {
      setQueue([]);
      return;
    }
    let alive = true;
    fetchPendingIncomingRequests(userId).then((reqs) => {
      if (!alive) return;
      reqs.forEach(enqueue);
    });
    const unsubscribe = subscribeIncomingTransferRequests(
      userId,
      (req) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        }
        enqueue(req);
      },
      // Sender cancelled (or it expired server-side) — drop it, but never
      // while an accept/decline is in flight for it.
      (req) => {
        if (respondingRef.current) return;
        setQueue((prev) => prev.filter((r) => r.id !== req.id));
      }
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [userId, enqueue]);

  const current = queue[0] ?? null;

  // Quietly drop a request that expires while on screen.
  useEffect(() => {
    if (!current) return;
    const remaining = Date.parse(current.expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => {
      if (respondingRef.current) return;
      setQueue((prev) => prev.filter((r) => r.id !== current.id));
    }, Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [current]);

  const respond = async (accept: boolean) => {
    if (!current || !userId || responding) return;
    if (isRequestExpired(current)) {
      setQueue((prev) => prev.filter((r) => r.id !== current.id));
      return;
    }
    setResponding(true);
    respondingRef.current = true;
    const res = await respondToTransferRequest({
      requestId: current.id,
      userId,
      accept,
    });
    setResponding(false);
    respondingRef.current = false;
    setQueue((prev) => prev.filter((r) => r.id !== current.id));
    if (res.status === "accepted") {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      setResult({
        ok: true,
        message: `You received ${formatCoins(res.coins ?? current.coins)} from ${
          res.fromName ?? current.fromName ?? "the sender"
        }`,
      });
    } else if (res.status === "declined") {
      setResult(null);
    } else if (res.error) {
      setResult({ ok: false, message: res.error });
    }
  };

  if (current) {
    const senderName = current.fromName ?? "Someone";
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: Colors.card }]} testID="incoming-transfer-popup">
            <View style={styles.iconWrap}>
              <Coins color={COIN_YELLOW} size={34} />
            </View>
            <Text style={[styles.title, { color: Colors.text }]}>
              {senderName} wants to send you
            </Text>
            <Text style={styles.amount} testID="incoming-transfer-amount">
              {formatCoins(current.coins)}
            </Text>
            {current.note ? (
              <Text style={[styles.note, { color: Colors.textSecondary }]}>
                &ldquo;{current.note}&rdquo;
              </Text>
            ) : null}
            <Text style={[styles.sub, { color: Colors.textSecondary }]}>
              The coins are only added to your GET.coin wallet once you accept.
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.declineBtn]}
                onPress={() => respond(false)}
                disabled={responding}
                testID="incoming-transfer-decline"
              >
                <X color={LOSS_RED} size={18} />
                <Text style={[styles.btnText, { color: LOSS_RED }]}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.acceptBtn]}
                onPress={() => respond(true)}
                disabled={responding}
                testID="incoming-transfer-accept"
              >
                {responding ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Check color="#FFFFFF" size={18} />
                    <Text style={[styles.btnText, { color: "#FFFFFF" }]}>Accept</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  if (result) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: Colors.card }]} testID="incoming-transfer-result">
            <View style={styles.iconWrap}>
              {result.ok ? (
                <Check color={GAIN_GREEN} size={34} />
              ) : (
                <X color={LOSS_RED} size={34} />
              )}
            </View>
            <Text style={[styles.title, { color: Colors.text }]}>{result.message}</Text>
            <TouchableOpacity
              style={[styles.btn, styles.acceptBtn, styles.doneBtn]}
              onPress={() => setResult(null)}
              testID="incoming-transfer-done"
            >
              <Text style={[styles.btnText, { color: "#FFFFFF" }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 28,
  },
  card: {
    width: "100%" as const,
    maxWidth: 400,
    borderRadius: 22,
    padding: 24,
    alignItems: "center" as const,
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#FEF9C3",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  },
  amount: {
    fontSize: 34,
    fontWeight: "900" as const,
    color: "#B45309",
    marginTop: 6,
  },
  note: {
    fontSize: 14,
    fontStyle: "italic" as const,
    marginTop: 8,
    textAlign: "center" as const,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center" as const,
    marginTop: 10,
  },
  actions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 20,
    alignSelf: "stretch" as const,
  },
  btn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    borderRadius: 14,
    paddingVertical: 13,
  },
  declineBtn: {
    backgroundColor: "#FEE2E2",
  },
  acceptBtn: {
    backgroundColor: GAIN_GREEN,
  },
  doneBtn: {
    marginTop: 20,
    alignSelf: "stretch" as const,
  },
  btnText: { fontSize: 15, fontWeight: "800" as const },
});
