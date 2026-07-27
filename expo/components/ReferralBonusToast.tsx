import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, Platform } from "react-native";
import Constants from "expo-constants";
import { Gift } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { formatCoins } from "@/utils/getCoinStore";
import {
  subscribeReferralBonus,
  consumePendingReferralBonus,
} from "@/utils/referral";

const BONUS_GOLD = "#EAB308";

// Mounted at the app root (a sibling of the navigator), so there's no
// SafeAreaProvider in scope for `useSafeAreaInsets`. `Constants.statusBarHeight`
// gives a provider-free top offset that clears the status bar / notch.
const TOP_OFFSET = (Constants.statusBarHeight ?? 0) + 10;

/**
 * Globally-mounted listener that celebrates a referral welcome bonus. When a
 * freshly signed-up user's referral code is applied (`applyPendingReferral`),
 * the bonus GET.coin credited to them is announced here and a toast slides in
 * from the top explicitly stating the amount added to their balance.
 *
 * Two paths feed it: a live in-memory event (bonus earned during this session)
 * and a persisted flag consumed on mount (bonus that landed while navigating
 * away from PIN setup, or before this component was mounted). Either way the
 * persisted flag is cleared when the toast shows, so it appears exactly once.
 */
export default function ReferralBonusToast() {
  const [coins, setCoins] = useState<number | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (amount: number) => {
      if (!(amount > 0)) return;
      setCoins(amount);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      anim.stopAnimation();
      Animated.timing(anim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, {
          toValue: 0,
          duration: 260,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => setCoins(null));
      }, 4200);
    },
    [anim]
  );

  useEffect(() => {
    let alive = true;
    // Cold-start / post-navigation: surface a bonus recorded while nothing was
    // listening.
    consumePendingReferralBonus().then((amount) => {
      if (alive && amount) show(amount);
    });
    // Live: bonus earned during this session. Clear the persisted flag so the
    // cold-start path above never re-shows it.
    const unsubscribe = subscribeReferralBonus((amount) => {
      void consumePendingReferralBonus();
      show(amount);
    });
    return () => {
      alive = false;
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [show]);

  if (coins == null) return null;

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
        <Text style={styles.title}>Welcome bonus unlocked! 🎉</Text>
        <Text style={styles.body} testID="referral-bonus-toast-amount">
          {formatCoins(coins)} added to your GET.coin balance
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
