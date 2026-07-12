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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  ScanLine,
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
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

const PAY_QUICK_AMOUNTS: number[] = [10, 20, 50, 100];

/**
 * GET.wallet Scan screen — camera QR scanner styled after the reference:
 * DuitNow mark, rounded scan frame, flash toggle, Show Code pill, and a
 * bottom wallet-balance bar. Scanning a QR opens a pay sheet that deducts
 * the entered amount from GET.wallet.
 */
export default function WalletScanScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
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

  const parsedAmount = useMemo(() => {
    const n = Number(amountText.replace(/[^0-9.]/g, ""));
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
            <View style={[styles.frame, { width: frameSize, height: frameSize }]}>
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

      {/* Pay sheet — appears after a QR is scanned */}
      <Modal
        visible={payVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closePaySheet}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.payCard}>
            {paidAmount !== null ? (
              <View style={styles.successWrap}>
                <CheckCircle2 color={Colors.success} size={56} />
                <Text style={styles.successTitle}>Payment Successful</Text>
                <Text style={styles.successAmount}>RM {paidAmount.toFixed(2)}</Text>
                <Text style={styles.successNote} numberOfLines={1}>
                  {scannedLabel}
                </Text>
                <TouchableOpacity
                  style={styles.payBtnWrap}
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
                <View style={styles.payHeaderRow}>
                  <View style={[styles.payIconBubble, { backgroundColor: Colors.accent + "22" }]}>
                    <ScanLine color={Colors.accent} size={20} />
                  </View>
                  <Text style={styles.payTitle}>Pay with GET.wallet</Text>
                  <TouchableOpacity
                    onPress={closePaySheet}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="wallet-scan-pay-close"
                  >
                    <X color="#6B7280" size={22} />
                  </TouchableOpacity>
                </View>

                <View style={styles.payToBox}>
                  <Text style={styles.payToLabel}>Paying to</Text>
                  <Text style={styles.payToValue} numberOfLines={2}>
                    {scannedLabel}
                  </Text>
                </View>

                <View style={styles.amountRow}>
                  <Text style={styles.amountPrefix}>RM</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={amountText}
                    onChangeText={setAmountText}
                    placeholder="0"
                    placeholderTextColor="#D1D5DB"
                    keyboardType="decimal-pad"
                    autoFocus
                    testID="wallet-scan-pay-amount"
                  />
                </View>

                <View style={styles.quickRow}>
                  {PAY_QUICK_AMOUNTS.map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={[styles.quickChip, { borderColor: Colors.accent + "55" }]}
                      onPress={() => setAmountText(String(q))}
                      testID={`wallet-scan-quick-${q}`}
                    >
                      <Text style={[styles.quickChipText, { color: Colors.accent }]}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.payBalanceLine}>
                  Wallet balance: RM{(balances?.getWallet ?? 0).toFixed(2)}
                </Text>

                {payError ? <Text style={[styles.payErrorText, { color: Colors.danger }]}>{payError}</Text> : null}

                <TouchableOpacity
                  style={styles.payBtnWrap}
                  onPress={handlePay}
                  disabled={paying || !(parsedAmount > 0)}
                  activeOpacity={0.9}
                  testID="wallet-scan-pay-submit"
                >
                  <LinearGradient
                    colors={
                      parsedAmount > 0
                        ? [Colors.accent, Colors.accentDark]
                        : ["#E5E7EB", "#E5E7EB"]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.payBtn}
                  >
                    {paying ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text
                        style={[
                          styles.payBtnText,
                          parsedAmount > 0 ? null : { color: "#9CA3AF" },
                        ]}
                      >
                        Pay
                      </Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
  payCard: {
    width: "100%" as const,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
  },
  payHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  payIconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  payTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800" as const,
    color: "#111827",
  },
  payToBox: {
    backgroundColor: "#F4F5F7",
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  payToLabel: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 3,
  },
  payToValue: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#111827",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 14,
  },
  amountPrefix: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: "#111827",
  },
  amountInput: {
    fontSize: 40,
    fontWeight: "800" as const,
    color: "#111827",
    minWidth: 90,
    textAlign: "center" as const,
    padding: 0,
  },
  quickRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 14,
  },
  quickChip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  quickChipText: {
    fontSize: 15,
    fontWeight: "800" as const,
  },
  payBalanceLine: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center" as const,
    marginBottom: 10,
  },
  payErrorText: {
    fontSize: 13,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    marginBottom: 10,
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
  successWrap: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
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
