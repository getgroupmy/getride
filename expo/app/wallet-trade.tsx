import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import QrScanCamera, { useQrCameraPermission } from "@/components/QrScanCamera";
import {
  ChevronLeft,
  Coins,
  TrendingUp,
  TrendingDown,
  Wallet,
  Check,
  Info,
  Send,
  QrCode,
  ScanLine,
  X,
  Camera as CameraIcon,
} from "lucide-react-native";
import Svg, { Polyline, Line } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { walletPalette, type WalletPalette } from "@/utils/walletTheme";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchGetCoinSettings,
  fetchCoinMarketStats,
  fetchCoinRateHistory,
  computeMarketRate,
  recordCoinRateSnapshot,
  formatCoins,
  type GetCoinSettings,
  type CoinMarketStats,
  type CoinMarketRate,
  type CoinRatePoint,
} from "@/utils/getCoinStore";
import {
  fetchWalletBalances,
  tradeCoins,
  type WalletBalances,
} from "@/utils/walletStore";
import {
  requestCoinTransfer,
  cancelTransferRequest,
  fetchTransferRequest,
  subscribeTransferRequestUpdates,
  isRequestExpired,
  type WalletTransferRequest,
  type TransferRequestStatus,
} from "@/utils/transferRequestsStore";

const COIN_YELLOW = "#EAB308";
const COIN_AMBER_DARK = "#92400E";
const SEND_AMBER = "#D97706";

type TradeDirection = "buy" | "sell" | "send";

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Parse the "Send to" field: a pasted/scanned account id (raw uuid or a
 * getpay://u/<id> QR payload) wins; anything with 7+ digits is treated as a
 * phone number and resolved server-side.
 */
function parseRecipient(raw: string): { toUserId?: string; toPhone?: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const idMatch = text.match(UUID_RE);
  if (idMatch) return { toUserId: idMatch[1].toLowerCase() };
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 7) return { toPhone: text };
  return null;
}

/** Compact RM formatting for rates: RM0.10, RM1.25, RM0.0825. */
function formatRate(rate: number): string {
  if (rate >= 1) return `RM${rate.toFixed(2)}`;
  return `RM${parseFloat(rate.toFixed(4)).toString().replace(/^0\./, "0.")}`;
}

/** Simple polyline sparkline for the rate history. */
function RateSparkline({ points, color }: { points: number[]; color: string }) {
  const { styles, wc } = useWalletStyles();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 64 });
  const polyline = useMemo(() => {
    if (points.length < 2 || size.w <= 0) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || max || 1;
    const stepX = size.w / (points.length - 1);
    const pad = 6;
    const usable = size.h - pad * 2;
    return points
      .map((p, i) => {
        const y = pad + usable * (1 - (p - min) / span);
        return `${(i * stepX).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points, size]);

  return (
    <View
      style={styles.sparklineWrap}
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {polyline ? (
        <Svg width={size.w} height={size.h}>
          <Line
            x1={0}
            y1={size.h / 2}
            x2={size.w}
            y2={size.h / 2}
            stroke={wc.border}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <Polyline
            points={polyline}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : (
        <Text style={styles.sparklineEmpty}>Price chart builds as rates are recorded</Text>
      )}
    </View>
  );
}

/**
 * Trade GET.coin — buy GC with GET.wallet or sell GC back, at the live market
 * rate (or the pegged rate when market pricing is off). Shows what's driving
 * the price and the coin supply against the admin cap.
 */
export default function WalletTradeScreen() {
  const router = useRouter();
  const { styles, wc, Colors } = useWalletStyles();
  const { authState } = useAuth();
  const userId = authState.userId ?? "guest";

  const [loading, setLoading] = useState<boolean>(true);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [settings, setSettings] = useState<GetCoinSettings | null>(null);
  const [stats, setStats] = useState<CoinMarketStats | null>(null);
  const [history, setHistory] = useState<CoinRatePoint[]>([]);
  const [direction, setDirection] = useState<TradeDirection>("buy");
  const [amountInput, setAmountInput] = useState<string>("");
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [trading, setTrading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [successNote, setSuccessNote] = useState<string>("");

  const [scanVisible, setScanVisible] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string>("");
  const [permission, requestPermission] = useQrCameraPermission();
  const scanLockRef = useRef<boolean>(false);

  // Send approval handshake: the request we're waiting on, then its outcome.
  const [awaiting, setAwaiting] = useState<{
    requestId: string;
    coins: number;
    recipientHint: string;
  } | null>(null);
  const [outcome, setOutcome] = useState<{
    status: TransferRequestStatus;
    name: string | null;
    coins: number;
  } | null>(null);
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (scanVisible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [scanVisible, permission, requestPermission]);

  const openScanner = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    scanLockRef.current = false;
    setScanError("");
    setScanVisible(true);
  };

  const handleScanned = useCallback((data: string) => {
    if (scanLockRef.current || !data) return;
    scanLockRef.current = true;
    const parsed = parseRecipient(data);
    if (!parsed) {
      setScanError("That QR code isn't a GET wallet code. Try another.");
      // Re-arm after a moment so the user can point at a different code.
      setTimeout(() => {
        scanLockRef.current = false;
      }, 1200);
      return;
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setRecipientInput(data.trim());
    setError("");
    setSuccessNote("");
    setScanVisible(false);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [b, s, m] = await Promise.all([
        fetchWalletBalances(userId),
        fetchGetCoinSettings(),
        fetchCoinMarketStats(),
      ]);
      setBalances(b);
      setSettings(s);
      setStats(m);
      const rate = computeMarketRate(s, m);
      void recordCoinRateSnapshot(rate.ratePerGC);
      const h = await fetchCoinRateHistory(48);
      setHistory(h);
    } catch (e) {
      console.log("[wallet-trade] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const market: CoinMarketRate | null = useMemo(() => {
    if (!settings || !stats) return null;
    return computeMarketRate(settings, stats);
  }, [settings, stats]);

  const chartPoints = useMemo(() => {
    const pts = history.map((p) => p.rate);
    if (market && (pts.length === 0 || pts[pts.length - 1] !== market.ratePerGC)) {
      pts.push(market.ratePerGC);
    }
    return pts;
  }, [history, market]);

  const parsedCoins = useMemo(() => {
    const n = Number(amountInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }, [amountInput]);

  const tradeValue = useMemo(() => {
    if (!market || !(parsedCoins > 0)) return 0;
    return Math.round(parsedCoins * market.ratePerGC * 100) / 100;
  }, [market, parsedCoins]);

  const recipient = useMemo(() => parseRecipient(recipientInput), [recipientInput]);

  const maxCoins = useMemo(() => {
    if (!market || !balances) return 0;
    if (direction !== "buy") return Math.floor(balances.getCoin * 100) / 100;
    if (!(market.ratePerGC > 0)) return 0;
    let affordable = Math.floor((balances.getWallet / market.ratePerGC) * 100) / 100;
    if (settings && settings.maxSupply > 0 && stats) {
      const remaining = Math.max(settings.maxSupply - stats.circulatingSupply, 0);
      affordable = Math.min(affordable, Math.floor(remaining * 100) / 100);
    }
    return affordable;
  }, [market, balances, direction, settings, stats]);

  const canConfirm =
    !trading &&
    !loading &&
    parsedCoins > 0 &&
    market !== null &&
    parsedCoins <= maxCoins + 0.0001 &&
    (direction === "send" ? recipient !== null : tradeValue > 0);

  const handleQuick = (v: number | "max") => {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    setError("");
    setSuccessNote("");
    if (v === "max") {
      setAmountInput(maxCoins > 0 ? String(maxCoins) : "");
    } else {
      setAmountInput(String(v));
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !market || !settings || !stats) return;
    setTrading(true);
    setError("");
    setSuccessNote("");

    if (direction === "send") {
      if (!authState.userId || !recipient) {
        setTrading(false);
        setError(!authState.userId ? "Sign in to send coins." : "Enter who to send to.");
        return;
      }
      const res = await requestCoinTransfer({
        fromUserId: authState.userId,
        ...recipient,
        coins: parsedCoins,
      });
      setTrading(false);
      if (!res.ok) {
        setError(res.error ?? "Transfer failed. Please try again.");
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        return;
      }
      // Pre-approval databases send instantly — keep the old success path.
      if (res.immediate) {
        if (res.balances) setBalances(res.balances);
        setAmountInput("");
        setRecipientInput("");
        setSuccessNote(
          `Sent ${formatCoins(res.coins ?? 0)} to ${res.recipientName ?? recipientInput.trim()}`
        );
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        return;
      }
      if (!res.requestId) {
        setError("Transfer request failed. Please try again.");
        return;
      }
      // The recipient now gets a popup naming the sender and the amount;
      // coins move once they accept.
      setAwaiting({
        requestId: res.requestId,
        coins: res.coins ?? parsedCoins,
        recipientHint: recipientInput.trim(),
      });
      return;
    }

    const res = await tradeCoins({
      userId,
      direction,
      coins: parsedCoins,
      ratePerGC: market.ratePerGC,
      maxSupply: settings.maxSupply,
      circulatingSupply: stats.circulatingSupply,
    });
    setTrading(false);
    if (!res.ok) {
      setError(res.error ?? "Trade failed. Please try again.");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      return;
    }
    if (res.balances) setBalances(res.balances);
    setAmountInput("");
    setSuccessNote(
      direction === "buy"
        ? `Bought ${formatCoins(res.coins ?? 0)} for RM${(res.amountCurrency ?? 0).toFixed(2)}`
        : `Sold ${formatCoins(res.coins ?? 0)} for RM${(res.amountCurrency ?? 0).toFixed(2)}`
    );
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    // Refresh signals — the trade itself moves the market.
    try {
      const m = await fetchCoinMarketStats();
      setStats(m);
    } catch (e) {
      console.log("[wallet-trade] stats refresh failed", e);
    }
  };

  // A watched request left the pending state (realtime or poll — both can
  // fire, so the resolved-ids set dedupes).
  const handleRequestResolved = useCallback(
    (req: WalletTransferRequest) => {
      if (req.status === "pending") return;
      if (resolvedIdsRef.current.has(req.id)) return;
      resolvedIdsRef.current.add(req.id);
      setAwaiting(null);
      setOutcome({ status: req.status, name: req.toName, coins: req.coins });
      if (req.status === "accepted") {
        setAmountInput("");
        setRecipientInput("");
        fetchWalletBalances(userId)
          .then(setBalances)
          .catch((e) => console.log("[wallet-trade] balance refresh failed", e));
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      } else if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    },
    [userId]
  );

  // Watch the pending request for the recipient's response — realtime first,
  // with a light poll as fallback (realtime may be unavailable).
  useEffect(() => {
    if (!awaiting) return;
    const unsubscribe = subscribeTransferRequestUpdates(
      awaiting.requestId,
      handleRequestResolved
    );
    const poll = setInterval(async () => {
      const req = await fetchTransferRequest(awaiting.requestId);
      if (!req) return;
      if (req.status !== "pending") {
        handleRequestResolved(req);
      } else if (isRequestExpired(req)) {
        handleRequestResolved({ ...req, status: "expired" });
      }
    }, 5000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [awaiting, handleRequestResolved]);

  const handleCancelRequest = async () => {
    if (!awaiting || !authState.userId) return;
    const id = awaiting.requestId;
    // Ignore any late update events for this request.
    resolvedIdsRef.current.add(id);
    setAwaiting(null);
    await cancelTransferRequest({ requestId: id, userId: authState.userId });
  };

  const goBack = () => {
    try {
      router.back();
    } catch (e) {
      console.log("[wallet-trade] back failed", e);
      router.replace("/wallet" as never);
    }
  };

  const up = (market?.changePct ?? 0) >= 0;
  const trendColor = (market?.changePct ?? 0) === 0 ? wc.textMuted : up ? wc.amountPositive : wc.amountNegative;

  const supplyRatio =
    settings && stats && settings.maxSupply > 0
      ? Math.min(stats.circulatingSupply / settings.maxSupply, 1)
      : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} testID="trade-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft color={wc.textStrong} size={26} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Coins color={COIN_YELLOW} size={18} />
          <Text style={styles.headerTitle}>Trade GET.coin</Text>
        </View>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.push("/wallet-coin-qr" as never)}
          testID="trade-show-qr"
          accessibilityRole="button"
          accessibilityLabel="Show my GET.coin QR code"
        >
          <QrCode color={wc.textStrong} size={22} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Price card */}
            <View style={styles.priceCard} testID="trade-price-card">
              <View style={styles.priceTopRow}>
                <Text style={styles.priceLabel}>1 GC</Text>
                {market && settings?.marketEnabled ? (
                  <View style={[styles.trendBadge, { backgroundColor: trendColor + "18" }]}>
                    {up ? (
                      <TrendingUp color={trendColor} size={13} />
                    ) : (
                      <TrendingDown color={trendColor} size={13} />
                    )}
                    <Text style={[styles.trendText, { color: trendColor }]}>
                      {market.changePct >= 0 ? "+" : ""}
                      {market.changePct.toFixed(2)}%
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.trendBadge, { backgroundColor: wc.surfaceMuted }]}>
                    <Text style={[styles.trendText, { color: wc.textMuted }]}>Fixed rate</Text>
                  </View>
                )}
              </View>
              <Text style={styles.priceValue} testID="trade-rate">
                {market ? formatRate(market.ratePerGC) : "—"}
              </Text>
              {market && settings?.marketEnabled ? (
                <Text style={styles.pegText}>
                  Pegged rate {formatRate(market.baseRatePerGC)} · moves with app activity
                </Text>
              ) : (
                <Text style={styles.pegText}>Rate set by admin — market pricing is off</Text>
              )}
              <RateSparkline points={chartPoints} color={trendColor} />
            </View>

            {/* Market drivers */}
            {settings?.marketEnabled && market && market.contributions.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>What&apos;s moving the price</Text>
                {market.contributions.map((c) => {
                  const pos = c.pct >= 0;
                  return (
                    <View key={c.key} style={styles.driverRow}>
                      <Text style={styles.driverLabel}>{c.label}</Text>
                      <Text
                        style={[
                          styles.driverPct,
                          { color: c.pct === 0 ? wc.textFaint : pos ? wc.amountPositive : wc.amountNegative },
                        ]}
                      >
                        {pos ? "+" : ""}
                        {c.pct.toFixed(2)}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Supply */}
            {settings && settings.maxSupply > 0 && stats ? (
              <View style={styles.card} testID="trade-supply-card">
                <Text style={styles.cardTitle}>Coin supply</Text>
                <View style={styles.supplyBarTrack}>
                  <View
                    style={[
                      styles.supplyBarFill,
                      { width: `${Math.max(supplyRatio * 100, 2)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.supplyText}>
                  {formatCoins(stats.circulatingSupply)} of {formatCoins(settings.maxSupply)}{" "}
                  minted ({Math.round(supplyRatio * 100)}%)
                </Text>
              </View>
            ) : null}

            {/* Trade form */}
            <View style={styles.card}>
              <View style={styles.segmentTrack}>
                {(["buy", "sell", "send"] as TradeDirection[]).map((d) => {
                  const selected = direction === d;
                  const selectedColor =
                    d === "buy" ? wc.amountPositive : d === "sell" ? wc.amountNegative : SEND_AMBER;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[
                        styles.segment,
                        selected && { backgroundColor: selectedColor },
                      ]}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
                        setDirection(d);
                        setError("");
                        setSuccessNote("");
                      }}
                      testID={`trade-tab-${d}`}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          { color: selected ? Colors.onAccent : wc.textMuted },
                        ]}
                      >
                        {d === "buy" ? "Buy" : d === "sell" ? "Sell" : "Send"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {direction === "send" ? (
                <TouchableOpacity
                  style={styles.myQrRow}
                  onPress={() => router.push("/wallet-coin-qr" as never)}
                  testID="trade-my-qr"
                  accessibilityRole="button"
                >
                  <QrCode color={COIN_AMBER_DARK} size={14} />
                  <Text style={styles.myQrText}>Receiving instead? Show my QR code</Text>
                </TouchableOpacity>
              ) : null}

              {direction === "send" ? (
                <View style={styles.recipientRow}>
                  <Send color={wc.coinText} size={16} />
                  <TextInput
                    style={styles.recipientInput}
                    value={recipientInput}
                    onChangeText={(t) => {
                      setRecipientInput(t);
                      setError("");
                      setSuccessNote("");
                    }}
                    placeholder="Recipient phone number or wallet QR code"
                    placeholderTextColor={wc.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="trade-recipient-input"
                    accessibilityLabel="Receiving instead? Show my QR code"
                  />
                  <TouchableOpacity
                    style={styles.scanBtn}
                    onPress={openScanner}
                    testID="trade-scan-qr"
                    accessibilityRole="button"
                    accessibilityLabel="Scan a QR code"
                  >
                    <ScanLine color={COIN_AMBER_DARK} size={18} />
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.amountRow}>
                <TextInput
                  style={styles.amountInput}
                  value={amountInput}
                  onChangeText={(t) => {
                    setAmountInput(t);
                    setError("");
                    setSuccessNote("");
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={wc.placeholder}
                  testID="trade-amount-input"
                  accessibilityLabel="Amount"
                />
                <Text style={styles.amountUnit}>GC</Text>
              </View>

              <View style={styles.quickRow}>
                {[10, 50, 100].map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={styles.quickChip}
                    onPress={() => handleQuick(v)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.quickChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.quickChip, styles.quickChipMax]}
                  onPress={() => handleQuick("max")}
                  testID="trade-max"
                  accessibilityRole="button"
                >
                  <Text style={[styles.quickChipText, { color: COIN_AMBER_DARK }]}>MAX</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  {direction === "buy"
                    ? "You pay"
                    : direction === "sell"
                      ? "You receive"
                      : "Worth about"}
                </Text>
                <Text style={styles.summaryValue} testID="trade-total">
                  RM {tradeValue.toFixed(2)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <View style={styles.balanceInline}>
                  <Wallet color={wc.textMuted} size={13} />
                  <Text style={styles.summaryLabel}>
                    {direction === "buy"
                      ? `GET.wallet RM ${(balances?.getWallet ?? 0).toFixed(2)}`
                      : `GET.coin ${formatCoins(balances?.getCoin ?? 0)}`}
                  </Text>
                </View>
                {parsedCoins > maxCoins + 0.0001 ? (
                  <Text style={[styles.summaryLabel, { color: wc.amountNegative }]}>
                    {direction === "buy" ? "Not enough balance" : "Not enough coins"}
                  </Text>
                ) : null}
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {successNote ? (
                <View style={styles.successRow}>
                  <Check color={wc.amountPositive} size={15} />
                  <Text style={styles.successText}>{successNote}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor:
                      direction === "buy"
                        ? wc.amountPositive
                        : direction === "sell"
                          ? wc.amountNegative
                          : SEND_AMBER,
                    opacity: canConfirm ? 1 : 0.4,
                  },
                ]}
                onPress={handleConfirm}
                disabled={!canConfirm}
                testID="trade-confirm"
                accessibilityRole="button"
              >
                {trading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmText}>
                    {`${direction === "buy" ? "Buy" : direction === "sell" ? "Sell" : "Send"} ${
                      parsedCoins > 0 ? formatCoins(parsedCoins) : "GET.coin"
                    }`}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.noteRow}>
              <Info color={wc.textFaint} size={13} />
              <Text style={styles.noteText}>
                Trades settle instantly between GET.wallet and GET.coin at the rate shown.
                Sending asks the recipient to approve first — the coins move to their
                GET.coin wallet once they accept. Spending and ride redemptions always
                use the official pegged rate.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* QR scanner — fills the "Send to" field from a wallet QR code */}
      <Modal
        visible={scanVisible}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setScanVisible(false)}
      >
        <View style={styles.scanContainer} testID="trade-scan-modal">
          {permission?.granted ? (
            <QrScanCamera
              style={StyleSheet.absoluteFill}
              active={scanVisible}
              onScanned={handleScanned}
              testID="trade-scan-camera"
            />
          ) : null}
          <SafeAreaView style={styles.scanOverlay} edges={["top", "bottom"]}>
            <View style={styles.scanTopRow}>
              <TouchableOpacity
                style={styles.scanCloseBtn}
                onPress={() => setScanVisible(false)}
                testID="trade-scan-close"
                accessibilityRole="button"
              >
                <X color="#FFFFFF" size={22} />
              </TouchableOpacity>
              <Text style={styles.scanTitle}>Scan wallet QR</Text>
              <View style={styles.scanCloseBtn} />
            </View>

            <View style={styles.scanFrameArea}>
              {permission?.granted ? (
                <>
                  <View style={styles.scanFrame}>
                    <View style={[styles.scanCorner, styles.scanCornerTL]} />
                    <View style={[styles.scanCorner, styles.scanCornerTR]} />
                    <View style={[styles.scanCorner, styles.scanCornerBL]} />
                    <View style={[styles.scanCorner, styles.scanCornerBR]} />
                  </View>
                  <Text style={styles.scanHint}>
                    {scanError || "Point at the recipient's GET.coin QR code"}
                  </Text>
                </>
              ) : (
                <View style={styles.scanPermissionCard}>
                  <CameraIcon color="#FFFFFF" size={34} />
                  <Text style={styles.scanPermissionTitle}>Camera access needed</Text>
                  <Text style={styles.scanPermissionSub}>
                    Allow camera access to scan the recipient&apos;s wallet QR code.
                  </Text>
                  <TouchableOpacity
                    style={styles.scanPermissionBtn}
                    onPress={() => {
                      if (permission?.canAskAgain) {
                        requestPermission();
                      } else {
                        Linking.openSettings().catch(() => {});
                      }
                    }}
                    testID="trade-scan-allow-camera"
                    accessibilityRole="button"
                  >
                    <Text style={styles.scanPermissionBtnText}>
                      {permission?.canAskAgain === false ? "Open Settings" : "Allow Camera"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Send approval — waiting for the recipient, then the outcome */}
      <Modal
        visible={awaiting !== null || outcome !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (outcome) setOutcome(null);
        }}
      >
        <View style={styles.approvalBackdrop}>
          {awaiting ? (
            <View style={styles.approvalCard} testID="transfer-waiting-modal">
              <ActivityIndicator color={SEND_AMBER} size="large" />
              <Text style={styles.approvalTitle}>Waiting for approval</Text>
              <Text style={styles.approvalSub}>
                {`${awaiting.recipientHint || "The recipient"} got a notification to accept ${formatCoins(
                  awaiting.coins
                )} from you. The coins move once they approve.`}
              </Text>
              <TouchableOpacity
                style={styles.approvalCancelBtn}
                onPress={handleCancelRequest}
                testID="transfer-cancel-request"
                accessibilityRole="button"
              >
                <Text style={styles.approvalCancelText}>Cancel request</Text>
              </TouchableOpacity>
            </View>
          ) : outcome ? (
            <View style={styles.approvalCard} testID="transfer-outcome-modal">
              <View
                style={[
                  styles.approvalIconWrap,
                  {
                    backgroundColor:
                      outcome.status === "accepted" ? wc.surfaceSuccess : wc.surfaceDanger,
                  },
                ]}
              >
                {outcome.status === "accepted" ? (
                  <Check color={wc.amountPositive} size={34} />
                ) : (
                  <X color={wc.amountNegative} size={34} />
                )}
              </View>
              <Text style={styles.approvalTitle} testID="transfer-outcome-title">
                {outcome.status === "accepted"
                  ? `${outcome.name ?? "Recipient"} approved your request`
                  : outcome.status === "declined"
                    ? "The recipient declined the transfer"
                    : outcome.status === "expired"
                      ? "Request expired"
                      : outcome.status === "failed"
                        ? "Transfer failed"
                        : "Request cancelled"}
              </Text>
              <Text style={styles.approvalSub}>
                {outcome.status === "accepted"
                  ? `Sent ${formatCoins(outcome.coins)} to ${outcome.name ?? "the recipient"}.`
                  : outcome.status === "expired"
                    ? "The recipient didn't respond in time. Your GET.coin was not moved."
                    : outcome.status === "failed"
                      ? "There wasn't enough GET.coin when the recipient accepted."
                      : "Your GET.coin was not moved."}
              </Text>
              <TouchableOpacity
                style={[
                  styles.approvalDoneBtn,
                  {
                    backgroundColor:
                      outcome.status === "accepted" ? wc.amountPositive : wc.text,
                  },
                ]}
                onPress={() => setOutcome(null)}
                testID="transfer-outcome-done"
                accessibilityRole="button"
              >
                <Text style={styles.approvalDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(wc: WalletPalette, Colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: wc.surfaceMuted },
    flex: { flex: 1 },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: wc.surfaceMuted,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTitleRow: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 6,
    },
    headerTitle: { fontSize: 17, fontWeight: "800" as const, color: wc.textStrong },
    loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    priceCard: {
      backgroundColor: wc.surfaceCoin,
      borderColor: wc.borderCoin,
      borderWidth: 1,
      borderRadius: 18,
      padding: 16,
    },
    priceTopRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    priceLabel: { fontSize: 14, fontWeight: "800" as const, color: COIN_AMBER_DARK },
    trendBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    trendText: { fontSize: 12, fontWeight: "800" as const },
    priceValue: { fontSize: 32, fontWeight: "900" as const, color: wc.textStrong, marginTop: 4 },
    pegText: { fontSize: 12, color: wc.textMuted, marginTop: 2 },
    sparklineWrap: {
      height: 64,
      marginTop: 12,
      justifyContent: "center" as const,
    },
    sparklineEmpty: { fontSize: 12, color: wc.textFaint, textAlign: "center" as const },
    card: {
      backgroundColor: wc.surface,
      borderColor: wc.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: 16,
    },
    cardTitle: { fontSize: 14, fontWeight: "800" as const, color: wc.textStrong, marginBottom: 10 },
    driverRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 6,
    },
    driverLabel: { fontSize: 13, color: wc.text },
    driverPct: { fontSize: 13, fontWeight: "800" as const },
    supplyBarTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: wc.surfaceMuted,
      overflow: "hidden" as const,
    },
    supplyBarFill: {
      height: 8,
      borderRadius: 4,
      backgroundColor: COIN_YELLOW,
    },
    supplyText: { fontSize: 12, color: wc.textMuted, marginTop: 8 },
    segmentTrack: {
      flexDirection: "row" as const,
      backgroundColor: wc.surfaceMuted,
      borderRadius: 12,
      padding: 4,
      marginBottom: 14,
    },
    segment: {
      flex: 1,
      borderRadius: 9,
      paddingVertical: 9,
      alignItems: "center" as const,
    },
    segmentText: { fontSize: 14, fontWeight: "800" as const },
    myQrRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginBottom: 10,
      alignSelf: "flex-start" as const,
    },
    myQrText: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: COIN_AMBER_DARK,
      textDecorationLine: "underline" as const,
    },
    recipientRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      borderWidth: 1,
      borderColor: wc.borderCoin,
      borderRadius: 14,
      paddingHorizontal: 14,
      backgroundColor: wc.surfaceCoin,
      marginBottom: 10,
    },
    recipientInput: {
      flex: 1,
      fontSize: 15,
      fontWeight: "600" as const,
      color: wc.textStrong,
      paddingVertical: 12,
    },
    scanBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: wc.surfaceCoinPill,
    },
    scanContainer: { flex: 1, backgroundColor: "#111111" },
    scanOverlay: { flex: 1 },
    scanTopRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    scanCloseBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    scanTitle: { fontSize: 16, fontWeight: "800" as const, color: "#FFFFFF" },
    scanFrameArea: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 22,
    },
    scanFrame: { width: 260, height: 260 },
    scanCorner: {
      position: "absolute" as const,
      width: 52,
      height: 52,
      borderColor: "#FFFFFF",
    },
    scanCornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 30 },
    scanCornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 30 },
    scanCornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 30 },
    scanCornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 30 },
    scanHint: {
      fontSize: 14,
      fontWeight: "600" as const,
      color: "#FFFFFF",
      textAlign: "center" as const,
      paddingHorizontal: 40,
    },
    scanPermissionCard: {
      alignItems: "center" as const,
      gap: 10,
      paddingHorizontal: 32,
    },
    scanPermissionTitle: { fontSize: 18, fontWeight: "800" as const, color: "#FFFFFF" },
    scanPermissionSub: {
      fontSize: 14,
      color: "rgba(255,255,255,0.75)",
      textAlign: "center" as const,
      lineHeight: 20,
    },
    scanPermissionBtn: {
      marginTop: 8,
      borderRadius: 999,
      paddingHorizontal: 26,
      paddingVertical: 12,
      backgroundColor: SEND_AMBER,
    },
    scanPermissionBtnText: { fontSize: 15, fontWeight: "800" as const, color: "#FFFFFF" },
    amountRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      borderWidth: 1,
      borderColor: wc.border,
      borderRadius: 14,
      paddingHorizontal: 16,
      backgroundColor: wc.surfaceMuted,
    },
    amountInput: {
      flex: 1,
      fontSize: 26,
      fontWeight: "800" as const,
      color: wc.textStrong,
      paddingVertical: 12,
    },
    amountUnit: { fontSize: 16, fontWeight: "800" as const, color: wc.coinText },
    quickRow: {
      flexDirection: "row" as const,
      gap: 8,
      marginTop: 10,
    },
    quickChip: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: "center" as const,
      backgroundColor: wc.surfaceMuted,
    },
    quickChipMax: { backgroundColor: wc.surfaceCoinPill },
    quickChipText: { fontSize: 13, fontWeight: "800" as const, color: wc.text },
    summaryRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginTop: 12,
    },
    balanceInline: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
    summaryLabel: { fontSize: 13, color: wc.textMuted },
    summaryValue: { fontSize: 16, fontWeight: "900" as const, color: wc.textStrong },
    errorText: { fontSize: 13, fontWeight: "600" as const, color: wc.amountNegative, marginTop: 12 },
    successRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginTop: 12,
    },
    successText: { fontSize: 13, fontWeight: "700" as const, color: wc.amountPositive },
    confirmBtn: {
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginTop: 14,
    },
    confirmText: { fontSize: 15, fontWeight: "800" as const, color: "#FFFFFF" },
    noteRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 6,
      paddingHorizontal: 4,
    },
    noteText: { flex: 1, fontSize: 12, lineHeight: 17, color: wc.textFaint },
    approvalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: 28,
    },
    approvalCard: {
      width: "100%" as const,
      maxWidth: 400,
      backgroundColor: wc.surface,
      borderRadius: 22,
      padding: 24,
      alignItems: "center" as const,
    },
    approvalIconWrap: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    approvalTitle: {
      fontSize: 17,
      fontWeight: "800" as const,
      color: wc.textStrong,
      textAlign: "center" as const,
      marginTop: 14,
    },
    approvalSub: {
      fontSize: 13,
      lineHeight: 19,
      color: wc.textMuted,
      textAlign: "center" as const,
      marginTop: 8,
    },
    approvalCancelBtn: {
      marginTop: 18,
      borderRadius: 12,
      paddingHorizontal: 22,
      paddingVertical: 11,
      backgroundColor: wc.surfaceMuted,
    },
    approvalCancelText: { fontSize: 14, fontWeight: "800" as const, color: wc.text },
    approvalDoneBtn: {
      marginTop: 18,
      alignSelf: "stretch" as const,
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: "center" as const,
    },
    approvalDoneText: { fontSize: 15, fontWeight: "800" as const, color: "#FFFFFF" },
  });
}

function useWalletStyles() {
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const wc = useMemo(() => walletPalette(colorScheme === "dark"), [colorScheme]);
  const styles = useMemo(() => makeStyles(wc, Colors), [wc, Colors]);
  return { styles, wc, Colors };
}
