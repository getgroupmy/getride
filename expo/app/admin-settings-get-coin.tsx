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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, Coins, Info, ArrowRightLeft, Check } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import {
  fetchGetCoinSettings,
  saveGetCoinRate,
  coinsToCurrency,
  currencyToCoins,
  type GetCoinSettings,
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
  const [error, setError] = useState<string>("");
  const [savedNote, setSavedNote] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const s = await fetchGetCoinSettings();
      setSettings(s);
      setRateInput(formatRate(s.coinsPerCurrency));
    } catch (e) {
      console.log("[admin-getcoin] load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const parsedRate = useMemo(() => {
    const n = Number(rateInput.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [rateInput]);

  const dirty = settings !== null && parsedRate > 0 && parsedRate !== settings.coinsPerCurrency;

  const handleSave = async () => {
    if (saving) return;
    setError("");
    setSavedNote("");
    if (!(parsedRate > 0)) {
      setError("Enter a rate greater than 0.");
      return;
    }
    setSaving(true);
    const res = await saveGetCoinRate(parsedRate);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Save failed.");
      return;
    }
    if (res.settings) {
      setSettings(res.settings);
      setRateInput(formatRate(res.settings.coinsPerCurrency));
    }
    setSavedNote("Exchange rate saved.");
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
              >
                {saving ? (
                  <ActivityIndicator color={Colors.onAccent} size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, { color: Colors.onAccent }]}>Save Rate</Text>
                )}
              </TouchableOpacity>

              {settings?.updatedAt ? (
                <Text style={[styles.updatedText, { color: Colors.textSecondary }]}>
                  Last updated {new Date(settings.updatedAt).toLocaleString()}
                </Text>
              ) : null}
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
});
