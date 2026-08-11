import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Share,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Copy,
  Check,
  Share2,
  Gift,
  Sparkles,
  Link as LinkIcon,
  Users,
} from "lucide-react-native";
import QRCodeLib from "qrcode";
import Svg, { Path, Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGetCoinSettings, formatCoins, type GetCoinSettings } from "@/utils/getCoinStore";
import {
  referralCodeForUser,
  buildReferralLink,
  buildReferralMessage,
  fetchMyReferralCount,
} from "@/utils/referral";

const BRAND_BLUE = "#2dabe2";
const BRAND_BLUE_DARK = "#1B6E92";
const BONUS_GOLD = "#EAB308";

/** Build a single SVG path covering every dark module of the QR matrix. */
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
    console.log("[referral-card] qr build failed", e);
    return null;
  }
}

/**
 * The shareable poster itself — a self-contained, screenshot-ready invite card
 * sized for Instagram Stories / WhatsApp (portrait). Rendered both on screen as
 * a live preview and off screen at full resolution for image capture. `scale`
 * multiplies every dimension so the same layout serves both.
 */
function ReferralPoster({
  code,
  qr,
  referredCoins,
  referrerCoins,
  inviterName,
  scale = 1,
}: {
  code: string;
  qr: { path: string; modules: number } | null;
  referredCoins: number;
  referrerCoins: number;
  inviterName: string;
  scale?: number;
}) {
  const s = (n: number) => Math.round(n * scale);
  const qrSize = s(150);
  const friendBonus = referredCoins > 0 ? formatCoins(referredCoins) : null;
  const youBonus = referrerCoins > 0 ? formatCoins(referrerCoins) : null;
  return (
    <LinearGradient
      colors={[BRAND_BLUE, BRAND_BLUE_DARK]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        posterStyles.poster,
        { width: s(300), padding: s(24), borderRadius: s(28) },
      ]}
    >
      <View style={[posterStyles.brandRow, { gap: s(7), marginBottom: s(18) }]}>
        <Sparkles color="#FFFFFF" size={s(20)} />
        <Text style={[posterStyles.brand, { fontSize: s(22) }]}>GET.ride</Text>
      </View>

      <Text style={[posterStyles.headline, { fontSize: s(26), lineHeight: s(30) }]}>
        {inviterName ? `${inviterName} is inviting` : "You're invited"}
      </Text>
      <Text style={[posterStyles.headline, { fontSize: s(26), lineHeight: s(30) }]}>
        you to ride 🚕
      </Text>

      <Text style={[posterStyles.sub, { fontSize: s(13), lineHeight: s(19), marginTop: s(10) }]}>
        Sign up with this code and we both earn bonus GET.coin to spend on rides.
      </Text>

      {/* Bonus chips */}
      {friendBonus || youBonus ? (
        <View style={[posterStyles.bonusRow, { gap: s(10), marginTop: s(18) }]}>
          {friendBonus ? (
            <View style={[posterStyles.bonusChip, { borderRadius: s(14), padding: s(12) }]}>
              <Gift color={BONUS_GOLD} size={s(18)} />
              <Text style={[posterStyles.bonusAmount, { fontSize: s(16), marginTop: s(6) }]}>
                {friendBonus}
              </Text>
              <Text style={[posterStyles.bonusLabel, { fontSize: s(11) }]}>for you</Text>
            </View>
          ) : null}
          {youBonus ? (
            <View style={[posterStyles.bonusChip, { borderRadius: s(14), padding: s(12) }]}>
              <Gift color={BONUS_GOLD} size={s(18)} />
              <Text style={[posterStyles.bonusAmount, { fontSize: s(16), marginTop: s(6) }]}>
                {youBonus}
              </Text>
              <Text style={[posterStyles.bonusLabel, { fontSize: s(11) }]}>
                for {inviterName || "your friend"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Code + QR card */}
      <View style={[posterStyles.codeCard, { borderRadius: s(20), padding: s(18), marginTop: s(20) }]}>
        <Text style={[posterStyles.codeLabel, { fontSize: s(11), letterSpacing: s(1.5) }]}>
          YOUR REFERRAL CODE
        </Text>
        <Text
          style={[posterStyles.code, { fontSize: s(30), letterSpacing: s(3), marginTop: s(6) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {code}
        </Text>
        <View style={[posterStyles.qrWrap, { marginTop: s(16), padding: s(10), borderRadius: s(14) }]}>
          {qr ? (
            <Svg width={qrSize} height={qrSize} viewBox={`0 0 ${qr.modules} ${qr.modules}`}>
              <Rect x={0} y={0} width={qr.modules} height={qr.modules} fill="#FFFFFF" />
              <Path d={qr.path} fill={BRAND_BLUE_DARK} />
            </Svg>
          ) : (
            <View style={{ width: qrSize, height: qrSize }} />
          )}
        </View>
        <Text style={[posterStyles.scanHint, { fontSize: s(11), marginTop: s(10) }]}>
          Scan to download GET.ride & join
        </Text>
      </View>
    </LinearGradient>
  );
}

const posterStyles = StyleSheet.create({
  poster: { alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brand: { color: "#FFFFFF", fontWeight: "900" as const, letterSpacing: 0.5 },
  headline: {
    color: "#FFFFFF",
    fontWeight: "900" as const,
    textAlign: "center" as const,
  },
  sub: {
    color: "rgba(255,255,255,0.9)",
    textAlign: "center" as const,
    paddingHorizontal: 6,
  },
  bonusRow: { flexDirection: "row", alignSelf: "stretch" as const },
  bonusChip: {
    flex: 1,
    alignItems: "center" as const,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  bonusAmount: { color: "#FFFFFF", fontWeight: "900" as const },
  bonusLabel: { color: "rgba(255,255,255,0.82)", fontWeight: "600" as const, marginTop: 2 },
  codeCard: {
    alignSelf: "stretch" as const,
    backgroundColor: "#FFFFFF",
    alignItems: "center" as const,
  },
  codeLabel: { color: "#6B7280", fontWeight: "800" as const },
  code: { color: "#0F172A", fontWeight: "900" as const, textAlign: "center" as const },
  qrWrap: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  scanHint: { color: "#6B7280", fontWeight: "600" as const, textAlign: "center" as const },
});

/**
 * Referral share-card screen. Shows a branded, screenshot-ready invite poster
 * (referral code, current bonus amounts, and a scannable QR of the invite
 * link) and lets the user share it as an image (optimized for Instagram /
 * WhatsApp), copy their code, or share the plain invite link/text.
 */
export default function ReferralCardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { authState } = useAuth();
  const userId = authState.userId ?? "guest";
  const inviterName = (authState.profileName ?? "").trim();

  const [coinSettings, setCoinSettings] = useState<GetCoinSettings | null>(null);
  const [referralCount, setReferralCount] = useState<number | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [sharing, setSharing] = useState<boolean>(false);
  const posterRef = useRef<View>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const code = useMemo(() => referralCodeForUser(userId), [userId]);
  const link = useMemo(() => buildReferralLink(code), [code]);
  const qr = useMemo(() => buildQrPath(link), [link]);

  const referredCoins = coinSettings?.referralReferredCoins ?? 0;
  const referrerCoins = coinSettings?.referralReferrerCoins ?? 0;

  useEffect(() => {
    fetchGetCoinSettings()
      .then((s) => setCoinSettings(s))
      .catch((e) => console.log("[referral-card] settings load failed", e));
  }, []);

  // How many friends have signed up with this account's code so far.
  useEffect(() => {
    if (userId === "guest") return;
    fetchMyReferralCount(userId)
      .then((n) => setReferralCount(n))
      .catch((e) => console.log("[referral-card] referral count load failed", e));
  }, [userId]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const handleCopyCode = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(code);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.log("[referral-card] copy failed", e);
    }
  }, [code]);

  const handleShareLink = useCallback(async () => {
    const message = buildReferralMessage(code, link);
    try {
      if (Platform.OS === "web") {
        const nav = navigator as Navigator & {
          share?: (data: { title?: string; text?: string }) => Promise<void>;
        };
        if (nav.share) {
          await nav.share({ title: "GET.ride referral", text: message });
        } else {
          await Clipboard.setStringAsync(message);
          setCopied(true);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopied(false), 1600);
        }
        return;
      }
      await Share.share(Platform.OS === "ios" ? { message, url: link } : { message });
    } catch (e) {
      console.log("[referral-card] link share dismissed/failed", e);
    }
  }, [code, link]);

  const handleShareImage = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(posterRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        fileName: `getride-invite-${Date.now()}`,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Share your GET.ride invite",
        });
      } else {
        // Web / unsupported: fall back to sharing the link text.
        await handleShareLink();
      }
    } catch (e) {
      console.log("[referral-card] image share failed", e);
    } finally {
      setSharing(false);
    }
  }, [sharing, handleShareLink]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ backgroundColor: BRAND_BLUE }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="referral-card-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color="#FFFFFF" size={22} />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <Gift color="#FFFFFF" size={20} />
            <Text style={styles.headerTitle}>Invite friends</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Share this card on Instagram or WhatsApp. When a friend joins with your
          code, you both earn bonus GET.coin.
        </Text>

        {/* Total referrals — how many friends joined with this account's code */}
        {referralCount !== null ? (
          <View style={styles.statCard} testID="referral-card-total">
            <View style={styles.statIconWrap}>
              <Users color={BRAND_BLUE_DARK} size={22} />
            </View>
            <View style={styles.statBody}>
              <Text style={styles.statLabel}>Total referrals</Text>
              <Text style={styles.statHint}>
                {referralCount === 1
                  ? "friend signed up with your code"
                  : "friends signed up with your code"}
              </Text>
            </View>
            <Text style={styles.statValue} testID="referral-card-total-value">
              {referralCount}
            </Text>
          </View>
        ) : null}

        {/* On-screen preview */}
        <View style={styles.previewWrap} testID="referral-card-preview">
          <ReferralPoster
            code={code}
            qr={qr}
            referredCoins={referredCoins}
            referrerCoins={referrerCoins}
            inviterName={inviterName}
          />
        </View>

        {/* Copy code row */}
        <TouchableOpacity
          style={styles.codeRow}
          onPress={handleCopyCode}
          activeOpacity={0.8}
          testID="referral-card-copy"
        >
          <View style={styles.codeRowInfo}>
            <Text style={styles.codeRowLabel}>Your code</Text>
            <Text style={styles.codeRowValue}>{code}</Text>
          </View>
          {copied ? (
            <View style={styles.copiedPill}>
              <Check color="#16A34A" size={16} />
              <Text style={styles.copiedText}>Copied</Text>
            </View>
          ) : (
            <View style={styles.copyPill}>
              <Copy color={BRAND_BLUE_DARK} size={16} />
              <Text style={styles.copyText}>Copy</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={handleShareLink}
          testID="referral-card-share-link"
        >
          <LinkIcon color={BRAND_BLUE_DARK} size={18} />
          <Text style={styles.linkBtnText}>Share link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.imageBtn}
          onPress={handleShareImage}
          disabled={sharing}
          testID="referral-card-share-image"
        >
          {sharing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Share2 color="#FFFFFF" size={18} />
              <Text style={styles.imageBtnText}>Share card</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Off-screen high-resolution poster for image capture. */}
      <View style={styles.posterHost} pointerEvents="none">
        <View ref={posterRef} collapsable={false}>
          <ReferralPoster
            code={code}
            qr={qr}
            referredCoins={referredCoins}
            referrerCoins={referrerCoins}
            inviterName={inviterName}
            scale={3.6}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4FAFE" },
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
    borderColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 22, fontWeight: "700" as const, color: "#FFFFFF" },
  scrollContent: { padding: 18, paddingBottom: 28, alignItems: "center" },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: "#4B5563",
    textAlign: "center" as const,
    marginBottom: 18,
    paddingHorizontal: 6,
  },
  statCard: {
    alignSelf: "stretch" as const,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D6EBF7",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
  },
  statIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EAF6FD",
    alignItems: "center",
    justifyContent: "center",
  },
  statBody: { flex: 1 },
  statLabel: { fontSize: 15, fontWeight: "800" as const, color: "#0F172A" },
  statHint: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  statValue: { fontSize: 26, fontWeight: "900" as const, color: BRAND_BLUE_DARK },
  previewWrap: {
    borderRadius: 28,
    shadowColor: "#1B6E92",
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  codeRow: {
    alignSelf: "stretch" as const,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D6EBF7",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 18,
  },
  codeRowInfo: { flex: 1 },
  codeRowLabel: { fontSize: 12, color: "#6B7280", marginBottom: 2 },
  codeRowValue: {
    fontSize: 20,
    fontWeight: "900" as const,
    color: "#0F172A",
    letterSpacing: 2,
  },
  copyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EAF6FD",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copyText: { fontSize: 13, fontWeight: "800" as const, color: BRAND_BLUE_DARK },
  copiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DCFCE7",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  copiedText: { fontSize: 13, fontWeight: "800" as const, color: "#16A34A" },
  bottomBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#EAF0F4",
  },
  linkBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#EAF6FD",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  linkBtnText: { fontSize: 15, fontWeight: "800" as const, color: BRAND_BLUE_DARK },
  imageBtn: {
    flex: 1.4,
    height: 52,
    borderRadius: 14,
    backgroundColor: BRAND_BLUE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  imageBtnText: { fontSize: 15, fontWeight: "800" as const, color: "#FFFFFF" },
  posterHost: { position: "absolute", left: -4000, top: 0 },
});
