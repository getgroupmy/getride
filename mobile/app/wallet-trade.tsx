import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/contexts/WalletContext";
import { useColors } from "@/hooks/useColors";
import {
  computeMarketRate,
  fetchCoinMarketStats,
  fetchGetCoinSettings,
  type CoinMarketRate,
  type GetCoinSettings,
} from "@/utils/getCoinStore";
import { tradeCoins } from "@/utils/walletStore";

type Direction = "buy" | "sell";

/**
 * Buy or sell GET.coin against GET.wallet.
 *
 * The rate shown here is only ever indicative. `wallet_trade_coins` anchors the
 * executed rate server-side to the admin peg ± the permitted swing band and
 * enforces the supply cap, so a stale or tampered client rate cannot move coins
 * at a price the operator did not sanction.
 */
export default function WalletTrade() {
  const colors = useColors();
  const { authState } = useAuth();
  const { balances, apply } = useWallet();

  const [settings, setSettings] = useState<GetCoinSettings | null>(null);
  const [rate, setRate] = useState<CoinMarketRate | null>(null);
  const [circulating, setCirculating] = useState(0);
  const [direction, setDirection] = useState<Direction>("buy");
  const [coins, setCoins] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, stats] = await Promise.all([fetchGetCoinSettings(), fetchCoinMarketStats()]);
      setSettings(s);
      setRate(computeMarketRate(s, stats));
      setCirculating(stats.circulatingSupply);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const amount = Number(coins);
  const valid = Number.isFinite(amount) && amount > 0;
  const ratePerGC = rate?.ratePerGC ?? 0;
  const cost = valid && ratePerGC > 0 ? amount * ratePerGC : 0;

  const submit = async () => {
    if (!valid || !authState.userId || busy) return;

    if (direction === "buy" && cost > balances.getWallet) {
      Alert.alert("Not enough in GET.wallet", "Top up first, then try again.");
      return;
    }
    if (direction === "sell" && amount > balances.getCoin) {
      Alert.alert("Not enough GET.coin", "You don't have that many coins.");
      return;
    }

    setBusy(true);
    const res = await tradeCoins({
      userId: authState.userId,
      direction,
      coins: amount,
      ratePerGC,
      maxSupply: settings?.maxSupply ?? 0,
      circulatingSupply: circulating,
    });
    setBusy(false);

    if (!res.ok) {
      Alert.alert("Trade didn't go through", res.error ?? "Please try again.");
      return;
    }
    apply(res.balances);
    setCoins("");
    Alert.alert(
      direction === "buy" ? "Coins bought" : "Coins sold",
      `${amount.toFixed(2)} GC ${direction === "buy" ? "added to" : "sold from"} your balance.`
    );
    void load();
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.rateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.rateLabel, { color: colors.textSecondary }]}>1 GET.coin</Text>
        <Text style={[styles.rateValue, { color: colors.text }]}>
          {balances.currency} {ratePerGC.toFixed(4)}
        </Text>
        {rate && settings?.marketEnabled ? (
          <Text
            style={[
              styles.rateNote,
              { color: rate.changePct >= 0 ? colors.success : colors.error },
            ]}
          >
            {rate.changePct >= 0 ? "+" : ""}
            {rate.changePct.toFixed(2)}% vs peg
          </Text>
        ) : (
          <Text style={[styles.rateNote, { color: colors.subtext }]}>Fixed rate</Text>
        )}
      </View>

      <View style={styles.toggle}>
        {(["buy", "sell"] as Direction[]).map((d) => (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={d === "buy" ? "Buy coins" : "Sell coins"}
            onPress={() => setDirection(d)}
            style={[
              styles.toggleBtn,
              {
                backgroundColor: direction === d ? colors.primary : colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                { color: direction === d ? colors.onAccent : colors.text },
              ]}
            >
              {d === "buy" ? "Buy" : "Sell"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Coins (GC)</Text>
        <TextInput
          accessibilityLabel="Number of coins"
          value={coins}
          onChangeText={setCoins}
          placeholder="0.00"
          placeholderTextColor={colors.subtext}
          keyboardType="decimal-pad"
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
      </View>

      <View style={[styles.summary, { borderColor: colors.border }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {direction === "buy" ? "You pay" : "You receive"}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {balances.currency} {cost.toFixed(2)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>GET.wallet</Text>
          <Text style={[styles.summaryMeta, { color: colors.textSecondary }]}>
            {balances.currency} {balances.getWallet.toFixed(2)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>GET.coin</Text>
          <Text style={[styles.summaryMeta, { color: colors.textSecondary }]}>
            {balances.getCoin.toFixed(2)} GC
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={direction === "buy" ? "Confirm buy" : "Confirm sell"}
        onPress={submit}
        disabled={!valid || busy}
        style={[styles.cta, { backgroundColor: valid && !busy ? colors.primary : colors.border }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={[styles.ctaText, { color: colors.onAccent }]}>
            {direction === "buy" ? "Buy coins" : "Sell coins"}
          </Text>
        )}
      </Pressable>

      <Text style={[styles.footnote, { color: colors.subtext }]}>
        The final rate is set by the server when the trade runs, so it may differ slightly from
        the price shown here.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  rateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    gap: 2,
  },
  rateLabel: { fontSize: 13 },
  rateValue: { fontSize: 32, fontWeight: "800", letterSpacing: -0.6 },
  rateNote: { fontSize: 13, fontWeight: "600" },
  toggle: { flexDirection: "row", gap: 10 },
  toggleBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  toggleText: { fontSize: 15, fontWeight: "700" },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 20,
  },
  summary: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryValue: { fontSize: 18, fontWeight: "800" },
  summaryMeta: { fontSize: 14 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "700" },
  footnote: { fontSize: 12, lineHeight: 17 },
});
