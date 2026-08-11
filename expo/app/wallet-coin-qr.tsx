import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { ChevronLeft, Coins, Copy, Check } from "lucide-react-native";
import QRCodeLib from "qrcode";
import Svg, { Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { walletPalette, QR_SURFACE, type WalletPalette } from "@/utils/walletTheme";
import { fetchWalletBalances, type WalletBalances } from "@/utils/walletStore";
import {
  fetchGetCoinSettings,
  coinsToCurrency,
  formatCoins,
  type GetCoinSettings,
} from "@/utils/getCoinStore";

const COIN_YELLOW = "#EAB308";
const COIN_AMBER_DARK = "#92400E";

/**
 * Build a single SVG path covering every dark module of the QR matrix.
 */
function buildQrPath(value: string): { path: string; modules: number } | null {
  try {
    const qr = QRCodeLib.create(value, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c]) {
          d += `M${c} ${r}h1v1h-1z`;
        }
      }
    }
    return { path: d, modules: size };
  } catch (e) {
    console.log("[wallet-coin-qr] qr build failed", e);
    return null;
  }
}

/** Amber GET.coin QR frame matching the DuitNow frame styling on Receive. */
function CoinQrFrame({
  qr,
  size,
}: {
  qr: { path: string; modules: number } | null;
  size: number;
}) {
  const bandFont = Math.min(18, Math.max(11, Math.round(size * 0.052)));
  return (
    <View style={[frameStyles.outer, { width: size }]}>
      <View style={frameStyles.inner}>
        {qr ? (
          <Svg
            width={size - 60}
            height={size - 60}
            viewBox={`0 0 ${qr.modules} ${qr.modules}`}
          >
            <Rect x={0} y={0} width={qr.modules} height={qr.modules} fill={QR_SURFACE} />
            <Path d={qr.path} fill={COIN_AMBER_DARK} />
          </Svg>
        ) : (
          <View style={{ width: size - 60, height: size - 60 }} />
        )}
      </View>
      <Text
        style={[frameStyles.band, { fontSize: bandFont }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        GET.COIN WALLET QR
      </Text>
    </View>
  );
}

const frameStyles = StyleSheet.create({
  outer: {
    backgroundColor: COIN_YELLOW,
    borderRadius: 28,
    padding: 14,
    alignItems: "center",
  },
  inner: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    alignSelf: "stretch" as const,
    alignItems: "center",
  },
  band: {
    color: "#FFFFFF",
    fontWeight: "800" as const,
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 2,
    textAlign: "center" as const,
    alignSelf: "stretch" as const,
  },
});

/**
 * GET.coin QR screen — the personal wallet QR used for coin trading and any
 * other transaction: another user scans it (or pastes the copied wallet ID)
 * to send GET.coin from Trade → Send, and the in-app scanner accepts the same
 * code for QR payments with coin redemption.
 */
export default function WalletCoinQrScreen() {
  const { styles, wc } = useWalletStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { authState } = useAuth();
  const userId = authState.userId ?? "guest";
  const displayName = (authState.profileName ?? "GET User").trim().toUpperCase();

  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [coinSettings, setCoinSettings] = useState<GetCoinSettings | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [bodyHeight, setBodyHeight] = useState<number>(0);
  const { width: windowWidth } = useWindowDimensions();
  const posterRef = useRef<View>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    if (!authState.userId) return;
    try {
      const [b, s] = await Promise.all([
        fetchWalletBalances(authState.userId),
        fetchGetCoinSettings(),
      ]);
      setBalances(b);
      setCoinSettings(s);
    } catch (e) {
      console.log("[wallet-coin-qr] load failed", e);
    }
  }, [authState.userId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // Same payload as the GET.wallet QR: the scanner and the Trade → Send
  // recipient parser both resolve the account from it.
  const qrValue = useMemo(() => `getpay://u/${userId}`, [userId]);
  const qr = useMemo(() => buildQrPath(qrValue), [qrValue]);

  const coinBalance = balances?.getCoin ?? 0;
  const coinWorth =
    coinSettings && coinSettings.coinsPerCurrency > 0
      ? coinsToCurrency(coinBalance, coinSettings.coinsPerCurrency)
      : null;

  /**
   * QR frame size computed from the measured body height so the whole
   * screen (QR card + wallet-id card) always fits without scrolling.
   */
  const frameSize = useMemo(() => {
    const maxByWidth = windowWidth - 28 - 36;
    if (bodyHeight <= 0) return Math.min(300, maxByWidth);
    const overhead = 348;
    const byHeight = bodyHeight - overhead;
    return Math.max(190, Math.min(320, maxByWidth, byHeight));
  }, [bodyHeight, windowWidth]);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(userId);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.log("[wallet-coin-qr] copy failed", e);
    }
  }, [userId]);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const uri = await captureRef(posterRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        fileName: `getcoin-qr-${Date.now()}`,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "GET.coin QR",
        });
      } else {
        console.log("[wallet-coin-qr] sharing not available on this platform");
      }
    } catch (e) {
      console.log("[wallet-coin-qr] download failed", e);
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ backgroundColor: COIN_YELLOW }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="wallet-coin-qr-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={wc.textStrong} size={22} />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <Coins color={wc.textStrong} size={20} />
            <Text style={styles.headerTitle}>GET.coin QR</Text>
          </View>
        </View>
      </SafeAreaView>

      <View
        style={styles.body}
        onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces
          alwaysBounceVertical
          overScrollMode="always"
        >
          <View style={styles.qrCard} testID="wallet-coin-qr-card">
            <Text style={styles.cardTitle}>Scan QR to send GET.coin to</Text>
            <Text style={styles.cardName}>{displayName}</Text>

            <View style={styles.frameWrap}>
              <CoinQrFrame qr={qr} size={frameSize} />
            </View>

            <View style={styles.balanceRow}>
              <Coins color={COIN_AMBER_DARK} size={16} />
              <Text style={styles.balanceText} testID="wallet-coin-qr-balance">
                {formatCoins(coinBalance)}
                {coinWorth != null ? ` ≈ RM ${coinWorth.toFixed(2)}` : ""}
              </Text>
            </View>
            <Text style={styles.cardHint}>
              Works for coin trades, P2P transfers and QR payments — scan it from
              Trade GET.coin → Send or the wallet scanner.
            </Text>
          </View>

          <View style={styles.accountCard}>
            <View style={styles.coinLogo}>
              <View style={styles.coinCircle}>
                <Coins color="#FFFFFF" size={16} />
              </View>
              <Text style={styles.coinLabel}>
                <Text style={styles.coinLabelDark}>GET.</Text>
                <Text style={{ color: COIN_AMBER_DARK }}>coin</Text>
              </Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountLabel}>Wallet ID</Text>
              <Text
                style={styles.accountNo}
                numberOfLines={1}
                testID="wallet-coin-qr-wallet-id"
              >
                {userId}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={handleCopy}
              testID="wallet-coin-qr-copy"
              accessibilityRole="button"
              accessibilityLabel="Copy the account number"
            >
              {copied ? (
                <Check color={wc.amountPositive} size={22} />
              ) : (
                <Copy color={wc.textMuted} size={22} />
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity
          style={styles.filledBtn}
          onPress={handleDownload}
          disabled={downloading}
          testID="wallet-coin-qr-download"
          accessibilityRole="button"
        >
          {downloading ? (
            <ActivityIndicator color={wc.textStrong} size="small" />
          ) : (
            <Text style={styles.filledBtnText}>DOWNLOAD / SHARE QR</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Off-screen poster rendered for DOWNLOAD / SHARE QR capture */}
      <View style={styles.posterHost} pointerEvents="none">
        <View ref={posterRef} collapsable={false} style={styles.posterCapture}>
          <LinearGradient
            colors={[COIN_YELLOW, "#CA8A04"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.posterGradient}
          >
            <View style={styles.posterBrandRow}>
              <Coins color="#FFFFFF" size={30} />
              <Text style={styles.posterBrandText}>GET.coin</Text>
            </View>
            <View style={styles.posterCard}>
              <Text style={styles.posterHint}>
                Scan QR with the GET app to send GET.coin to
              </Text>
              <Text style={styles.posterName}>{displayName}</Text>
              <CoinQrFrame qr={qr} size={320} />
            </View>
          </LinearGradient>
        </View>
      </View>
    </View>
  );
}

function makeStyles(wc: WalletPalette, Colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: wc.surfaceCoin,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 16,
      gap: 14,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: "rgba(17,24,39,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: "700" as const,
      color: wc.textStrong,
    },
    body: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      padding: 14,
      paddingBottom: 24,
      justifyContent: "center" as const,
    },
    qrCard: {
      backgroundColor: wc.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: wc.borderCoin,
      paddingVertical: 26,
      paddingHorizontal: 18,
      alignItems: "center",
    },
    cardTitle: {
      fontSize: 18,
      color: wc.text,
    },
    cardName: {
      fontSize: 18,
      fontWeight: "800" as const,
      color: wc.text,
      letterSpacing: 1,
      textAlign: "center" as const,
      marginTop: 10,
    },
    frameWrap: {
      marginTop: 22,
    },
    balanceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 18,
    },
    balanceText: {
      fontSize: 16,
      fontWeight: "800" as const,
      color: wc.textStrong,
    },
    cardHint: {
      fontSize: 12,
      lineHeight: 17,
      color: wc.textMuted,
      textAlign: "center" as const,
      marginTop: 8,
      paddingHorizontal: 8,
    },
    accountCard: {
      backgroundColor: wc.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: wc.borderCoin,
      marginTop: 14,
      paddingVertical: 16,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    coinLogo: {
      alignItems: "center",
      width: 52,
    },
    coinCircle: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: COIN_YELLOW,
      alignItems: "center",
      justifyContent: "center",
    },
    coinLabel: {
      fontSize: 10,
      fontWeight: "800" as const,
      marginTop: 3,
    },
    coinLabelDark: {
      color: wc.text,
    },
    accountInfo: {
      flex: 1,
    },
    accountLabel: {
      fontSize: 15,
      fontWeight: "700" as const,
      color: wc.textStrong,
    },
    accountNo: {
      fontSize: 13,
      color: wc.textMuted,
      marginTop: 3,
      fontVariant: ["tabular-nums"],
    },
    copyBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    bottomBar: {
      paddingHorizontal: 14,
      paddingTop: 10,
      backgroundColor: wc.surfaceCoin,
    },
    filledBtn: {
      height: 52,
      borderRadius: 12,
      backgroundColor: COIN_YELLOW,
      alignItems: "center",
      justifyContent: "center",
    },
    filledBtnText: {
      fontSize: 15,
      fontWeight: "800" as const,
      color: wc.textStrong,
      letterSpacing: 0.6,
    },
    posterHost: {
      position: "absolute" as const,
      left: -1200,
      top: 0,
    },
    posterCapture: {
      width: 460,
    },
    posterGradient: {
      paddingVertical: 40,
      paddingHorizontal: 32,
      alignItems: "center",
    },
    posterBrandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 26,
    },
    posterBrandText: {
      fontSize: 30,
      fontWeight: "800" as const,
      color: "#FFFFFF",
    },
    posterCard: {
      alignSelf: "stretch" as const,
      backgroundColor: wc.surface,
      borderRadius: 24,
      paddingVertical: 28,
      paddingHorizontal: 22,
      alignItems: "center",
    },
    posterHint: {
      fontSize: 16,
      color: wc.text,
      textAlign: "center" as const,
      lineHeight: 23,
    },
    posterName: {
      fontSize: 22,
      fontWeight: "800" as const,
      color: wc.text,
      letterSpacing: 1,
      textAlign: "center" as const,
      marginTop: 14,
      marginBottom: 22,
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
