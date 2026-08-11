import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import {
  ArrowLeft,
  Coins,
  Info,
  ArrowRightLeft,
  Check,
  Gift,
  TrendingUp,
  Database,
  Users,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import {
  fetchGetCoinSettings,
  saveGetCoinSettings,
  fetchCoinMarketStats,
  computeMarketRate,
  coinsToCurrency,
  currencyToCoins,
  rideRewardCoins,
  formatCoins,
  type GetCoinSettings,
  type CoinMarketStats,
} from "@/utils/getCoinStore";

/** "10" for whole rates, "10.25" otherwise. */
function formatRate(rate: number): string {
  return rate % 1 === 0 ? String(rate) : String(Math.round(rate * 10000) / 10000);
}

/**
 * Admin -> Settings -> Get Coin
 * Sets the GET.coin exchange rate: how many GC equal RM1. GET.coin balances
 * are shown in GC across the app and converted with this rate.
 */
export default function AdminSettingsGetCoinScreen() {
  const router = useRouter();
  const Colors = useColors();

  const [settings, setSettings] = useState<GetCoinSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [rateInput, setRateInput] = useState<string>("");
  const [earnInput, setEarnInput] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [savedNote, setSavedNote] = useState<string>("");
  const [marketEnabled, setMarketEnabled] = useState<boolean>(false);
  const [sigTrading, setSigTrading] = useState<boolean>(true);
  const [sigRevenue, setSigRevenue] = useState<boolean>(true);
  const [sigServices, setSigServices] = useState<boolean>(true);
  const [sigSignups, setSigSignups] = useState<boolean>(true);
  const [sigMinting, setSigMinting] = useState<boolean>(true);
  const [swingInput, setSwingInput] = useState<string>("50");
  const [supplyInput, setSupplyInput] = useState<string>("0");
  const [stats, setStats] = useState<CoinMarketStats | null>(null);
  const [referralEnabled, setReferralEnabled] = useState<boolean>(true);
  const [refReferrerInput, setRefReferrerInput] = useState<string>("0");
  const [refReferredInput, setRefReferredInput] = useState<string>("0");

  const applySettings = useCallback((s: GetCoinSettings) => {
    setSettings(s);
    setRateInput(formatRate(s.coinsPerCurrency));
    setEarnInput(formatRate(s.earnCoinsPerCurrency));
    setMarketEnabled(s.marketEnabled);
    setSigTrading(s.signalTrading);
    setSigRevenue(s.signalRevenue);
    setSigServices(s.signalServices);
    setSigSignups(s.signalSignups);
    setSigMinting(s.signalMinting);
    setSwingInput(formatRate(s.maxSwingPct));
    setSupplyInput(formatRate(s.maxSupply));
    setReferralEnabled(s.referralEnabled);
    setRefReferrerInput(formatRate(s.referralReferrerCoins));
    setRefReferredInput(formatRate(s.referralReferredCoins));
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([fetchGetCoinSettings(), fetchCoinMarketStats()]);
      applySettings(s);
      setStats(m);
    } catch (e) {
      console.log("[admin-getcoin] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const parsedRate = useMemo(() => {
    const n = Number(rateInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [rateInput]);

  const parsedEarn = useMemo(() => {
    const n = Number(earnInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [earnInput]);

  const parsedSwing = useMemo(() => {
    const n = Number(swingInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 95) : 50;
  }, [swingInput]);

  const parsedSupply = useMemo(() => {
    const n = Number(supplyInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [supplyInput]);

  const parsedRefReferrer = useMemo(() => {
    const n = Number(refReferrerInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [refReferrerInput]);

  const parsedRefReferred = useMemo(() => {
    const n = Number(refReferredInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [refReferredInput]);

  const dirty =
    settings !== null &&
    parsedRate > 0 &&
    (parsedRate !== settings.coinsPerCurrency ||
      parsedEarn !== settings.earnCoinsPerCurrency ||
      marketEnabled !== settings.marketEnabled ||
      sigTrading !== settings.signalTrading ||
      sigRevenue !== settings.signalRevenue ||
      sigServices !== settings.signalServices ||
      sigSignups !== settings.signalSignups ||
      sigMinting !== settings.signalMinting ||
      parsedSwing !== settings.maxSwingPct ||
      parsedSupply !== settings.maxSupply ||
      referralEnabled !== settings.referralEnabled ||
      parsedRefReferrer !== settings.referralReferrerCoins ||
      parsedRefReferred !== settings.referralReferredCoins);

  /** Draft settings from the unsaved inputs, for the live market preview. */
  const draft = useMemo<GetCoinSettings | null>(() => {
    if (!settings || !(parsedRate > 0)) return null;
    return {
      ...settings,
      coinsPerCurrency: parsedRate,
      earnCoinsPerCurrency: parsedEarn,
      marketEnabled,
      signalTrading: sigTrading,
      signalRevenue: sigRevenue,
      signalServices: sigServices,
      signalSignups: sigSignups,
      signalMinting: sigMinting,
      maxSwingPct: parsedSwing,
      maxSupply: parsedSupply,
    };
  }, [
    settings,
    parsedRate,
    parsedEarn,
    marketEnabled,
    sigTrading,
    sigRevenue,
    sigServices,
    sigSignups,
    sigMinting,
    parsedSwing,
    parsedSupply,
  ]);

  const marketPreview = useMemo(
    () => (draft && stats ? computeMarketRate(draft, stats) : null),
    [draft, stats]
  );

  const handleSave = async () => {
    if (saving) return;
    setError("");
    setSavedNote("");
    if (!(parsedRate > 0)) {
      setError("Enter a rate greater than 0.");
      return;
    }
    setSaving(true);
    const res = await saveGetCoinSettings({
      coinsPerCurrency: parsedRate,
      earnCoinsPerCurrency: parsedEarn,
      marketEnabled,
      signalTrading: sigTrading,
      signalRevenue: sigRevenue,
      signalServices: sigServices,
      signalSignups: sigSignups,
      signalMinting: sigMinting,
      maxSwingPct: parsedSwing,
      maxSupply: parsedSupply,
      referralEnabled,
      referralReferrerCoins: parsedRefReferrer,
      referralReferredCoins: parsedRefReferred,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    if (res.settings) {
      applySettings(res.settings);
    }
    setSavedNote("Get Coin settings saved.");
    setTimeout(() => setSavedNote(""), 2600);
  };

  const previewRows = useMemo(() => {
    if (!(parsedRate > 0)) return [];
    return [
      { left: "RM 1.00", right: `${formatRate(currencyToCoins(1, parsedRate))} GC` },
      { left: "RM 10.00", right: `${formatRate(currencyToCoins(10, parsedRate))} GC` },
      { left: "100 GC", right: `RM ${coinsToCurrency(100, parsedRate).toFixed(2)}` },
    ];
  }, [parsedRate]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="getcoin-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Coins color="#EAB308" size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Get Coin</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            GET.coin exchange rate (GC per RM)
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {settings?.source === "local" ? (
              <View style={[styles.banner, { backgroundColor: Colors.warning + "15" }]}>
                <Info color={Colors.warning} size={15} />
                <Text style={[styles.bannerText, { color: "#6B7280" }]}>
                  Get Coin settings table not found in the database — the rate is saved on
                  this device only. Apply migration 0061 to sync it.
                </Text>
              </View>
            ) : null}

            {savedNote ? (
              <View style={[styles.banner, { backgroundColor: Colors.success + "18" }]}>
                <Check color={Colors.success} size={15} />
                <Text style={[styles.bannerText, { color: Colors.success }]}>{savedNote}</Text>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={styles.cardTitleRow}>
                <ArrowRightLeft color={Colors.accent} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Exchange Rate</Text>
              </View>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                How many Get Coins (GC) equal RM1. GET.coin balances everywhere in the app
                use this rate for their approximate RM value.
              </Text>

              <View style={styles.rateRow}>
                <View style={[styles.ratePill, { backgroundColor: Colors.accent + "14" }]}>
                  <Text style={[styles.ratePillText, { color: Colors.accent }]}>RM 1</Text>
                </View>
                <Text style={[styles.rateEquals, { color: Colors.textSecondary }]}>=</Text>
                <View style={[styles.rateInputWrap, { borderColor: Colors.border, backgroundColor: Colors.background }]}>
                  <TextInput
                    style={[styles.rateInput, { color: Colors.text }]}
                    value={rateInput}
                    onChangeText={(t) => {
                      setRateInput(t);
                      setError("");
                    }}
                    keyboardType="decimal-pad"
                    placeholder="1"
                    placeholderTextColor={Colors.textSecondary}
                    testID="getcoin-rate-input"
                  />
                  <Text style={[styles.rateUnit, { color: "#A16207" }]}>GC</Text>
                </View>
              </View>

              {parsedRate > 0 ? (
                <Text style={[styles.inverseText, { color: Colors.textSecondary }]}>
                  1 GC ≈ RM {coinsToCurrency(1, parsedRate).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}
                </Text>
              ) : null}

              {error ? (
                <Text style={[styles.errorText, { color: Colors.danger }]}>{error}</Text>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  { backgroundColor: Colors.accent, opacity: saving ? 0.6 : dirty ? 1 : 0.4 },
                ]}
                onPress={handleSave}
                disabled={saving || !dirty}
                testID="getcoin-save"
                accessibilityRole="button"
              >
                {saving ? (
                  <ActivityIndicator color={Colors.onAccent} size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, { color: Colors.onAccent }]}>Save Settings</Text>
                )}
              </TouchableOpacity>

              {settings?.updatedAt ? (
                <Text style={[styles.updatedText, { color: Colors.textSecondary }]}>
                  Last updated {new Date(settings.updatedAt).toLocaleString()}
                </Text>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Gift color="#EAB308" size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Ride Rewards</Text>
              </View>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                Coins riders earn per RM1 of a completed trip fare. Set to 0 to turn ride
                rewards off.
              </Text>

              <View style={styles.rateRow}>
                <View style={[styles.ratePill, { backgroundColor: "#FDE68A" }]}>
                  <Text style={[styles.ratePillText, { color: "#92400E" }]}>RM 1 fare</Text>
                </View>
                <Text style={[styles.rateEquals, { color: Colors.textSecondary }]}>{"\u2192"}</Text>
                <View style={[styles.rateInputWrap, { borderColor: Colors.border, backgroundColor: Colors.background }]}>
                  <TextInput
                    style={[styles.rateInput, { color: Colors.text }]}
                    value={earnInput}
                    onChangeText={(t) => {
                      setEarnInput(t);
                      setError("");
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textSecondary}
                    testID="getcoin-earn-input"
                  />
                  <Text style={[styles.rateUnit, { color: "#A16207" }]}>GC</Text>
                </View>
              </View>

              <Text style={[styles.inverseText, { color: Colors.textSecondary }]}>
                {parsedEarn > 0
                  ? `Example: a RM25.00 trip rewards ${formatRate(rideRewardCoins(25, parsedEarn))} GC`
                  : "Ride rewards are currently off."}
              </Text>
            </View>

            {/* Market Pricing */}
            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={styles.cardTitleRow}>
                <TrendingUp color={Colors.accent} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Market Pricing</Text>
              </View>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                When on, the coin&apos;s traded value floats around the pegged rate, driven by
                live app activity. Spending and ride redemptions always use the pegged rate
                — only trading uses the market price.
              </Text>

              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: Colors.text }]}>Market-driven rate</Text>
                <Switch
                  value={marketEnabled}
                  onValueChange={setMarketEnabled}
                  trackColor={{ false: Colors.gray[200], true: Colors.accent + "66" }}
                  thumbColor={marketEnabled ? Colors.accent : "#9CA3AF"}
                  testID="getcoin-market-toggle"
                />
              </View>

              {marketEnabled ? (
                <>
                  <Text style={[styles.signalsHeading, { color: Colors.textSecondary }]}>
                    PRICE SIGNALS (LAST 30 DAYS)
                  </Text>
                  {[
                    {
                      key: "trading",
                      label: "Trading",
                      desc: "Buy vs sell volume between users",
                      value: sigTrading,
                      set: setSigTrading,
                    },
                    {
                      key: "revenue",
                      label: "Commission revenue",
                      desc: "App revenue charged to partners",
                      value: sigRevenue,
                      set: setSigRevenue,
                    },
                    {
                      key: "services",
                      label: "Completed services",
                      desc: "Trips and orders completed",
                      value: sigServices,
                      set: setSigServices,
                    },
                    {
                      key: "signups",
                      label: "New sign-ups",
                      desc: "New active users and partners",
                      value: sigSignups,
                      set: setSigSignups,
                    },
                    {
                      key: "minting",
                      label: "New coins generated",
                      desc: "Rewards, admin grants & purchases (pushes price down)",
                      value: sigMinting,
                      set: setSigMinting,
                    },
                  ].map((s) => (
                    <View key={s.key} style={styles.signalRow}>
                      <View style={styles.signalTextWrap}>
                        <Text style={[styles.signalLabel, { color: Colors.text }]}>{s.label}</Text>
                        <Text style={[styles.signalDesc, { color: Colors.textSecondary }]}>
                          {s.desc}
                        </Text>
                      </View>
                      <Switch
                        value={s.value}
                        onValueChange={s.set}
                        trackColor={{ false: Colors.gray[200], true: Colors.accent + "66" }}
                        thumbColor={s.value ? Colors.accent : "#9CA3AF"}
                        testID={`getcoin-signal-${s.key}`}
                      />
                    </View>
                  ))}

                  <View style={styles.smallInputRow}>
                    <Text style={[styles.smallInputLabel, { color: Colors.text }]}>
                      Max price swing
                    </Text>
                    <View
                      style={[
                        styles.smallInputWrap,
                        { borderColor: Colors.border, backgroundColor: Colors.background },
                      ]}
                    >
                      <TextInput
                        style={[styles.smallInput, { color: Colors.text }]}
                        value={swingInput}
                        onChangeText={(t) => {
                          setSwingInput(t);
                          setError("");
                        }}
                        keyboardType="decimal-pad"
                        placeholder="50"
                        placeholderTextColor={Colors.textSecondary}
                        testID="getcoin-swing-input"
                      />
                      <Text style={[styles.smallInputUnit, { color: Colors.textSecondary }]}>%</Text>
                    </View>
                  </View>
                  <Text style={[styles.inverseText, { color: Colors.textSecondary, marginTop: 4 }]}>
                    The market rate never moves more than ±{formatRate(parsedSwing)}% from the peg.
                  </Text>

                  {marketPreview ? (
                    <View style={[styles.previewBanner, { backgroundColor: Colors.accent + "12" }]}>
                      <TrendingUp color={Colors.accent} size={14} />
                      <Text style={[styles.previewBannerText, { color: Colors.text }]}>
                        Live market now: 1 GC ≈ RM {marketPreview.ratePerGC.toFixed(4)} (
                        {marketPreview.changePct >= 0 ? "+" : ""}
                        {marketPreview.changePct.toFixed(2)}% vs peg)
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>

            {/* Referral Rewards */}
            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Users color={Colors.accent} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Referral Rewards</Text>
              </View>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                Bonus GET.coin when a new user signs up with a shared referral link. Both
                sides are credited automatically the moment the new account is created.
              </Text>

              <View style={styles.toggleRow}>
                <Text style={[styles.toggleLabel, { color: Colors.text }]}>Referral program</Text>
                <Switch
                  value={referralEnabled}
                  onValueChange={setReferralEnabled}
                  trackColor={{ false: Colors.gray[200], true: Colors.accent + "66" }}
                  thumbColor={referralEnabled ? Colors.accent : "#9CA3AF"}
                  testID="getcoin-referral-toggle"
                />
              </View>

              {referralEnabled ? (
                <>
                  <View style={styles.smallInputRow}>
                    <Text style={[styles.smallInputLabel, { color: Colors.text }]}>
                      Inviter earns
                    </Text>
                    <View
                      style={[
                        styles.smallInputWrap,
                        { borderColor: Colors.border, backgroundColor: Colors.background },
                      ]}
                    >
                      <TextInput
                        style={[styles.smallInput, { color: Colors.text }]}
                        value={refReferrerInput}
                        onChangeText={(t) => {
                          setRefReferrerInput(t);
                          setError("");
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={Colors.textSecondary}
                        testID="getcoin-referral-referrer-input"
                      />
                      <Text style={[styles.smallInputUnit, { color: "#A16207" }]}>GC</Text>
                    </View>
                  </View>

                  <View style={styles.smallInputRow}>
                    <Text style={[styles.smallInputLabel, { color: Colors.text }]}>
                      New user earns
                    </Text>
                    <View
                      style={[
                        styles.smallInputWrap,
                        { borderColor: Colors.border, backgroundColor: Colors.background },
                      ]}
                    >
                      <TextInput
                        style={[styles.smallInput, { color: Colors.text }]}
                        value={refReferredInput}
                        onChangeText={(t) => {
                          setRefReferredInput(t);
                          setError("");
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={Colors.textSecondary}
                        testID="getcoin-referral-referred-input"
                      />
                      <Text style={[styles.smallInputUnit, { color: "#A16207" }]}>GC</Text>
                    </View>
                  </View>

                  <Text style={[styles.inverseText, { color: Colors.textSecondary }]}>
                    {parsedRefReferrer > 0 || parsedRefReferred > 0
                      ? `Each sign-up mints ${formatRate(parsedRefReferrer + parsedRefReferred)} GC in total${
                          parsedRate > 0
                            ? ` (≈ RM ${coinsToCurrency(parsedRefReferrer + parsedRefReferred, parsedRate).toFixed(2)})`
                            : ""
                        }.`
                      : "Both amounts are 0 — referrals are tracked but no coins are paid."}
                  </Text>
                </>
              ) : null}
            </View>

            {/* Coin Supply */}
            <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Database color="#EAB308" size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Coin Supply</Text>
              </View>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                Maximum GC that can ever exist — like Bitcoin&apos;s 21 million cap. New coins
                can&apos;t be minted past this limit. Set to 0 for unlimited supply.
              </Text>

              <View style={styles.smallInputRow}>
                <Text style={[styles.smallInputLabel, { color: Colors.text }]}>Max supply</Text>
                <View
                  style={[
                    styles.smallInputWrap,
                    { borderColor: Colors.border, backgroundColor: Colors.background },
                  ]}
                >
                  <TextInput
                    style={[styles.smallInput, { color: Colors.text }]}
                    value={supplyInput}
                    onChangeText={(t) => {
                      setSupplyInput(t);
                      setError("");
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textSecondary}
                    testID="getcoin-supply-input"
                  />
                  <Text style={[styles.smallInputUnit, { color: "#A16207" }]}>GC</Text>
                </View>
              </View>

              <Text style={[styles.inverseText, { color: Colors.textSecondary }]}>
                {stats
                  ? `${formatCoins(stats.circulatingSupply)} in circulation${
                      parsedSupply > 0
                        ? ` · ${formatCoins(Math.max(parsedSupply - stats.circulatingSupply, 0))} left to mint`
                        : " · supply is unlimited"
                    }`
                  : parsedSupply > 0
                    ? "Supply cap active."
                    : "Supply is unlimited."}
              </Text>
            </View>

            {previewRows.length > 0 ? (
              <View style={[styles.card, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <View style={styles.cardTitleRow}>
                  <Coins color="#EAB308" size={18} />
                  <Text style={[styles.cardTitle, { color: Colors.text }]}>Preview</Text>
                </View>
                {previewRows.map((row) => (
                  <View key={row.left} style={styles.previewRow}>
                    <Text style={[styles.previewLeft, { color: Colors.textSecondary }]}>{row.left}</Text>
                    <Text style={[styles.previewRight, { color: Colors.text }]}>{row.right}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  banner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  cardTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "800" as const },
  cardSub: { fontSize: 12, lineHeight: 17, marginBottom: 16 },
  rateRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  ratePill: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  ratePillText: { fontSize: 17, fontWeight: "800" as const },
  rateEquals: { fontSize: 18, fontWeight: "700" as const },
  rateInputWrap: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  rateInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700" as const,
    paddingVertical: 12,
  },
  rateUnit: { fontSize: 15, fontWeight: "800" as const },
  inverseText: { fontSize: 13, marginTop: 10 },
  errorText: { fontSize: 13, fontWeight: "600" as const, marginTop: 10 },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginTop: 16,
  },
  saveBtnText: { fontSize: 15, fontWeight: "800" as const },
  updatedText: { fontSize: 12, marginTop: 10, textAlign: "center" as const },
  previewRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 8,
  },
  previewLeft: { fontSize: 14 },
  previewRight: { fontSize: 14, fontWeight: "800" as const },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 4,
  },
  toggleLabel: { fontSize: 15, fontWeight: "700" as const },
  signalsHeading: {
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 4,
  },
  signalRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 8,
  },
  signalTextWrap: { flex: 1, marginRight: 12 },
  signalLabel: { fontSize: 14, fontWeight: "600" as const },
  signalDesc: { fontSize: 12, marginTop: 1 },
  smallInputRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 12,
    gap: 12,
  },
  smallInputLabel: { fontSize: 14, fontWeight: "600" as const },
  smallInputWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minWidth: 120,
  },
  smallInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700" as const,
    paddingVertical: 8,
  },
  smallInputUnit: { fontSize: 13, fontWeight: "800" as const },
  previewBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  previewBannerText: { flex: 1, fontSize: 12, fontWeight: "600" as const },
});
