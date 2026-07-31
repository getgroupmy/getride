/**
 * Settings → OBD-II (CANBus) reader.
 *
 * User-side management of the vehicle link: add a reader (Wi-Fi / Bluetooth LE
 * / USB), pick which one to use, connect, and watch live telemetry. The saved
 * reader is what the partner Teksi/e-hailing screens auto-connect to, so this
 * screen is the single place a driver sets the dongle up.
 *
 * Only shown to accounts that are also partners — see `useIsPartner`.
 */

import React, { useCallback, useMemo, useState } from "react";
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
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Bluetooth,
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
import { TRANSPORT_LABEL, type CanTransportKind } from "@/utils/canbus/types";
import { WIFI_ADAPTER_HOST, WIFI_ADAPTER_PORT } from "@/utils/canbus/config";
import {
  addCanbusAdapter,
  deleteCanbusAdapter,
  describeAdapter,
  setSelectedAdapterId,
  type SavedCanAdapter,
} from "@/utils/canbusAdapterStore";

const TRANSPORT_ICON: Record<CanTransportKind, typeof Wifi> = {
  wifi: Wifi,
  bluetooth: Bluetooth,
  usb: Usb,
};

/** Copy for the transport picker in the "Add reader" sheet. */
const TRANSPORT_CHOICES: {
  kind: CanTransportKind;
  title: string;
  hint: string;
  androidOnly?: boolean;
}[] = [
  {
    kind: "wifi",
    title: "Wi-Fi",
    hint: "ELM327 Wi-Fi dongle. Join the dongle's Wi-Fi network, then enter its address below.",
  },
  {
    kind: "bluetooth",
    title: "Bluetooth LE",
    hint: "ELM327 Bluetooth Low Energy dongle. Do not pair it in the phone's Bluetooth settings — it is found automatically.",
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
  const [saving, setSaving] = useState<boolean>(false);

  const state = canbus.state;
  const online = state.phase === "online";
  const linked = online && !state.simulated;
  const device = state.device;

  const transportChoices = useMemo(
    () => TRANSPORT_CHOICES.filter((t) => !t.androidOnly || Platform.OS === "android"),
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
  }, []);

  const handleSaveAdapter = useCallback(async () => {
    setSaving(true);
    const res = await addCanbusAdapter({
      name: draftName,
      transport: draftKind,
      host: draftHost,
      port: draftPort,
    });
    setSaving(false);
    if (res.error) {
      Alert.alert("Check the details", res.error);
      return;
    }
    await canbus.reloadAdapters();
    setAddVisible(false);
    resetDraft();
  }, [canbus, draftHost, draftKind, draftName, draftPort, resetDraft]);

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
        // Be honest rather than failing silently: the native driver behind a
        // transport is missing in Expo Go / on web, so a real link is impossible.
        Alert.alert(
          `${TRANSPORT_LABEL[target.transport]} not available`,
          `${avail?.reason ?? "This transport is unavailable"}.\n\nConnecting to a real OBD-II reader over ${TRANSPORT_LABEL[target.transport]} needs the adapter's native driver, which ships in a development or production build — not in Expo Go or the web preview.`
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

      <SafeAreaView edges={["top"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.header}>
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
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
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

              {telemetryKeys.length > 0 ? (
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
                </View>
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
                            Unavailable in this build — {avail.reason}
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

      {/* --- Add reader sheet --- */}
      <Modal
        visible={addVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAddVisible(false)}
      >
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
              { backgroundColor: Colors.background, paddingBottom: insets.bottom + 20 },
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
              ) : (
                <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
                  {draftKind === "bluetooth"
                    ? "The reader is discovered by scanning for ELM327 devices — no pairing needed in your phone's Bluetooth settings."
                    : "The reader is detected over USB-OTG when it is plugged in. Android only."}
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
  sheetSave: { marginBottom: 24 },
});
