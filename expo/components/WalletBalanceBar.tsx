import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

/**
 * Bottom "Wallet balance" bar used on the Scan and Show Code screens —
 * mirrors the reference design: balance on the left, Reload link on the right.
 */
export default function WalletBalanceBar({
  balance,
  onReload,
  testID,
}: {
  balance: number | null;
  onReload: () => void;
  testID?: string;
}) {
  const Colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 14) }]} testID={testID}>
      <View style={styles.balanceInfo}>
        <Text style={styles.balanceLabel}>Wallet balance</Text>
        <Text style={styles.balanceValue} testID={testID ? `${testID}-value` : undefined}>
          RM{(balance ?? 0).toFixed(2)}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onReload}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        testID={testID ? `${testID}-reload` : undefined}
        accessibilityRole="button"
      >
        <Text style={[styles.reloadText, { color: Colors.accent }]}>Reload</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 2,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: "800" as const,
    color: "#111827",
  },
  reloadText: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
});
