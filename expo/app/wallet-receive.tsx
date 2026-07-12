import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Copy, Check, Wallet, X } from "lucide-react-native";
import QRCodeLib from "qrcode";
import Svg, { Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

const DUITNOW_PINK = "#ED2E67";
const AMOUNT_TTL_SECONDS = 60;

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
    console.log("[wallet-receive] qr build failed", e);
    return null;
  }
}

/** Deterministic digit string derived from the user id. */
function deriveDigits(userId: string, length: number): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h = Math.imul(h ^ userId.charCodeAt(i), 16777619) >>> 0;
  }
  let out = "";
  while (out.length < length) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out += String(h % 10);
  }
  return out.slice(0, length);
}

/** DuitNow-style pink QR frame with the "MALAYSIA NATIONAL QR" band. */
function DuitNowFrame({
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
            <Rect x={0} y={0} width={qr.modules} height={qr.modules} fill="#FFFFFF" />
            <Path d={qr.path} fill={DUITNOW_PINK} />
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
        MALAYSIA NATIONAL QR
      </Text>
    </View>
  );
}

const frameStyles = StyleSheet.create({
  outer: {
    backgroundColor: DUITNOW_PINK,
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
 * GET.wallet Receive screen — personal DuitNow-style QR, account number with
 * copy, QR download/share, and a specific-amount QR that expires after 60s.
 */
export default function WalletReceiveScreen() {
  const router = useRouter();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPartnerMode = params.mode === "partner";
  const { authState } = useAuth();
  const userId = authState.userId ?? "guest";
  const displayName = (authState.profileName ?? "GET User").trim().toUpperCase();

  const [amount, setAmount] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [amountModalVisible, setAmountModalVisible] = useState<boolean>(false);
  const [amountText, setAmountText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [bodyHeight, setBodyHeight] = useState<number>(0);
  const { width: windowWidth } = useWindowDimensions();
  const posterRef = useRef<View>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accountNo = useMemo(() => `2600${deriveDigits(userId, 16)}`, [userId]);

  const qrValue = useMemo(() => {
    const base = `getpay://u/${userId}`;
    return amount != null ? `${base}?amt=${amount.toFixed(2)}` : base;
  }, [userId, amount]);

  const qr = useMemo(() => buildQrPath(qrValue), [qrValue]);
  const posterQr = useMemo(() => buildQrPath(`getpay://u/${userId}`), [userId]);

  /**
   * QR frame size computed from the measured body height so the whole
   * screen (QR card + account card) always fits without scrolling.
   */
  const frameSize = useMemo(() => {
    const maxByWidth = windowWidth - 28 - 36;
    if (bodyHeight <= 0) return Math.min(300, maxByWidth);
    const overhead = 348;
    const byHeight = bodyHeight - overhead;
    return Math.max(190, Math.min(320, maxByWidth, byHeight));
  }, [bodyHeight, windowWidth]);

  /** Countdown for a specific-amount QR — reverts to the open QR at zero. */
  useEffect(() => {
    if (amount == null) return;
    setSecondsLeft(AMOUNT_TTL_SECONDS);
    const iv = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(iv);
          setAmount(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [amount]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(accountNo);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.log("[wallet-receive] copy failed", e);
    }
  }, [accountNo]);

  const handleAmountChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
    setAmountText(digits.length > 0 ? (Number(digits) / 100).toFixed(2) : "");
  }, []);

  const parsedAmount = useMemo(() => Number(amountText), [amountText]);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const confirmAmount = useCallback(() => {
    if (!amountValid) return;
    setAmount(parsedAmount);
    setAmountModalVisible(false);
    setAmountText("");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [amountValid, parsedAmount]);

  const openAmountModal = useCallback(() => {
    setAmountText("");
    setAmountModalVisible(true);
  }, []);

  const cancelAmount = useCallback(() => {
    setAmount(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const uri = await captureRef(posterRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        fileName: `getwallet-qr-${Date.now()}`,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "GET.wallet QR",
        });
      } else {
        console.log("[wallet-receive] sharing not available on this platform");
      }
    } catch (e) {
      console.log("[wallet-receive] download failed", e);
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  return (
    <View style={styles.root}>
      <SafeAreaView
        style={[styles.headerSafe, { backgroundColor: Colors.accent }]}
        edges={["top"]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="wallet-receive-back"
          >
            <ChevronLeft color="#FFFFFF" size={22} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Receive</Text>
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
          <View style={styles.qrCard} testID="wallet-receive-card">
            {amount != null ? (
              <Text style={styles.cardTitle}>
                Scan QR to Send <Text style={styles.cardTitleBold}>RM{amount.toFixed(2)}</Text> to
              </Text>
            ) : (
              <Text style={styles.cardTitle}>Scan QR to send money to</Text>
            )}
            <Text style={styles.cardName}>{displayName}</Text>

            <View style={styles.frameWrap}>
              <DuitNowFrame qr={qr} size={frameSize} />
            </View>

            {amount != null ? (
              <Text style={styles.countdown} testID="wallet-receive-countdown">
                <Text style={styles.countdownNum}>{secondsLeft}</Text> sec
              </Text>
            ) : null}
          </View>

          <View style={styles.accountCard}>
            <View style={styles.duitNowLogo}>
              <View style={styles.duitNowCircle}>
                <Text style={styles.duitNowCircleText}>D</Text>
              </View>
              <Text style={styles.duitNowLabel}>
                <Text style={styles.duitNowLabelDark}>Duit</Text>
                <Text style={{ color: DUITNOW_PINK }}>Now</Text>
              </Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountLabel}>DuitNow Account No.</Text>
              <Text style={styles.accountNo} testID="wallet-receive-account-no">
                {accountNo}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={handleCopy}
              testID="wallet-receive-copy"
            >
              {copied ? (
                <Check color="#16A34A" size={22} />
              ) : (
                <Copy color="#6B7280" size={22} />
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        {amount != null ? (
          <>
            <TouchableOpacity
              style={[styles.filledBtn, { backgroundColor: Colors.accent }]}
              onPress={openAmountModal}
              testID="wallet-receive-new-amount"
            >
              <Text style={styles.filledBtnText}>ENTER NEW AMOUNT</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={cancelAmount}
              testID="wallet-receive-cancel-amount"
            >
              <Text style={styles.outlineBtnText}>CANCEL</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={handleDownload}
              disabled={downloading}
              testID="wallet-receive-download"
            >
              {downloading ? (
                <ActivityIndicator color="#111827" size="small" />
              ) : (
                <Text style={styles.outlineBtnText}>DOWNLOAD QR</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filledBtn, { backgroundColor: Colors.accent }]}
              onPress={openAmountModal}
              testID="wallet-receive-enter-amount"
            >
              <Text style={styles.filledBtnText}>ENTER SPECIFIC AMOUNT</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Off-screen poster rendered for DOWNLOAD QR capture */}
      <View style={styles.posterHost} pointerEvents="none">
        <View ref={posterRef} collapsable={false} style={styles.posterCapture}>
          <LinearGradient
            colors={[Colors.accent, Colors.accentDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.posterGradient}
          >
            <View style={styles.posterBrandRow}>
              <Wallet color="#FFFFFF" size={30} />
              <Text style={styles.posterBrandText}>GET.wallet</Text>
            </View>
            <View style={styles.posterCard}>
              <Text style={styles.posterHint}>
                Scan QR with any banking apps or eWallets to send money to
              </Text>
              <Text style={styles.posterName}>{displayName}</Text>
              <DuitNowFrame qr={posterQr} size={320} />
            </View>
          </LinearGradient>
        </View>
      </View>

      <Modal
        visible={amountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAmountModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setAmountModalVisible(false)}>
          <Pressable style={styles.amountSheet} onPress={() => {}}>
            <View style={styles.amountSheetHeader}>
              <Text style={styles.amountSheetTitle}>Enter Amount</Text>
              <TouchableOpacity
                style={styles.amountSheetClose}
                onPress={() => setAmountModalVisible(false)}
                testID="wallet-receive-amount-close"
              >
                <X color="#6B7280" size={20} />
              </TouchableOpacity>
            </View>
            <Text style={styles.amountSheetSub}>
              The QR with this amount expires after {AMOUNT_TTL_SECONDS} seconds.
            </Text>
            <View style={styles.amountInputRow}>
              <Text style={styles.amountPrefix}>RM</Text>
              <TextInput
                style={styles.amountInput}
                value={amountText}
                onChangeText={handleAmountChange}
                placeholder="0.00"
                placeholderTextColor="#C3C9CF"
                keyboardType="number-pad"
                autoFocus
                testID="wallet-receive-amount-input"
              />
            </View>
            <TouchableOpacity
              style={[
                styles.filledBtn,
                { backgroundColor: amountValid ? Colors.accent : "#C7CDD4" },
              ]}
              onPress={confirmAmount}
              disabled={!amountValid}
              testID="wallet-receive-amount-confirm"
            >
              <Text style={styles.filledBtnText}>SET AMOUNT</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F2F4F6",
  },
  headerSafe: {},
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
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 26,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 18,
    color: "#1F2937",
  },
  cardTitleBold: {
    fontWeight: "800" as const,
    color: "#111827",
  },
  cardName: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#27272A",
    letterSpacing: 1,
    textAlign: "center" as const,
    marginTop: 10,
  },
  frameWrap: {
    marginTop: 22,
  },
  countdown: {
    marginTop: 20,
    fontSize: 16,
    color: "#4B5563",
  },
  countdownNum: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#111827",
    fontVariant: ["tabular-nums"],
  },
  accountCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    marginTop: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  duitNowLogo: {
    alignItems: "center",
    width: 52,
  },
  duitNowCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: DUITNOW_PINK,
    alignItems: "center",
    justifyContent: "center",
  },
  duitNowCircleText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800" as const,
  },
  duitNowLabel: {
    fontSize: 10,
    fontWeight: "800" as const,
    marginTop: 3,
  },
  duitNowLabelDark: {
    color: "#27272A",
  },
  accountInfo: {
    flex: 1,
  },
  accountLabel: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#111827",
  },
  accountNo: {
    fontSize: 14,
    color: "#6B7280",
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
    gap: 10,
    backgroundColor: "#F2F4F6",
  },
  outlineBtn: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#C9CFD6",
    backgroundColor: "#F2F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: "#111827",
    letterSpacing: 0.6,
  },
  filledBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  filledBtnText: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: "center",
  },
  posterHint: {
    fontSize: 16,
    color: "#374151",
    textAlign: "center" as const,
    lineHeight: 23,
  },
  posterName: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: "#27272A",
    letterSpacing: 1,
    textAlign: "center" as const,
    marginTop: 14,
    marginBottom: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  amountSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
  },
  amountSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  amountSheetTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#111827",
  },
  amountSheetClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F3F5",
    alignItems: "center",
    justifyContent: "center",
  },
  amountSheetSub: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 6,
  },
  amountInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#E5E8EB",
    paddingBottom: 8,
  },
  amountPrefix: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: "#6B7280",
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: "800" as const,
    color: "#111827",
    padding: 0,
  },
});
