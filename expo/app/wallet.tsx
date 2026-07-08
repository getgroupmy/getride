import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Wallet as WalletIcon,
  CreditCard,
  Plus,
  ArrowRightLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Banknote,
  Info,
  CircleDollarSign,
  ChevronRight,
  Smartphone,
  ReceiptText,
  ScanLine,
  QrCode,
  Eye,
  EyeOff,
  X,
} from "lucide-react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWalletBalances,
  fetchWalletTransactions,
  subscribeWalletRealtime,
  topUpWallet,
  rechargeCredit,
  type WalletBalances,
  type WalletTransaction,
  type WalletType,
} from "@/utils/walletStore";

/**
 * Dollar-in-circle with an incoming arrow — matches the "RELOAD" reference icon.
 */
function ReloadDollarIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15.9 16.6 A7.5 7.5 0 1 1 15.9 7.4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M22.5 12 H15"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M18 8.8 L14.8 12 L18 15.2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <SvgText
        x={10}
        y={15.4}
        fontSize={9.5}
        fontWeight="800"
        fill={color}
        textAnchor="middle"
      >
        $
      </SvgText>
    </Svg>
  );
}

const QUICK_AMOUNTS: number[] = [10, 20, 50, 100];

const TOPUP_QUICK_AMOUNTS: number[] = [5, 10, 20, 50, 100, 200];

type TxFilter = "all" | WalletType;

/**
 * Wallet screen for both user and partner mode.
 * - GET.wallet (master): always shown, top-up supported.
 * - GET.credit (partner-only): shown when opened with mode=partner; recharged
 *   by transferring from GET.wallet.
 */
export default function WalletScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; focus?: string }>();
  const isPartnerMode = params.mode === "partner";
  const focusTarget = params.focus === "credit" || params.focus === "wallet" ? params.focus : undefined;
  const userId = authState.userId ?? "";

  const scrollRef = useRef<ScrollView | null>(null);
  const creditCardY = useRef<number>(0);
  const didAutoScroll = useRef<boolean>(false);
  const [highlighted, setHighlighted] = useState<"credit" | "wallet" | null>(null);

  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [txFilter, setTxFilter] = useState<TxFilter>("all");

  const [topUpVisible, setTopUpVisible] = useState<boolean>(false);
  const [rechargeVisible, setRechargeVisible] = useState<boolean>(false);
  const [duitNowVisible, setDuitNowVisible] = useState<boolean>(false);
  const [transferVisible, setTransferVisible] = useState<boolean>(false);
  const [balanceHidden, setBalanceHidden] = useState<boolean>(true);
  const [amountText, setAmountText] = useState<string>("");
  const [methodId, setMethodId] = useState<string>("");
  const [topUpStep, setTopUpStep] = useState<"amount" | "method">("amount");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [successNote, setSuccessNote] = useState<string>("");
  const [actionsWidth, setActionsWidth] = useState<number>(0);

  /**
   * Shared scale for all wallet-card pills (SEND/RECEIVE/RELOAD/TRANSFER).
   * Derived from the measured actions-column width so every pill shrinks
   * together instead of only the pill whose text overflows.
   */
  const pillScale = useMemo<number>(() => {
    const baseWidth = 174;
    if (actionsWidth <= 0) return 1;
    return Math.max(0.7, Math.min(1, actionsWidth / baseWidth));
  }, [actionsWidth]);

  const loadAll = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const [b, t] = await Promise.all([
        fetchWalletBalances(userId),
        fetchWalletTransactions(userId),
      ]);
      setBalances(b);
      setTransactions(t.transactions);
    } catch (e) {
      console.log("[wallet-screen] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
      // Live updates: refetch whenever this user's wallet rows change in the
      // database. When Supabase isn't reachable/configured this is a no-op and
      // the screen keeps using the device-local wallet.
      const unsubscribe = subscribeWalletRealtime(userId, loadAll);
      return unsubscribe;
    }, [loadAll, userId])
  );

  useEffect(() => {
    if (loading || !focusTarget || didAutoScroll.current) return;
    didAutoScroll.current = true;
    setHighlighted(focusTarget);
    const scrollTimer = setTimeout(() => {
      if (focusTarget === "credit" && creditCardY.current > 0) {
        scrollRef.current?.scrollTo({ y: Math.max(creditCardY.current - 12, 0), animated: true });
      } else {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    }, 250);
    const highlightTimer = setTimeout(() => setHighlighted(null), 2200);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(highlightTimer);
    };
  }, [loading, focusTarget]);

  useEffect(() => {
    if (!successNote) return;
    const timer = setTimeout(() => setSuccessNote(""), 2600);
    return () => clearTimeout(timer);
  }, [successNote]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountText.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }, [amountText]);

  const openTopUp = () => {
    setAmountText("");
    setActionError("");
    setMethodId("");
    setTopUpStep("amount");
    setTopUpVisible(true);
  };

  const openRecharge = () => {
    setAmountText("");
    setActionError("");
    setRechargeVisible(true);
  };

  const handleTopUp = async () => {
    if (submitting) return;
    setActionError("");
    if (!(parsedAmount > 0)) {
      setActionError("Enter an amount greater than 0.");
      return;
    }
    if (!methodId) {
      setActionError("Select a reload method.");
      return;
    }
    setSubmitting(true);
    const res = await topUpWallet(userId, parsedAmount, methodId);
    setSubmitting(false);
    if (!res.ok) {
      setActionError(res.error ?? "Reload failed.");
      return;
    }
    if (res.balances) setBalances(res.balances);
    setTopUpVisible(false);
    setSuccessNote(`RM ${parsedAmount.toFixed(2)} added to GET.wallet`);
    loadAll();
  };

  const handleRecharge = async () => {
    if (submitting) return;
    setActionError("");
    if (!(parsedAmount > 0)) {
      setActionError("Enter an amount greater than 0.");
      return;
    }
    if (balances && parsedAmount > balances.getWallet) {
      setActionError("Not enough balance in GET.wallet.");
      return;
    }
    setSubmitting(true);
    const res = await rechargeCredit(userId, parsedAmount);
    setSubmitting(false);
    if (!res.ok) {
      setActionError(res.error ?? "Recharge failed.");
      return;
    }
    if (res.balances) setBalances(res.balances);
    setRechargeVisible(false);
    setSuccessNote(`RM ${parsedAmount.toFixed(2)} moved to GET.credit`);
    loadAll();
  };

  const filteredTx = useMemo(() => {
    if (txFilter === "all") return transactions;
    return transactions.filter((t) => t.walletType === txFilter);
  }, [transactions, txFilter]);

  const txMeta = (tx: WalletTransaction): { label: string; Icon: typeof Plus; color: string } => {
    switch (tx.kind) {
      case "topup":
        return { label: "Top up", Icon: Plus, color: Colors.success };
      case "recharge_in":
        return { label: "Recharge received", Icon: ArrowDownLeft, color: Colors.success };
      case "recharge_out":
        return { label: "Recharge to GET.credit", Icon: ArrowRightLeft, color: Colors.warning };
      case "payment":
        return { label: "Payment", Icon: ArrowUpRight, color: Colors.danger };
      case "commission":
        return { label: "Commission", Icon: Landmark, color: Colors.danger };
      case "refund":
        return { label: "Refund", Icon: ArrowDownLeft, color: Colors.success };
      default:
        return { label: tx.note ?? "Adjustment", Icon: Banknote, color: Colors.textSecondary };
    }
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
      " · " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const amountModal = (
    kind: "topup" | "recharge"
  ) => {
    const isTopUp = kind === "topup";
    const canGoNext = parsedAmount > 0 && amountText.trim() !== "";
    return (
      <Modal
        visible={isTopUp ? topUpVisible : rechargeVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => (isTopUp ? setTopUpVisible(false) : setRechargeVisible(false))}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {isTopUp ? (
            <View style={styles.topUpCard}>
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.topUpTitleRow}>
                  <View style={[styles.modalIconBubble, { backgroundColor: Colors.accent + "22" }]}>
                    <Plus color={Colors.accent} size={20} />
                  </View>
                  <Text style={styles.topUpTitle}>Reload GET.wallet</Text>
                </View>

                <LinearGradient
                  colors={[Colors.accent, "#2691c4", Colors.accentDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0.6 }}
                  style={styles.topUpBanner}
                >
                  <Text style={styles.topUpBannerLabel} testID="wallet-topup-current-balance">
                    Current Balance:{" "}
                    <Text style={styles.topUpBannerAmount}>
                      RM{(balances?.getWallet ?? 0).toFixed(2)}
                    </Text>
                  </Text>
                  <View style={styles.topUpPoweredWrap}>
                    <Text style={styles.topUpPoweredBy}>Powered By</Text>
                    <Image
                      source={require("@/assets/images/mcash-logo-white.png")}
                      style={styles.topUpMcashLogo}
                      resizeMode="contain"
                    />
                  </View>
                </LinearGradient>

                {topUpStep === "amount" ? (
                <View style={styles.topUpBody}>
                  <Text style={styles.topUpHeading}>Reload Amount</Text>
                  <Text style={styles.topUpSub}>Please enter required details.</Text>

                  <View style={styles.topUpAmountCard}>
                    <CircleDollarSign color={Colors.accent} size={42} strokeWidth={1.8} />
                    <View style={styles.topUpAmountFields}>
                      <Text style={styles.topUpAmountLabel}>Amount (RM)*</Text>
                      <TextInput
                        style={styles.topUpAmountInput}
                        value={amountText}
                        onChangeText={setAmountText}
                        keyboardType="decimal-pad"
                        placeholder="Minimum Amount: RM1"
                        placeholderTextColor="#B4B4BC"
                        testID="wallet-amount-input"
                      />
                    </View>
                    {amountText.trim() !== "" ? (
                      <TouchableOpacity
                        style={[styles.amountClearBtn, { backgroundColor: Colors.accent }]}
                        onPress={() => setAmountText("")}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID="wallet-amount-clear"
                      >
                        <X color="#FFFFFF" size={14} strokeWidth={3} />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.topUpOrRow}>
                    <View style={styles.topUpOrLine} />
                    <Text style={styles.topUpOrText}>or</Text>
                    <View style={styles.topUpOrLine} />
                  </View>

                  <Text style={styles.topUpHeading}>Reload Amount</Text>
                  <Text style={styles.topUpSub}>Select a quick reload amount to reload instantly.</Text>

                  <View style={styles.topUpQuickGrid}>
                    {TOPUP_QUICK_AMOUNTS.map((q) => {
                      const selected = parsedAmount === q && amountText.trim() !== "";
                      return (
                        <TouchableOpacity
                          key={q}
                          style={[
                            styles.topUpQuickPill,
                            selected && styles.topUpQuickPillSelected,
                          ]}
                          onPress={() => setAmountText(String(q))}
                          testID={`wallet-quick-${q}`}
                        >
                          <Text
                            style={[
                              styles.topUpQuickPillText,
                              selected && styles.topUpQuickPillTextSelected,
                            ]}
                          >
                            RM{q}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {actionError ? (
                    <Text style={[styles.errorText, { color: Colors.danger }]}>{actionError}</Text>
                  ) : null}

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.topUpCancelBtn]}
                      onPress={() => setTopUpVisible(false)}
                      disabled={submitting}
                    >
                      <Text style={[styles.modalBtnText, { color: "#3A3A3C" }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalBtn,
                        { backgroundColor: Colors.accent, opacity: canGoNext ? 1 : 0.4 },
                      ]}
                      onPress={() => {
                        setActionError("");
                        setTopUpStep("method");
                      }}
                      disabled={!canGoNext}
                      testID="wallet-topup-next"
                    >
                      <Text style={[styles.modalBtnText, { color: Colors.onAccent }]}>Next</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                ) : (
                <View style={styles.topUpBody}>
                  <View style={styles.reloadDetailsRow}>
                    <Text style={styles.topUpHeading}>Reload Details</Text>
                    <TouchableOpacity
                      style={styles.changeAmountBtn}
                      onPress={() => setTopUpStep("amount")}
                      testID="wallet-topup-change-amount"
                    >
                      <Text style={[styles.changeAmountText, { color: Colors.accent }]}>
                        Change Amount
                      </Text>
                      <ChevronRight color={Colors.accent} size={18} strokeWidth={2.6} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.reloadAmountRow}>
                    <Text style={styles.reloadAmountLabel}>Reload Amount</Text>
                    <Text
                      style={[styles.reloadAmountValue, { color: Colors.success }]}
                      testID="wallet-topup-reload-amount"
                    >
                      RM{parsedAmount.toFixed(2)}
                    </Text>
                  </View>

                  <View style={styles.reloadDivider} />

                  <Text style={[styles.topUpHeading, { marginBottom: 12 }]}>
                    Select Reload Method
                  </Text>

                  <View style={styles.methodGroup}>
                    <TouchableOpacity
                      style={styles.methodCard}
                      onPress={() => {
                        setMethodId("fpx");
                        setActionError("");
                      }}
                      testID="wallet-method-fpx"
                    >
                      <View
                        style={[
                          styles.methodRadio,
                          methodId === "fpx" && { borderColor: Colors.accent },
                        ]}
                      >
                        {methodId === "fpx" ? (
                          <View
                            style={[styles.methodRadioDot, { backgroundColor: Colors.accent }]}
                          />
                        ) : null}
                      </View>
                      <Smartphone color={Colors.accent} size={30} strokeWidth={1.8} />
                      <Text style={styles.methodLabel}>Online Banking</Text>
                      <Text style={styles.fpxBadge}>FPX</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.methodCard}
                      onPress={() => {
                        setMethodId("card");
                        setActionError("");
                      }}
                      testID="wallet-method-card"
                    >
                      <View
                        style={[
                          styles.methodRadio,
                          methodId === "card" && { borderColor: Colors.accent },
                        ]}
                      >
                        {methodId === "card" ? (
                          <View
                            style={[styles.methodRadioDot, { backgroundColor: Colors.accent }]}
                          />
                        ) : null}
                      </View>
                      <CreditCard color={Colors.accent} size={30} strokeWidth={1.8} />
                      <Text style={styles.methodLabel}>Cards</Text>
                      <View style={styles.cardBadges}>
                        <View style={styles.mcCircles}>
                          <View style={[styles.mcCircle, { backgroundColor: "#EB001B" }]} />
                          <View
                            style={[
                              styles.mcCircle,
                              styles.mcCircleRight,
                              { backgroundColor: "#F79E1B" },
                            ]}
                          />
                        </View>
                        <Text style={styles.visaBadge}>VISA</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  {actionError ? (
                    <Text style={[styles.errorText, { color: Colors.danger }]}>{actionError}</Text>
                  ) : null}

                  <View style={[styles.demoNote, { backgroundColor: "#F59E0B15" }]}>
                    <Info color="#F59E0B" size={14} />
                    <Text style={[styles.demoNoteText, { color: "#6B6B70" }]}>
                      Demo reload — no real payment is charged yet.
                    </Text>
                  </View>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalBtn, styles.topUpCancelBtn]}
                      onPress={() => setTopUpVisible(false)}
                      disabled={submitting}
                    >
                      <Text style={[styles.modalBtnText, { color: "#3A3A3C" }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalBtn,
                        {
                          backgroundColor: Colors.accent,
                          opacity: submitting ? 0.6 : methodId ? 1 : 0.4,
                        },
                      ]}
                      onPress={handleTopUp}
                      disabled={submitting || !methodId}
                      testID="wallet-topup-confirm"
                    >
                      {submitting ? (
                        <ActivityIndicator color={Colors.onAccent} size="small" />
                      ) : (
                        <Text style={[styles.modalBtnText, { color: Colors.onAccent }]}>Reload</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
                )}
              </ScrollView>
            </View>
          ) : (
          <View style={[styles.modalCard, { backgroundColor: Colors.background }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconBubble, { backgroundColor: "#F59E0B22" }]}>
                <ArrowRightLeft color="#F59E0B" size={20} />
              </View>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>Recharge GET.credit</Text>
            </View>
            <Text style={[styles.modalSub, { color: Colors.textSecondary }]}>
              {`Transfer from GET.wallet · available RM ${(balances?.getWallet ?? 0).toFixed(2)}`}
            </Text>

            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map((q) => {
                const selected = parsedAmount === q && amountText.trim() !== "";
                return (
                  <TouchableOpacity
                    key={q}
                    style={[
                      styles.quickChip,
                      {
                        borderColor: selected ? Colors.accent : Colors.border,
                        backgroundColor: selected ? Colors.accent + "18" : "transparent",
                      },
                    ]}
                    onPress={() => setAmountText(String(q))}
                    testID={`wallet-quick-${q}`}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        { color: selected ? Colors.accent : Colors.text },
                      ]}
                    >
                      RM {q}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.amountInputWrap, { borderColor: Colors.border }]}>
              <Text style={[styles.amountPrefix, { color: Colors.textSecondary }]}>RM</Text>
              <TextInput
                style={[styles.amountInput, { color: Colors.text }]}
                value={amountText}
                onChangeText={setAmountText}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textSecondary}
                testID="wallet-amount-input"
              />
            </View>

            {actionError ? (
              <Text style={[styles.errorText, { color: Colors.danger }]}>{actionError}</Text>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: Colors.border, borderWidth: 1 }]}
                onPress={() => setRechargeVisible(false)}
                disabled={submitting}
              >
                <Text style={[styles.modalBtnText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  { backgroundColor: Colors.accent, opacity: submitting ? 0.6 : 1 },
                ]}
                onPress={handleRecharge}
                disabled={submitting}
                testID="wallet-recharge-confirm"
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.onAccent} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: Colors.onAccent }]}>Recharge</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="wallet-back"
        >
          <ArrowLeft color={Colors.text} size={24} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: Colors.text }]}>Wallet</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
        >
          {successNote ? (
            <View style={[styles.successBanner, { backgroundColor: Colors.success + "18" }]}>
              <Text style={[styles.successBannerText, { color: Colors.success }]}>{successNote}</Text>
            </View>
          ) : null}

          {balances?.source === "local" ? (
            <View style={[styles.localBanner, { backgroundColor: Colors.warning + "15" }]}>
              <Info color={Colors.warning} size={15} />
              <Text style={[styles.localBannerText, { color: Colors.textSecondary }]}>
                Wallet tables not found in the database — running on this device only. Apply
                migration 0056 to sync balances.
              </Text>
            </View>
          ) : null}

          {/* GET.wallet — master */}
          <View
            style={[
              styles.masterCard,
              { backgroundColor: Colors.accent },
              highlighted === "wallet" ? styles.focusHighlight : null,
            ]}
          >
            <View style={styles.cardTopRow}>
              <View style={styles.cardTitleRow}>
                <WalletIcon color="#FFFFFF" size={18} />
                <Text style={styles.masterCardName}>GET.wallet</Text>
              </View>
            </View>
            <View style={styles.masterBodyRow}>
              <View style={styles.masterBalanceCol}>
                <View style={styles.masterBalanceRow}>
                  <Text style={styles.masterBalance} testID="wallet-master-balance">
                    <Text style={styles.masterBalanceCurrency}>RM </Text>
                    {balanceHidden ? "****" : (balances?.getWallet ?? 0).toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setBalanceHidden((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="wallet-balance-toggle"
                  >
                    {balanceHidden ? (
                      <EyeOff color="rgba(255,255,255,0.9)" size={18} />
                    ) : (
                      <Eye color="rgba(255,255,255,0.9)" size={18} />
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={styles.masterBalanceLabel}>Wallet Balance</Text>
              </View>
              <View
                style={styles.masterActionsCol}
                onLayout={(e) => setActionsWidth(e.nativeEvent.layout.width)}
              >
                <View style={styles.sendReceiveRow}>
                  <TouchableOpacity
                    style={styles.whitePillBtn}
                    onPress={() => setDuitNowVisible(true)}
                    testID="wallet-send"
                  >
                    <ScanLine color="#3F3F46" size={13 * pillScale} />
                    <Text
                      style={[styles.whitePillText, { fontSize: 11 * pillScale }]}
                      numberOfLines={1}
                    >
                      SEND
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.whitePillBtn}
                    onPress={() => setDuitNowVisible(true)}
                    testID="wallet-receive"
                  >
                    <QrCode color="#3F3F46" size={13 * pillScale} />
                    <Text
                      style={[styles.whitePillText, { fontSize: 11 * pillScale }]}
                      numberOfLines={1}
                    >
                      RECEIVE
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.masterActionBtn}
                  onPress={openTopUp}
                  testID="wallet-topup-open"
                >
                  <ReloadDollarIcon color="#FFFFFF" size={15 * pillScale} />
                  <Text
                    style={[styles.masterActionText, { fontSize: 12 * pillScale }]}
                    numberOfLines={1}
                  >
                    RELOAD
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.transferPillBtn}
                  onPress={() => setTransferVisible(true)}
                  testID="wallet-transfer-open"
                >
                  <ArrowRightLeft color="#27272A" size={15 * pillScale} />
                  <Text
                    style={[styles.transferPillText, { fontSize: 12 * pillScale }]}
                    numberOfLines={1}
                  >
                    TRANSFER
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Modal
            visible={duitNowVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setDuitNowVisible(false)}
          >
            <View style={styles.duitNowOverlay}>
              <View style={[styles.duitNowCard, { backgroundColor: Colors.card }]}>
                <View style={[styles.duitNowIconWrap, { backgroundColor: Colors.accent + "18" }]}>
                  <QrCode color={Colors.accent} size={28} />
                </View>
                <Text style={[styles.duitNowTitle, { color: Colors.text }]}>DuitNow Coming Soon</Text>
                <Text style={[styles.duitNowMessage, { color: Colors.textSecondary }]}>
                  Send & receive with DuitNow will be available in an upcoming update.
                </Text>
                <TouchableOpacity
                  style={[styles.duitNowBtn, { backgroundColor: Colors.accent }]}
                  onPress={() => setDuitNowVisible(false)}
                  testID="wallet-duitnow-close"
                >
                  <Text style={[styles.duitNowBtnText, { color: Colors.onAccent }]}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <Modal
            visible={transferVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setTransferVisible(false)}
          >
            <View style={styles.duitNowOverlay}>
              <View style={[styles.duitNowCard, { backgroundColor: Colors.card }]}>
                <View style={[styles.duitNowIconWrap, { backgroundColor: Colors.accent + "18" }]}>
                  <ArrowRightLeft color={Colors.accent} size={28} />
                </View>
                <Text style={[styles.duitNowTitle, { color: Colors.text }]}>Coming Soon</Text>
                <Text style={[styles.duitNowMessage, { color: Colors.textSecondary }]}>
                  We&apos;re working on this feature and it will be available soon.
                </Text>
                <TouchableOpacity
                  style={[styles.duitNowBtn, { backgroundColor: Colors.accent }]}
                  onPress={() => setTransferVisible(false)}
                  testID="wallet-transfer-close"
                >
                  <Text style={[styles.duitNowBtnText, { color: Colors.onAccent }]}>Got It</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* GET.credit — partner only */}
          {isPartnerMode ? (
            <View
              style={[
                styles.creditCard,
                { backgroundColor: Colors.card, borderColor: Colors.border },
                highlighted === "credit" ? styles.focusHighlight : null,
              ]}
              onLayout={(e) => {
                creditCardY.current = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.cardTopRow}>
                <View style={styles.cardTitleRow}>
                  <CreditCard color="#F59E0B" size={18} />
                  <Text style={[styles.creditCardName, { color: Colors.text }]}>GET.credit</Text>
                </View>
              </View>
              <Text style={[styles.creditBalance, { color: Colors.text }]} testID="wallet-credit-balance">
                RM {(balances?.getCredit ?? 0).toFixed(2)}
              </Text>
              <Text style={[styles.creditHint, { color: Colors.textSecondary }]}>
                Pays for in-app services & commissions. Recharge from GET.wallet.
              </Text>
              <TouchableOpacity
                style={[styles.rechargeBtn, { backgroundColor: "#F59E0B" }]}
                onPress={openRecharge}
                testID="wallet-recharge-open"
              >
                <ArrowRightLeft color="#000000" size={16} />
                <Text style={styles.rechargeBtnText}>Recharge from GET.wallet</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Transactions */}
          <View style={styles.txHeaderRow}>
            <View style={styles.cardTitleRow}>
              <ReceiptText color={Colors.textSecondary} size={16} />
              <Text style={[styles.txHeaderTitle, { color: Colors.text }]}>Transactions</Text>
            </View>
          </View>

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
                        backgroundColor: selected ? Colors.accent : "transparent",
                        borderColor: selected ? Colors.accent : Colors.border,
                      },
                    ]}
                    onPress={() => setTxFilter(f.id)}
                    testID={`wallet-filter-${f.id}`}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: selected ? Colors.onAccent : Colors.textSecondary },
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
            <View style={styles.emptyWrap}>
              <WalletIcon color={Colors.textSecondary} size={32} />
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>No transactions yet</Text>
              <Text style={[styles.emptySub, { color: Colors.textSecondary }]}>
                Top up your GET.wallet to get started.
              </Text>
            </View>
          ) : (
            filteredTx.map((tx) => {
              const meta = txMeta(tx);
              const positive = tx.amount >= 0;
              return (
                <View
                  key={tx.id}
                  style={[styles.txRow, { borderBottomColor: Colors.border }]}
                  testID={`wallet-tx-${tx.id}`}
                >
                  <View style={[styles.txIconBubble, { backgroundColor: meta.color + "1A" }]}>
                    <meta.Icon color={meta.color} size={16} />
                  </View>
                  <View style={styles.txInfo}>
                    <Text style={[styles.txLabel, { color: Colors.text }]} numberOfLines={1}>
                      {meta.label}
                    </Text>
                    <Text style={[styles.txSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {(tx.walletType === "get_wallet" ? "GET.wallet" : "GET.credit") +
                        " · " +
                        formatDate(tx.createdAt)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.txAmount,
                      { color: positive ? Colors.success : Colors.text },
                    ]}
                  >
                    {(positive ? "+" : "-") + "RM " + Math.abs(tx.amount).toFixed(2)}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {amountModal("topup")}
      {amountModal("recharge")}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
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
  successBanner: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  successBannerText: {
    fontSize: 14,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  localBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  localBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  masterCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
  },
  focusHighlight: {
    borderWidth: 2,
    borderColor: "#F59E0B",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  masterCardName: {
    fontSize: 17,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  masterBalanceLabel: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  masterBalance: {
    fontSize: 24,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  masterBalanceCurrency: {
    fontSize: 13,
    fontWeight: "400" as const,
    color: "rgba(255,255,255,0.9)",
  },
  masterBodyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  masterBalanceCol: {
    flexShrink: 1,
  },
  masterBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  masterActionsCol: {
    gap: 8,
    flexShrink: 1,
    alignItems: "flex-end",
  },
  sendReceiveRow: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 1,
    alignSelf: "stretch",
  },
  whitePillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#F4F1F8",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
    minWidth: 0,
  },
  whitePillText: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.4,
    color: "#3F3F46",
    flexShrink: 1,
  },
  masterActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "stretch",
    minWidth: 0,
  },
  transferPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: "stretch",
    minWidth: 0,
  },
  transferPillText: {
    fontSize: 12,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
    color: "#27272A",
    flexShrink: 1,
  },
  duitNowOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  duitNowCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
  },
  duitNowIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  duitNowTitle: {
    fontSize: 17,
    fontWeight: "800" as const,
    marginBottom: 6,
    textAlign: "center",
  },
  duitNowMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 18,
  },
  duitNowBtn: {
    borderRadius: 999,
    paddingHorizontal: 36,
    paddingVertical: 11,
  },
  duitNowBtnText: {
    fontSize: 14,
    fontWeight: "800" as const,
  },
  masterActionText: {
    fontSize: 12,
    fontWeight: "800" as const,
    letterSpacing: 0.8,
    color: "#FFFFFF",
    flexShrink: 1,
  },
  creditCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 18,
  },
  creditCardName: {
    fontSize: 17,
    fontWeight: "800" as const,
  },
  creditBalance: {
    fontSize: 28,
    fontWeight: "800" as const,
  },
  creditHint: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 17,
  },
  rechargeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
  },
  rechargeBtnText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#000000",
  },
  txHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 2,
  },
  txHeaderTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
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
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
  emptySub: {
    fontSize: 13,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  txIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: { flex: 1 },
  txLabel: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  txSub: {
    fontSize: 12,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  modalIconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    flex: 1,
  },
  modalBalance: {
    fontSize: 14,
    fontWeight: "700" as const,
    marginBottom: 2,
  },
  modalSub: {
    fontSize: 13,
    marginBottom: 14,
  },
  quickRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  quickChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 9,
    alignItems: "center",
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: "700" as const,
  },
  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  amountPrefix: {
    fontSize: 16,
    fontWeight: "700" as const,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700" as const,
    paddingVertical: 12,
  },
  methodRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  methodChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  methodChipText: {
    fontSize: 11,
    fontWeight: "700" as const,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600" as const,
    marginBottom: 10,
  },
  demoNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  demoNoteText: {
    flex: 1,
    fontSize: 12,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  topUpCard: {
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    overflow: "hidden" as const,
    maxHeight: "92%" as const,
  },
  topUpTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
  },
  topUpTitle: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: "#1C1C1E",
    flex: 1,
  },
  topUpBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topUpBannerLabel: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#FFFFFF",
    flexShrink: 1,
  },
  topUpBannerAmount: {
    fontSize: 17,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  topUpPoweredWrap: {
    alignItems: "center" as const,
  },
  topUpPoweredBy: {
    fontSize: 10,
    fontWeight: "600" as const,
    color: "#FFFFFF",
    marginBottom: 2,
  },
  topUpMcashLogo: {
    width: 74,
    height: 20,
  },
  topUpBody: {
    backgroundColor: "#F4F4F6",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  topUpHeading: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#3A3A3C",
    marginBottom: 2,
  },
  topUpSub: {
    fontSize: 13,
    color: "#6B6B70",
    marginBottom: 12,
  },
  topUpAmountCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E7EB",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  topUpAmountFields: {
    flex: 1,
  },
  topUpAmountLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: "#3A3A3C",
    marginBottom: 2,
  },
  topUpAmountInput: {
    fontSize: 17,
    fontWeight: "600" as const,
    color: "#1C1C1E",
    paddingVertical: 4,
    padding: 0,
  },
  amountClearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  topUpOrRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    marginBottom: 14,
  },
  topUpOrLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#D9D9DE",
  },
  topUpOrText: {
    fontSize: 13,
    color: "#9A9AA0",
  },
  topUpQuickGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
    marginBottom: 14,
  },
  topUpQuickPill: {
    flexBasis: "30%" as const,
    flexGrow: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#ECECEF",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center" as const,
  },
  topUpQuickPillSelected: {
    borderColor: "#8A16E8",
    backgroundColor: "#8A16E812",
  },
  topUpQuickPillText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#3A3A3C",
  },
  topUpQuickPillTextSelected: {
    color: "#8A16E8",
    fontWeight: "700" as const,
  },
  topUpCancelBtn: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E3E3E8",
  },
  reloadDetailsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 12,
  },
  changeAmountBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
  },
  changeAmountText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  reloadAmountRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 14,
  },
  reloadAmountLabel: {
    fontSize: 15,
    color: "#6B6B70",
  },
  reloadAmountValue: {
    fontSize: 18,
    fontWeight: "800" as const,
  },
  reloadDivider: {
    height: 1,
    backgroundColor: "#D9D9DE",
    marginBottom: 16,
  },
  methodGroup: {
    gap: 10,
    marginBottom: 14,
  },
  methodCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  methodRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#C5C5CC",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  methodRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  methodLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#1C1C1E",
  },
  fpxBadge: {
    fontSize: 15,
    fontWeight: "800" as const,
    fontStyle: "italic" as const,
    color: "#1A2E6E",
  },
  cardBadges: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  mcCircles: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  mcCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    opacity: 0.9,
  },
  mcCircleRight: {
    marginLeft: -7,
  },
  visaBadge: {
    fontSize: 14,
    fontWeight: "800" as const,
    fontStyle: "italic" as const,
    color: "#1A1F71",
  },
});
