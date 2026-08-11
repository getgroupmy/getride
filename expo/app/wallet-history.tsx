import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Home,
  Wallet as WalletIcon,
  Sparkles,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { walletPalette, type WalletPalette } from "@/utils/walletTheme";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWalletTransactions,
  subscribeWalletRealtime,
  type WalletTransaction,
  type WalletType,
} from "@/utils/walletStore";
import {
  walletAmountText,
  walletTxMeta,
  walletTxCategory,
  walletTypeLabel,
  isReferralTransaction,
  REFERRAL_HIGHLIGHT,
  type WalletTxCategoryId,
} from "@/utils/walletDisplay";
import PullDownScrollView from "@/components/PullDownScrollView";

type TxFilter = "all" | WalletType;
type CategoryFilter = "all" | WalletTxCategoryId;

const CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ride", label: "Ride" },
  { id: "reward", label: "Reward" },
  { id: "referral", label: "Referral" },
  { id: "transfer", label: "Transfer" },
  { id: "reload", label: "Reload" },
  { id: "refund", label: "Refund" },
  { id: "other", label: "Other" },
];

interface MonthOption {
  id: string;
  label: string;
  year: number;
  month: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "19/06/2026" style date for group headers. */
function formatGroupDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "19/06/2026, 10.40PM" style date for the details view. */
function formatDetailDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hours24 = d.getHours();
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${formatGroupDate(iso)}, ${hours12}.${pad(d.getMinutes())}${suffix}`;
}

/**
 * Wallet transaction history — opened from "View All" on the wallet screen.
 * Matches the reference design: blue header, month filter dropdown, date
 * grouped expandable rows with a View Details drill-in, END OF HISTORY footer
 * with Back to Top, and a floating home button.
 */
export default function WalletHistoryScreen() {
  const router = useRouter();
  const { styles, wc, Colors } = useWalletStyles();
  const { authState } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPartnerMode = params.mode === "partner";
  const userId = authState.userId ?? "";

  const scrollRef = useRef<ScrollView | null>(null);
  const monthPillRef = useRef<View | null>(null);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [txFilter, setTxFilter] = useState<TxFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTx, setDetailTx] = useState<WalletTransaction | null>(null);
  const [monthMenuVisible, setMonthMenuVisible] = useState<boolean>(false);
  const [monthMenuTop, setMonthMenuTop] = useState<number>(120);

  const monthOptions = useMemo<MonthOption[]>(() => {
    const now = new Date();
    const opts: MonthOption[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label =
        i === 0
          ? "This Month"
          : i === 1
            ? "Last Month"
            : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      opts.push({ id: `${d.getFullYear()}-${d.getMonth()}`, label, year: d.getFullYear(), month: d.getMonth() });
    }
    return opts;
  }, []);
  const [selectedMonthId, setSelectedMonthId] = useState<string>(monthOptions[0].id);
  const selectedMonth = monthOptions.find((m) => m.id === selectedMonthId) ?? monthOptions[0];

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
    await loadAll();
  }, [loadAll]);

  const filteredTx = useMemo(() => {
    let list = transactions;
    if (txFilter !== "all") list = list.filter((t) => t.walletType === txFilter);
    if (categoryFilter !== "all") {
      list = list.filter((t) => walletTxCategory(t).id === categoryFilter);
    }
    return list.filter((t) => {
      const d = new Date(t.createdAt);
      return d.getFullYear() === selectedMonth.year && d.getMonth() === selectedMonth.month;
    });
  }, [transactions, txFilter, categoryFilter, selectedMonth]);

  /** Transactions grouped by day, newest group first. */
  const groups = useMemo(() => {
    const map = new Map<string, WalletTransaction[]>();
    for (const tx of filteredTx) {
      const key = formatGroupDate(tx.createdAt);
      const arr = map.get(key);
      if (arr) {
        arr.push(tx);
      } else {
        map.set(key, [tx]);
      }
    }
    return Array.from(map.entries());
  }, [filteredTx]);

  const openMonthMenu = () => {
    monthPillRef.current?.measureInWindow((_x, y, _w, h) => {
      setMonthMenuTop(y + h + 6);
      setMonthMenuVisible(true);
    });
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleBack = () => {
    if (detailTx) {
      setDetailTx(null);
      return;
    }
    router.back();
  };

  const renderDetails = (tx: WalletTransaction) => {
    const meta = walletTxMeta(tx, Colors);
    const cat = walletTxCategory(tx);
    const positive = tx.amount >= 0;
    return (
      <ScrollView
        contentContainerStyle={styles.detailScrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.detailCard}>
          <Text style={styles.detailHeading}>Transaction Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Category</Text>
            <View style={[styles.detailCategoryTag, { backgroundColor: cat.bg }]}>
              <cat.Icon color={cat.color} size={13} strokeWidth={2.6} />
              <Text style={[styles.detailCategoryText, { color: cat.color }]}>{cat.label}</Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {meta.label}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{formatDetailDate(tx.createdAt)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Amount</Text>
            <Text style={styles.detailValue}>
              {positive ? "" : "-"}
              {walletAmountText(tx.walletType, tx.amount)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Payment Method</Text>
            <Text style={styles.detailValue}>
              {tx.method && tx.method.length > 0 ? tx.method : "Wallet Balance"}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Wallet</Text>
            <Text style={styles.detailValue}>{walletTypeLabel(tx.walletType)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction ID</Text>
            <Text style={[styles.detailValue, styles.detailValueSmall]} numberOfLines={1}>
              {tx.id}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction Status</Text>
            <Text style={[styles.detailValue, styles.detailStatus]}>Completed</Text>
          </View>
        </View>

        {tx.note ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailSubHeading}>Additional Information</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Reference</Text>
              <Text style={[styles.detailValue, styles.detailValueFlex]} numberOfLines={2}>
                {tx.note}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  const renderList = () => (
    <PullDownScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      onPullRefresh={onRefresh}
      spinnerColor={Colors.accent}
    >
      <View style={styles.tabsRow}>
          {(
            isPartnerMode
              ? [
                  { id: "all" as TxFilter, label: "All" },
                  { id: "get_wallet" as TxFilter, label: "GET.wallet" },
                  { id: "get_credit" as TxFilter, label: "GET.credit" },
                  { id: "get_coin" as TxFilter, label: "GET.coin" },
                ]
              : [
                  { id: "all" as TxFilter, label: "All" },
                  { id: "get_wallet" as TxFilter, label: "GET.wallet" },
                  { id: "get_coin" as TxFilter, label: "GET.coin" },
                ]
          ).map((f) => {
            const selected = txFilter === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                style={styles.tabItem}
                onPress={() => {
                  setTxFilter(f.id);
                  setExpandedId(null);
                }}
                testID={`wallet-history-filter-${f.id}`}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: selected ? wc.text : wc.textFaint },
                  ]}
                >
                  {f.label}
                </Text>
                <View
                  style={[
                    styles.tabUnderline,
                    { backgroundColor: selected ? Colors.accent : "transparent" },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
      </View>

      {/* Category filter chips — colour-coded to match transaction icons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryScrollContent}
      >
        {CATEGORY_FILTERS.map((c) => {
          const selected = categoryFilter === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: selected ? Colors.accent : wc.surface,
                  borderColor: selected ? Colors.accent : wc.border,
                },
              ]}
              onPress={() => {
                setCategoryFilter(c.id);
                setExpandedId(null);
              }}
              testID={`wallet-history-category-${c.id}`}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  { color: selected ? Colors.onAccent : wc.textMuted },
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>Filter by Month</Text>
        <TouchableOpacity
          ref={monthPillRef as React.RefObject<View>}
          style={styles.monthPill}
          onPress={openMonthMenu}
          testID="wallet-history-month-pill"
        >
          <Text style={styles.monthPillText}>{selectedMonth.label}</Text>
          {monthMenuVisible ? (
            <ChevronUp color={wc.textMuted} size={18} />
          ) : (
            <ChevronDown color={wc.textMuted} size={18} />
          )}
        </TouchableOpacity>
      </View>

      {groups.length === 0 ? (
        <View style={styles.emptyCard}>
          <WalletIcon color={wc.textFaint} size={32} />
          <Text style={styles.emptyTitle}>No transactions</Text>
          <Text style={styles.emptySub}>
            {categoryFilter === "all"
              ? `Nothing recorded for ${selectedMonth.label.toLowerCase()}.`
              : `No ${CATEGORY_FILTERS.find((c) => c.id === categoryFilter)?.label.toLowerCase() ?? ""} transactions for ${selectedMonth.label.toLowerCase()}.`}
          </Text>
        </View>
      ) : (
        groups.map(([date, txs]) => (
          <View key={date}>
            <Text style={styles.groupDate}>{date}</Text>
            {txs.map((tx) => {
              const meta = walletTxMeta(tx, Colors);
              const cat = walletTxCategory(tx);
              const positive = tx.amount >= 0;
              const expanded = expandedId === tx.id;
              const isReferral = isReferralTransaction(tx);
              return (
                <View
                  key={tx.id}
                  style={[styles.txCard, isReferral ? styles.txCardReferral : null]}
                >
                  <TouchableOpacity
                    style={styles.txRow}
                    onPress={() => setExpandedId(expanded ? null : tx.id)}
                    testID={`wallet-history-tx-${tx.id}`}
                  >
                    <View style={[styles.txIconWrap, { backgroundColor: cat.bg }]}>
                      <cat.Icon color={cat.color} size={17} strokeWidth={2.4} />
                    </View>
                    <View style={styles.txTitleWrap}>
                      <View style={styles.txTitleRow}>
                        <Text style={styles.txTitle} numberOfLines={1}>
                          {meta.label}
                        </Text>
                        {isReferral ? (
                          <View style={styles.referralBadge}>
                            <Sparkles color={REFERRAL_HIGHLIGHT.badgeText} size={9} strokeWidth={2.6} />
                            <Text style={styles.referralBadgeText}>BONUS</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.txCategory, { color: cat.color }]} numberOfLines={1}>
                        {cat.label}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.txAmount,
                        { color: positive ? wc.amountPositive : wc.amountNegative },
                      ]}
                    >
                      {positive ? "" : "-"}
                      {walletAmountText(tx.walletType, tx.amount)}
                    </Text>
                    {expanded ? (
                      <ChevronUp color={wc.textFaint} size={20} />
                    ) : (
                      <ChevronDown color={wc.textFaint} size={20} />
                    )}
                  </TouchableOpacity>
                  {expanded ? (
                    <TouchableOpacity
                      style={styles.viewDetailsRow}
                      onPress={() => setDetailTx(tx)}
                      testID={`wallet-history-details-${tx.id}`}
                    >
                      <Text style={[styles.viewDetailsText, { color: Colors.accent }]}>
                        View Details
                      </Text>
                      <ChevronRight color={Colors.accent} size={16} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))
      )}

      <View style={styles.endWrap}>
        <View style={styles.endRow}>
          <View style={styles.endLine} />
          <Text style={styles.endText}>END OF HISTORY</Text>
          <View style={styles.endLine} />
        </View>
        <TouchableOpacity
          style={[styles.backTopPill, { backgroundColor: wc.surfaceReferral }]}
          onPress={scrollToTop}
          testID="wallet-history-back-top"
        >
          <Text style={[styles.backTopText, { color: Colors.accent }]}>Back to Top</Text>
          <ChevronUp color={Colors.accent} size={16} />
        </TouchableOpacity>
      </View>
    </PullDownScrollView>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.accent }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          testID="wallet-history-back"
        >
          <View style={styles.backCircle}>
            <ChevronLeft color="#FFFFFF" size={22} />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.accent} size="large" />
          </View>
        ) : detailTx ? (
          renderDetails(detailTx)
        ) : (
          renderList()
        )}

        {!isPartnerMode ? (
          <TouchableOpacity
            style={styles.homeFab}
            onPress={() => router.push("/")}
            testID="wallet-history-home"
          >
            <Home color={Colors.accent} size={24} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal
        visible={monthMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthMenuVisible(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMonthMenuVisible(false)}>
          <View style={[styles.monthMenu, { top: monthMenuTop }]}>
            {monthOptions.map((m) => {
              const selected = m.id === selectedMonthId;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.monthMenuItem,
                    selected ? { backgroundColor: wc.surfaceReferral } : null,
                  ]}
                  onPress={() => {
                    setSelectedMonthId(m.id);
                    setExpandedId(null);
                    setMonthMenuVisible(false);
                  }}
                  testID={`wallet-history-month-${m.id}`}
                >
                  <Text style={styles.monthMenuItemText}>{m.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(wc: WalletPalette, Colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 14,
      gap: 12,
    },
    backBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    backCircle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1.5,
      borderColor: "rgba(255,255,255,0.85)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: "800" as const,
      color: "#FFFFFF",
    },
    body: {
      flex: 1,
      backgroundColor: wc.screen,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 60,
    },
    tabsRow: {
      flexDirection: "row",
      gap: 18,
      marginBottom: 16,
      flexWrap: "wrap" as const,
    },
    tabItem: {
      alignItems: "center",
    },
    tabText: {
      fontSize: 15,
      fontWeight: "700" as const,
      marginBottom: 6,
    },
    tabUnderline: {
      height: 3,
      borderRadius: 2,
      alignSelf: "stretch",
    },
    categoryScroll: {
      marginBottom: 16,
      marginHorizontal: -16,
    },
    categoryScrollContent: {
      paddingHorizontal: 16,
      gap: 8,
    },
    categoryChip: {
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    categoryChipText: {
      fontSize: 13,
      fontWeight: "700" as const,
    },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    filterLabel: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: wc.textMuted,
    },
    monthPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: wc.surface,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
      shadowColor: "#000000",
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    monthPillText: {
      fontSize: 15,
      fontWeight: "700" as const,
      color: wc.text,
    },
    groupDate: {
      fontSize: 14,
      color: wc.textMuted,
      marginBottom: 10,
      marginTop: 4,
    },
    txCard: {
      backgroundColor: wc.surface,
      borderRadius: 16,
      marginBottom: 12,
      overflow: "hidden" as const,
      shadowColor: "#000000",
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    txCardReferral: {
      backgroundColor: REFERRAL_HIGHLIGHT.rowBg,
      borderWidth: 1,
      borderColor: REFERRAL_HIGHLIGHT.border,
    },
    txRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 17,
    },
    txIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    txTitleWrap: {
      flex: 1,
      minWidth: 0,
    },
    txTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    txTitle: {
      fontSize: 15,
      fontWeight: "700" as const,
      color: wc.text,
      flexShrink: 1,
    },
    referralBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 2,
      backgroundColor: REFERRAL_HIGHLIGHT.badgeBg,
    },
    referralBadgeText: {
      fontSize: 9,
      fontWeight: "800" as const,
      letterSpacing: 0.5,
      color: REFERRAL_HIGHLIGHT.badgeText,
    },
    txCategory: {
      fontSize: 11,
      fontWeight: "800" as const,
      letterSpacing: 0.5,
      textTransform: "uppercase" as const,
      marginTop: 2,
    },
    txAmount: {
      fontSize: 15,
      fontWeight: "800" as const,
    },
    viewDetailsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 16,
      paddingVertical: 13,
      borderTopWidth: 1,
      borderTopColor: wc.hairline,
      backgroundColor: wc.surfaceMuted,
    },
    viewDetailsText: {
      fontSize: 14,
      fontWeight: "700" as const,
    },
    emptyCard: {
      alignItems: "center",
      paddingVertical: 48,
      gap: 8,
      backgroundColor: wc.surface,
      borderRadius: 18,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: wc.textStrong,
    },
    emptySub: {
      fontSize: 13,
      color: wc.textMuted,
    },
    endWrap: {
      alignItems: "center",
      marginTop: 36,
      gap: 18,
    },
    endRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    endLine: {
      width: 56,
      height: 1.5,
      backgroundColor: wc.divider,
    },
    endText: {
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 2,
      color: wc.textFaint,
    },
    backTopPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    backTopText: {
      fontSize: 14,
      fontWeight: "800" as const,
    },
    homeFab: {
      position: "absolute" as const,
      right: 20,
      bottom: 28,
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: wc.surface,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000000",
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    menuOverlay: {
      flex: 1,
    },
    monthMenu: {
      position: "absolute" as const,
      right: 16,
      backgroundColor: wc.surface,
      borderRadius: 14,
      paddingVertical: 6,
      minWidth: 210,
      shadowColor: "#000000",
      shadowOpacity: 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    monthMenuItem: {
      paddingHorizontal: 18,
      paddingVertical: 14,
    },
    monthMenuItemText: {
      fontSize: 17,
      fontWeight: "600" as const,
      color: wc.text,
    },
    detailScrollContent: {
      padding: 16,
      paddingBottom: 60,
    },
    detailCard: {
      backgroundColor: wc.surface,
      borderRadius: 18,
      paddingHorizontal: 18,
      paddingVertical: 20,
      marginBottom: 16,
      shadowColor: "#000000",
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    detailHeading: {
      fontSize: 19,
      fontWeight: "800" as const,
      color: wc.text,
      marginBottom: 14,
    },
    detailSubHeading: {
      fontSize: 16,
      fontWeight: "800" as const,
      color: wc.text,
      marginBottom: 10,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingVertical: 9,
    },
    detailLabel: {
      fontSize: 14,
      color: wc.textFaint,
    },
    detailValue: {
      fontSize: 14,
      fontWeight: "700" as const,
      color: wc.text,
      flexShrink: 1,
      textAlign: "right" as const,
    },
    detailValueSmall: {
      fontSize: 12,
    },
    detailValueFlex: {
      flex: 1,
    },
    detailStatus: {
      color: wc.amountPositive,
    },
    detailCategoryTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 8,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    detailCategoryText: {
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 0.3,
    },
  });
}

function useWalletStyles() {
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const wc = useMemo(() => walletPalette(colorScheme === "dark"), [colorScheme]);
  const styles = useMemo(() => makeStyles(wc, Colors), [wc, Colors]);
  return { styles, wc, Colors };
}
