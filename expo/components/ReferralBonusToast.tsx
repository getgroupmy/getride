import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, Platform } from "react-native";
import Constants from "expo-constants";
import { Gift } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { formatCoins } from "@/utils/getCoinStore";
import { useAuth } from "@/contexts/AuthContext";
import {
  subscribeReferralBonus,
  consumePendingReferralBonuses,
  syncReferralBonusCredits,
  subscribeReferralBonusCredits,
  type ReferralBonusEvent,
} from "@/utils/referral";

const BONUS_GOLD = "#EAB308";

/** How long a toast stays on screen before sliding back out. */
const VISIBLE_MS = 4200;
const ANIM_MS = 260;
/** Beat between consecutive toasts so they read as separate events. */
const GAP_MS = 320;

// Mounted at the app root (a sibling of the navigator), so there's no
// SafeAreaProvider in scope for `useSafeAreaInsets`. `Constants.statusBarHeight`
// gives a provider-free top offset that clears the status bar / notch.
const TOP_OFFSET = (Constants.statusBarHeight ?? 0) + 10;

const COPY: Record<ReferralBonusEvent["kind"], string> = {
  welcome: "Welcome bonus unlocked! 🎉",
  referrer: "Referral bonus earned! 🎉",
};

/**
 * Globally-mounted listener that celebrates referral bonus GET.coin, popping a
 * toast that states the exact amount added to the user's balance. Covers both
 * sides of a referral, which reach the client differently:
 *
 * - **Welcome bonus** — the user signed up with someone's code. Announced by
 *   `applyPendingReferral` while they're in the app, or replayed from the
 *   persisted queue when it landed mid-navigation or before this mounted.
 * - **Referral bonus** — a friend joined with this user's code, crediting them
 *   from the server with no local action to hook onto. Picked up live from the
 *   wallet-transaction insert, or on launch for credits earned while away.
 *
 * Bonuses queue rather than overwrite, so two friends joining shows two toasts.
 */
export default function ReferralBonusToast() {
  const { authState, isSupabaseSession } = useAuth();
  const userId = authState.userId ?? null;

  const [current, setCurrent] = useState<ReferralBonusEvent | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const queue = useRef<ReferralBonusEvent[]>([]);
  const showing = useRef<boolean>(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef<boolean>(true);

  const showNext = useCallback(() => {
    const next = queue.current.shift();
    if (!next || !mounted.current) {
      showing.current = false;
      return;
    }
    showing.current = true;
    setCurrent(next);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    anim.stopAnimation();
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: ANIM_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: ANIM_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        if (!mounted.current) return;
        setCurrent(null);
        // Let the toast clear the screen before the next one slides in.
        if (gapTimer.current) clearTimeout(gapTimer.current);
        gapTimer.current = setTimeout(showNext, GAP_MS);
      });
    }, VISIBLE_MS);
  }, [anim]);

  const enqueue = useCallback(
    (events: ReferralBonusEvent[]) => {
      const valid = events.filter((e) => e && e.coins > 0);
      if (!valid.length) return;
      queue.current.push(...valid);
      if (!showing.current) showNext();
    },
    [showNext]
  );

  // Welcome bonuses: live events plus anything queued while nothing listened.
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeReferralBonus((event) => enqueue([event]));
    consumePendingReferralBonuses()
      .then((events) => {
        if (mounted.current) enqueue(events);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (gapTimer.current) clearTimeout(gapTimer.current);
    };
  }, [enqueue]);

  // Inviter-side bonuses: catch up on credits earned while away, then watch for
  // new ones. Needs a real Supabase session — the wallet query is RLS-scoped.
  useEffect(() => {
    if (!userId || !isSupabaseSession) return;
    void syncReferralBonusCredits(userId);
    return subscribeReferralBonusCredits(userId);
  }, [userId, isSupabaseSession]);

  if (current == null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { top: TOP_OFFSET },
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-24, 0],
              }),
            },
          ],
        },
      ]}
      testID="referral-bonus-toast"
    >
      <View style={styles.iconWrap}>
        <Gift color="#7A5C00" size={20} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{COPY[current.kind]}</Text>
        <Text style={styles.body} testID="referral-bonus-toast-amount">
          {formatCoins(current.coins)} added to your GET.coin balance
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: BONUS_GOLD,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: BONUS_GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1 },
  title: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  body: { color: "#FDE68A", fontSize: 13, fontWeight: "600", marginTop: 2 },
});
