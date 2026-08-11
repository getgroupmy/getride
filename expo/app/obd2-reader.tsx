/**
 * Settings → OBD-II (CANBus) reader.
 *
 * User-side management of the vehicle link: add a reader (Wi-Fi / Bluetooth LE
 * / Bluetooth MFi / USB), pick which one to use, connect, and watch live
 * telemetry. The saved reader is what the partner Teksi/e-hailing screens
 * auto-connect to, so this screen is the single place a driver sets the
 * dongle up.
 *
 * Only shown to accounts that are also partners — see `useIsPartner`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Bluetooth,
  BluetoothConnected,
  Check,
  Cpu,
  Plus,
  Trash2,
  Usb,
  Wifi,
  X,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useCanbus } from "@/hooks/useCanbus";
import { useIsPartner } from "@/hooks/useIsPartner";
import { useDisplaySettings } from "@/contexts/DisplaySettingsContext";
import { formatTelemetryValue, OBD_PIDS } from "@/utils/canbus/obd";
import {
  formatKm,
  ODOMETER_ABSENT_READS,
  ODOMETER_REFRESH_MS,
  readOdometerKm,
  shouldReadOdometer,
  type OdometerStatus,
} from "@/utils/canbus/fuelRange";
import { TRANSPORT_LABEL, type CanTransportKind } from "@/utils/canbus/types";
import { WIFI_ADAPTER_HOST, WIFI_ADAPTER_PORT } from "@/utils/canbus/config";
import {
  scanForBleAdapters,
  type DiscoveredBleAdapter,
} from "@/utils/canbus/transports";
import {
  addCanbusAdapter,
  deleteCanbusAdapter,
  describeAdapter,
  setSelectedAdapterId,
  type SavedCanAdapter,
} from "@/utils/canbusAdapterStore";
import { useLandscapeLock } from "@/hooks/useLandscapeLock";
import FixedLandscapeStage from "@/components/FixedLandscapeStage";
import { resolveLandscapeStage } from "@/utils/fixedLandscape";
import { MODAL_SUPPORTED_ORIENTATIONS } from "@/utils/modalOrientation";

/** Base paddings the stage insets are added onto (see the header / scroll styles). */
const HEADER_PAD_V = 12;
const SCREEN_PAD_H = 16;

const TRANSPORT_ICON: Record<CanTransportKind, typeof Wifi> = {
  wifi: Wifi,
  bluetooth: Bluetooth,
  // A distinct glyph for MFi: the two Bluetooth rows sit next to each other and
  // pair very differently, so they should not look interchangeable.
  mfi: BluetoothConnected,
  usb: Usb,
};

/** Copy for the transport picker in the "Add reader" sheet. */
const TRANSPORT_CHOICES: {
  kind: CanTransportKind;
  title: string;
  hint: string;
  androidOnly?: boolean;
  iosOnly?: boolean;
}[] = [
  {
    kind: "wifi",
    title: "Wi-Fi",
    hint: "ELM327 Wi-Fi dongle. Join the dongle's Wi-Fi network, then enter its address below.",
  },
  {
    kind: "bluetooth",
    title: "Bluetooth LE",
    hint: "ELM327 Bluetooth Low Energy dongle. Not paired in the phone's Bluetooth settings — scan for it here to pick your device.",
  },
  {
    kind: "mfi",
    title: "Bluetooth MFi",
    hint: "Apple-certified (MFi) adapter such as the OBDLink MX+. Pair it in iOS Settings → Bluetooth first — unlike a BLE dongle, it is not found by scanning.",
    iosOnly: true,
  },
  {
    kind: "usb",
    title: "USB",
    hint: "USB-serial ELM327 connected with an OTG cable. Android only.",
    androidOnly: true,
  },
];

export default function Obd2ReaderScreen() {
  const router = useRouter();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const isLightMode = Colors.background === "#FFFFFF";
  const { isPartner, loading: partnerLoading } = useIsPartner();
  const { settings: displaySettings } = useDisplaySettings();

  // The OBD-II reader is a panel of the Meter Digital instrument, read off a
  // windscreen mount in landscape. Pin the device sideways where the platform
  // allows it and back that up with a stage, so the page is read horizontally
  // either way instead of as a tall portrait column. See
  // `hooks/useLandscapeLock.ts` and `utils/fixedLandscape.ts`.
  useLandscapeLock();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const stage = useMemo(
    () =>
      resolveLandscapeStage(winWidth, winHeight, {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom,
        left: insets.left,
      }),
    [insets.bottom, insets.left, insets.right, insets.top, winHeight, winWidth],
  );

  // Managing the link is an explicit action here — never auto-connect on open.
  const canbus = useCanbus({
    autoConnect: false,
    allowSimulator: false,
    preferSavedAdapter: true,
  });

  const [addVisible, setAddVisible] = useState<boolean>(false);
  const [draftKind, setDraftKind] = useState<CanTransportKind>("wifi");
  const [draftName, setDraftName] = useState<string>("");
  const [draftHost, setDraftHost] = useState<string>(WIFI_ADAPTER_HOST);
  const [draftPort, setDraftPort] = useState<string>(String(WIFI_ADAPTER_PORT));
  const [draftAccessory, setDraftAccessory] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  // Bluetooth LE scan (add sheet): the exact peripheral the driver picked, plus
  // the live discovered list. A BLE dongle never shows in the phone's system
  // Bluetooth list, so it can only be found by scanning here.
  const [draftDeviceId, setDraftDeviceId] = useState<string>("");
  const [scanning, setScanning] = useState<boolean>(false);
  const [discovered, setDiscovered] = useState<DiscoveredBleAdapter[]>([]);

  const state = canbus.state;
  const online = state.phase === "online";
  const linked = online && !state.simulated;
  const device = state.device;

  const transportChoices = useMemo(
    () =>
      TRANSPORT_CHOICES.filter(
        (t) =>
          (!t.androidOnly || Platform.OS === "android") &&
          (!t.iosOnly || Platform.OS === "ios")
      ),
    []
  );

  const availabilityFor = useCallback(
    (kind: CanTransportKind) => canbus.availability.find((a) => a.kind === kind),
    [canbus.availability]
  );

  const resetDraft = useCallback(() => {
    setDraftKind("wifi");
    setDraftName("");
    setDraftHost(WIFI_ADAPTER_HOST);
    setDraftPort(String(WIFI_ADAPTER_PORT));
    setDraftAccessory("");
    setDraftDeviceId("");
    setDiscovered([]);
  }, []);

  const handleSaveAdapter = useCallback(async () => {
    setSaving(true);
    const res = await addCanbusAdapter({
      name: draftName,
      transport: draftKind,
      host: draftHost,
      port: draftPort,
      accessory: draftAccessory,
      deviceId: draftDeviceId,
    });
    setSaving(false);
    if (res.error) {
      Alert.alert("Check the details", res.error);
      return;
    }
    await canbus.reloadAdapters();
    setAddVisible(false);
    resetDraft();
  }, [
    canbus,
    draftAccessory,
    draftDeviceId,
    draftHost,
    draftKind,
    draftName,
    draftPort,
    resetDraft,
  ]);

  const handleScanBle = useCallback(async () => {
    setScanning(true);
    setDiscovered([]);
    try {
      const seen = new Map<string, DiscoveredBleAdapter>();
      await scanForBleAdapters({
        onDevice: (device) => {
          seen.set(device.id, device);
          // Stream results in, ELM-looking dongles first then by signal.
          setDiscovered(
            Array.from(seen.values()).sort((a, b) => {
              if (a.isElm !== b.isElm) return a.isElm ? -1 : 1;
              return (b.rssi ?? -999) - (a.rssi ?? -999);
            }),
          );
        },
      });
    } catch (e: any) {
      Alert.alert("Bluetooth scan", e?.message ? String(e.message) : "Bluetooth scan failed.");
    } finally {
      setScanning(false);
    }
  }, []);

  const pickDiscovered = useCallback((device: DiscoveredBleAdapter) => {
    setDraftDeviceId(device.id);
    setDraftName((prev) => prev || device.name);
  }, []);

  // A picked device belongs to the Bluetooth LE flow; switching away from it, or
  // closing the sheet, drops the selection and the scan results.
  useEffect(() => {
    if (draftKind !== "bluetooth") {
      setDraftDeviceId("");
      setDiscovered([]);
    }
  }, [draftKind]);

  useEffect(() => {
    if (!addVisible) setDiscovered([]);
  }, [addVisible]);

  const handleSelect = useCallback(
    async (adapter: SavedCanAdapter) => {
      await setSelectedAdapterId(adapter.id);
      await canbus.reloadAdapters();
    },
    [canbus]
  );

  const handleDelete = useCallback(
    (adapter: SavedCanAdapter) => {
      Alert.alert(
        "Remove reader",
        `Remove "${adapter.name}" from this device? The reader itself is not affected.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await deleteCanbusAdapter(adapter.id);
              await canbus.reloadAdapters();
            },
          },
        ]
      );
    },
    [canbus]
  );

  const handleConnect = useCallback(
    async (adapter?: SavedCanAdapter) => {
      const target = adapter ?? canbus.defaultAdapter;
      if (!target) {
        Alert.alert("No reader added", "Add an OBD-II reader first.");
        return;
      }
      const avail = availabilityFor(target.transport);
      if (!avail?.available) {
        // Be honest rather than failing silently, and say the thing the driver
        // can act on: `guidance` already knows whether this is Expo Go, the web
        // preview, or an installed build that predates the transport.
        Alert.alert(
          `${TRANSPORT_LABEL[target.transport]} not available`,
          avail?.guidance ??
            `${avail?.reason ?? "This transport is unavailable"}.`
        );
        return;
      }
      await canbus.connect(target.transport, { adapter: target });
    },
    [availabilityFor, canbus]
  );

  const telemetryKeys = useMemo(
    () =>
      (Object.keys(state.telemetry) as (keyof typeof OBD_PIDS)[]).filter(
        (k) => typeof state.telemetry[k] === "number"
      ),
    [state.telemetry]
  );

  /* --- Odometer (mode 01 PID A6) ---------------------------------------
   *
   * Read beside the 1 Hz sweep rather than in it: `OBD_PIDS` stays small
   * because the adapter answers one command at a time, so a parameter that
   * moves as slowly as a mileage counter has no business costing the whole
   * sweep a slot. It is asked once as soon as the link is up and then every
   * ODOMETER_REFRESH_MS while it stays up. Plenty of cars keep the odometer on
   * the instrument cluster and never put it on the bus, so one that does not
   * answer says so on the card instead of leaving a driver wondering why the
   * number never appeared.
   */
  const [odometerKm, setOdometerKm] = useState<number | null>(null);
  const [odometerStatus, setOdometerStatus] = useState<OdometerStatus>("unknown");
  const odometerStatusRef = useRef<OdometerStatus>("unknown");
  const odometerReadingRef = useRef<boolean>(false);
  const odometerAttemptRef = useRef<number | null>(null);
  const odometerEmptyReadsRef = useRef<number>(0);
  // `canbus` is a fresh object every render; the sweep re-renders this screen
  // once a second, so depending on it below would reset the refresh timer
  // before it could ever elapse. `sendCommand` itself is stable.
  const sendCommandRef = useRef(canbus.sendCommand);
  sendCommandRef.current = canbus.sendCommand;

  // A reading belongs to the link that produced it: dropping the reader, or
  // linking a different one, clears it rather than leaving the last car's
  // mileage on screen under a new connection.
  const linkKey = linked ? (device?.id ?? device?.transport ?? "linked") : null;

  useEffect(() => {
    odometerStatusRef.current = "unknown";
    odometerReadingRef.current = false;
    odometerAttemptRef.current = null;
    odometerEmptyReadsRef.current = 0;
    setOdometerKm(null);
    setOdometerStatus("unknown");
  }, [linkKey]);

  useEffect(() => {
    if (!linkKey) return;
    let cancelled = false;

    const attempt = async () => {
      if (
        cancelled ||
        !shouldReadOdometer({
          linked,
          simulated: state.simulated,
          status: odometerStatusRef.current,
          reading: odometerReadingRef.current,
          lastAttemptAt: odometerAttemptRef.current,
          now: Date.now(),
        })
      ) {
        return;
      }
      odometerReadingRef.current = true;
      odometerAttemptRef.current = Date.now();
      let km: number | null = null;
      try {
        km = await readOdometerKm((command) => sendCommandRef.current(command));
      } finally {
        odometerReadingRef.current = false;
      }
      if (cancelled) return;
      if (km !== null) {
        odometerEmptyReadsRef.current = 0;
        odometerStatusRef.current = "ready";
        setOdometerKm(km);
        setOdometerStatus("ready");
        return;
      }
      odometerEmptyReadsRef.current += 1;
      // A refresh the adapter missed leaves the reading already on screen
      // alone — never blank a number the vehicle did once report — and only a
      // car that has stayed silent across whole reads is called odometer-less.
      if (
        odometerStatusRef.current === "unknown" &&
        odometerEmptyReadsRef.current >= ODOMETER_ABSENT_READS
      ) {
        odometerStatusRef.current = "unsupported";
        setOdometerStatus("unsupported");
      }
    };

    void attempt();
    const timer = setInterval(() => void attempt(), ODOMETER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [linkKey, linked, state.simulated]);

  const statusLine = canbus.connecting
    ? "Connecting to the reader…"
    : linked && device
      ? `Connected via ${TRANSPORT_LABEL[device.transport]} — ${device.name}`
      : online && state.simulated
        ? "Demo Mode — virtual vehicle data, not a real link"
        : state.error
          ? state.error
          : "Not connected";

  const statusColor = linked
    ? "#22C55E"
    : canbus.connecting || (online && state.simulated)
      ? "#F59E0B"
      : state.error
        ? "#EF4444"
        : Colors.textSecondary;

  const cardStyle = {
    backgroundColor: isLightMode ? "#F9FAFB" : "#111",
    borderColor: Colors.border,
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isLightMode ? "dark-content" : "light-content"} />

      <FixedLandscapeStage
        stage={stage}
        style={{ backgroundColor: Colors.background }}
        testID="obd2-stage"
      >
        <View
          style={[
            styles.header,
            {
              paddingTop: HEADER_PAD_V + stage.insets.top,
              paddingLeft: SCREEN_PAD_H + stage.insets.left,
              paddingRight: SCREEN_PAD_H + stage.insets.right,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.back()}
            testID="obd2-back"
          >
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>OBD-II reader</Text>
          <View style={styles.headerButton} />
        </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: stage.insets.bottom + 32,
            paddingLeft: SCREEN_PAD_H + stage.insets.left,
            paddingRight: SCREEN_PAD_H + stage.insets.right,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {partnerLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : !isPartner ? (
          <View style={[styles.card, cardStyle]}>
            <Text style={[styles.cardTitle, { color: Colors.text }]}>Partner mode required</Text>
            <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
              The OBD-II (CANBus) reader links the app to your vehicle&apos;s diagnostics
              port. It is available once your account is set up as a partner.
            </Text>
          </View>
        ) : (
          <>
            {/* --- Live link status --- */}
            <View style={[styles.card, cardStyle]} testID="obd2-status-card">
              <View style={styles.cardHeader}>
                <Cpu color={Colors.text} size={18} />
                <Text style={[styles.cardTitle, { color: Colors.text }]}>Vehicle link</Text>
              </View>
              <Text style={[styles.statusLine, { color: statusColor }]}>{statusLine}</Text>
              {state.protocol ? (
                <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                  {state.protocol}
                  {state.bitrateKbps ? ` · ${state.bitrateKbps} kbps` : ""}
                </Text>
              ) : null}

              {telemetryKeys.length > 0 || odometerKm !== null ? (
                <View style={styles.telemetryGrid}>
                  {telemetryKeys.map((k) => (
                    <View key={k} style={styles.telemetryCell}>
                      <Text style={[styles.telemetryValue, { color: Colors.text }]}>
                        {formatTelemetryValue(k, state.telemetry[k] as number)}
                      </Text>
                      <Text style={[styles.telemetryKey, { color: Colors.textSecondary }]}>
                        {OBD_PIDS[k]?.label ?? k}
                      </Text>
                    </View>
                  ))}
                  {odometerKm !== null ? (
                    <View style={styles.telemetryCell} testID="obd2-odometer">
                      <Text style={[styles.telemetryValue, { color: Colors.text }]}>
                        {formatKm(odometerKm)} km
                      </Text>
                      <Text style={[styles.telemetryKey, { color: Colors.textSecondary }]}>
                        Odometer
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {odometerStatus === "unsupported" ? (
                <Text
                  style={[styles.cardBody, { color: Colors.textSecondary, marginTop: 10 }]}
                  testID="obd2-odometer-unsupported"
                >
                  This vehicle does not answer the odometer parameter (mode 01 PID
                  A6). Most cars keep the odometer on the instrument cluster and
                  never put it on the diagnostic bus.
                </Text>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: online ? "#EF444422" : Colors.accent },
                    canbus.connecting && styles.buttonDisabled,
                  ]}
                  disabled={canbus.connecting}
                  onPress={() => {
                    if (online) void canbus.disconnect();
                    else void handleConnect();
                  }}
                  testID="obd2-connect"
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: online ? "#EF4444" : Colors.onAccent },
                    ]}
                  >
                    {canbus.connecting ? "Connecting…" : online ? "Disconnect" : "Connect"}
                  </Text>
                </TouchableOpacity>

                {displaySettings.partnerDriveSimEnabled && !linked ? (
                  <TouchableOpacity
                    style={[styles.secondaryButton, { borderColor: Colors.border }]}
                    onPress={() => canbus.connectDemo()}
                    testID="obd2-demo"
                  >
                    <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
                      Demo Mode
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* --- Saved readers --- */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionHeader, { color: Colors.textSecondary }]}>
                MY READERS
              </Text>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setAddVisible(true)}
                testID="obd2-add"
              >
                <Plus color={Colors.accent} size={18} />
                <Text style={[styles.addButtonText, { color: Colors.accent }]}>Add reader</Text>
              </TouchableOpacity>
            </View>

            {canbus.savedAdapters.length === 0 ? (
              <View style={[styles.card, cardStyle]}>
                <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
                  No reader added yet. Plug an ELM327-compatible OBD-II dongle into your
                  vehicle&apos;s diagnostics port, then add it here to stream live speed,
                  RPM, fuel and engine data into partner mode.
                </Text>
              </View>
            ) : (
              <View style={[styles.card, cardStyle, styles.listCard]}>
                {canbus.savedAdapters.map((adapter, idx) => {
                  const Icon = TRANSPORT_ICON[adapter.transport];
                  const selected = canbus.defaultAdapter?.id === adapter.id;
                  const avail = availabilityFor(adapter.transport);
                  const isLive = linked && device?.transport === adapter.transport;
                  return (
                    <TouchableOpacity
                      key={adapter.id}
                      style={[
                        styles.adapterRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: Colors.border,
                        },
                      ]}
                      onPress={() => void handleSelect(adapter)}
                      onLongPress={() => handleDelete(adapter)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      accessibilityLabel={`${adapter.name}, ${TRANSPORT_LABEL[adapter.transport]}`}
                      testID={`obd2-adapter-${adapter.id}`}
                    >
                      <Icon color={isLive ? "#22C55E" : Colors.textSecondary} size={20} />
                      <View style={styles.adapterInfo}>
                        <Text style={[styles.adapterName, { color: Colors.text }]} numberOfLines={1}>
                          {adapter.name}
                        </Text>
                        <Text
                          style={[styles.adapterSub, { color: Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {describeAdapter(adapter)}
                        </Text>
                        {!avail?.available && avail?.reason ? (
                          <Text style={styles.adapterWarn} numberOfLines={2}>
                            Unavailable — {avail.reason}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? <Check color={Colors.accent} size={20} strokeWidth={3} /> : null}
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => handleDelete(adapter)}
                        testID={`obd2-delete-${adapter.id}`}
                      >
                        <Trash2 color="#EF4444" size={18} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* --- What this build supports --- */}
            <Text style={[styles.sectionHeader, { color: Colors.textSecondary }]}>
              SUPPORTED CONNECTIONS
            </Text>
            <View style={[styles.card, cardStyle, styles.listCard]}>
              {canbus.availability.map((a, idx) => {
                const Icon = TRANSPORT_ICON[a.kind];
                return (
                  <View
                    key={a.kind}
                    style={[
                      styles.adapterRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: Colors.border,
                      },
                    ]}
                  >
                    <Icon color={a.available ? "#22C55E" : Colors.textSecondary} size={20} />
                    <View style={styles.adapterInfo}>
                      <Text style={[styles.adapterName, { color: Colors.text }]}>
                        {TRANSPORT_LABEL[a.kind]}
                      </Text>
                      <Text style={[styles.adapterSub, { color: Colors.textSecondary }]}>
                        {a.available ? "Available on this device" : (a.reason ?? "Unavailable")}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      </FixedLandscapeStage>

      {/* --- Add reader sheet --- */}
      <Modal
        visible={addVisible}
        animationType="slide"
        transparent
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        onRequestClose={() => setAddVisible(false)}
      >
        {/* A Modal is its own native window and does not inherit the stage's
            transform, so it wraps its own stage to come up in landscape too. */}
        <FixedLandscapeStage stage={stage}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setAddVisible(false)}
          />
          <View
            style={[
              styles.sheet,
              { backgroundColor: Colors.background, paddingBottom: stage.insets.bottom + 20 },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: Colors.text }]}>Add OBD-II reader</Text>
              <TouchableOpacity
                onPress={() => setAddVisible(false)}
                style={[styles.sheetClose, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}
                testID="obd2-add-close"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>CONNECTION</Text>
              <View style={[styles.card, cardStyle, styles.listCard]}>
                {transportChoices.map((choice, idx) => {
                  const Icon = TRANSPORT_ICON[choice.kind];
                  const picked = draftKind === choice.kind;
                  const avail = availabilityFor(choice.kind);
                  return (
                    <TouchableOpacity
                      key={choice.kind}
                      style={[
                        styles.adapterRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: Colors.border,
                        },
                      ]}
                      onPress={() => setDraftKind(choice.kind)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: picked, checked: picked, disabled: !avail?.available }}
                      accessibilityLabel={choice.title}
                      testID={`obd2-kind-${choice.kind}`}
                    >
                      <Icon color={picked ? Colors.accent : Colors.textSecondary} size={20} />
                      <View style={styles.adapterInfo}>
                        <Text style={[styles.adapterName, { color: Colors.text }]}>
                          {choice.title}
                        </Text>
                        <Text style={[styles.adapterSub, { color: Colors.textSecondary }]}>
                          {choice.hint}
                        </Text>
                        {!avail?.available ? (
                          <Text style={styles.adapterWarn}>
                            Not available in this build — you can still save it for later.
                          </Text>
                        ) : null}
                      </View>
                      {picked ? <Check color={Colors.accent} size={20} strokeWidth={3} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>NAME</Text>
              <TextInput
                style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="e.g. Vgate iCar Pro"
                placeholderTextColor={Colors.textSecondary}
                maxLength={60}
                testID="obd2-name-input"
              />

              {draftKind === "wifi" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                    ADAPTER ADDRESS
                  </Text>
                  <View style={styles.rowFields}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.hostInput,
                        { color: Colors.text, borderColor: Colors.border },
                      ]}
                      value={draftHost}
                      onChangeText={setDraftHost}
                      placeholder={WIFI_ADAPTER_HOST}
                      placeholderTextColor={Colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="numbers-and-punctuation"
                      testID="obd2-host-input"
                    />
                    <TextInput
                      style={[
                        styles.input,
                        styles.portInput,
                        { color: Colors.text, borderColor: Colors.border },
                      ]}
                      value={draftPort}
                      onChangeText={setDraftPort}
                      placeholder={String(WIFI_ADAPTER_PORT)}
                      placeholderTextColor={Colors.textSecondary}
                      keyboardType="number-pad"
                      testID="obd2-port-input"
                    />
                  </View>
                  <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                    Most ELM327 Wi-Fi dongles run their own Wi-Fi network and listen on{" "}
                    {WIFI_ADAPTER_HOST}:{WIFI_ADAPTER_PORT}. Join that network on your phone
                    before connecting.
                  </Text>
                </>
              ) : draftKind === "mfi" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
                    PAIRED NAME (OPTIONAL)
                  </Text>
                  <TextInput
                    style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
                    value={draftAccessory}
                    onChangeText={setDraftAccessory}
                    placeholder="e.g. OBDLink MX+"
                    placeholderTextColor={Colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={60}
                    testID="obd2-accessory-input"
                  />
                  <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                    Pair the adapter in iOS Settings → Bluetooth first. Leave the name blank
                    and the first paired OBD-II accessory is used; fill it in exactly as iOS
                    shows it when you have more than one paired.
                  </Text>
                </>
              ) : draftKind === "bluetooth" ? (
                <>
                  <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                    A Bluetooth LE dongle never shows in your phone&apos;s Bluetooth settings — scan
                    for it here and pick it from the list. Leave it unselected to auto-connect to the
                    first ELM327 reader found.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      styles.scanButton,
                      { borderColor: Colors.border },
                      scanning && styles.buttonDisabled,
                    ]}
                    disabled={scanning}
                    onPress={() => void handleScanBle()}
                    testID="obd2-scan"
                  >
                    {scanning ? (
                      <ActivityIndicator color={Colors.text} size="small" />
                    ) : (
                      <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
                        Scan for readers
                      </Text>
                    )}
                  </TouchableOpacity>
                  {discovered.length > 0 ? (
                    <View style={[styles.card, cardStyle, styles.listCard, styles.discoveredCard]}>
                      {discovered.map((d, idx) => (
                        <TouchableOpacity
                          key={d.id}
                          style={[
                            styles.adapterRow,
                            idx > 0 && {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: Colors.border,
                            },
                          ]}
                          onPress={() => pickDiscovered(d)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${d.name}`}
                          testID={`obd2-found-${d.id}`}
                        >
                          <Bluetooth
                            color={draftDeviceId === d.id ? Colors.accent : Colors.textSecondary}
                            size={18}
                          />
                          <View style={styles.adapterInfo}>
                            <Text style={[styles.adapterName, { color: Colors.text }]} numberOfLines={1}>
                              {d.name}
                            </Text>
                            <Text style={[styles.adapterSub, { color: Colors.textSecondary }]}>
                              {d.isElm ? "Looks like an ELM327" : "Bluetooth device"}
                              {typeof d.rssi === "number" ? ` · ${d.rssi} dBm` : ""}
                            </Text>
                          </View>
                          {draftDeviceId === d.id ? (
                            <Check color={Colors.accent} size={18} strokeWidth={3} />
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : scanning ? (
                    <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                      Scanning… make sure the dongle is plugged into the OBD-II port and powered.
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                  The reader is detected over USB-OTG when it is plugged in. Android only.
                </Text>
              )}

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  styles.sheetSave,
                  { backgroundColor: Colors.accent },
                  saving && styles.buttonDisabled,
                ]}
                disabled={saving}
                onPress={() => void handleSaveAdapter()}
                testID="obd2-save"
              >
                <Text style={[styles.primaryButtonText, { color: Colors.onAccent }]}>
                  {saving ? "Saving…" : "Save reader"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
        </FixedLandscapeStage>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerButton: { width: 32, height: 32, justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  loadingBlock: { paddingVertical: 48, alignItems: "center" },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 16,
  },
  listCard: { padding: 0 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardBody: { fontSize: 13, lineHeight: 19 },
  statusLine: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  telemetryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    marginHorizontal: -6,
  },
  telemetryCell: { width: "50%", paddingHorizontal: 6, paddingVertical: 6 },
  telemetryValue: { fontSize: 17, fontWeight: "700" },
  telemetryKey: { fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontSize: 15, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionHeader: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  addButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingBottom: 8 },
  addButtonText: { fontSize: 14, fontWeight: "600" },
  adapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  adapterInfo: { flex: 1 },
  adapterName: { fontSize: 15, fontWeight: "600" },
  adapterSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  adapterWarn: { fontSize: 11, marginTop: 4, color: "#F59E0B", lineHeight: 15 },
  deleteButton: { paddingLeft: 8, paddingVertical: 4 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: "88%",
  },
  sheetScroll: { marginTop: 8 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  rowFields: { flexDirection: "row", gap: 10 },
  hostInput: { flex: 2 },
  portInput: { flex: 1 },
  helpText: { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  scanButton: { flex: undefined, marginBottom: 12 },
  discoveredCard: { marginTop: 0 },
  sheetSave: { marginBottom: 24 },
});
