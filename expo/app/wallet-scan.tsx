import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  useWindowDimensions,
  Animated,
  PanResponder,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  X,
  HelpCircle,
  Zap,
  ZapOff,
  QrCode,
  Camera as CameraIcon,
  CheckCircle2,
  ArrowLeft,
  ChevronsRight,
} from "lucide-react-native";
import Svg, { Path, Circle, Ellipse } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import WalletBalanceBar from "@/components/WalletBalanceBar";
import { fetchWalletBalances, payFromWallet, type WalletBalances } from "@/utils/walletStore";

/** DuitNow-style pin mark: rounded square with one square corner and a hole. */
function DuitNowMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fillRule="evenodd"
        d="M24 4 C35.05 4 44 12.95 44 24 C44 35.05 35.05 44 24 44 L8.5 44 C6 44 4 42 4 39.5 L4 24 C4 12.95 12.95 4 24 4 Z M24 17.5 a6.5 6.5 0 1 0 0.01 0 Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

const SLIDE_THUMB = 58;
const SLIDE_PAD = 7;

/** Decorative swoosh + gold coins for the pay page, bottom-right corner. */
function PayCoinsDecor({ accent }: { accent: string }) {
  return (
    <Svg width={240} height={300} viewBox="0 0 240 300" pointerEvents="none">
      <Path d="M240 0 C160 95 145 180 240 300 L240 0 Z" fill={accent} opacity={0.14} />
      <Path d="M240 45 C185 125 175 195 240 290 L240 45 Z" fill={accent} opacity={0.18} />
      <Circle cx={166} cy={190} r={32} fill="#F6BA30" stroke="#DE9B12" strokeWidth={6} />
      <Circle cx={166} cy={190} r={17} fill="none" stroke="#DE9B12" strokeWidth={3} opacity={0.6} />
      <Ellipse cx={106} cy={152} rx={16} ry={11} fill="#F6BA30" stroke="#DE9B12" strokeWidth={3} />
      <Ellipse cx={210} cy={132} rx={14} ry={10} fill="#F6BA30" stroke="#DE9B12" strokeWidth={3} />
      <Ellipse cx={130} cy={242} rx={13} ry={9} fill="#F6BA30" stroke="#DE9B12" strokeWidth={3} />
      <Ellipse cx={218} cy={252} rx={15} ry={10} fill="#F6BA30" stroke="#DE9B12" strokeWidth={3} />
      <Circle cx={92} cy={200} r={3} fill="#FFFFFF" />
      <Circle cx={202} cy={172} r={3} fill="#FFFFFF" />
      <Circle cx={148} cy={128} r={2.5} fill="#F6BA30" />
      <Circle cx={90} cy={252} r={2.5} fill="#F6BA30" />
    </Svg>
  );
}

/**
 * Slide-to-pay button — drag the chevron thumb across the track to confirm.
 * Grey and locked while the amount is invalid; shows a spinner while paying.
 */
function SlideToPayButton({
  enabled,
  paying,
  onComplete,
  testID,
}: {
  enabled: boolean;
  paying: boolean;
  onComplete: () => void;
  testID?: string;
}) {
  const Colors = useColors();
  const [trackW, setTrackW] = useState<number>(0);
  const dragX = useRef(new Animated.Value(0)).current;
  const maxDrag = Math.max(trackW - SLIDE_THUMB - SLIDE_PAD * 2, 1);

  const enabledRef = useRef<boolean>(false);
  enabledRef.current = enabled && !paying;
  const maxDragRef = useRef<number>(1);
  maxDragRef.current = maxDrag;
  const completeRef = useRef<() => void>(onComplete);
  completeRef.current = onComplete;
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!paying) {
      firedRef.current = false;
      Animated.spring(dragX, { toValue: 0, friction: 6, useNativeDriver: true }).start();
    }
  }, [paying, dragX]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabledRef.current,
        onMoveShouldSetPanResponder: (_e, g) => enabledRef.current && Math.abs(g.dx) > 2,
        onPanResponderMove: (_e, g) => {
          dragX.setValue(Math.min(Math.max(g.dx, 0), maxDragRef.current));
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx >= maxDragRef.current * 0.7 && !firedRef.current) {
            firedRef.current = true;
            Animated.timing(dragX, {
              toValue: maxDragRef.current,
              duration: 110,
              useNativeDriver: true,
            }).start(() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }
              completeRef.current();
            });
          } else {
            Animated.spring(dragX, { toValue: 0, friction: 6, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragX, { toValue: 0, friction: 6, useNativeDriver: true }).start();
        },
      }),
    [dragX]
  );

  const labelOpacity = dragX.interpolate({
    inputRange: [0, Math.max(maxDrag * 0.8, 1)],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <View
      style={[styles.slideTrack, { backgroundColor: enabled ? Colors.accent : "#C3C8CE" }]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      testID={testID}
    >
      {paying ? (
        <ActivityIndicator color="#FFFFFF" style={styles.slideCenter} />
      ) : (
        <Animated.Text
          style={[
            styles.slideLabel,
            { opacity: labelOpacity, color: enabled ? "#FFFFFF" : "#EDEFF2" },
          ]}
        >
          Pay
        </Animated.Text>
      )}
      <Animated.View
        style={[
          styles.slideThumb,
          {
            backgroundColor: enabled ? "#FFFFFF" : "#E7E9EC",
            transform: [{ translateX: dragX }],
          },
        ]}
        {...pan.panHandlers}
        testID={testID ? `${testID}-thumb` : undefined}
      >
        <ChevronsRight color={enabled ? Colors.accentDark : "#858D96"} size={26} />
      </Animated.View>
    </View>
  );
}

/**
 * GET.wallet Scan screen — camera QR scanner styled after the reference:
 * DuitNow mark, rounded scan frame, flash toggle, Show Code pill, and a
 * bottom wallet-balance bar. Scanning a QR opens a pay sheet that deducts
 * the entered amount from GET.wallet.
 */
export default function WalletScanScreen() {
  const router = useRouter();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPartnerMode = params.mode === "partner";
  const { authState } = useAuth();
  const userId = authState.userId ?? "";

  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [helpVisible, setHelpVisible] = useState<boolean>(false);
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  const [scannedData, setScannedData] = useState<string>("");
  const [payVisible, setPayVisible] = useState<boolean>(false);
  const [amountText, setAmountText] = useState<string>("");
  const [payError, setPayError] = useState<string>("");
  const [paying, setPaying] = useState<boolean>(false);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const scanLockRef = useRef<boolean>(false);
  const frameRef = useRef<View>(null);
  const [frameRect, setFrameRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  );

  const loadBalances = useCallback(async () => {
    if (!userId) return;
    try {
      setBalances(await fetchWalletBalances(userId));
    } catch (e) {
      console.log("[wallet-scan] balance load failed", e);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadBalances();
    }, [loadBalances])
  );

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  /**
   * Cents-style amount entry: every typed digit shifts in from the right,
   * e.g. typing 5 → 0.05, 55 → 0.55, 550 → 5.50 (like most e-wallets).
   */
  const handleAmountChange = useCallback((text: string) => {
    const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
    setAmountText(digits.length > 0 ? (Number(digits) / 100).toFixed(2) : "");
    setPayError("");
  }, []);

  const parsedAmount = useMemo(() => {
    const n = Number(amountText);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }, [amountText]);

  const scannedLabel = useMemo(() => {
    if (scannedData.startsWith("getpay://u/")) {
      const id = scannedData.slice("getpay://u/".length);
      return `GET user • ${id.slice(0, 8)}…`;
    }
    return scannedData.length > 42 ? `${scannedData.slice(0, 42)}…` : scannedData;
  }, [scannedData]);

  const handleScanned = useCallback((result: BarcodeScanningResult) => {
    if (scanLockRef.current || !result?.data) return;
    scanLockRef.current = true;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setScannedData(result.data);
    setAmountText("");
    setPayError("");
    setPaidAmount(null);
    setPayVisible(true);
  }, []);

  const closePaySheet = () => {
    setPayVisible(false);
    setPaidAmount(null);
    // Small delay before re-arming so the same code isn't instantly re-scanned.
    setTimeout(() => {
      scanLockRef.current = false;
    }, 800);
  };

  const handlePay = async () => {
    if (paying) return;
    setPayError("");
    if (!(parsedAmount > 0)) {
      setPayError("Enter an amount greater than 0.");
      return;
    }
    setPaying(true);
    const res = await payFromWallet(userId, parsedAmount, `QR payment — ${scannedLabel}`);
    setPaying(false);
    if (!res.ok) {
      setPayError(res.error ?? "Payment failed.");
      return;
    }
    if (res.balances) setBalances(res.balances);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setPaidAmount(parsedAmount);
  };

  const openReload = () => {
    router.navigate({
      pathname: "/wallet",
      params: isPartnerMode ? { mode: "partner", action: "reload" } : { action: "reload" },
    });
  };

  const openShowCode = () => {
    router.push(
      isPartnerMode
        ? { pathname: "/wallet-show-code", params: { mode: "partner" } }
        : { pathname: "/wallet-show-code" }
    );
  };

  const frameSize = Math.min(windowWidth * 0.72, 300);
  const granted = permission?.granted === true;

  const measureFrame = useCallback(() => {
    frameRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setFrameRect({ x, y, w, h });
    });
  }, []);

  const dimPath = useMemo(() => {
    if (!frameRect) return "";
    const { x, y, w, h } = frameRect;
    const r = 34;
    return (
      `M0 0 H${windowWidth} V${windowHeight} H0 Z ` +
      `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
      `V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} ` +
      `H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} ` +
      `V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
    );
  }, [frameRect, windowWidth, windowHeight]);

  return (
    <View style={styles.container} testID="wallet-scan-screen">
      {granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchOn}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={payVisible ? undefined : handleScanned}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraFallback]} />
      )}

      {/* Dim tint around the scan frame with a clear rounded cut-out */}
      {granted && dimPath ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={windowWidth} height={windowHeight}>
            <Path d={dimPath} fill="rgba(0,0,0,0.45)" fillRule="evenodd" />
          </Svg>
        </View>
      ) : null}

      <SafeAreaView style={styles.overlay} edges={["top"]}>
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => router.back()}
            testID="wallet-scan-close"
          >
            <X color="#FFFFFF" size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => setHelpVisible(true)}
            testID="wallet-scan-help"
          >
            <HelpCircle color="#FFFFFF" size={22} />
          </TouchableOpacity>
        </View>

        <View style={styles.brandWrap}>
          <DuitNowMark size={44} />
          <Text style={styles.brandText}>DuitNow</Text>
        </View>

        <View style={styles.frameArea}>
          {granted ? (
            <View
              ref={frameRef}
              onLayout={measureFrame}
              style={[styles.frame, { width: frameSize, height: frameSize }]}
            >
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          ) : (
            <View style={styles.permissionCard}>
              <CameraIcon color="#FFFFFF" size={34} />
              <Text style={styles.permissionTitle}>Camera access needed</Text>
              <Text style={styles.permissionSub}>
                Allow camera access to scan DuitNow and merchant QR codes.
              </Text>
              <TouchableOpacity
                style={[styles.permissionBtn, { backgroundColor: Colors.accent }]}
                onPress={() => {
                  if (permission?.canAskAgain) {
                    requestPermission();
                  } else {
                    Linking.openSettings().catch(() => {});
                  }
                }}
                testID="wallet-scan-allow-camera"
              >
                <Text style={styles.permissionBtnText}>
                  {permission?.canAskAgain === false ? "Open Settings" : "Allow Camera"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.bottomControls}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={() => setTorchOn((v) => !v)}
            testID="wallet-scan-torch"
          >
            {torchOn ? <Zap color="#FFD400" size={20} /> : <ZapOff color="#FFFFFF" size={20} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.showCodePill}
            onPress={openShowCode}
            activeOpacity={0.9}
            testID="wallet-scan-show-code"
          >
            <QrCode color="#111827" size={20} />
            <Text style={styles.showCodeText}>Show Code</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <WalletBalanceBar
        balance={balances?.getWallet ?? null}
        onReload={openReload}
        testID="wallet-scan-balance"
      />

      {/* Pay page — full screen, appears after a valid QR is scanned */}
      {payVisible ? (
        <View style={[StyleSheet.absoluteFill, styles.payPage]} testID="wallet-scan-pay-page">
          <SafeAreaView style={styles.payPageSafe} edges={["top"]}>
            <KeyboardAvoidingView
              style={styles.payPageSafe}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              {paidAmount !== null ? (
                <View style={styles.successPage}>
                  <CheckCircle2 color={Colors.success} size={64} />
                  <Text style={styles.successTitle}>Payment Successful</Text>
                  <Text style={styles.successAmount}>RM {paidAmount.toFixed(2)}</Text>
                  <Text style={styles.successNote} numberOfLines={2}>
                    {scannedLabel}
                  </Text>
                  <TouchableOpacity
                    style={styles.successDoneWrap}
                    onPress={() => {
                      closePaySheet();
                      router.back();
                    }}
                    activeOpacity={0.9}
                    testID="wallet-scan-pay-done"
                  >
                    <LinearGradient
                      colors={[Colors.accent, Colors.accentDark]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.payBtn}
                    >
                      <Text style={styles.payBtnText}>Done</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.payPageHeader}>
                    <TouchableOpacity
                      style={styles.payBackBtn}
                      onPress={closePaySheet}
                      testID="wallet-scan-pay-close"
                    >
                      <ArrowLeft color="#111827" size={26} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.payMerchant} numberOfLines={2}>
                    {scannedLabel.toUpperCase()}
                  </Text>

                  <Text style={styles.payAmountLabel}>Pay (RM)</Text>
                  <TextInput
                    style={styles.payAmountInput}
                    value={amountText}
                    onChangeText={handleAmountChange}
                    placeholder="0.00"
                    placeholderTextColor="#C3C9CF"
                    keyboardType="number-pad"
                    autoFocus
                    testID="wallet-scan-pay-amount"
                  />
                  {parsedAmount > 0 ? (
                    payError ? (
                      <Text style={[styles.payHint, { color: Colors.danger }]}>{payError}</Text>
                    ) : (
                      <Text style={styles.payHint}> </Text>
                    )
                  ) : (
                    <Text style={[styles.payHint, { color: "#F0654A" }]}>
                      Enter an amount more than 0.00
                    </Text>
                  )}

                  <View style={styles.payDecorArea} pointerEvents="none">
                    <PayCoinsDecor accent={Colors.accent} />
                  </View>

                  <View
                    style={[styles.payBottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}
                  >
                    <View style={styles.payBalanceRow}>
                      <View
                        style={[
                          styles.payBalanceAvatar,
                          { backgroundColor: Colors.accent + "22" },
                        ]}
                      >
                        <Text style={[styles.payBalanceAvatarText, { color: Colors.accent }]}>
                          G
                        </Text>
                      </View>
                      <Text style={styles.payBalanceText}>
                        Wallet Balance {"\u2022"} RM{(balances?.getWallet ?? 0).toFixed(2)}
                      </Text>
                    </View>
                    <SlideToPayButton
                      enabled={parsedAmount > 0}
                      paying={paying}
                      onComplete={handlePay}
                      testID="wallet-scan-pay-slide"
                    />
                  </View>
                </>
              )}
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      ) : null}

      {/* How to pay help sheet */}
      <Modal
        visible={helpVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setHelpVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.helpCard}>
            <Text style={styles.helpTitle}>How to pay</Text>
            {[
              { n: "1", text: "Find the DuitNow or merchant QR code at the counter." },
              { n: "2", text: "Point your camera at the QR code to scan it." },
              { n: "3", text: "Enter the amount and confirm — it's paid from your GET.wallet." },
            ].map((s) => (
              <View key={s.n} style={styles.helpRow}>
                <View style={[styles.helpStep, { backgroundColor: Colors.accent + "22" }]}>
                  <Text style={[styles.helpStepText, { color: Colors.accent }]}>{s.n}</Text>
                </View>
                <Text style={styles.helpRowText}>{s.text}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.payBtnWrap}
              onPress={() => setHelpVisible(false)}
              activeOpacity={0.9}
              testID="wallet-scan-help-close"
            >
              <LinearGradient
                colors={[Colors.accent, Colors.accentDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.payBtn}
              >
                <Text style={styles.payBtnText}>Got It</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
  },
  cameraFallback: {
    backgroundColor: "#1C1C1E",
  },
  overlay: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  circleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  brandWrap: {
    alignItems: "center",
    marginTop: 18,
    gap: 6,
  },
  brandText: {
    fontSize: 17,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  frameArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    position: "relative" as const,
  },
  corner: {
    position: "absolute" as const,
    width: 56,
    height: 56,
    borderColor: "#FFFFFF",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 34,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 34,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 34,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 34,
  },
  permissionCard: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 32,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  permissionSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center" as const,
    lineHeight: 20,
  },
  permissionBtn: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  permissionBtnText: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  bottomControls: {
    alignItems: "center",
    gap: 18,
    paddingBottom: 22,
  },
  showCodePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  showCodeText: {
    fontSize: 16,
    fontWeight: "800" as const,
    color: "#111827",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  payPage: {
    backgroundColor: "#EAF6FC",
  },
  payPageSafe: {
    flex: 1,
  },
  payPageHeader: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  payBackBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  payMerchant: {
    fontSize: 20,
    fontWeight: "800" as const,
    color: "#111827",
    textAlign: "center" as const,
    paddingHorizontal: 32,
    marginTop: 22,
  },
  payAmountLabel: {
    fontSize: 19,
    color: "#9AA1A9",
    textAlign: "center" as const,
    marginTop: 34,
  },
  payAmountInput: {
    fontSize: 52,
    fontWeight: "600" as const,
    color: "#111827",
    textAlign: "center" as const,
    paddingVertical: 4,
    paddingHorizontal: 24,
  },
  payHint: {
    fontSize: 15,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    marginTop: 4,
    minHeight: 20,
    color: "#9AA1A9",
  },
  payDecorArea: {
    flex: 1,
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  payBottomBar: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 24,
    paddingTop: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  payBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginBottom: 16,
  },
  payBalanceAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  payBalanceAvatarText: {
    fontSize: 12,
    fontWeight: "800" as const,
  },
  payBalanceText: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: "#111827",
  },
  slideTrack: {
    height: SLIDE_THUMB + SLIDE_PAD * 2,
    borderRadius: (SLIDE_THUMB + SLIDE_PAD * 2) / 2,
    justifyContent: "center",
    marginHorizontal: 8,
  },
  slideCenter: {
    alignSelf: "center" as const,
  },
  slideLabel: {
    fontSize: 18,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  slideThumb: {
    position: "absolute" as const,
    left: SLIDE_PAD,
    width: SLIDE_THUMB,
    height: SLIDE_THUMB,
    borderRadius: SLIDE_THUMB / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  payBtnWrap: {
    marginTop: 4,
  },
  payBtn: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  payBtnText: {
    fontSize: 16,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  successPage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 24,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#111827",
    marginTop: 6,
  },
  successAmount: {
    fontSize: 30,
    fontWeight: "800" as const,
    color: "#111827",
  },
  successNote: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 10,
    textAlign: "center" as const,
  },
  successDoneWrap: {
    alignSelf: "stretch" as const,
    marginTop: 12,
  },
  helpCard: {
    width: "100%" as const,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
  },
  helpTitle: {
    fontSize: 19,
    fontWeight: "800" as const,
    color: "#111827",
    marginBottom: 16,
  },
  helpRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  helpStep: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  helpStepText: {
    fontSize: 14,
    fontWeight: "800" as const,
  },
  helpRowText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: "#374151",
  },
});
