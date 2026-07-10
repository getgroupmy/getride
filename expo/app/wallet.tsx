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
  Info,
  CircleDollarSign,
  ChevronRight,
  Smartphone,
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
import { formatActivityDate, formatUpdatedStamp, walletTxMeta } from "@/utils/walletDisplay";

/**
 * Dollar-in-circle with an incoming arrow — matches the "Reload" reference icon.
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
 * - GET.wallet (master): always shown, reload supported.
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [topUpVisible, setTopUpVisible] = useState<boolean>(false);
  const [rechargeVisible, setRechargeVisible] = useState<boolean>(false);
  const [duitNowVisible, setDuitNowVisible] = useState<boolean>(false);
  const [comingSoonVisible, setComingSoonVisible] = useState<boolean>(false);
  const [balanceHidden, setBalanceHidden] = useState<boolean>(true);
  const [amountText, setAmountText] = useState<string>("");
  const [methodId, setMethodId] = useState<string>("");
  const [topUpStep, setTopUpStep] = useState<"amount" | "method">("amount");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [successNote, setSuccessNote] = useState<string>("");

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
      setLastUpdated(new Date());
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

  const recentTx = useMemo(() => filteredTx.slice(0, 5), [filteredTx]);

  const openHistory = () => {
    router.push(
      isPartnerMode
        ? { pathname: "/wallet-history", params: { mode: "partner" } }
        : { pathname: "/wallet-history" }
    );
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
    <SafeAreaView style={[styles.container, { backgroundColor: "#55BEEC" }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="wallet-back"
        >
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={[styles.loadingWrap, { backgroundColor: "#F4F5F7" }]}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />
          }
        >
          {/* Gradient backdrop with layered balance card + pill tray */}
          <View style={styles.heroSection}>
            <LinearGradient
              colors={["#55BEEC", Colors.accent, Colors.accentDark]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={styles.heroBackdrop}
            >
              <View style={styles.heroCircleLarge} />
              <View style={styles.heroCircleSmall} />
              <View style={styles.heroCircleTiny} />
            </LinearGradient>

            <View
              style={[
                styles.balanceCard,
                highlighted === "wallet" ? styles.focusHighlight : null,
              ]}
            >
              <View style={styles.balanceLabelRow}>
                <Text style={styles.balanceLabel}>WALLET BALANCE</Text>
                <TouchableOpacity
                  onPress={() => setBalanceHidden((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID="wallet-balance-toggle"
                >
                  {balanceHidden ? (
                    <EyeOff color="#3A3A3C" size={22} />
                  ) : (
                    <Eye color="#3A3A3C" size={22} />
                  )}
                </TouchableOpacity>
              </View>
              <View style={styles.balanceValueRow}>
                <Text style={styles.balanceCurrency}>RM</Text>
                {balanceHidden ? (
                  <Text style={styles.balanceMask} testID="wallet-master-balance">
                    ****
                  </Text>
                ) : (
                  <Text
                    style={styles.balanceValue}
                    testID="wallet-master-balance"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}
                  >
                    {(balances?.getWallet ?? 0).toFixed(2)}
                  </Text>
                )}
              </View>
              {lastUpdated ? (
                <Text style={styles.balanceUpdated} testID="wallet-updated-at">
                  Updated • {formatUpdatedStamp(lastUpdated)}
                </Text>
              ) : null}
              <View style={styles.balanceDivider} />
            </View>

            <View style={styles.pillTray}>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={openTopUp}
                  activeOpacity={0.85}
                  testID="wallet-topup-open"
                >
                  <LinearGradient
                    colors={[Colors.accent, Colors.accentDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.pillInner}
                  >
                    <ReloadDollarIcon color="#FFFFFF" size={17} />
                    <Text style={[styles.pillText, styles.pillTextOnAccent]} numberOfLines={1}>
                      Reload
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={() => setComingSoonVisible(true)}
                  activeOpacity={0.85}
                  testID="wallet-scan"
                >
                  <View style={[styles.pillInner, styles.pillWhite]}>
                    <ScanLine color="#27272A" size={17} />
                    <Text style={styles.pillText} numberOfLines={1}>
                      Scan
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={() => setDuitNowVisible(true)}
                  activeOpacity={0.85}
                  testID="wallet-receive"
                >
                  <View style={[styles.pillInner, styles.pillWhite]}>
                    <QrCode color="#27272A" size={17} />
                    <Text style={styles.pillText} numberOfLines={1}>
                      Receive
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={() => setComingSoonVisible(true)}
                  activeOpacity={0.85}
                  testID="wallet-transfer-open"
                >
                  <View style={[styles.pillInner, styles.pillWhite]}>
                    <ArrowRightLeft color="#27272A" size={17} />
                    <Text style={styles.pillText} numberOfLines={1}>
                      Transfer
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.bodyContent}>
            {successNote ? (
              <View style={[styles.successBanner, { backgroundColor: Colors.success + "18" }]}>
                <Text style={[styles.successBannerText, { color: Colors.success }]}>{successNote}</Text>
              </View>
            ) : null}

            {balances?.source === "local" ? (
              <View style={[styles.localBanner, { backgroundColor: Colors.warning + "15" }]}>
                <Info color={Colors.warning} size={15} />
                <Text style={[styles.localBannerText, { color: "#6B7280" }]}>
                  Wallet tables not found in the database — running on this device only. Apply
                  migration 0056 to sync balances.
                </Text>
              </View>
            ) : null}

            {/* GET.credit — partner only */}
            {isPartnerMode ? (
              <View
                style={[
                  styles.creditCard,
                  highlighted === "credit" ? styles.focusHighlight : null,
                ]}
                onLayout={(e) => {
                  creditCardY.current = e.nativeEvent.layout.y;
                }}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.cardTitleRow}>
                    <CreditCard color="#F59E0B" size={18} />
                    <Text style={styles.creditCardName}>GET.credit</Text>
                  </View>
                </View>
                <Text style={styles.creditBalance} testID="wallet-credit-balance">
                  RM {(balances?.getCredit ?? 0).toFixed(2)}
                </Text>
                <Text style={styles.creditHint}>
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

            {/* Recent Activity */}
            <View style={styles.activityHeaderRow}>
              <Text style={styles.activityTitle}>Recent Activity</Text>
              <TouchableOpacity
                style={styles.viewAllBtn}
                onPress={openHistory}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="wallet-view-all"
              >
                <Text style={styles.viewAllText}>View All</Text>
                <ChevronRight color="#27272A" size={18} strokeWidth={2.4} />
              </TouchableOpacity>
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
                          backgroundColor: selected ? Colors.accent : "#FFFFFF",
                          borderColor: selected ? Colors.accent : "#E5E7EB",
                        },
                      ]}
                      onPress={() => setTxFilter(f.id)}
                      testID={`wallet-filter-${f.id}`}
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

            {recentTx.length === 0 ? (
              <View style={styles.emptyCard}>
                <WalletIcon color="#9CA3AF" size={32} />
                <Text style={styles.emptyTitle}>No activity yet</Text>
                <Text style={styles.emptySub}>Reload your GET.wallet to get started.</Text>
              </View>
            ) : (
              <View>
                {recentTx.map((tx) => {
                  const meta = walletTxMeta(tx, Colors);
                  const positive = tx.amount >= 0;
                  return (
                    <View
                      key={tx.id}
                      style={styles.activityCard}
                      testID={`wallet-tx-${tx.id}`}
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
          </View>
        </ScrollView>
      )}

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
        visible={comingSoonVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setComingSoonVisible(false)}
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
              onPress={() => setComingSoonVisible(false)}
              testID="wallet-transfer-close"
            >
              <Text style={[styles.duitNowBtnText, { color: Colors.onAccent }]}>Got It</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    paddingVertical: 4,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollArea: {
    flex: 1,
    backgroundColor: "#F2F3F5",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroSection: {
    paddingTop: 30,
  },
  heroBackdrop: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 68,
    overflow: "hidden" as const,
  },
  heroCircleLarge: {
    position: "absolute" as const,
    top: 36,
    right: -34,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  heroCircleSmall: {
    position: "absolute" as const,
    bottom: 26,
    right: 26,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  heroCircleTiny: {
    position: "absolute" as const,
    top: 140,
    right: 74,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  balanceCard: {
    marginHorizontal: 20,
    borderRadius: 24,
    backgroundColor: "#F0F5FB",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    zIndex: 2,
    shadowColor: "#0B3550",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  balanceLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  balanceLabel: {
    fontSize: 15,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    color: "#3A3A3C",
  },
  balanceValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  balanceValue: {
    fontSize: 44,
    fontWeight: "800" as const,
    color: "#3A3A3C",
    flexShrink: 1,
  },
  balanceMask: {
    fontSize: 40,
    fontWeight: "800" as const,
    color: "#3A3A3C",
    letterSpacing: 2,
    transform: [{ translateY: 9 }],
  },
  balanceCurrency: {
    fontSize: 22,
    fontWeight: "600" as const,
    color: "#8A8A8E",
  },
  balanceUpdated: {
    fontSize: 14,
    color: "#98989E",
    marginTop: 6,
  },
  balanceDivider: {
    height: 1,
    backgroundColor: "#DDE3EE",
    marginTop: 16,
  },
  pillTray: {
    marginHorizontal: 12,
    marginTop: -30,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    paddingTop: 40,
    paddingBottom: 14,
    paddingHorizontal: 10,
    zIndex: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  pillRow: {
    flexDirection: "row",
    gap: 7,
  },
  pillWrap: {
    flex: 1,
    minWidth: 0,
  },
  pillInner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 4,
    minWidth: 0,
  },
  pillWhite: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EEEEF1",
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#27272A",
    flexShrink: 1,
  },
  pillTextOnAccent: {
    color: "#FFFFFF",
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
  bodyContent: {
    paddingHorizontal: 12,
    paddingTop: 22,
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
  creditCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    marginBottom: 18,
  },
  creditCardName: {
    fontSize: 17,
    fontWeight: "800" as const,
    color: "#111827",
  },
  creditBalance: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: "#111827",
  },
  creditHint: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 17,
    color: "#6B7280",
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
  activityHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  activityTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#2A2A2E",
  },
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  viewAllText: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#2A2A2E",
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
    paddingVertical: 40,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginBottom: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  activityInfo: {
    flex: 1,
    minWidth: 0,
  },
  activityLabel: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: "#26262A",
    marginBottom: 6,
  },
  activityMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activityDate: {
    fontSize: 14,
    color: "#96969C",
    flexShrink: 1,
  },
  statusBadge: {
    backgroundColor: "#E8EBF3",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
    color: "#454F68",
  },
  activityAmount: {
    fontSize: 16,
    fontWeight: "800" as const,
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
    borderColor: "#2dabe2",
    backgroundColor: "#2dabe212",
  },
  topUpQuickPillText: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: "#3A3A3C",
  },
  topUpQuickPillTextSelected: {
    color: "#2dabe2",
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
