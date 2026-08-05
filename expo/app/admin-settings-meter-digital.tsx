/**
 * Admin → Settings → Meter Digital Setting.
 *
 * The back office for the in-app taxi meter (`app/meter-digital.tsx`): one
 * global rate card plus country / state / city / suburb overrides, stored in
 * `meter_digital_settings` (migration 0081) and resolved on the driver's device
 * highest-scope-first.
 *
 * A card is six things in one editor — which sensors the meter may bill on,
 * whether a hire may open without the vehicle's odometer, whether a TEKSI driver
 * opens the app straight into the console, what the console's two leave keys do,
 * which console panels are shown and which may be tapped, and the rates
 * themselves. All of the shaping, coercion and validation is pure and lives in
 * `utils/meterSettings.ts` and `utils/meterLeave.ts`; this screen is the form
 * over it.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Country, State, City } from "country-state-city";
import {
  ArrowLeft,
  Building2,
  Check,
  Gauge,
  Globe2,
  Home,
  DoorOpen,
  Inbox,
  LayoutGrid,
  Map as MapIcon,
  Moon,
  Pencil,
  Plus,
  Luggage,
  Rocket,
  Satellite,
  Trash2,
  X,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useReadOnlyGuard } from "@/hooks/useReadOnlyGuard";
import { detectApp } from "@/utils/installedApps";
import {
  describeMeterLeave,
  normalizeMeterLeaveUrl,
  type MeterLeaveEhailingAction,
  type MeterLeavePassengerAction,
} from "@/utils/meterLeave";
import {
  describeAppIosRoute,
  describeAppPresence,
  meterLeaveAppById,
  meterLeaveAppProbe,
  meterLeaveAppStore,
  METER_LEAVE_APPS,
  STORE_LABELS,
  type AppPresence,
  type StorePlatform,
} from "@/utils/meterLeaveApps";
import {
  canApplyMeterPanelLive,
  createMeterProfileDraft,
  DEFAULT_METER_PROFILE,
  describeMeterRates,
  describeMissingMeterColumns,
  METER_PANEL_IDS,
  METER_PANEL_LABELS,
  meterProfileScopeLabel,
  setMeterPanelAccess,
  validateMeterProfile,
  type MeterPanelAccess,
  type MeterPanelId,
  type MeterProfile,
  type MeterSettingsLevel,
  type MeterSourceMode,
} from "@/utils/meterSettings";
import {
  deleteMeterProfile,
  fetchMeterProfiles,
  meterSettingsMissingGroups,
  saveMeterPanelAccess,
  saveMeterProfile,
  type MeterSettingsSource,
} from "@/utils/meterSettingsStore";
import type {
  MeterChargeFrom,
  MeterChargeMode,
  MeterDistanceMode,
  MeterTimeMode,
} from "@/utils/taxiMeter";

type OverrideLevel = Exclude<MeterSettingsLevel, "master">;

const LEVELS: {
  level: OverrideLevel;
  title: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
}[] = [
  { level: "suburb", title: "Suburb cards", description: "Beats city, state, country & global", icon: Home },
  { level: "city", title: "City cards", description: "Beats state, country & global", icon: Building2 },
  { level: "state", title: "State cards", description: "Beats country & global", icon: MapIcon },
  { level: "country", title: "Country cards", description: "Beats the global card only", icon: Globe2 },
];

const SOURCE_OPTIONS: { key: MeterSourceMode; label: string; hint: string }[] = [
  { key: "gps", label: "GPS only", hint: "Ignore the reader — always bill on GPS" },
  { key: "gps+obd", label: "GPS + OBD", hint: "Bill on the vehicle, fall back to GPS" },
  { key: "obd", label: "OBD only", hint: "Never bill on GPS" },
];

/** What the e-hailing key of the leave-the-meter popup opens. */
const LEAVE_EHAILING_OPTIONS: { key: MeterLeaveEhailingAction; label: string; hint: string }[] = [
  { key: "app", label: "This app", hint: "Opens the partner e-hailing screen" },
  { key: "link", label: "Another app", hint: "Opens the app at the link below" },
];

const DISTANCE_OPTIONS: { key: MeterDistanceMode; label: string }[] = [
  { key: "block", label: "Per block" },
  { key: "per_km", label: "Per km" },
  { key: "off", label: "No distance charge" },
];

const TIME_OPTIONS: { key: MeterTimeMode; label: string }[] = [
  { key: "block", label: "Per block" },
  { key: "per_minute", label: "Per minute" },
  { key: "per_second", label: "Per second" },
  { key: "off", label: "No time charge" },
];

const CHARGE_MODE_OPTIONS: { key: MeterChargeMode; label: string }[] = [
  { key: "max", label: "Whichever is greater" },
  { key: "sum", label: "Added together" },
];

const CHARGE_FROM_OPTIONS: { key: MeterChargeFrom; label: string }[] = [
  { key: "flag", label: "Past the flag distance" },
  { key: "start", label: "From the start of the hire" },
];

function eqi(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** A form value: what the driver typed, kept as text until it is committed. */
type NumericField =
  | "flagFare"
  | "flagDistanceM"
  | "minimumFare"
  | "distanceBlockM"
  | "distanceBlockCharge"
  | "perKmCharge"
  | "timeBlockS"
  | "timeBlockCharge"
  | "perMinuteCharge"
  | "perSecondCharge"
  | "nightMultiplier"
  | "nightStartHour"
  | "nightEndHour"
  | "extraLuggageCharge"
  | "freeLuggage"
  | "extraPassengerCharge"
  | "freePassengers"
  | "extraStep"
  | "maxExtra";


/** Read a numeric form field, falling back to the built-in default. */
function readNumber(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** What the panel switches are reporting about themselves right now. */
type PanelNote = { kind: "saved" | "draft" | "error"; text: string } | null;

export default function AdminSettingsMeterDigitalScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { editable, guard } = useReadOnlyGuard();

  const [profiles, setProfiles] = useState<MeterProfile[]>([]);
  const [source, setSource] = useState<MeterSettingsSource>("supabase");
  /** Column groups the live database has refused — a migration behind. */
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<MeterProfile>(() => createMeterProfileDraft("master"));
  /** The numeric fields, held as text so a half-typed "0." isn't clamped away. */
  const [fields, setFields] = useState<Record<NumericField, string>>(() => fieldsOf(DEFAULT_METER_PROFILE));
  const [focusField, setFocusField] = useState<"country" | "state" | "city" | null>(null);
  /** The panel a live toggle is being written for, and what it last reported. */
  const [panelBusy, setPanelBusy] = useState<MeterPanelId | null>(null);
  const [panelNote, setPanelNote] = useState<PanelNote>(null);

  const load = useCallback(async () => {
    const res = await fetchMeterProfiles();
    setProfiles(res.profiles);
    setSource(res.source);
    // Asked after every read: the store learns a column is missing by being
    // refused one, so this is only known once something has been tried.
    setMissingColumns(meterSettingsMissingGroups());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const globalCard = useMemo(
    () => profiles.find((p) => p.level === "master") ?? null,
    [profiles],
  );

  // --- Geography suggestions, same source the commission screen uses ---------

  const countryIso = useMemo<string | null>(() => {
    const hit = Country.getAllCountries().find((c) => eqi(c.name, draft.country));
    return hit?.isoCode ?? null;
  }, [draft.country]);

  const stateIso = useMemo<string | null>(() => {
    if (!countryIso) return null;
    const hit = State.getStatesOfCountry(countryIso).find((s) => eqi(s.name, draft.state));
    return hit?.isoCode ?? null;
  }, [countryIso, draft.state]);

  const suggestions = useMemo<string[]>(() => {
    if (!focusField) return [];
    let pool: string[] = [];
    let query = "";
    if (focusField === "country") {
      pool = Country.getAllCountries().map((c) => c.name);
      query = draft.country ?? "";
    } else if (focusField === "state") {
      pool = countryIso ? State.getStatesOfCountry(countryIso).map((s) => s.name) : [];
      query = draft.state ?? "";
    } else {
      pool =
        countryIso && stateIso
          ? City.getCitiesOfState(countryIso, stateIso).map((c) => c.name)
          : [];
      query = draft.city ?? "";
    }
    const q = query.trim().toLowerCase();
    const filtered = q.length > 0 ? pool.filter((n) => n.toLowerCase().includes(q)) : pool;
    return Array.from(new Set(filtered)).slice(0, 8);
  }, [countryIso, draft.city, draft.country, draft.state, focusField, stateIso]);

  // --- Editor ---------------------------------------------------------------

  const openEditor = useCallback((profile: MeterProfile) => {
    setDraft({
      ...profile,
      rates: { ...profile.rates },
      leave: { ...profile.leave },
      panels: {
        meter: { ...profile.panels.meter },
        trips: { ...profile.panels.trips },
        printer: { ...profile.panels.printer },
        obd: { ...profile.panels.obd },
        settings: { ...profile.panels.settings },
      },
    });
    setFields(fieldsOf(profile));
    setFocusField(null);
    setPanelBusy(null);
    setPanelNote(null);
    setEditorOpen(true);
  }, []);

  const openGlobal = useCallback(() => {
    // With no global row yet the editor opens on the built-in card, so saving
    // it writes down exactly what the meter was already billing.
    openEditor(globalCard ?? { ...createMeterProfileDraft("master"), label: "Global rate card" });
  }, [globalCard, openEditor]);

  const openAdd = useCallback(
    (level: OverrideLevel) => {
      if (!guard()) return;
      openEditor(createMeterProfileDraft(level));
    },
    [guard, openEditor],
  );

  /**
   * Which catalogue apps this device can see.
   *
   * Probed once when the editor opens on a link card, and only ever used to
   * *label* rows — see `utils/meterLeaveApps.ts` on why a negative answer means
   * "not found among the apps this build can ask about" rather than "not
   * installed". Picking an app is never gated on it: the admin's phone is not
   * the fleet's.
   */
  const [presence, setPresence] = useState<Record<string, AppPresence>>({});

  useEffect(() => {
    if (!editorOpen || draft.leave.ehailing !== "link") return;
    let live = true;
    void (async () => {
      const found: Record<string, AppPresence> = {};
      for (const app of METER_LEAVE_APPS) {
        // Probed, not launched: an https universal link would answer "yes" on
        // every iPhone, since a browser handles it either way.
        found[app.id] = await detectApp(
          meterLeaveAppProbe(app, Platform.OS === "ios" ? "ios" : "android"),
        );
      }
      if (live) setPresence(found);
    })();
    return () => {
      live = false;
    };
  }, [draft.leave.ehailing, editorOpen]);

  /** Point the card at a catalogue app, filling in what the catalogue knows. */
  const pickLeaveApp = useCallback((appId: string | null) => {
    setDraft((p) => {
      const app = meterLeaveAppById(appId);
      return {
        ...p,
        leave: {
          ...p.leave,
          ehailingAppId: app?.id ?? null,
          // Filled in with whatever the catalogue actually knows — Play is
          // derived from the package id, the others only where a real address
          // was supplied. An address already entered is never overwritten by
          // the pick.
          ehailingStores: {
            ios: p.leave.ehailingStores.ios ?? meterLeaveAppStore(app, "ios"),
            android: p.leave.ehailingStores.android ?? meterLeaveAppStore(app, "android"),
            huawei: p.leave.ehailingStores.huawei ?? meterLeaveAppStore(app, "huawei"),
          },
        },
      };
    });
  }, []);

  /**
   * The e-hailing link is typed but could never open an app.
   *
   * Only complains about something actually entered — a field still empty is a
   * card that isn't finished yet, which the Save press reports rather than a red
   * border following the admin around the form.
   */
  /** The catalogue app this card names, if any. */
  const pickedApp = meterLeaveAppById(draft.leave.ehailingAppId);

  const linkInvalid =
    draft.leave.ehailing === "link" &&
    (draft.leave.ehailingUrl ?? "").trim().length > 0 &&
    !normalizeMeterLeaveUrl(draft.leave.ehailingUrl);

  /** The draft with its text fields folded back on — the card as it would save. */
  const mergedDraft = useCallback((): MeterProfile => {
    const d = DEFAULT_METER_PROFILE;
    return {
      ...draft,
      rates: {
        ...draft.rates,
        flagFare: readNumber(fields.flagFare, d.rates.flagFare),
        flagDistanceM: Math.round(readNumber(fields.flagDistanceM, d.rates.flagDistanceM)),
        minimumFare: readNumber(fields.minimumFare, d.rates.minimumFare),
        distanceBlockM: Math.round(readNumber(fields.distanceBlockM, d.rates.distanceBlockM)),
        distanceBlockCharge: readNumber(fields.distanceBlockCharge, d.rates.distanceBlockCharge),
        perKmCharge: readNumber(fields.perKmCharge, d.rates.perKmCharge),
        timeBlockS: Math.round(readNumber(fields.timeBlockS, d.rates.timeBlockS)),
        timeBlockCharge: readNumber(fields.timeBlockCharge, d.rates.timeBlockCharge),
        perMinuteCharge: readNumber(fields.perMinuteCharge, d.rates.perMinuteCharge),
        perSecondCharge: readNumber(fields.perSecondCharge, d.rates.perSecondCharge),
      },
      nightMultiplier: Math.max(1, readNumber(fields.nightMultiplier, d.nightMultiplier)),
      nightStartHour: clampHour(readNumber(fields.nightStartHour, d.nightStartHour), 23),
      nightEndHour: clampHour(readNumber(fields.nightEndHour, d.nightEndHour), 24),
      extraLuggageCharge: readNumber(fields.extraLuggageCharge, d.extraLuggageCharge),
      freeLuggage: Math.round(readNumber(fields.freeLuggage, d.freeLuggage)),
      extraPassengerCharge: readNumber(fields.extraPassengerCharge, d.extraPassengerCharge),
      freePassengers: Math.round(readNumber(fields.freePassengers, d.freePassengers)),
      extraStep: Math.max(0.01, readNumber(fields.extraStep, d.extraStep)),
      maxExtra: readNumber(fields.maxExtra, d.maxExtra),
    };
  }, [draft, fields]);

  /** Fold the text fields back onto the draft, then save it. */
  const submit = useCallback(async () => {
    if (!guard()) return;
    const merged = mergedDraft();

    const invalid = validateMeterProfile(merged);
    if (invalid) {
      Alert.alert("Check the card", invalid);
      return;
    }

    setBusy(true);
    const res = await saveMeterProfile(merged);
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Could not save", res.error ?? "Please try again.");
      return;
    }
    setEditorOpen(false);
    await load();

    // The save succeeded, but a database a migration behind quietly dropped the
    // columns those switches live in. Said out loud here rather than left to be
    // discovered by reopening the card and finding the switch back where it
    // started — which is what a broken toggle looks like.
    const dropped = describeMissingMeterColumns(meterSettingsMissingGroups());
    if (dropped) Alert.alert("Saved, with one part left out", dropped);
  }, [guard, load, mergedDraft]);

  /**
   * A console panel's Show or Tap switch — applied live, not on Save.
   *
   * A panel is not a fare: which tabs a driver's console carries can change
   * under them without anything being mis-billed, so the switch writes straight
   * through and the drivers pick it up from the table. Only the ten panel
   * columns are written (`saveMeterPanelAccess`), so a rate the admin is halfway
   * through typing in the same editor is never committed by a panel toggle —
   * that still waits for Save.
   *
   * The switch moves first and is put back if the write is refused, so it never
   * shows a state the database did not take.
   */
  const applyPanel = useCallback(
    async (id: MeterPanelId, patch: Partial<MeterPanelAccess>) => {
      if (!guard()) return;
      const previous = draft.panels;
      const panels = setMeterPanelAccess(previous, id, patch);
      setDraft((p) => ({ ...p, panels }));

      // A card that isn't stored yet has no row to write to, and no scope
      // entered either — its panels ride along with the Create press.
      if (!canApplyMeterPanelLive(draft)) {
        setPanelNote({
          kind: "draft",
          text: "Panels apply live once this card is created.",
        });
        return;
      }

      // The base is the *stored* card, so the write carries nothing but the
      // panels. Only when the global row does not exist yet is the editor's own
      // card used — that toggle has to create the row it applies to.
      const stored =
        profiles.find((p) => p.id === draft.id.trim()) ??
        (draft.level === "master" ? globalCard : null);
      let base: MeterProfile;
      if (stored) {
        base = stored;
      } else {
        const merged = mergedDraft();
        const invalid = validateMeterProfile({ ...merged, panels });
        if (invalid) {
          setDraft((p) => ({ ...p, panels: previous }));
          setPanelNote({ kind: "error", text: invalid });
          return;
        }
        base = merged;
      }

      setPanelBusy(id);
      const res = await saveMeterPanelAccess(base, panels);
      setPanelBusy(null);
      if (!res.ok) {
        setDraft((p) => ({ ...p, panels: previous }));
        setPanelNote({ kind: "error", text: res.error ?? "Could not apply. Please try again." });
        return;
      }
      // A toggle that created the global row adopts its id, so the next one
      // updates that row rather than looking for it again.
      if (res.id) setDraft((p) => (p.id.trim() ? p : { ...p, id: res.id as string }));
      setPanelNote({
        kind: "saved",
        text:
          res.source === "local"
            ? "Applied on this device — the meter settings table isn't in the database yet."
            : "Applied live — drivers' consoles update without a Save.",
      });
      await load();
    },
    [draft, globalCard, guard, load, mergedDraft, profiles],
  );

  const confirmDelete = useCallback(
    (profile: MeterProfile) => {
      if (!guard()) return;
      Alert.alert(
        "Delete rate card?",
        `${meterProfileScopeLabel(profile)} will be removed. Hires there fall back to the next scope${
          profile.level === "master" ? " — with no global card, the meter bills on the built-in TEKSI tariff." : "."
        }`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              const res = await deleteMeterProfile(profile.id);
              if (!res.ok) {
                Alert.alert("Could not delete", res.error ?? "Please try again.");
                return;
              }
              await load();
            },
          },
        ],
      );
    },
    [guard, load],
  );

  const toggleActive = useCallback(
    async (profile: MeterProfile) => {
      if (!guard()) return;
      const res = await saveMeterProfile({ ...profile, active: !profile.active });
      if (!res.ok) {
        Alert.alert("Could not update", res.error ?? "Please try again.");
        return;
      }
      await load();
    },
    [guard, load],
  );

  // --- Small form pieces ----------------------------------------------------

  const setField = useCallback((key: NumericField, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const numberField = (key: NumericField, label: string, suffix?: string) => (
    <View style={styles.halfField} key={key}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            styles.inputFlex,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text },
          ]}
          value={fields[key]}
          onChangeText={(t) => setField(key, t)}
          onFocus={() => setFocusField(null)}
          keyboardType="decimal-pad"
          editable={editable}
          testID={`meter-settings-${key}`}
        />
        {suffix ? (
          <Text style={[styles.suffix, { color: Colors.textSecondary }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );

  const segmented = <T extends string>(
    label: string,
    options: { key: T; label: string; hint?: string }[],
    value: T,
    onPick: (key: T) => void,
    testId: string,
  ) => (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <View style={styles.segmentRow}>
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[
                styles.segment,
                {
                  backgroundColor: active ? Colors.accent + "18" : Colors.gray[100],
                  borderColor: active ? Colors.accent : Colors.border,
                },
              ]}
              onPress={() => {
                if (!editable) {
                  guard();
                  return;
                }
                onPick(opt.key);
              }}
              activeOpacity={0.85}
              testID={`${testId}-${opt.key}`}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? Colors.accent : Colors.text },
                ]}
              >
                {opt.label}
              </Text>
              {opt.hint ? (
                <Text style={[styles.segmentHint, { color: Colors.textSecondary }]}>
                  {opt.hint}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const switchRow = (
    label: string,
    hint: string,
    value: boolean,
    onChange: (next: boolean) => void,
    testId: string,
  ) => (
    <View style={styles.switchRow} key={testId}>
      <View style={styles.switchInfo}>
        <Text style={[styles.switchLabel, { color: Colors.text }]}>{label}</Text>
        <Text style={[styles.switchHint, { color: Colors.textSecondary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          if (!editable) {
            guard();
            return;
          }
          onChange(next);
        }}
        trackColor={{ false: Colors.gray[300], true: Colors.accent }}
        thumbColor="#fff"
        testID={testId}
      />
    </View>
  );

  const geoField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    field: "country" | "state" | "city" | null,
    placeholder: string,
  ) => (
    <View style={styles.fieldBlock} key={label}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border, color: Colors.text },
        ]}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocusField(field)}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        autoCapitalize="words"
        autoCorrect={false}
        editable={editable}
        testID={`meter-settings-scope-${label.toLowerCase()}`}
      />
      {focusField === field && suggestions.length > 0 && (
        <View
          style={[
            styles.suggestBox,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          {suggestions.map((name) => (
            <TouchableOpacity
              key={name}
              style={styles.suggestRow}
              onPress={() => {
                onChange(name);
                if (field === "country") setDraft((p) => ({ ...p, state: null, city: null }));
                else if (field === "state") setDraft((p) => ({ ...p, city: null }));
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

  const renderCardRow = (profile: MeterProfile) => (
    <View
      key={profile.id}
      style={[
        styles.cardRow,
        {
          backgroundColor: Colors.gray[100],
          borderColor: Colors.border,
          opacity: profile.active ? 1 : 0.55,
        },
      ]}
      testID={`meter-settings-card-${profile.id}`}
    >
      <View style={styles.cardInfo}>
        <Text style={[styles.cardScope, { color: Colors.text }]} numberOfLines={1}>
          {meterProfileScopeLabel(profile)}
        </Text>
        <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={2}>
          {profile.label ? `${profile.label} · ` : ""}
          {[...describeMeterRates(profile).slice(0, 3), ...describeMeterLeave(profile.leave)].join(
            " · ",
          )}
        </Text>
      </View>
      <Switch
        value={profile.active}
        onValueChange={() => void toggleActive(profile)}
        trackColor={{ false: Colors.gray[300], true: Colors.accent }}
        thumbColor="#fff"
        testID={`meter-settings-active-${profile.id}`}
      />
      <TouchableOpacity
        onPress={() => openEditor(profile)}
        style={styles.iconAction}
        testID={`meter-settings-edit-${profile.id}`}
      >
        <Pencil color={Colors.textSecondary} size={16} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => confirmDelete(profile)}
        style={styles.iconAction}
        testID={`meter-settings-delete-${profile.id}`}
      >
        <Trash2 color={Colors.error} size={16} />
      </TouchableOpacity>
    </View>
  );

  const editorTitle =
    draft.level === "master"
      ? "Global rate card"
      : `${draft.id ? "Edit" : "Add"} ${draft.level} card`;

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
          testID="meter-settings-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Gauge color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Meter Digital Setting</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Sensors, launch, console panels & fare rates for the in-app taxi meter
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.noteBox,
              { backgroundColor: Colors.accent + "10", borderColor: Colors.accent + "30" },
            ]}
          >
            <Text style={[styles.noteTitle, { color: Colors.text }]}>Card priority</Text>
            <Text style={[styles.noteChain, { color: Colors.textSecondary }]}>
              Suburb → City → State → Country → Global
            </Text>
            <Text style={[styles.noteBody, { color: Colors.textSecondary }]}>
              The driver&apos;s meter resolves the first matching card for where the hire
              starts. With no card at all it bills on the built-in TEKSI tariff.
            </Text>
          </View>

          {!editable && (
            <View
              style={[
                styles.noteBox,
                {
                  backgroundColor: (Colors.warning ?? "#F59E0B") + "15",
                  borderColor: (Colors.warning ?? "#F59E0B") + "40",
                  marginTop: 12,
                },
              ]}
            >
              <Text style={[styles.noteBody, { color: Colors.text }]}>
                You have read-only access on this page — rate cards can be viewed but not changed.
              </Text>
            </View>
          )}

          {describeMissingMeterColumns(missingColumns) && (
            <View
              style={[
                styles.noteBox,
                {
                  backgroundColor: (Colors.warning ?? "#F59E0B") + "15",
                  borderColor: (Colors.warning ?? "#F59E0B") + "40",
                  marginTop: 12,
                },
              ]}
              testID="meter-settings-missing-columns"
            >
              <Text style={[styles.noteBody, { color: Colors.text }]}>
                {describeMissingMeterColumns(missingColumns)}
              </Text>
            </View>
          )}

          {source === "local" && (
            <View
              style={[
                styles.noteBox,
                {
                  backgroundColor: (Colors.warning ?? "#F59E0B") + "15",
                  borderColor: (Colors.warning ?? "#F59E0B") + "40",
                  marginTop: 12,
                },
              ]}
            >
              <Text style={[styles.noteBody, { color: Colors.text }]}>
                The meter settings table isn&apos;t in the live database — changes are stored on
                this device only. Run migration 0081 in Supabase to share cards across all
                drivers.
              </Text>
            </View>
          )}

          {/* The global card */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Globe2 color={Colors.accent} size={16} />
              <Text style={[styles.sectionTitle, { color: Colors.text }]}>Global card</Text>
            </View>
          </View>
          <Text style={[styles.sectionDesc, { color: Colors.textSecondary }]}>
            What every meter uses unless a narrower card matches
          </Text>
          <TouchableOpacity
            style={[
              styles.globalCard,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
            onPress={openGlobal}
            activeOpacity={0.85}
            testID="meter-settings-global"
          >
            <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "20" }]}>
              <Gauge color={Colors.accent} size={20} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardScope, { color: Colors.text }]}>
                {globalCard?.label ?? "Global rate card"}
                {globalCard ? "" : " (not configured)"}
              </Text>
              <Text style={[styles.cardSub, { color: Colors.textSecondary }]}>
                {describeMeterRates(globalCard ?? DEFAULT_METER_PROFILE).join(" · ")}
              </Text>
            </View>
            <Pencil color={Colors.textSecondary} size={16} />
          </TouchableOpacity>

          {/* Overrides */}
          {LEVELS.map((meta) => {
            const Icon = meta.icon;
            const levelCards = profiles.filter((p) => p.level === meta.level);
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
                    testID={`meter-settings-add-${meta.level}`}
                  >
                    <Plus color={Colors.accent} size={14} />
                    <Text style={[styles.addBtnText, { color: Colors.accent }]}>Add</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.sectionDesc, { color: Colors.textSecondary }]}>
                  {meta.description}
                </Text>
                {levelCards.length === 0 ? (
                  <View
                    style={[
                      styles.emptyRow,
                      { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                    ]}
                  >
                    <Inbox color={Colors.textSecondary} size={16} />
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                      No cards
                    </Text>
                  </View>
                ) : (
                  <View style={styles.list}>{levelCards.map(renderCardRow)}</View>
                )}
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Editor */}
      <Modal
        visible={editorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: Colors.background, borderColor: Colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.text }]}>{editorTitle}</Text>
              <TouchableOpacity
                onPress={() => setEditorOpen(false)}
                style={styles.iconAction}
                testID="meter-settings-editor-close"
              >
                <X color={Colors.textSecondary} size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalScroll}>
              {/* Scope */}
              {draft.level !== "master" && (
                <>
                  <GroupTitle Colors={Colors} icon={MapIcon} title="Scope" />
                  {geoField(
                    "Country",
                    draft.country ?? "",
                    (t) => setDraft((p) => ({ ...p, country: t })),
                    "country",
                    "e.g. Malaysia",
                  )}
                  {["state", "city", "suburb"].includes(draft.level) &&
                    geoField(
                      "State",
                      draft.state ?? "",
                      (t) => setDraft((p) => ({ ...p, state: t })),
                      "state",
                      "e.g. Selangor",
                    )}
                  {["city", "suburb"].includes(draft.level) &&
                    geoField(
                      "City",
                      draft.city ?? "",
                      (t) => setDraft((p) => ({ ...p, city: t })),
                      "city",
                      "e.g. Petaling Jaya",
                    )}
                  {draft.level === "suburb" &&
                    geoField(
                      "Suburb",
                      draft.suburb ?? "",
                      (t) => setDraft((p) => ({ ...p, suburb: t })),
                      null,
                      "e.g. Bangsar",
                    )}
                </>
              )}

              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                  Card name (optional)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: Colors.border,
                      color: Colors.text,
                    },
                  ]}
                  value={draft.label ?? ""}
                  onChangeText={(t) => setDraft((p) => ({ ...p, label: t }))}
                  onFocus={() => setFocusField(null)}
                  placeholder="e.g. KL city tariff"
                  placeholderTextColor={Colors.textSecondary}
                  editable={editable}
                  testID="meter-settings-label"
                />
              </View>

              {/* Sensors */}
              <GroupTitle Colors={Colors} icon={Satellite} title="Sensors" />
              {segmented(
                "The meter may bill on",
                SOURCE_OPTIONS,
                draft.sourceMode,
                (key) => setDraft((p) => ({ ...p, sourceMode: key })),
                "meter-settings-source",
              )}
              {switchRow(
                "Start without odometer",
                "Applies only with no reader linked — a hire opened on a connected reader always requires the odometer (PID A6). Off means no hire opens without it at all.",
                draft.allowStartWithoutOdometer,
                (next) => setDraft((p) => ({ ...p, allowStartWithoutOdometer: next })),
                "meter-settings-allow-start-without-odo",
              )}
              {switchRow(
                "Read the odometer",
                "Ask the reader for the odometer at pickup and drop-off. Turn off for fleets whose cars don't publish it — otherwise a connected reader that can't return it blocks the hire.",
                draft.readOdometer,
                (next) => setDraft((p) => ({ ...p, readOdometer: next })),
                "meter-settings-read-odo",
              )}

              {/* How the driver reaches the console */}
              <GroupTitle Colors={Colors} icon={Rocket} title="Driver launch" />
              {switchRow(
                "Open the meter on launch",
                "Drivers with the TEKSI partner type land on the meter console when they sign in or reopen the app, instead of the passenger map. An in-progress ride is still restored first, and leaving the console does not bounce them back into it. The meter opens on whichever vehicle the driver still has claimed, and asks them to pick one when they have none.",
                draft.autoLaunch,
                (next) => setDraft((p) => ({ ...p, autoLaunch: next })),
                "meter-settings-auto-launch",
              )}

              {/* Leaving the console */}
              <GroupTitle Colors={Colors} icon={DoorOpen} title="Leave the meter" />
              <Text style={[styles.groupHint, { color: Colors.textSecondary }]}>
                The back key on an idle meter asks the driver where they are going. These
                two answers are what it offers — the third is always &ldquo;stay on the
                meter&rdquo;. A running hire cannot be left at all.
              </Text>
              {switchRow(
                "Passenger key exits the app",
                "Instead of opening passenger mode, the key closes the app without signing the driver out — the next launch comes straight back to the meter. On iOS and on the web the app cannot close itself, so the driver is told how to leave instead.",
                draft.leave.passenger === "exit",
                (next) =>
                  setDraft((p) => ({
                    ...p,
                    leave: {
                      ...p.leave,
                      passenger: (next ? "exit" : "passenger") as MeterLeavePassengerAction,
                    },
                  })),
                "meter-settings-leave-passenger",
              )}
              {segmented(
                "E-hailing key opens",
                LEAVE_EHAILING_OPTIONS,
                draft.leave.ehailing,
                (key) => setDraft((p) => ({ ...p, leave: { ...p.leave, ehailing: key } })),
                "meter-settings-leave-ehailing",
              )}
              {draft.leave.ehailing === "link" && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                      Dispatch app
                    </Text>
                    <Text style={[styles.groupHint, { color: Colors.textSecondary }]}>
                      Pick the app your drivers take jobs in, or choose Other app and enter
                      its link by hand. Neither iOS nor Android will list a phone&apos;s apps
                      to us, so &ldquo;on this device&rdquo; only covers the apps below, only
                      on this phone, and only in a recent build — it is a hint, not the
                      fleet&apos;s answer.
                    </Text>
                    <View style={styles.appList}>
                      {METER_LEAVE_APPS.map((app) => {
                        const picked = draft.leave.ehailingAppId === app.id;
                        const seen = presence[app.id] ?? "unknown";
                        return (
                          <TouchableOpacity
                            key={app.id}
                            style={[
                              styles.appRow,
                              {
                                backgroundColor: picked ? Colors.accent + "18" : Colors.gray[100],
                                borderColor: picked ? Colors.accent : Colors.border,
                              },
                            ]}
                            onPress={() => {
                              if (!editable) {
                                guard();
                                return;
                              }
                              pickLeaveApp(picked ? null : app.id);
                            }}
                            activeOpacity={0.85}
                            testID={`meter-settings-leave-app-${app.id}`}
                          >
                            <View style={styles.cardInfo}>
                              <Text
                                style={[
                                  styles.appName,
                                  { color: picked ? Colors.accent : Colors.text },
                                ]}
                              >
                                {app.name}
                              </Text>
                              <Text style={[styles.appMeta, { color: Colors.textSecondary }]}>
                                {describeAppPresence(seen)}
                                {" · "}
                                {describeAppIosRoute(app)}
                              </Text>
                            </View>
                            {picked && <Check color={Colors.accent} size={16} />}
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[
                          styles.appRow,
                          {
                            backgroundColor: draft.leave.ehailingAppId
                              ? Colors.gray[100]
                              : Colors.accent + "18",
                            borderColor: draft.leave.ehailingAppId
                              ? Colors.border
                              : Colors.accent,
                          },
                        ]}
                        onPress={() => {
                          if (!editable) {
                            guard();
                            return;
                          }
                          pickLeaveApp(null);
                        }}
                        activeOpacity={0.85}
                        testID="meter-settings-leave-app-other"
                      >
                        <View style={styles.cardInfo}>
                          <Text
                            style={[
                              styles.appName,
                              {
                                color: draft.leave.ehailingAppId ? Colors.text : Colors.accent,
                              },
                            ]}
                          >
                            Other app
                          </Text>
                          <Text style={[styles.appMeta, { color: Colors.textSecondary }]}>
                            Open whatever the link below names
                          </Text>
                        </View>
                        {!draft.leave.ehailingAppId && <Check color={Colors.accent} size={16} />}
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                      App link
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: Colors.gray[100],
                          borderColor: linkInvalid ? Colors.error : Colors.border,
                          color: Colors.text,
                        },
                      ]}
                      value={draft.leave.ehailingUrl ?? ""}
                      onChangeText={(t) =>
                        setDraft((p) => ({ ...p, leave: { ...p.leave, ehailingUrl: t } }))
                      }
                      onFocus={() => setFocusField(null)}
                      placeholder="e.g. driverapp:// or https://dispatch.example.com"
                      placeholderTextColor={Colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      editable={editable}
                      testID="meter-settings-leave-url"
                    />
                    <Text
                      style={[
                        styles.groupHint,
                        { color: linkInvalid ? Colors.error : Colors.textSecondary },
                      ]}
                    >
                      {linkInvalid
                        ? "A link has to start with a scheme — driverapp://, https:// — so the device knows which app to open."
                        : pickedApp
                          ? `Optional for ${pickedApp.name} on Android, which opens by package. ${
                              pickedApp.iosScheme
                                ? "iPhones use the app's own scheme."
                                : "iPhones need it — without one they are offered the App Store instead."
                            }`
                          : "The driver's phone opens whichever app claims this link. The meter stays open behind it."}
                    </Text>
                  </View>

                  {/* Where a driver without the app is sent. One field per
                      platform because no address yields another: a package id
                      is the Play page, but App Store and AppGallery pages are
                      per-app numbers. */}
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                      Store links (for drivers who don&apos;t have the app)
                    </Text>
                    <Text style={[styles.groupHint, { color: Colors.textSecondary }]}>
                      Offered when the app cannot be opened on a driver&apos;s phone. Huawei is
                      listed on its own because an HMS device has no Play Store.
                    </Text>
                  </View>
                  {(["ios", "android", "huawei"] as StorePlatform[]).map((platform) => (
                    <View style={styles.fieldBlock} key={platform}>
                      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                        {STORE_LABELS[platform]}
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: Colors.border,
                            color: Colors.text,
                          },
                        ]}
                        value={draft.leave.ehailingStores[platform] ?? ""}
                        onChangeText={(t) =>
                          setDraft((p) => ({
                            ...p,
                            leave: {
                              ...p.leave,
                              ehailingStores: { ...p.leave.ehailingStores, [platform]: t },
                            },
                          }))
                        }
                        onFocus={() => setFocusField(null)}
                        placeholder={
                          platform === "android"
                            ? "https://play.google.com/store/apps/details?id=…"
                            : platform === "ios"
                              ? "https://apps.apple.com/app/id…"
                              : "https://appgallery.huawei.com/app/…"
                        }
                        placeholderTextColor={Colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        editable={editable}
                        testID={`meter-settings-leave-store-${platform}`}
                      />
                    </View>
                  ))}
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                      Key caption (optional)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: Colors.gray[100],
                          borderColor: Colors.border,
                          color: Colors.text,
                        },
                      ]}
                      value={draft.leave.ehailingLabel ?? ""}
                      onChangeText={(t) =>
                        setDraft((p) => ({ ...p, leave: { ...p.leave, ehailingLabel: t } }))
                      }
                      onFocus={() => setFocusField(null)}
                      placeholder="E-HAILING APP"
                      placeholderTextColor={Colors.textSecondary}
                      autoCapitalize="characters"
                      maxLength={22}
                      editable={editable}
                      testID="meter-settings-leave-label"
                    />
                  </View>
                </>
              )}

              {/* Panels */}
              <GroupTitle Colors={Colors} icon={LayoutGrid} title="Console panels" />
              <Text style={[styles.groupHint, { color: Colors.textSecondary }]}>
                Show puts the tab on the console; Tap decides whether the driver can open it. A
                panel that is shown but not tappable is visible and locked. These switches take
                effect immediately — they are saved as you move them, no Save needed.
              </Text>
              {panelNote && (
                <Text
                  style={[
                    styles.panelNote,
                    {
                      color:
                        panelNote.kind === "error"
                          ? Colors.error
                          : panelNote.kind === "draft"
                            ? Colors.textSecondary
                            : Colors.accent,
                    },
                  ]}
                  testID="meter-settings-panel-note"
                >
                  {panelNote.text}
                </Text>
              )}
              <View style={[styles.panelHead, { borderBottomColor: Colors.border }]}>
                <Text style={[styles.panelHeadCell, { color: Colors.textSecondary, flex: 1 }]}>
                  Panel
                </Text>
                <Text style={[styles.panelHeadCell, { color: Colors.textSecondary }]}>Show</Text>
                <Text style={[styles.panelHeadCell, { color: Colors.textSecondary }]}>Tap</Text>
              </View>
              {METER_PANEL_IDS.map((id: MeterPanelId) => {
                const locked = id === "meter"; // the meter itself is never hidden
                const writing = panelBusy === id;
                return (
                  <View key={id} style={styles.panelRow}>
                    <Text style={[styles.panelName, { color: Colors.text }]} numberOfLines={2}>
                      {METER_PANEL_LABELS[id]}
                      {locked ? " (always on)" : ""}
                    </Text>
                    <View style={styles.panelSwitch}>
                      {/* Left in place while the write is in flight rather than
                          swapped for a spinner: the switch already shows where
                          it is going, and the note below reports how it went. */}
                      <Switch
                        value={draft.panels[id].show}
                        disabled={locked || writing}
                        onValueChange={(next) => void applyPanel(id, { show: next })}
                        trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                        thumbColor="#fff"
                        testID={`meter-settings-show-${id}`}
                      />
                    </View>
                    <View style={styles.panelSwitch}>
                      <Switch
                        value={draft.panels[id].tap}
                        disabled={locked || !draft.panels[id].show || writing}
                        onValueChange={(next) => void applyPanel(id, { tap: next })}
                        trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                        thumbColor="#fff"
                        testID={`meter-settings-tap-${id}`}
                      />
                    </View>
                  </View>
                );
              })}

              {/* Rates */}
              <GroupTitle Colors={Colors} icon={Gauge} title="Fare rates" />
              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Currency</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: Colors.border,
                      color: Colors.text,
                    },
                  ]}
                  value={draft.currency}
                  onChangeText={(t) => setDraft((p) => ({ ...p, currency: t.toUpperCase() }))}
                  onFocus={() => setFocusField(null)}
                  autoCapitalize="characters"
                  maxLength={6}
                  editable={editable}
                  testID="meter-settings-currency"
                />
              </View>
              <View style={styles.fieldGrid}>
                {numberField("flagFare", "Flag / minimum fare", draft.currency)}
                {numberField("flagDistanceM", "Flag distance", "m")}
                {numberField("minimumFare", "Fare floor (0 = none)", draft.currency)}
              </View>

              {segmented(
                "Distance charge",
                DISTANCE_OPTIONS,
                draft.rates.distanceMode,
                (key) => setDraft((p) => ({ ...p, rates: { ...p.rates, distanceMode: key } })),
                "meter-settings-distance-mode",
              )}
              {draft.rates.distanceMode === "block" && (
                <View style={styles.fieldGrid}>
                  {numberField("distanceBlockM", "Block length", "m")}
                  {numberField("distanceBlockCharge", "Charge per block", draft.currency)}
                </View>
              )}
              {draft.rates.distanceMode === "per_km" && (
                <View style={styles.fieldGrid}>{numberField("perKmCharge", "Charge per km", draft.currency)}</View>
              )}

              {segmented(
                "Time charge",
                TIME_OPTIONS,
                draft.rates.timeMode,
                (key) => setDraft((p) => ({ ...p, rates: { ...p.rates, timeMode: key } })),
                "meter-settings-time-mode",
              )}
              {draft.rates.timeMode === "block" && (
                <View style={styles.fieldGrid}>
                  {numberField("timeBlockS", "Block length", "s")}
                  {numberField("timeBlockCharge", "Charge per block", draft.currency)}
                </View>
              )}
              {draft.rates.timeMode === "per_minute" && (
                <View style={styles.fieldGrid}>
                  {numberField("perMinuteCharge", "Charge per minute", draft.currency)}
                </View>
              )}
              {draft.rates.timeMode === "per_second" && (
                <View style={styles.fieldGrid}>
                  {numberField("perSecondCharge", "Charge per second", draft.currency)}
                </View>
              )}

              {draft.rates.distanceMode !== "off" &&
                draft.rates.timeMode !== "off" &&
                segmented(
                  "Distance & time combine",
                  CHARGE_MODE_OPTIONS,
                  draft.rates.chargeMode,
                  (key) => setDraft((p) => ({ ...p, rates: { ...p.rates, chargeMode: key } })),
                  "meter-settings-charge-mode",
                )}
              {segmented(
                "Charging starts",
                CHARGE_FROM_OPTIONS,
                draft.rates.chargeFrom,
                (key) => setDraft((p) => ({ ...p, rates: { ...p.rates, chargeFrom: key } })),
                "meter-settings-charge-from",
              )}

              {/* Night shift */}
              <GroupTitle Colors={Colors} icon={Moon} title="Night shift" />
              <View style={styles.fieldGrid}>
                {numberField("nightMultiplier", "Surcharge multiplier", "×")}
                {numberField("nightStartHour", "Starts at", "h")}
                {numberField("nightEndHour", "Ends at", "h")}
              </View>

              {/* Extras */}
              <GroupTitle Colors={Colors} icon={Luggage} title="Extras" />
              <Text style={[styles.groupHint, { color: Colors.textSecondary }]}>
                Charges a meter cannot measure. The driver adds them by hand at the end of a hire.
              </Text>
              <View style={styles.fieldGrid}>
                {numberField("extraLuggageCharge", "Per bag", draft.currency)}
                {numberField("freeLuggage", "Bags included", "")}
                {numberField("extraPassengerCharge", "Per passenger", draft.currency)}
                {numberField("freePassengers", "Passengers included", "")}
                {numberField("extraStep", "Free-form extra step", draft.currency)}
                {numberField("maxExtra", "Extras ceiling", draft.currency)}
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={[styles.switchLabel, { color: Colors.text }]}>Active</Text>
                  <Text style={[styles.switchHint, { color: Colors.textSecondary }]}>
                    An inactive card is skipped — hires fall through to the next scope.
                  </Text>
                </View>
                <Switch
                  value={draft.active}
                  onValueChange={(next) => {
                    if (!editable) {
                      guard();
                      return;
                    }
                    setDraft((p) => ({ ...p, active: next }));
                  }}
                  trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                  thumbColor="#fff"
                  testID="meter-settings-active"
                />
              </View>

              <View style={{ height: 12 }} />
            </ScrollView>

            <TouchableOpacity
              onPress={() => void submit()}
              style={[
                styles.submitBtn,
                { backgroundColor: Colors.accent, opacity: busy || !editable ? 0.6 : 1 },
              ]}
              disabled={busy || !editable}
              testID="meter-settings-save"
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>
                  {draft.id ? "Save rate card" : "Create rate card"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

/** The numeric fields of a profile, as the text the form edits. */
function fieldsOf(profile: MeterProfile): Record<NumericField, string> {
  const r = profile.rates;
  const s = (n: number) => String(n);
  return {
    flagFare: s(r.flagFare),
    flagDistanceM: s(r.flagDistanceM),
    minimumFare: s(r.minimumFare),
    distanceBlockM: s(r.distanceBlockM),
    distanceBlockCharge: s(r.distanceBlockCharge),
    perKmCharge: s(r.perKmCharge),
    timeBlockS: s(r.timeBlockS),
    timeBlockCharge: s(r.timeBlockCharge),
    perMinuteCharge: s(r.perMinuteCharge),
    perSecondCharge: s(r.perSecondCharge),
    nightMultiplier: s(profile.nightMultiplier),
    nightStartHour: s(profile.nightStartHour),
    nightEndHour: s(profile.nightEndHour),
    extraLuggageCharge: s(profile.extraLuggageCharge),
    freeLuggage: s(profile.freeLuggage),
    extraPassengerCharge: s(profile.extraPassengerCharge),
    freePassengers: s(profile.freePassengers),
    extraStep: s(profile.extraStep),
    maxExtra: s(profile.maxExtra),
  };
}

function clampHour(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)));
}

function GroupTitle({
  Colors,
  icon: Icon,
  title,
}: {
  Colors: ReturnType<typeof useColors>;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  title: string;
}) {
  return (
    <View style={[styles.groupTitleRow, { borderTopColor: Colors.border }]}>
      <Icon color={Colors.accent} size={15} />
      <Text style={[styles.groupTitle, { color: Colors.text }]}>{title}</Text>
    </View>
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

  noteBox: { borderRadius: 12, borderWidth: 1, padding: 12 },
  noteTitle: { fontSize: 13, fontWeight: "800" as const },
  noteChain: { fontSize: 13, fontWeight: "700" as const, marginTop: 4 },
  noteBody: { fontSize: 12, lineHeight: 17, marginTop: 4 },

  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 18,
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

  globalCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },

  list: { gap: 8 },
  cardRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  cardInfo: { flex: 1 },
  cardScope: { fontSize: 14, fontWeight: "700" as const },
  cardSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  iconAction: { padding: 6 },
  emptyRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyText: { fontSize: 12, fontWeight: "600" as const },

  modalWrap: { flex: 1, justifyContent: "flex-end" as const, backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 28,
    maxHeight: "92%" as const,
  },
  modalScroll: { flexGrow: 0 },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 6,
  },
  modalTitle: { fontSize: 16, fontWeight: "800" as const, textTransform: "capitalize" as const },

  groupTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  groupTitle: { fontSize: 14, fontWeight: "800" as const },
  groupHint: { fontSize: 11, lineHeight: 16, marginTop: 6 },

  fieldBlock: { marginTop: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "700" as const, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  inputFlex: { flex: 1 },
  suffix: { fontSize: 12, fontWeight: "700" as const, minWidth: 22 },
  fieldGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "space-between" as const,
  },
  halfField: { width: "48%" as const, marginTop: 12 },

  appList: { gap: 8, marginTop: 8 },
  appRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  appName: { fontSize: 13, fontWeight: "700" as const },
  appMeta: { fontSize: 11, marginTop: 2 },

  suggestBox: { borderWidth: 1, borderRadius: 12, marginTop: 4, overflow: "hidden" as const },
  suggestRow: { paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { fontSize: 13 },

  segmentRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  segment: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexGrow: 1, flexBasis: "30%" as const },
  segmentText: { fontSize: 13, fontWeight: "700" as const },
  segmentHint: { fontSize: 10, marginTop: 2, lineHeight: 14 },

  switchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    marginTop: 14,
  },
  switchInfo: { flex: 1 },
  switchLabel: { fontSize: 13, fontWeight: "700" as const },
  switchHint: { fontSize: 11, marginTop: 2, lineHeight: 15 },

  panelHead: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderBottomWidth: 1,
    paddingBottom: 6,
    marginTop: 12,
  },
  panelNote: { fontSize: 11, fontWeight: "700" as const, lineHeight: 16, marginTop: 6 },
  panelHeadCell: { fontSize: 11, fontWeight: "700" as const, width: 54, textAlign: "center" as const },
  panelRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 8 },
  panelName: { flex: 1, fontSize: 13, fontWeight: "600" as const, paddingRight: 8 },
  panelSwitch: { width: 54, alignItems: "center" as const },

  submitBtn: {
    marginTop: 14,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" as const },
});
