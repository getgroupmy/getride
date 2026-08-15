import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  buildReferralLink,
  buildReferralMessage,
  fetchMyReferrer,
  referralCodeForUser,
  type MyReferrer,
} from "@/utils/referral";

/**
 * Invite a friend.
 *
 * The code is derived from the account id rather than stored, so the same
 * account always produces the same code and there is nothing to keep in sync.
 * The link is built with `ExpoLinking.createURL`, which means it carries
 * whatever scheme the build actually uses instead of a hardcoded one.
 */
export default function Referral() {
  const colors = useColors();
  const { authState } = useAuth();

  const [referrer, setReferrer] = useState<MyReferrer | null>(null);
  const [copied, setCopied] = useState(false);

  const code = useMemo(
    () => (authState.userId ? referralCodeForUser(authState.userId) : null),
    [authState.userId]
  );
  const link = useMemo(() => (code ? buildReferralLink(code) : null), [code]);

  useEffect(() => {
    void (async () => {
      try {
        setReferrer(await fetchMyReferrer());
      } catch {
        // Not knowing who invited you is cosmetic.
      }
    })();
  }, []);

  const copy = useCallback(async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const share = useCallback(async () => {
    if (!code || !link) return;
    await Share.share({ message: buildReferralMessage(code, link) });
  }, [code, link]);

  if (!code) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Sign in to get your invite code.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.content, { backgroundColor: colors.background }]}>
      <Text style={[styles.lead, { color: colors.text }]}>
        Invite a friend, you both earn GET.coin
      </Text>
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        They sign up with your code, and the bonus lands in both wallets.
      </Text>

      <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.codeLabel, { color: colors.textSecondary }]}>Your code</Text>
        <Text style={[styles.code, { color: colors.text }]}>{code}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share your invite"
        onPress={share}
        style={[styles.cta, { backgroundColor: colors.primary }]}
      >
        <Text style={[styles.ctaText, { color: colors.onAccent }]}>Share invite</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy your code"
        onPress={copy}
        style={[styles.secondary, { borderColor: colors.border }]}
      >
        <Text style={[styles.ctaText, { color: colors.text }]}>
          {copied ? "Copied" : "Copy code"}
        </Text>
      </Pressable>

      {referrer?.name ? (
        <Text style={[styles.note, { color: colors.subtext }]}>
          You were invited by {referrer.name}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  lead: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  note: { fontSize: 14, lineHeight: 20 },
  codeCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    gap: 4,
    marginVertical: 6,
  },
  codeLabel: { fontSize: 13 },
  code: { fontSize: 30, fontWeight: "800", letterSpacing: 4 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  secondary: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
