/**
 * Meter Digital → Printer setup.
 *
 * Direct support for a mini Bluetooth / Wi-Fi thermal (ESC/POS) receipt
 * printer. Reached from the Meter Digital printer tab, this is where a driver
 * adds a printer, picks which one to use, runs a test print, and prints the
 * last receipt straight to the paper roll — no OS print dialog in between.
 *
 * Everything native is behind the guarded transport loaders (`utils/printer/*`),
 * so the screen is safe on web and in older builds, where each transport simply
 * reports why it is unavailable.
 */

import React, { useCallback, useEffect, useState } from "react";
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
  BluetoothSearching,
  Check,
  Printer,
  Plus,
  Trash2,
  Wifi,
  X,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { usePrinter } from "@/hooks/usePrinter";
import type { PaperWidth } from "@/utils/printer/escpos";
import {
  PRINTER_TRANSPORT_LABEL,
  PRINTER_WIFI_PORT,
  type PrinterTransportKind,
} from "@/utils/printer/types";
import {
  addPrinter,
  deletePrinter,
  describePrinter,
  setSelectedPrinterId,
  type SavedPrinter,
} from "@/utils/printerStore";
import { loadMeterTrips, type MeterTrip } from "@/utils/meterTripsStore";

const TRANSPORT_ICON: Record<PrinterTransportKind, typeof Wifi> = {
  wifi: Wifi,
  bluetooth: Bluetooth,
  "bluetooth-classic": BluetoothSearching,
};

const PAPER_CHOICES: { width: PaperWidth; label: string }[] = [
  { width: "58mm", label: "58 mm (pocket, 32 cols)" },
  { width: "80mm", label: "80 mm (desktop, 48 cols)" },
];

/** Copy for the transport picker in the "Add printer" sheet. */
const TRANSPORT_CHOICES: {
  kind: PrinterTransportKind;
  title: string;
  hint: string;
}[] = [
  {
    kind: "wifi",
    title: "Wi-Fi / network",
    hint: "A printer with an IP address on your network. Enter its address below — most listen on port 9100.",
  },
  {
    kind: "bluetooth",
    title: "Bluetooth LE",
    hint: "A Bluetooth Low Energy mini printer. It is found by scanning — enter the name shown on the printer or its label.",
  },
  {
    kind: "bluetooth-classic",
    title: "Bluetooth (classic)",
    hint: "A classic Bluetooth (SPP) printer paired in the system settings. iOS only in this build — on Android use Bluetooth LE.",
  },
];

export default function MeterPrinterScreen() {
  const router = useRouter();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const isLightMode = Colors.background === "#FFFFFF";
  const printer = usePrinter();

  const [trips, setTrips] = useState<MeterTrip[]>([]);
  const [addVisible, setAddVisible] = useState<boolean>(false);
  const [draftKind, setDraftKind] = useState<PrinterTransportKind>("wifi");
  const [draftName, setDraftName] = useState<string>("");
  const [draftHost, setDraftHost] = useState<string>("");
  const [draftPort, setDraftPort] = useState<string>(String(PRINTER_WIFI_PORT));
  const [draftAddress, setDraftAddress] = useState<string>("");
  const [draftPaper, setDraftPaper] = useState<PaperWidth>("58mm");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    void loadMeterTrips().then(setTrips);
  }, []);

  // Drop any discovered devices when the add sheet is closed, so re-opening it
  // starts from a clean scan rather than a stale list. Depends on the stable
  // `clearDiscovered` callback, not the whole (per-render) `printer` object.
  const clearDiscovered = printer.clearDiscovered;
  useEffect(() => {
    if (!addVisible) clearDiscovered();
  }, [addVisible, clearDiscovered]);

  const lastTrip = trips[0] ?? null;

  const availabilityFor = useCallback(
    (kind: PrinterTransportKind) => printer.availability.find((a) => a.kind === kind),
    [printer.availability],
  );

  const resetDraft = useCallback(() => {
    setDraftKind("wifi");
    setDraftName("");
    setDraftHost("");
    setDraftPort(String(PRINTER_WIFI_PORT));
    setDraftAddress("");
    setDraftPaper("58mm");
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const res = await addPrinter({
      name: draftName,
      transport: draftKind,
      host: draftHost,
      port: draftPort,
      address: draftAddress,
      paperWidth: draftPaper,
    });
    setSaving(false);
    if (res.error) {
      Alert.alert("Check the details", res.error);
      return;
    }
    await printer.reload();
    setAddVisible(false);
    resetDraft();
  }, [draftAddress, draftHost, draftKind, draftName, draftPaper, draftPort, printer, resetDraft]);

  const handleSelect = useCallback(
    async (p: SavedPrinter) => {
      await setSelectedPrinterId(p.id);
      await printer.reload();
    },
    [printer],
  );

  const handleDelete = useCallback(
    (p: SavedPrinter) => {
      Alert.alert(
        "Remove printer",
        `Remove "${p.name}" from this device? The printer itself is not affected.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await deletePrinter(p.id);
              await printer.reload();
            },
          },
        ],
      );
    },
    [printer],
  );

  const handleScan = useCallback(async () => {
    const err = await printer.scanBle();
    if (err) Alert.alert("Bluetooth scan", err);
  }, [printer]);

  const pickDiscovered = useCallback(
    (name: string) => {
      setDraftAddress(name);
      setDraftName((prev) => prev || name);
    },
    [],
  );

  const handleTestPrint = useCallback(async () => {
    const res = await printer.testPrint();
    if (!res.ok) {
      Alert.alert("Test print failed", res.error ?? "Could not reach the printer.");
    } else {
      Alert.alert("Sent to printer", `A test slip was sent to ${res.device?.name ?? "the printer"}.`);
    }
  }, [printer]);

  const handlePrintLast = useCallback(async () => {
    if (!lastTrip) return;
    const res = await printer.print(lastTrip);
    if (!res.ok) {
      Alert.alert("Print failed", res.error ?? "Could not reach the printer.");
    }
  }, [lastTrip, printer]);

  const renderTransportForm = () => {
    if (draftKind === "wifi") {
      return (
        <>
          <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>PRINTER ADDRESS</Text>
          <View style={styles.rowFields}>
            <TextInput
              style={[styles.input, styles.hostInput, { color: Colors.text, borderColor: Colors.border }]}
              value={draftHost}
              onChangeText={setDraftHost}
              placeholder="192.168.0.50"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              testID="printer-host-input"
            />
            <TextInput
              style={[styles.input, styles.portInput, { color: Colors.text, borderColor: Colors.border }]}
              value={draftPort}
              onChangeText={setDraftPort}
              placeholder={String(PRINTER_WIFI_PORT)}
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
              testID="printer-port-input"
            />
          </View>
          <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
            Find the printer&apos;s IP address in its self-test slip or your router. Most ESC/POS
            printers listen on port {PRINTER_WIFI_PORT}. Your phone must be on the same network.
          </Text>
        </>
      );
    }
    if (draftKind === "bluetooth") {
      return (
        <>
          <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>BLUETOOTH NAME</Text>
          <TextInput
            style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
            value={draftAddress}
            onChangeText={setDraftAddress}
            placeholder="e.g. MTP-II or Printer001"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={60}
            testID="printer-ble-name-input"
          />
          <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
            A Bluetooth LE printer never shows in the phone&apos;s Bluetooth settings — scan for it
            here instead. Pick it from the list below, or type the name shown on its label.
          </Text>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              styles.scanButton,
              { borderColor: Colors.border },
              printer.scanning && styles.buttonDisabled,
            ]}
            disabled={printer.scanning}
            onPress={() => void handleScan()}
            testID="printer-scan"
          >
            {printer.scanning ? (
              <ActivityIndicator color={Colors.text} size="small" />
            ) : (
              <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>
                Scan for printers
              </Text>
            )}
          </TouchableOpacity>

          {printer.discovered.length > 0 ? (
            <View style={[styles.card, cardStyle, styles.listCard, styles.discoveredCard]}>
              {printer.discovered.map((d, idx) => (
                <TouchableOpacity
                  key={d.id}
                  style={[
                    styles.row,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
                  ]}
                  onPress={() => pickDiscovered(d.name)}
                  activeOpacity={0.7}
                  testID={`printer-found-${d.id}`}
                >
                  <Bluetooth color={draftAddress === d.name ? Colors.accent : Colors.textSecondary} size={18} />
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: Colors.text }]} numberOfLines={1}>
                      {d.name}
                    </Text>
                    {typeof d.rssi === "number" ? (
                      <Text style={[styles.rowSub, { color: Colors.textSecondary }]}>
                        Signal {d.rssi} dBm
                      </Text>
                    ) : null}
                  </View>
                  {draftAddress === d.name ? (
                    <Check color={Colors.accent} size={18} strokeWidth={3} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : printer.scanning ? (
            <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
              Scanning… make sure the printer is switched on and nearby.
            </Text>
          ) : null}
        </>
      );
    }
    return (
      <>
        <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>
          PAIRED NAME OR ADDRESS (OPTIONAL)
        </Text>
        <TextInput
          style={[styles.input, { color: Colors.text, borderColor: Colors.border }]}
          value={draftAddress}
          onChangeText={setDraftAddress}
          placeholder="e.g. Thermal Printer"
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
          testID="printer-classic-name-input"
        />
        <Text style={[styles.helpText, { color: Colors.textSecondary }]}>
          Pair the printer in the system Bluetooth settings first. Leave this blank to use the
          first paired device, or name it exactly when more than one is paired.
        </Text>
      </>
    );
  };

  const cardStyle = {
    backgroundColor: isLightMode ? "#F9FAFB" : "#111",
    borderColor: Colors.border,
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <StatusBar barStyle={isLightMode ? "dark-content" : "light-content"} />

      <SafeAreaView edges={["top"]} style={{ backgroundColor: Colors.background }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} testID="printer-back">
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Receipt printer</Text>
          <View style={styles.headerButton} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* --- Intro --- */}
        <View style={[styles.card, cardStyle]}>
          <View style={styles.cardHeader}>
            <Printer color={Colors.text} size={18} />
            <Text style={[styles.cardTitle, { color: Colors.text }]}>Direct printing</Text>
          </View>
          <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
            Connect a mini Bluetooth or Wi-Fi thermal printer to print receipts straight from the
            meter — no system print dialog. Add your printer below, then the meter&apos;s
            end-of-hire receipt and the PRINT RECEIPT button use it automatically. With no printer
            set up, receipts still fall back to your device&apos;s print service.
          </Text>
        </View>

        {/* --- Print actions --- */}
        {printer.defaultPrinter ? (
          <View style={[styles.card, cardStyle]} testID="printer-actions">
            <Text style={[styles.cardTitle, { color: Colors.text }]}>{printer.defaultPrinter.name}</Text>
            <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
              {describePrinter(printer.defaultPrinter)}
            </Text>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: Colors.border }, printer.printing && styles.buttonDisabled]}
                disabled={printer.printing}
                onPress={() => void handleTestPrint()}
                testID="printer-test"
              >
                <Text style={[styles.secondaryButtonText, { color: Colors.text }]}>Test print</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { backgroundColor: Colors.accent },
                  (printer.printing || !lastTrip) && styles.buttonDisabled,
                ]}
                disabled={printer.printing || !lastTrip}
                onPress={() => void handlePrintLast()}
                testID="printer-print-last"
              >
                {printer.printing ? (
                  <ActivityIndicator color={Colors.onAccent} size="small" />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: Colors.onAccent }]}>
                    {lastTrip ? "Print last receipt" : "No receipt yet"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* --- Saved printers --- */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeader, { color: Colors.textSecondary }]}>MY PRINTERS</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setAddVisible(true)} testID="printer-add">
            <Plus color={Colors.accent} size={18} />
            <Text style={[styles.addButtonText, { color: Colors.accent }]}>Add printer</Text>
          </TouchableOpacity>
        </View>

        {printer.loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : printer.printers.length === 0 ? (
          <View style={[styles.card, cardStyle]}>
            <Text style={[styles.cardBody, { color: Colors.textSecondary }]}>
              No printer added yet. Tap Add printer to connect a mini Bluetooth or Wi-Fi thermal
              printer.
            </Text>
          </View>
        ) : (
          <View style={[styles.card, cardStyle, styles.listCard]}>
            {printer.printers.map((p, idx) => {
              const Icon = TRANSPORT_ICON[p.transport];
              const selected = printer.defaultPrinter?.id === p.id;
              const avail = availabilityFor(p.transport);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.row,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
                  ]}
                  onPress={() => void handleSelect(p)}
                  onLongPress={() => handleDelete(p)}
                  activeOpacity={0.7}
                  testID={`printer-row-${p.id}`}
                >
                  <Icon color={selected ? Colors.accent : Colors.textSecondary} size={20} />
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: Colors.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[styles.rowSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                      {describePrinter(p)}
                    </Text>
                    {!avail?.available && avail?.reason ? (
                      <Text style={styles.rowWarn} numberOfLines={2}>
                        Unavailable — {avail.reason}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? <Check color={Colors.accent} size={20} strokeWidth={3} /> : null}
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDelete(p)}
                    testID={`printer-delete-${p.id}`}
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
          {printer.availability.map((a, idx) => {
            const Icon = TRANSPORT_ICON[a.kind];
            return (
              <View
                key={a.kind}
                style={[
                  styles.row,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
                ]}
              >
                <Icon color={a.available ? "#22C55E" : Colors.textSecondary} size={20} />
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: Colors.text }]}>
                    {PRINTER_TRANSPORT_LABEL[a.kind]}
                  </Text>
                  <Text style={[styles.rowSub, { color: Colors.textSecondary }]}>
                    {a.available ? "Available on this device" : (a.reason ?? "Unavailable")}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* --- Add printer sheet --- */}
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
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setAddVisible(false)} />
          <View
            style={[styles.sheet, { backgroundColor: Colors.background, paddingBottom: insets.bottom + 20 }]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: Colors.text }]}>Add printer</Text>
              <TouchableOpacity
                onPress={() => setAddVisible(false)}
                style={[styles.sheetClose, { backgroundColor: isLightMode ? "#F3F4F6" : "#1a1a1a" }]}
                testID="printer-add-close"
              >
                <X color={Colors.text} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>CONNECTION</Text>
              <View style={[styles.card, cardStyle, styles.listCard]}>
                {TRANSPORT_CHOICES.map((choice, idx) => {
                  const Icon = TRANSPORT_ICON[choice.kind];
                  const picked = draftKind === choice.kind;
                  const avail = availabilityFor(choice.kind);
                  return (
                    <TouchableOpacity
                      key={choice.kind}
                      style={[
                        styles.row,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
                      ]}
                      onPress={() => setDraftKind(choice.kind)}
                      activeOpacity={0.7}
                      testID={`printer-kind-${choice.kind}`}
                    >
                      <Icon color={picked ? Colors.accent : Colors.textSecondary} size={20} />
                      <View style={styles.rowInfo}>
                        <Text style={[styles.rowName, { color: Colors.text }]}>{choice.title}</Text>
                        <Text style={[styles.rowSub, { color: Colors.textSecondary }]}>{choice.hint}</Text>
                        {!avail?.available ? (
                          <Text style={styles.rowWarn}>
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
                placeholder="e.g. Cab printer"
                placeholderTextColor={Colors.textSecondary}
                maxLength={60}
                testID="printer-name-input"
              />

              {renderTransportForm()}

              <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>PAPER WIDTH</Text>
              <View style={[styles.card, cardStyle, styles.listCard]}>
                {PAPER_CHOICES.map((choice, idx) => {
                  const picked = draftPaper === choice.width;
                  return (
                    <TouchableOpacity
                      key={choice.width}
                      style={[
                        styles.row,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
                      ]}
                      onPress={() => setDraftPaper(choice.width)}
                      activeOpacity={0.7}
                      testID={`printer-paper-${choice.width}`}
                    >
                      <View style={styles.rowInfo}>
                        <Text style={[styles.rowName, { color: Colors.text }]}>{choice.label}</Text>
                      </View>
                      {picked ? <Check color={Colors.accent} size={20} strokeWidth={3} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  styles.sheetSave,
                  { backgroundColor: Colors.accent },
                  saving && styles.buttonDisabled,
                ]}
                disabled={saving}
                onPress={() => void handleSave()}
                testID="printer-save"
              >
                <Text style={[styles.primaryButtonText, { color: Colors.onAccent }]}>
                  {saving ? "Saving…" : "Save printer"}
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
  cardBody: { fontSize: 13, lineHeight: 19, marginTop: 2 },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  rowWarn: { fontSize: 11, marginTop: 4, color: "#F59E0B", lineHeight: 15 },
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
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
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
