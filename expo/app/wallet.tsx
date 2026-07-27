import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  useWindowDimensions,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
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
  Coins,
  TrendingUp,
  Gift,
  Share2,
  UserCheck,
} from "lucide-react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import PullDownScrollView from "@/components/PullDownScrollView";
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
import {
  formatActivityDate,
  formatUpdatedStamp,
  walletAmountText,
  walletTxMeta,
  walletTxCategory,
} from "@/utils/walletDisplay";
import {
  fetchGetCoinSettings,
  coinsToCurrency,
  formatCoins,
  type GetCoinSettings,
} from "@/utils/getCoinStore";
import { consumeWalletReloadRequest } from "@/utils/walletUiFlags";
import {
  referralCodeForUser,
  buildReferralLink,
  buildReferralMessage,
  fetchMyReferral,
  type MyReferral,
} from "@/utils/referral";

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
  const { height: windowHeight } = useWindowDimensions();
  const { authState } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; focus?: string; action?: string }>();
  const isPartnerMode = params.mode === "partner";
  const focusTarget = params.focus === "credit" || params.focus === "wallet" ? params.focus : undefined;
  const userId = authState.userId ?? "";

  const scrollRef = useRef<ScrollView | null>(null);
  const creditCardY = useRef<number>(0);
  const didAutoScroll = useRef<boolean>(false);
  const reloadReturnPathRef = useRef<"/wallet-scan" | "/wallet-show-code" | null>(null);
  const [highlighted, setHighlighted] = useState<"credit" | "wallet" | null>(null);

  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [coinSettings, setCoinSettings] = useState<GetCoinSettings | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [myReferral, setMyReferral] = useState<MyReferral | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
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
  const [pillRowWidth, setPillRowWidth] = useState<number>(0);
  const [viewportH, setViewportH] = useState<number>(0);
  const [bodyY, setBodyY] = useState<number>(0);
  const [listY, setListY] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [successNote, setSuccessNote] = useState<string>("");

  const loadAll = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const [b, t, coin, referral] = await Promise.all([
        fetchWalletBalances(userId),
        fetchWalletTransactions(userId),
        fetchGetCoinSettings(),
        fetchMyReferral(),
      ]);
      setBalances(b);
      setTransactions(t.transactions);
      setCoinSettings(coin);
      setMyReferral(referral);
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
      // Reload requested from the Scan / Show Code screens (they dismiss back
      // to this already-mounted wallet screen instead of pushing a new one).
      const returnPath = consumeWalletReloadRequest();
      if (returnPath) {
        reloadReturnPathRef.current = returnPath;
        setAmountText("");
        setActionError("");
        setMethodId("");
        setTopUpStep("amount");
        setTopUpVisible(true);
      }
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

  // Legacy deep-link support (e.g. ?action=reload) — just opens the popup.
  useEffect(() => {
    if (params.action !== "reload") return;
    router.setParams({ action: "" });
    setAmountText("");
    setActionError("");
    setMethodId("");
    setTopUpStep("amount");
    setTopUpVisible(true);
  }, [params.action, router]);

  /** Close the reload popup; if opened from Scan / Show Code, return there. */
  const closeTopUp = useCallback(() => {
    setTopUpVisible(false);
    const returnPath = reloadReturnPathRef.current;
    if (returnPath) {
      reloadReturnPathRef.current = null;
      router.push(
        isPartnerMode
          ? { pathname: returnPath, params: { mode: "partner" } }
          : { pathname: returnPath }
      );
    }
  }, [router, isPartnerMode]);

  useEffect(() => {
    if (!successNote) return;
    const timer = setTimeout(() => setSuccessNote(""), 2600);
    return () => clearTimeout(timer);
  }, [successNote]);

  /** Opens the native share sheet with a referral deep link and bonus-coin pitch. */
  const handleShareReferral = useCallback(async () => {
    const code = referralCodeForUser(userId || "guest");
    const link = buildReferralLink(code);
    const message = buildReferralMessage(code, link);
    console.log("[wallet] sharing referral", { code, link });
    try {
      if (Platform.OS === "web") {
        const nav = navigator as Navigator & {
          share?: (data: { title?: string; text?: string }) => Promise<void>;
        };
        if (nav.share) {
          await nav.share({ title: "GET.ride referral", text: message });
        } else {
          await Clipboard.setStringAsync(message);
          setSuccessNote("Referral link copied to clipboard!");
        }
        return;
      }
      await Share.share(
        Platform.OS === "ios"
          ? { message, url: link }
          : { message }
      );
    } catch (e) {
      console.log("[wallet] referral share dismissed/failed", e);
    }
  }, [userId]);

  const onRefresh = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountText.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }, [amountText]);

  const openTopUp = () => {
    reloadReturnPathRef.current = null;
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
    reloadReturnPathRef.current = null;
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

  // Show as many recent transactions as fit on screen without scrolling.
  // Preferred: real measurements — the scroll viewport height minus the
  // measured top of the activity list (works for both user and partner mode,
  // where the GET.credit card + filter chips push the list further down).
  // Fallback until the first layout pass: an estimate from the window height.
  const maxRecent = useMemo(() => {
    const rowH = 74;
    const bottomPad = 40; // bodyContent paddingBottom
    if (viewportH > 0 && bodyY > 0 && listY > 0) {
      const available = viewportH - (bodyY + listY) - bottomPad;
      return Math.min(Math.max(Math.floor(available / rowH), 2), 12);
    }
    const headerH = 52;
    const heroH = 236;
    const sheetTopPad = 52;
    const activityHeaderH = 46;
    // GET.coin card (both modes) + partner-only GET.credit card & filter chips.
    const coinCardH = 150;
    const partnerExtras = isPartnerMode ? 300 : 0;
    const available =
      windowHeight - headerH - heroH - sheetTopPad - activityHeaderH - bottomPad - coinCardH - partnerExtras;
    return Math.min(Math.max(Math.floor(available / rowH), 2), 12);
  }, [viewportH, bodyY, listY, windowHeight, isPartnerMode]);

  const recentTx = useMemo(() => filteredTx.slice(0, maxRecent), [filteredTx, maxRecent]);

  // Shared pill sizing: every pill gets the same font/icon size, scaled down
  // together just enough for the longest label ("Transfer") to fit in full.
  const pillSizing = useMemo(() => {
    const baseFont = 12;
    const baseIcon = 15;
    if (pillRowWidth <= 0) return { font: baseFont, icon: baseIcon, gap: 5 };
    const pillWidth = (pillRowWidth - 8 * 3) / 4;
    // icon + gap + text(8 chars × ~0.58×font for 700 weight) + inner padding
    const neededAtBase = baseIcon + 5 + 8 * 0.58 * baseFont + 10;
    if (pillWidth >= neededAtBase) return { font: baseFont, icon: baseIcon, gap: 5 };
    const scale = Math.max(pillWidth / neededAtBase, 0.62);
    return {
      font: Math.floor(baseFont * scale * 10) / 10,
      icon: Math.round(baseIcon * scale),
      gap: Math.max(Math.round(5 * scale), 2),
    };
  }, [pillRowWidth]);

  const pillTextSized = { fontSize: pillSizing.font };

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
        onRequestClose={() => (isTopUp ? closeTopUp() : setRechargeVisible(false))}
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
                      onPress={closeTopUp}
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
                      onPress={closeTopUp}
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
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.accent }]} edges={["top"]}>
      {/* Blue gradient backdrop on top, light backdrop below — so the bottom
          edge/overscroll shows the light sheet colour, not blue */}
      <LinearGradient
        colors={[Colors.accent, "#2691c4", Colors.accentDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.heroCircleLarge} />
        <View style={styles.heroCircleSmall} />
        <View style={styles.heroCircleTiny} />
      </LinearGradient>
      <View style={styles.bottomBackdrop} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="wallet-back"
        >
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      ) : (
        <PullDownScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onPullRefresh={onRefresh}
          spinnerColor="#FFFFFF"
          onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        >
          {/* Balance card floats over the boundary between the blue backdrop
              and the light content sheet below. */}
          <View style={styles.heroWrap}>
            <View
              style={[
                styles.balanceCard,
                highlighted === "wallet" ? styles.focusHighlight : null,
              ]}
            >
              <View style={styles.balanceCardTop}>
                <View style={styles.balanceLabelRow}>
                  <View style={styles.balanceTitleRow}>
                    <WalletIcon color={Colors.accent} size={18} />
                    <Text style={styles.balanceLabel}>GET.wallet Balance</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setBalanceHidden((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="wallet-balance-toggle"
                  >
                    {balanceHidden ? (
                      <EyeOff color="#3F3F46" size={20} />
                    ) : (
                      <Eye color="#3F3F46" size={20} />
                    )}
                  </TouchableOpacity>
                </View>
                <Text
                  style={styles.balanceValue}
                  testID="wallet-master-balance"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                >
                  <Text style={styles.balanceCurrency}>RM </Text>
                  {balanceHidden ? "****" : (balances?.getWallet ?? 0).toFixed(2)}
                </Text>
                {lastUpdated ? (
                  <Text style={styles.balanceUpdated} testID="wallet-updated-at">
                    Updated • {formatUpdatedStamp(lastUpdated)}
                  </Text>
                ) : null}
                <View style={styles.balanceDivider} />
              </View>

              <View
                style={styles.pillRow}
                onLayout={(e) => setPillRowWidth(e.nativeEvent.layout.width - 14 * 2)}
              >
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
                    style={[styles.pillInner, { gap: pillSizing.gap }]}
                  >
                    <ReloadDollarIcon color="#FFFFFF" size={pillSizing.icon} />
                    <Text
                      style={[styles.pillText, styles.pillTextOnAccent, pillTextSized]}
                      numberOfLines={1}
                    >
                      Reload
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={() =>
                    router.push(
                      isPartnerMode
                        ? { pathname: "/wallet-scan", params: { mode: "partner" } }
                        : { pathname: "/wallet-scan" }
                    )
                  }
                  activeOpacity={0.85}
                  testID="wallet-scan"
                >
                  <View style={[styles.pillInner, styles.pillWhite, { gap: pillSizing.gap }]}>
                    <ScanLine color="#27272A" size={pillSizing.icon} />
                    <Text style={[styles.pillText, pillTextSized]} numberOfLines={1}>
                      Scan
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.pillWrap}
                  onPress={() =>
                    router.push(
                      isPartnerMode
                        ? { pathname: "/wallet-receive", params: { mode: "partner" } }
                        : { pathname: "/wallet-receive" }
                    )
                  }
                  activeOpacity={0.85}
                  testID="wallet-receive"
                >
                  <View style={[styles.pillInner, styles.pillWhite, { gap: pillSizing.gap }]}>
                    <QrCode color="#27272A" size={pillSizing.icon} />
                    <Text style={[styles.pillText, pillTextSized]} numberOfLines={1}>
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
                  <View style={[styles.pillInner, styles.pillWhite, { gap: pillSizing.gap }]}>
                    <ArrowRightLeft color="#27272A" size={pillSizing.icon} />
                    <Text style={[styles.pillText, pillTextSized]} numberOfLines={1}>
                      Transfer
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View
            style={styles.bodyContent}
            onLayout={(e) => setBodyY(e.nativeEvent.layout.y)}
          >
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

            {/* GET.coin — available in both user and partner mode */}
            <View style={styles.coinCard} testID="wallet-coin-card">
              <View style={styles.cardTopRow}>
                <View style={styles.cardTitleRow}>
                  <Coins color="#EAB308" size={18} />
                  <Text style={styles.creditCardName}>GET.coin</Text>
                </View>
                <View style={styles.coinBadge}>
                  <Text style={styles.coinBadgeText}>GC</Text>
                </View>
              </View>
              <Text style={styles.creditBalance} testID="wallet-coin-balance">
                {formatCoins(balances?.getCoin ?? 0)}
              </Text>
              <Text style={styles.creditHint}>
                {coinSettings
                  ? `≈ RM ${coinsToCurrency(balances?.getCoin ?? 0, coinSettings.coinsPerCurrency).toFixed(2)} · Rate: RM1 = ${coinSettings.coinsPerCurrency % 1 === 0 ? coinSettings.coinsPerCurrency : coinSettings.coinsPerCurrency.toFixed(2)} GC`
                  : "Get Coins earned in the app."}
              </Text>
              <View style={styles.coinBtnRow}>
                <TouchableOpacity
                  style={[styles.rechargeBtn, styles.coinTradeBtn, { backgroundColor: "#EAB308" }]}
                  onPress={() => router.push("/wallet-trade" as any)}
                  testID="wallet-trade-open"
                >
                  <TrendingUp color="#000000" size={16} />
                  <Text style={styles.rechargeBtnText}>Trade GET.coin</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.coinQrBtn}
                  onPress={() => router.push("/wallet-coin-qr" as any)}
                  testID="wallet-coin-qr-open"
                >
                  <QrCode color="#92400E" size={16} />
                  <Text style={styles.coinQrBtnText}>QR</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* You were invited — shown once, after signing up via a referral link */}
            {myReferral ? (
              <View style={styles.invitedCard} testID="wallet-invited-card">
                <View style={styles.invitedIconWrap}>
                  <UserCheck color="#059669" size={22} />
                </View>
                <View style={styles.referralInfo}>
                  <Text style={styles.invitedTitle} numberOfLines={1}>
                    {myReferral.referrerName
                      ? `You were invited by ${myReferral.referrerName}`
                      : "You joined with a referral link"}
                  </Text>
                  <Text style={styles.invitedSub} numberOfLines={2}>
                    {myReferral.referredCoins > 0
                      ? `Welcome bonus of ${formatCoins(myReferral.referredCoins)} added to your GET.coin.`
                      : "Welcome to GET.ride — enjoy the ride!"}
                  </Text>
                </View>
                {myReferral.referredCoins > 0 ? (
                  <View style={styles.invitedBonusPill}>
                    <Coins color="#B45309" size={13} />
                    <Text style={styles.invitedBonusText}>
                      +{formatCoins(myReferral.referredCoins)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Referral — invite friends, earn bonus GET.coin */}
            <View style={styles.referralCard} testID="wallet-referral-card">
              <View style={styles.referralIconWrap}>
                <Gift color={Colors.accent} size={22} />
              </View>
              <View style={styles.referralInfo}>
                <Text style={styles.referralTitle}>Invite friends, earn GET.coin</Text>
                <Text style={styles.referralSub} numberOfLines={2}>
                  Share your link — you both get bonus coins when they take their first ride.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.referralBtn, { backgroundColor: Colors.accent }]}
                onPress={handleShareReferral}
                activeOpacity={0.85}
                testID="wallet-share-referral"
              >
                <Share2 color={Colors.onAccent} size={15} />
                <Text style={[styles.referralBtnText, { color: Colors.onAccent }]}>Share</Text>
              </TouchableOpacity>
            </View>

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

            <View style={styles.filterRow}>
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

            {recentTx.length === 0 ? (
              <View
                style={styles.emptyCard}
                onLayout={(e) => setListY(e.nativeEvent.layout.y)}
              >
                <WalletIcon color="#9CA3AF" size={32} />
                <Text style={styles.emptyTitle}>No activity yet</Text>
                <Text style={styles.emptySub}>Reload your GET.wallet to get started.</Text>
              </View>
            ) : (
              <View
                style={styles.activityCard}
                onLayout={(e) => setListY(e.nativeEvent.layout.y)}
              >
                {recentTx.map((tx, idx) => {
                  const meta = walletTxMeta(tx, Colors);
                  const cat = walletTxCategory(tx);
                  const positive = tx.amount >= 0;
                  return (
                    <View
                      key={tx.id}
                      style={[
                        styles.activityRow,
                        idx < recentTx.length - 1 ? styles.activityRowDivider : null,
                      ]}
                      testID={`wallet-tx-${tx.id}`}
                    >
                      <View style={[styles.categoryIconWrap, { backgroundColor: cat.bg }]}>
                        <cat.Icon color={cat.color} size={18} strokeWidth={2.4} />
                      </View>
                      <View style={styles.activityInfo}>
                        <Text style={styles.activityLabel} numberOfLines={1}>
                          {meta.label}
                        </Text>
                        <View style={styles.activityMetaRow}>
                          <View style={[styles.categoryTag, { backgroundColor: cat.bg }]}>
                            <Text style={[styles.categoryTagText, { color: cat.color }]}>
                              {cat.label}
                            </Text>
                          </View>
                          <Text style={styles.activityDate} numberOfLines={1}>
                            {formatActivityDate(tx.createdAt)}
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.activityAmount,
                          { color: positive ? "#16A34A" : "#DC2626" },
                        ]}
                      >
                        {positive
                          ? `+ ${walletAmountText(tx.walletType, tx.amount)}`
                          : `-${walletAmountText(tx.walletType, tx.amount)}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </PullDownScrollView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: "#FFFFFF",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    marginBottom: -34,
    zIndex: 2,
  },
  bottomBackdrop: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%" as const,
    backgroundColor: "#F4F5F7",
  },
  heroCircleLarge: {
    position: "absolute" as const,
    top: -40,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroCircleSmall: {
    position: "absolute" as const,
    top: 190,
    right: 40,
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  heroCircleTiny: {
    position: "absolute" as const,
    top: 30,
    left: -18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  balanceCard: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    overflow: "hidden" as const,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  balanceCardTop: {
    backgroundColor: "#EFF7FC",
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  balanceLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  balanceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balanceLabel: {
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 0.2,
    color: "#3F3F46",
  },
  balanceValue: {
    fontSize: 40,
    fontWeight: "800" as const,
    color: "#3F3F46",
  },
  balanceCurrency: {
    fontSize: 22,
    fontWeight: "600" as const,
    color: "#6B7280",
  },
  balanceUpdated: {
    fontSize: 13,
    color: "#8E8E93",
    marginTop: 4,
  },
  balanceDivider: {
    height: 1,
    backgroundColor: "#D9E4EC",
    marginTop: 14,
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "#FFFFFF",
  },
  pillWrap: {
    flex: 1,
    minWidth: 0,
  },
  pillInner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 3,
    minWidth: 0,
  },
  pillWhite: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#ECECEF",
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pillText: {
    fontSize: 12,
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
    flexGrow: 1,
    backgroundColor: "#F4F5F7",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 52,
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
  coinCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#F3E8C0",
    backgroundColor: "#FFFDF4",
    marginBottom: 18,
  },
  coinBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: "#EAB30822",
  },
  coinBadgeText: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: "#A16207",
    letterSpacing: 0.5,
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
  coinBtnRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  coinTradeBtn: {
    flex: 1,
  },
  coinQrBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: "#EAB308",
    backgroundColor: "#FFFFFF",
  },
  coinQrBtnText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#92400E",
  },
  referralCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#D6EBF7",
    backgroundColor: "#F2FAFE",
    marginBottom: 18,
  },
  invitedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
    marginBottom: 12,
  },
  invitedIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  invitedTitle: {
    fontSize: 14,
    fontWeight: "800" as const,
    color: "#065F46",
    marginBottom: 2,
  },
  invitedSub: {
    fontSize: 12,
    lineHeight: 16,
    color: "#4B7C64",
  },
  invitedBonusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FEF3C7",
  },
  invitedBonusText: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: "#B45309",
  },
  referralIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  referralInfo: {
    flex: 1,
    minWidth: 0,
  },
  referralTitle: {
    fontSize: 14,
    fontWeight: "800" as const,
    color: "#111827",
    marginBottom: 2,
  },
  referralSub: {
    fontSize: 12,
    lineHeight: 16,
    color: "#6B7280",
  },
  referralBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  referralBtnText: {
    fontSize: 13,
    fontWeight: "800" as const,
  },
  activityHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 2,
  },
  activityTitle: {
    fontSize: 21,
    fontWeight: "800" as const,
    color: "#27272A",
  },
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  viewAllText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#27272A",
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
  categoryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryTag: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryTagText: {
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.4,
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
  activityAmount: {
    fontSize: 15,
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
