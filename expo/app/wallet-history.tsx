import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { ArrowLeft, Wallet as WalletIcon } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWalletTransactions,
  subscribeWalletRealtime,
  type WalletTransaction,
  type WalletType,
} from "@/utils/walletStore";
import { formatActivityDate, walletTxMeta } from "@/utils/walletDisplay";

type TxFilter = "all" | WalletType;

/**
 * Full transaction history for the wallet — opened from "View All" on the
 * wallet screen. Lists every transaction in the Recent Activity card style
 * with pull-to-refresh; partner mode keeps wallet/credit filter chips.
 */
export default function WalletHistoryScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPartnerMode = params.mode === "partner";
  const userId = authState.userId ?? "";

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [txFilter, setTxFilter] = useState<TxFilter>("all");

  const loadAll = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const t = await fetchWalletTransactions(userId);
      setTransactions(t.transactions);
    } catch (e) {
      console.log("[wallet-history] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
      const unsubscribe = subscribeWalletRealtime(userId, loadAll);
      return unsubscribe;
    }, [loadAll, userId])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const filteredTx = useMemo(() => {
    if (txFilter === "all") return transactions;
    return transactions.filter((t) => t.walletType === txFilter);
  }, [transactions, txFilter]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="wallet-history-back"
        >
          <ArrowLeft color="#111827" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transaction History</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
        >
          {isPartnerMode ? (
            <View style={styles.filterRow}>
              {(
                [
                  { id: "all" as TxFilter, label: "All" },
                  { id: "get_wallet" as TxFilter, label: "GET.wallet" },
                  { id: "get_credit" as TxFilter, label: "GET.credit" },
                ]
              ).map((f) => {
                const selected = txFilter === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: selected ? Colors.accent : "#FFFFFF",
                        borderColor: selected ? Colors.accent : "#E5E7EB",
                      },
                    ]}
                    onPress={() => setTxFilter(f.id)}
                    testID={`wallet-history-filter-${f.id}`}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: selected ? Colors.onAccent : "#6B7280" },
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {filteredTx.length === 0 ? (
            <View style={styles.emptyCard}>
              <WalletIcon color="#9CA3AF" size={32} />
              <Text style={styles.emptyTitle}>No transactions yet</Text>
              <Text style={styles.emptySub}>Reload your GET.wallet to get started.</Text>
            </View>
          ) : (
            <View style={styles.activityCard}>
              {filteredTx.map((tx, idx) => {
                const meta = walletTxMeta(tx, Colors);
                const positive = tx.amount >= 0;
                return (
                  <View
                    key={tx.id}
                    style={[
                      styles.activityRow,
                      idx < filteredTx.length - 1 ? styles.activityRowDivider : null,
                    ]}
                    testID={`wallet-history-tx-${tx.id}`}
                  >
                    <View style={styles.activityInfo}>
                      <Text style={styles.activityLabel} numberOfLines={1}>
                        {meta.label}
                      </Text>
                      <View style={styles.activityMetaRow}>
                        <Text style={styles.activityDate} numberOfLines={1}>
                          {formatActivityDate(tx.createdAt)}
                        </Text>
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusBadgeText}>COMPLETED</Text>
                        </View>
                      </View>
                      {isPartnerMode ? (
                        <Text style={styles.activityWallet} numberOfLines={1}>
                          {tx.walletType === "get_wallet" ? "GET.wallet" : "GET.credit"}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.activityAmount,
                        { color: positive ? "#16A34A" : "#DC2626" },
                      ]}
                    >
                      {positive
                        ? `+ RM${Math.abs(tx.amount).toFixed(2)}`
                        : `-RM${Math.abs(tx.amount).toFixed(2)}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#ECECEF",
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#111827",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#111827",
  },
  emptySub: {
    fontSize: 13,
    color: "#6B7280",
  },
  activityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden" as const,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  activityRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1F1F4",
  },
  activityInfo: {
    flex: 1,
    minWidth: 0,
  },
  activityLabel: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#1C1C1E",
    marginBottom: 4,
  },
  activityMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activityDate: {
    fontSize: 13,
    color: "#8E8E93",
    flexShrink: 1,
  },
  statusBadge: {
    backgroundColor: "#EEF1F6",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.4,
    color: "#3A4157",
  },
  activityWallet: {
    fontSize: 12,
    color: "#9CA3AF",
    marginTop: 3,
  },
  activityAmount: {
    fontSize: 15,
    fontWeight: "800" as const,
  },
});
