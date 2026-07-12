import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { ArrowLeft, QrCode, Barcode } from "lucide-react-native";
import QRCodeLib from "qrcode";
import Svg, { Path, Rect } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import WalletBalanceBar from "@/components/WalletBalanceBar";
import { fetchWalletBalances, type WalletBalances } from "@/utils/walletStore";

const QR_SIZE = 256;

/**
 * Build a single SVG path covering every dark module of the QR matrix.
 * High error correction so the centre badge doesn't break scanning.
 */
function buildQrPath(value: string): { path: string; modules: number } | null {
  try {
    const qr = QRCodeLib.create(value, { errorCorrectionLevel: "H" });
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
    console.log("[wallet-show-code] qr build failed", e);
    return null;
  }
}

/** Deterministic digit string derived from the user id (display + barcode seed). */
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

/**
 * GET.wallet "Show Code" screen — displays the user's receive code as a QR
 * (default) or a rotated barcode, matching the reference design, with the
 * wallet balance bar at the bottom.
 */
export default function WalletShowCodeScreen() {
  const router = useRouter();
  const Colors = useColors();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPartnerMode = params.mode === "partner";
  const { authState } = useAuth();
  const userId = authState.userId ?? "guest";
  const initial = (authState.profileName ?? "G").trim().charAt(0).toUpperCase() || "G";

  const [mode, setMode] = useState<"qr" | "barcode">("qr");
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  const loadBalances = useCallback(async () => {
    if (!authState.userId) return;
    try {
      setBalances(await fetchWalletBalances(authState.userId));
    } catch (e) {
      console.log("[wallet-show-code] balance load failed", e);
    }
  }, [authState.userId]);

  useFocusEffect(
    useCallback(() => {
      loadBalances();
    }, [loadBalances])
  );

  const qr = useMemo(() => buildQrPath(`getpay://u/${userId}`), [userId]);
  const digits = useMemo(() => deriveDigits(userId, 18), [userId]);
  const digitsLabel = useMemo(
    () => (digits.match(/.{1,4}/g) ?? []).join(" "),
    [digits]
  );

  /** Bar thicknesses for the pseudo-barcode, derived from the digits. */
  const bars = useMemo(() => {
    const list: { bar: number; gap: number }[] = [];
    for (let i = 0; i < digits.length * 3; i++) {
      const d = Number(digits[i % digits.length]);
      const bar = 2 + ((d + i) % 4) * 2;
      const gap = 2 + ((d * 7 + i) % 3) * 2;
      list.push({ bar, gap });
    }
    return list;
  }, [digits]);

  const openReload = () => {
    router.navigate({
      pathname: "/wallet",
      params: isPartnerMode ? { mode: "partner", action: "reload" } : { action: "reload" },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="wallet-show-code-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="wallet-show-code-back"
        >
          <ArrowLeft color="#111827" size={24} />
        </TouchableOpacity>
      </View>

      <Text style={styles.waitText}>Please wait until{"\n"}the transaction is completed</Text>

      <View style={styles.codeArea}>
        {mode === "qr" ? (
          <View style={styles.qrWrap} testID="wallet-show-code-qr">
            {qr ? (
              <Svg
                width={QR_SIZE}
                height={QR_SIZE}
                viewBox={`0 0 ${qr.modules} ${qr.modules}`}
              >
                <Rect x={0} y={0} width={qr.modules} height={qr.modules} fill="#FFFFFF" />
                <Path d={qr.path} fill="#111111" />
              </Svg>
            ) : (
              <QrCode color="#111111" size={QR_SIZE * 0.8} />
            )}
            <View style={styles.qrBadgeOuter}>
              <View style={[styles.qrBadgeInner, { backgroundColor: Colors.accent }]}>
                <Text style={styles.qrBadgeText}>{initial}</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.barcodeRow} testID="wallet-show-code-barcode">
            <View style={styles.digitsColumn}>
              <Text style={styles.digitsText} numberOfLines={1}>
                {digitsLabel}
              </Text>
            </View>
            <View style={styles.barsColumn}>
              {bars.map((b, idx) => (
                <View key={`bar-${idx}`}>
                  <View style={[styles.bar, { height: b.bar }]} />
                  <View style={{ height: b.gap }} />
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={styles.toggleArea}>
        <View style={styles.togglePill}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              mode === "qr" ? [styles.toggleBtnActive, { borderColor: Colors.accentDark }] : null,
            ]}
            onPress={() => setMode("qr")}
            testID="wallet-show-code-mode-qr"
          >
            <QrCode color={mode === "qr" ? Colors.accentDark : "#6B7280"} size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              mode === "barcode"
                ? [styles.toggleBtnActive, { borderColor: Colors.accentDark }]
                : null,
            ]}
            onPress={() => setMode("barcode")}
            testID="wallet-show-code-mode-barcode"
          >
            <Barcode color={mode === "barcode" ? Colors.accentDark : "#6B7280"} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      <WalletBalanceBar
        balance={balances?.getWallet ?? null}
        onReload={openReload}
        testID="wallet-show-code-balance"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  waitText: {
    fontSize: 16,
    lineHeight: 23,
    color: "#6B7280",
    textAlign: "center" as const,
    marginTop: 10,
  },
  codeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  qrWrap: {
    width: QR_SIZE,
    height: QR_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  qrBadgeOuter: {
    position: "absolute" as const,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  qrBadgeInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  qrBadgeText: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: "#FFFFFF",
  },
  barcodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  digitsColumn: {
    width: 26,
    height: 340,
    alignItems: "center",
    justifyContent: "center",
  },
  digitsText: {
    width: 340,
    textAlign: "center" as const,
    transform: [{ rotate: "90deg" }],
    fontSize: 14,
    letterSpacing: 3,
    color: "#374151",
    fontVariant: ["tabular-nums"],
  },
  barsColumn: {
    width: 220,
  },
  bar: {
    width: "100%" as const,
    backgroundColor: "#111111",
  },
  toggleArea: {
    alignItems: "center",
    paddingBottom: 24,
  },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEF0F3",
    borderRadius: 999,
    padding: 5,
    gap: 4,
  },
  toggleBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleBtnActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
  },
});
