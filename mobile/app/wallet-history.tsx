import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useColors } from "@/hooks/useColors";
import { fetchWalletTransactions, type WalletTransaction } from "@/utils/walletStore";

const WALLET_LABEL: Record<string, string> = {
  get_wallet: "GET.wallet",
  get_credit: "GET.credit",
  get_coin: "GET.coin",
};

/** Turn a ledger `kind` into something a person recognises. */
function describeKind(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

export default function WalletHistory() {
  const colors = useColors();
  const { authState } = useAuth();
  const { balances } = useWallet();

  const [rows, setRows] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  /** True when these came from the device copy rather than the ledger. */
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    if (!authState.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWalletTransactions(authState.userId);
      setRows(res.transactions);
      setStale(res.source === "local");
    } finally {
      setLoading(false);
    }
  }, [authState.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={rows.length ? styles.list : styles.listEmpty}
      data={rows}
      keyExtractor={(r) => r.id}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
      }
      ItemSeparatorComponent={() => (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
      )}
      renderItem={({ item }) => {
        const isCoin = item.walletType === "get_coin";
        const credit = item.amount >= 0;
        // Coins are GC, not currency — never give them a currency symbol.
        const shown = isCoin
          ? `${credit ? "+" : ""}${item.amount.toFixed(2)} GC`
          : `${credit ? "+" : "−"}${balances.currency} ${Math.abs(item.amount).toFixed(2)}`;

        return (
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={[styles.kind, { color: colors.text }]} numberOfLines={1}>
                {describeKind(item.kind)}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                {[WALLET_LABEL[item.walletType] ?? item.walletType, item.method, item.note]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={[styles.when, { color: colors.subtext }]}>
                {formatWhen(item.createdAt)}
              </Text>
            </View>
            <Text style={[styles.amount, { color: credit ? colors.success : colors.text }]}>
              {shown}
            </Text>
          </View>
        );
      }}
      ListHeaderComponent={
        stale ? (
          <View style={[styles.notice, { borderColor: colors.warning }]}>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Showing a saved copy — we couldn&apos;t reach the server.
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        loading ? null : (
          <View style={styles.empty}>
            <Text style={[styles.kind, { color: colors.text }]}>Nothing here yet</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Top-ups, fares and rewards will show up here.
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  rowMain: { flex: 1, gap: 2 },
  kind: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 13 },
  when: { fontSize: 12 },
  amount: { fontSize: 15, fontWeight: "700" },
  empty: { alignItems: "center", gap: 6, padding: 32 },
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, margin: 16 },
});
