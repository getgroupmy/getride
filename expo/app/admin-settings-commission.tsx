import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Percent,
  Globe2,
  Map as MapIcon,
  Building2,
  Home,
  UserRound,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Search,
  Crown,
  Inbox,
} from "lucide-react-native";
import { Country, State, City } from "country-state-city";
import { useColors } from "@/hooks/useColors";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  CommissionLevel,
  CommissionRule,
  CommissionSource,
  DEFAULT_COMMISSION_RATE,
  deleteCommissionRule,
  fetchCommissionRules,
  saveCommissionRule,
} from "@/utils/commissionStore";

type OverrideLevel = Exclude<CommissionLevel, "master">;

interface LevelMeta {
  level: OverrideLevel;
  title: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
}

const LEVELS: LevelMeta[] = [
  { level: "user", title: "User overrides", description: "Per-partner rate — beats every other level", icon: UserRound },
  { level: "suburb", title: "Suburb overrides", description: "Beats city, state, country & master", icon: Home },
  { level: "city", title: "City overrides", description: "Beats state, country & master", icon: Building2 },
  { level: "state", title: "State overrides", description: "Beats country & master", icon: MapIcon },
  { level: "country", title: "Country overrides", description: "Beats master only", icon: Globe2 },
];

interface UserHit {
  id: string;
  name: string | null;
  phone: string | null;
  displayId: string | null;
}

function eqi(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function formatPct(rate: number): string {
  const pct = Math.round(rate * 10000) / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`;
}

function ruleScopeLabel(rule: CommissionRule): string {
  switch (rule.level) {
    case "country":
      return rule.country ?? "—";
    case "state":
      return [rule.state, rule.country].filter(Boolean).join(", ");
    case "city":
      return [rule.city, rule.state].filter(Boolean).join(", ");
    case "suburb":
      return [rule.suburb, rule.city].filter(Boolean).join(", ");
    case "user":
      return rule.userLabel ?? (rule.userId ? `${rule.userId.slice(0, 8)}…` : "—");
    default:
      return "Master";
  }
}

export default function AdminSettingsCommissionScreen() {
  const router = useRouter();
  const Colors = useColors();

  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [source, setSource] = useState<CommissionSource>("supabase");
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  const masterRule = useMemo<CommissionRule | undefined>(
    () => rules.find((r) => r.level === "master"),
    [rules]
  );
  const [masterInput, setMasterInput] = useState<string>("");
  const [masterEditing, setMasterEditing] = useState<boolean>(false);

  // ---- add / edit modal -----------------------------------------------------
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [modalLevel, setModalLevel] = useState<OverrideLevel>("country");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selCountry, setSelCountry] = useState<string>("");
  const [selState, setSelState] = useState<string>("");
  const [selCity, setSelCity] = useState<string>("");
  const [selSuburb, setSelSuburb] = useState<string>("");
  const [selUserId, setSelUserId] = useState<string>("");
  const [selUserLabel, setSelUserLabel] = useState<string>("");
  const [rateInput, setRateInput] = useState<string>("");
  const [activeInput, setActiveInput] = useState<boolean>(true);
  const [focusField, setFocusField] = useState<"country" | "state" | "city" | null>(null);

  // ---- user search ----------------------------------------------------------
  const [userQuery, setUserQuery] = useState<string>("");
  const [userResults, setUserResults] = useState<UserHit[]>([]);
  const [userSearching, setUserSearching] = useState<boolean>(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRules = useCallback(async () => {
    const res = await fetchCommissionRules();
    setRules(res.rules);
    setSource(res.source);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const countryIso = useMemo<string | null>(() => {
    const hit = Country.getAllCountries().find((c) => eqi(c.name, selCountry));
    return hit?.isoCode ?? null;
  }, [selCountry]);

  const stateIso = useMemo<string | null>(() => {
    if (!countryIso) return null;
    const hit = State.getStatesOfCountry(countryIso).find((s) => eqi(s.name, selState));
    return hit?.isoCode ?? null;
  }, [countryIso, selState]);

  const suggestions = useMemo<string[]>(() => {
    if (!focusField) return [];
    let pool: string[] = [];
    let query = "";
    if (focusField === "country") {
      pool = Country.getAllCountries().map((c) => c.name);
      query = selCountry;
    } else if (focusField === "state") {
      pool = countryIso ? State.getStatesOfCountry(countryIso).map((s) => s.name) : [];
      query = selState;
    } else {
      pool =
        countryIso && stateIso
          ? City.getCitiesOfState(countryIso, stateIso).map((c) => c.name)
          : [];
      query = selCity;
    }
    const q = query.trim().toLowerCase();
    const filtered = q.length > 0 ? pool.filter((n) => n.toLowerCase().includes(q)) : pool;
    return Array.from(new Set(filtered)).slice(0, 8);
  }, [focusField, selCountry, selState, selCity, countryIso, stateIso]);

  const runUserSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setUserResults([]);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setUserResults([]);
      return;
    }
    setUserSearching(true);
    try {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, phone, display_id")
        .or(`name.ilike.${like},phone.ilike.${like},display_id.ilike.${like}`)
        .limit(8);
      if (error) throw error;
      const rows = (data ?? []) as { id: string; name: string | null; phone: string | null; display_id: string | null }[];
      setUserResults(
        rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, displayId: r.display_id }))
      );
    } catch (e) {
      console.log("[commission] user search failed", e);
      setUserResults([]);
    } finally {
      setUserSearching(false);
    }
  }, []);

  const onUserQueryChange = useCallback(
    (text: string) => {
      setUserQuery(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => void runUserSearch(text), 350);
    },
    [runUserSearch]
  );

  const openAdd = useCallback((level: OverrideLevel) => {
    setModalLevel(level);
    setEditingId(null);
    setSelCountry("");
    setSelState("");
    setSelCity("");
    setSelSuburb("");
    setSelUserId("");
    setSelUserLabel("");
    setUserQuery("");
    setUserResults([]);
    setRateInput("");
    setActiveInput(true);
    setFocusField(null);
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((rule: CommissionRule) => {
    if (rule.level === "master") return;
    setModalLevel(rule.level);
    setEditingId(rule.id);
    setSelCountry(rule.country ?? "");
    setSelState(rule.state ?? "");
    setSelCity(rule.city ?? "");
    setSelSuburb(rule.suburb ?? "");
    setSelUserId(rule.userId ?? "");
    setSelUserLabel(rule.userLabel ?? "");
    setUserQuery("");
    setUserResults([]);
    const pct = Math.round(rule.rate * 10000) / 100;
    setRateInput(String(pct));
    setActiveInput(rule.active);
    setFocusField(null);
    setModalVisible(true);
  }, []);

  const parsePct = (raw: string): number | null => {
    const n = parseFloat(raw.replace(",", "."));
    if (!isFinite(n) || n < 0 || n >= 100) return null;
    return n / 100;
  };

  const submitModal = useCallback(async () => {
    const rate = parsePct(rateInput);
    if (rate === null) {
      Alert.alert("Invalid rate", "Enter a commission percentage between 0 and 99.99.");
      return;
    }
    setBusy(true);
    const res = await saveCommissionRule({
      id: editingId ?? undefined,
      level: modalLevel,
      country: selCountry,
      state: selState,
      city: selCity,
      suburb: selSuburb,
      userId: selUserId,
      userLabel: selUserLabel,
      rate,
      active: activeInput,
    });
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Could not save", res.error ?? "Please try again.");
      return;
    }
    setModalVisible(false);
    await loadRules();
  }, [rateInput, editingId, modalLevel, selCountry, selState, selCity, selSuburb, selUserId, selUserLabel, activeInput, loadRules]);

  const saveMaster = useCallback(async () => {
    const rate = parsePct(masterInput);
    if (rate === null) {
      Alert.alert("Invalid rate", "Enter a commission percentage between 0 and 99.99.");
      return;
    }
    setBusy(true);
    const res = await saveCommissionRule({ id: masterRule?.id, level: "master", rate });
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Could not save", res.error ?? "Please try again.");
      return;
    }
    setMasterEditing(false);
    await loadRules();
  }, [masterInput, masterRule?.id, loadRules]);

  const toggleActive = useCallback(
    async (rule: CommissionRule) => {
      const res = await saveCommissionRule({
        id: rule.id,
        level: rule.level,
        country: rule.country,
        state: rule.state,
        city: rule.city,
        suburb: rule.suburb,
        userId: rule.userId,
        userLabel: rule.userLabel,
        rate: rule.rate,
        active: !rule.active,
      });
      if (!res.ok) {
        Alert.alert("Could not update", res.error ?? "Please try again.");
        return;
      }
      await loadRules();
    },
    [loadRules]
  );

  const confirmDelete = useCallback(
    (rule: CommissionRule) => {
      Alert.alert(
        "Delete override?",
        `${ruleScopeLabel(rule)} — ${formatPct(rule.rate)} will be removed. Rides will fall back to the next level in the chain.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              const res = await deleteCommissionRule(rule.id);
              if (!res.ok) {
                Alert.alert("Could not delete", res.error ?? "Please try again.");
                return;
              }
              await loadRules();
            },
          },
        ]
      );
    },
    [loadRules]
  );

  const effectiveMasterRate = masterRule?.rate ?? DEFAULT_COMMISSION_RATE;

  const geoFieldRow = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    field: "country" | "state" | "city" | null,
    placeholder: string
  ) => (
    <View style={styles.fieldBlock} key={label}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text }]}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocusField(field)}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        autoCapitalize="words"
        autoCorrect={false}
        testID={`commission-field-${label.toLowerCase()}`}
      />
      {focusField === field && suggestions.length > 0 && (
        <View style={[styles.suggestBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          {suggestions.map((name) => (
            <TouchableOpacity
              key={name}
              style={styles.suggestRow}
              onPress={() => {
                onChange(name);
                if (field === "country") {
                  setSelState("");
                  setSelCity("");
                } else if (field === "state") {
                  setSelCity("");
                }
                setFocusField(null);
              }}
            >
              <Text style={[styles.suggestText, { color: Colors.text }]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  const renderRuleRow = (rule: CommissionRule) => (
    <View
      key={rule.id}
      style={[styles.ruleRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border, opacity: rule.active ? 1 : 0.55 }]}
      testID={`commission-rule-${rule.id}`}
    >
      <View style={styles.ruleInfo}>
        <Text style={[styles.ruleScope, { color: Colors.text }]} numberOfLines={1}>
          {ruleScopeLabel(rule)}
        </Text>
        {rule.level === "suburb" && (
          <Text style={[styles.ruleSub, { color: Colors.textSecondary }]} numberOfLines={1}>
            {[rule.state, rule.country].filter(Boolean).join(", ")}
          </Text>
        )}
        {rule.level === "city" && rule.country ? (
          <Text style={[styles.ruleSub, { color: Colors.textSecondary }]} numberOfLines={1}>
            {rule.country}
          </Text>
        ) : null}
        {rule.level === "user" && rule.userId ? (
          <Text style={[styles.ruleSub, { color: Colors.textSecondary }]} numberOfLines={1}>
            ID: {rule.userId.slice(0, 13)}…
          </Text>
        ) : null}
      </View>
      <View style={[styles.ratePill, { backgroundColor: Colors.accent + "18" }]}>
        <Text style={[styles.ratePillText, { color: Colors.accent }]}>{formatPct(rule.rate)}</Text>
      </View>
      <Switch
        value={rule.active}
        onValueChange={() => void toggleActive(rule)}
        trackColor={{ false: Colors.gray[300], true: Colors.accent }}
        thumbColor="#fff"
        testID={`commission-active-${rule.id}`}
      />
      <TouchableOpacity onPress={() => openEdit(rule)} style={styles.ruleBtn} testID={`commission-edit-${rule.id}`} accessibilityRole="button" accessibilityLabel="Edit commission">
        <Pencil color={Colors.textSecondary} size={16} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => confirmDelete(rule)} style={styles.ruleBtn} testID={`commission-delete-${rule.id}`} accessibilityRole="button" accessibilityLabel="Delete commission">
        <Trash2 color={Colors.error} size={16} />
      </TouchableOpacity>
    </View>
  );

  const modalTitle = `${editingId ? "Edit" : "Add"} ${modalLevel} override`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="commission-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Percent color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Commission Rates</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Master rate + geographic & per-user overrides
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.priorityBox, { backgroundColor: Colors.accent + "10", borderColor: Colors.accent + "30" }]}>
            <Text style={[styles.priorityTitle, { color: Colors.text }]}>Override priority</Text>
            <Text style={[styles.priorityChain, { color: Colors.textSecondary }]}>
              User → Suburb → City → State → Country → Master
            </Text>
            <Text style={[styles.priorityNote, { color: Colors.textSecondary }]}>
              When a trip completes, the first matching level (highest first) decides the commission
              deducted from the partner&apos;s GET.credit.
            </Text>
          </View>

          {source === "local" && (
            <View style={[styles.localBox, { backgroundColor: (Colors.warning ?? "#F59E0B") + "15", borderColor: (Colors.warning ?? "#F59E0B") + "40" }]}>
              <Text style={[styles.localText, { color: Colors.text }]}>
                Commission table not found in the live database — changes are stored on this device
                only. Run migration 0058 in Supabase to sync rates across all devices.
              </Text>
            </View>
          )}

          {/* Master rate */}
          <View style={[styles.masterCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
              <Crown color={Colors.accent} size={20} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: Colors.text }]}>Master commission rate</Text>
              <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                Platform-wide default when no override matches
                {!masterRule ? ` (built-in ${formatPct(DEFAULT_COMMISSION_RATE)})` : ""}
              </Text>
            </View>
            {masterEditing ? (
              <View style={styles.masterEditRow}>
                <TextInput
                  style={[styles.masterInput, { backgroundColor: Colors.background, borderColor: Colors.accent, color: Colors.text }]}
                  value={masterInput}
                  onChangeText={setMasterInput}
                  keyboardType="decimal-pad"
                  placeholder="15"
                  placeholderTextColor={Colors.textSecondary}
                  autoFocus
                  testID="commission-master-input"
                />
                <Text style={[styles.masterPct, { color: Colors.textSecondary }]}>%</Text>
                <TouchableOpacity
                  onPress={() => void saveMaster()}
                  style={[styles.masterSaveBtn, { backgroundColor: Colors.accent }]}
                  disabled={busy}
                  testID="commission-master-save"
                  accessibilityRole="button"
                  accessibilityLabel="Save"
                >
                  <Check color="#fff" size={16} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setMasterEditing(false)}
                  style={[styles.masterSaveBtn, { backgroundColor: Colors.gray[300] }]}
                >
                  <X color={Colors.text} size={16} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  const pct = Math.round(effectiveMasterRate * 10000) / 100;
                  setMasterInput(String(pct));
                  setMasterEditing(true);
                }}
                style={[styles.masterRatePill, { backgroundColor: Colors.accent }]}
                testID="commission-master-edit"
                accessibilityRole="button"
                accessibilityLabel="Edit commission"
              >
                <Text style={styles.masterRateText}>{formatPct(effectiveMasterRate)}</Text>
                <Pencil color="#fff" size={13} />
              </TouchableOpacity>
            )}
          </View>

          {/* Override sections */}
          {LEVELS.map((meta) => {
            const Icon = meta.icon;
            const levelRules = rules.filter((r) => r.level === meta.level);
            return (
              <View key={meta.level} style={{ marginTop: 22 }}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Icon color={Colors.accent} size={16} />
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>{meta.title}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => openAdd(meta.level)}
                    style={[styles.addBtn, { backgroundColor: Colors.accent + "15" }]}
                    testID={`commission-add-${meta.level}`}
                  >
                    <Plus color={Colors.accent} size={14} />
                    <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.sectionDesc, { color: Colors.textSecondary }]}>{meta.description}</Text>
                {levelRules.length === 0 ? (
                  <View style={[styles.emptyRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                    <Inbox color={Colors.textSecondary} size={16} />
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No overrides</Text>
                  </View>
                ) : (
                  <View style={styles.list}>{levelRules.map(renderRuleRow)}</View>
                )}
              </View>
            );
          })}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Add / edit override modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>{modalTitle}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.ruleBtn} testID="commission-modal-close">
                <X color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
              {modalLevel !== "user" &&
                geoFieldRow("Country", selCountry, setSelCountry, "country", "e.g. Malaysia")}
              {["state", "city", "suburb"].includes(modalLevel) &&
                geoFieldRow("State", selState, setSelState, "state", "e.g. Selangor")}
              {["city", "suburb"].includes(modalLevel) &&
                geoFieldRow("City", selCity, setSelCity, "city", "e.g. Petaling Jaya")}
              {modalLevel === "suburb" && (
                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Suburb</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text }]}
                    value={selSuburb}
                    onChangeText={setSelSuburb}
                    onFocus={() => setFocusField(null)}
                    placeholder="e.g. Bangsar"
                    placeholderTextColor={Colors.textSecondary}
                    autoCapitalize="words"
                    autoCorrect={false}
                    testID="commission-field-suburb"
                  />
                </View>
              )}

              {modalLevel === "user" && (
                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>User (partner account)</Text>
                  {selUserId ? (
                    <View style={[styles.selectedUser, { backgroundColor: Colors.accent + "12", borderColor: Colors.accent + "40" }]}>
                      <UserRound color={Colors.accent} size={16} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.selectedUserName, { color: Colors.text }]} numberOfLines={1}>
                          {selUserLabel || "Selected user"}
                        </Text>
                        <Text style={[styles.selectedUserId, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {selUserId}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setSelUserId("");
                          setSelUserLabel("");
                        }}
                        style={styles.ruleBtn}
                      >
                        <X color={Colors.textSecondary} size={16} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={[styles.searchRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                        <Search color={Colors.textSecondary} size={16} />
                        <TextInput
                          style={[styles.searchInput, { color: Colors.text }]}
                          value={userQuery}
                          onChangeText={onUserQueryChange}
                          placeholder="Search name, phone or ID…"
                          placeholderTextColor={Colors.textSecondary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          testID="commission-user-search"
                        />
                        {userSearching && <ActivityIndicator size="small" color={Colors.accent} />}
                      </View>
                      {userResults.map((u) => (
                        <TouchableOpacity
                          key={u.id}
                          style={[styles.userHit, { borderColor: Colors.border }]}
                          onPress={() => {
                            setSelUserId(u.id);
                            setSelUserLabel(
                              [u.name, u.phone].filter(Boolean).join(" · ") || u.displayId || u.id.slice(0, 8)
                            );
                            setUserResults([]);
                            setUserQuery("");
                          }}
                          testID={`commission-user-hit-${u.id}`}
                        >
                          <Text style={[styles.userHitName, { color: Colors.text }]} numberOfLines={1}>
                            {u.name ?? "Unnamed"}
                          </Text>
                          <Text style={[styles.userHitSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                            {[u.phone, u.displayId].filter(Boolean).join(" · ") || u.id}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      {!isSupabaseConfigured && (
                        <Text style={[styles.userHitSub, { color: Colors.textSecondary, marginTop: 6 }]}>
                          Database not connected — user search unavailable.
                        </Text>
                      )}
                    </>
                  )}
                </View>
              )}

              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Commission rate (%)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text }]}
                  value={rateInput}
                  onChangeText={setRateInput}
                  onFocus={() => setFocusField(null)}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 12.5"
                  placeholderTextColor={Colors.textSecondary}
                  testID="commission-field-rate"
                />
              </View>

              <View style={styles.activeRow}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginBottom: 0 }]}>Active</Text>
                <Switch
                  value={activeInput}
                  onValueChange={setActiveInput}
                  trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                  thumbColor="#fff"
                  testID="commission-field-active"
                />
              </View>
            </ScrollView>

            <TouchableOpacity
              onPress={() => void submitModal()}
              style={[styles.submitBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              disabled={busy}
              testID="commission-modal-save"
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>{editingId ? "Save changes" : "Add override"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  content: { paddingHorizontal: 16, paddingTop: 16 },

  priorityBox: { borderRadius: 12, borderWidth: 1, padding: 12 },
  priorityTitle: { fontSize: 13, fontWeight: "800" as const },
  priorityChain: { fontSize: 13, fontWeight: "700" as const, marginTop: 4 },
  priorityNote: { fontSize: 12, lineHeight: 17, marginTop: 4 },

  localBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
  localText: { fontSize: 12, lineHeight: 17 },

  masterCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginTop: 16,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  masterRatePill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  masterRateText: { color: "#fff", fontSize: 14, fontWeight: "800" as const },
  masterEditRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  masterInput: {
    width: 64,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  masterPct: { fontSize: 14, fontWeight: "700" as const },
  masterSaveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },

  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  sectionTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "800" as const },
  sectionDesc: { fontSize: 12, marginTop: 2, marginBottom: 10 },
  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  addBtnText: { fontSize: 12, fontWeight: "800" as const },
  list: { gap: 8 },
  emptyRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyText: { fontSize: 12, fontWeight: "600" as const },

  ruleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  ruleInfo: { flex: 1 },
  ruleScope: { fontSize: 14, fontWeight: "700" as const },
  ruleSub: { fontSize: 11, marginTop: 1 },
  ratePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  ratePillText: { fontSize: 12, fontWeight: "800" as const },
  ruleBtn: { padding: 6 },

  modalWrap: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 10,
  },
  modalTitle: { fontSize: 16, fontWeight: "800" as const, textTransform: "capitalize" as const },

  fieldBlock: { marginTop: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "700" as const, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  suggestBox: { borderWidth: 1, borderRadius: 12, marginTop: 4, overflow: "hidden" as const },
  suggestRow: { paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { fontSize: 13 },

  searchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  userHit: { borderBottomWidth: 1, paddingVertical: 8, paddingHorizontal: 4 },
  userHitName: { fontSize: 13, fontWeight: "700" as const },
  userHitSub: { fontSize: 11, marginTop: 1 },
  selectedUser: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  selectedUserName: { fontSize: 13, fontWeight: "700" as const },
  selectedUserId: { fontSize: 10, marginTop: 1 },

  activeRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 14,
  },
  submitBtn: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" as const },
});
