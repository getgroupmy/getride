import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useColors } from "@/hooks/useColors";
import {
  fetchPendingIncomingRequests,
  isRequestExpired,
  respondToTransferRequest,
  subscribeIncomingTransferRequests,
  type WalletTransferRequest,
} from "@/utils/transferRequestsStore";

/**
 * Incoming GET.coin, awaiting this account's answer.
 *
 * Mounted globally rather than on the wallet screen: a transfer can arrive
 * while the recipient is anywhere in the app, and it expires in 15 minutes, so
 * it cannot wait for them to happen to open their wallet.
 *
 * Coins move only on accept — declining, or letting it lapse, leaves both
 * balances untouched.
 */
export default function IncomingTransferPopup() {
  const colors = useColors();
  const { authState } = useAuth();
  const { apply, refresh } = useWallet();
  const userId = authState.userId;

  const [queue, setQueue] = useState<WalletTransferRequest[]>([]);
  const [busy, setBusy] = useState(false);

  const enqueue = useCallback((req: WalletTransferRequest) => {
    setQueue((prev) => (prev.some((r) => r.id === req.id) ? prev : [...prev, req]));
  }, []);

  const withdraw = useCallback((req: WalletTransferRequest) => {
    setQueue((prev) => prev.filter((r) => r.id !== req.id));
  }, []);

  // Catch up on anything that arrived while the app was closed, then follow.
  useEffect(() => {
    if (!userId) {
      setQueue([]);
      return;
    }
    let cancelled = false;

    void (async () => {
      const pending = await fetchPendingIncomingRequests(userId);
      if (!cancelled) {
        setQueue(pending.filter((r) => !isRequestExpired(r)));
      }
    })();

    const unsubscribe = subscribeIncomingTransferRequests(userId, enqueue, withdraw);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, enqueue, withdraw]);

  // Drop requests that lapse while the popup is open, rather than offering an
  // Accept that the server will refuse.
  useEffect(() => {
    if (queue.length === 0) return;
    const timer = setInterval(() => {
      setQueue((prev) => prev.filter((r) => !isRequestExpired(r)));
    }, 10_000);
    return () => clearInterval(timer);
  }, [queue.length]);

  const current = queue[0];

  const respond = async (accept: boolean) => {
    if (!current || !userId || busy) return;
    setBusy(true);
    const res = await respondToTransferRequest({
      requestId: current.id,
      userId,
      accept,
    });
    setBusy(false);

    // Whatever the server said, this request is answered — dequeue it so a
    // failure cannot wedge the popup open over the whole app.
    setQueue((prev) => prev.filter((r) => r.id !== current.id));

    if (res.ok) {
      apply(res.balances);
      if (!res.balances) void refresh();
    }
  };

  if (!current) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => respond(false)}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Incoming GET.coin</Text>
          <Text style={[styles.amount, { color: colors.text }]}>
            {current.coins.toFixed(2)} GC
          </Text>
          <Text style={[styles.from, { color: colors.textSecondary }]}>
            from {current.fromName ?? "another account"}
          </Text>
          {current.note ? (
            <Text style={[styles.note, { color: colors.subtext }]}>&ldquo;{current.note}&rdquo;</Text>
          ) : null}

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decline coins"
              onPress={() => respond(false)}
              disabled={busy}
              style={[
                styles.btn,
                { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Decline</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Accept coins"
              onPress={() => respond(true)}
              disabled={busy}
              style={[styles.btn, { backgroundColor: busy ? colors.border : colors.primary }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={[styles.btnText, { color: colors.onAccent }]}>Accept</Text>
              )}
            </Pressable>
          </View>

          {queue.length > 1 ? (
            <Text style={[styles.more, { color: colors.subtext }]}>
              {queue.length - 1} more waiting
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: { width: "100%", maxWidth: 380, borderRadius: 16, padding: 22, gap: 4 },
  title: { fontSize: 15, fontWeight: "600" },
  amount: { fontSize: 34, fontWeight: "800", letterSpacing: -0.6 },
  from: { fontSize: 15 },
  note: { fontSize: 14, fontStyle: "italic", marginTop: 4 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  btnText: { fontSize: 15, fontWeight: "700" },
  more: { fontSize: 12, textAlign: "center", marginTop: 10 },
});
