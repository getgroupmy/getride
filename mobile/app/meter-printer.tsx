import { useCallback, useState } from "react";
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

import { useColors } from "@/hooks/useColors";
import { usePrinter } from "@/hooks/usePrinter";
import {
  addPrinter,
  deletePrinter,
  describePrinter,
  setSelectedPrinterId,
  type PrinterDraft,
} from "@/utils/printerStore";
import { PRINTER_TRANSPORT_LABEL, type PaperWidth } from "@/utils/printer/types";

/** The two rolls a mini thermal printer takes. */
const PAPER_WIDTHS: PaperWidth[] = ["58mm", "80mm"];

/**
 * The driver's receipt printer.
 *
 * A mini ESC/POS thermal printer, saved device-locally like the OBD-II reader.
 * The receipt goes down the wire as an ASCII-folded ESC/POS string whose every
 * byte is ≤ 0x7F, so it survives any transport; its *content* comes from the
 * same `meterReceipt` helpers the on-screen total uses, so paper and phone can
 * never show different figures.
 *
 * A BLE printer never appears in the phone's system Bluetooth list, which is
 * why this screen runs its own in-app scan rather than sending the driver to
 * Settings.
 */
export default function MeterPrinter() {
  const colors = useColors();
  const {
    printers,
    defaultPrinter,
    availability,
    printing,
    scanning,
    discovered,
    reload,
    testPrint,
    scanBle,
  } = usePrinter();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PrinterDraft>({ transport: "wifi", paperWidth: "58mm" });

  const save = useCallback(async () => {
    const res = await addPrinter(draft);
    if (res.error) {
      Alert.alert("Check those details", res.error);
      return;
    }
    if (res.printer) await setSelectedPrinterId(res.printer.id);
    await reload();
    setAdding(false);
    setDraft({ transport: "wifi", paperWidth: "58mm" });
  }, [draft, reload]);

  const runTest = useCallback(
    async (printerId?: string) => {
      const res = await testPrint(printerId ? { printerId } : undefined);
      Alert.alert(
        res.ok ? "Test sent" : "Couldn't print",
        res.ok ? "Check the paper." : (res.error ?? "Please try again.")
      );
    },
    [testPrint]
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.section, { color: colors.textSecondary }]}>Your printers</Text>

      {printers.length === 0 ? (
        <Text style={[styles.meta, { color: colors.subtext }]}>
          No printer set up. Receipts will use the phone&apos;s print service instead.
        </Text>
      ) : (
        printers.map((p) => (
          <View
            key={p.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {p.name}
              {defaultPrinter?.id === p.id ? "  ·  default" : ""}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{describePrinter(p)}</Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Test print on ${p.name}`}
                onPress={() => void runTest(p.id)}
                disabled={printing}
                style={[styles.btn, { backgroundColor: printing ? colors.border : colors.primary }]}
              >
                {printing ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={[styles.btnText, { color: colors.onAccent }]}>Test print</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.name}`}
                onPress={async () => {
                  await deletePrinter(p.id);
                  await reload();
                }}
                style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.btnText, { color: colors.error }]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}

      <Text style={[styles.section, { color: colors.textSecondary }]}>Connection types</Text>
      {availability.map((a) => (
        <View
          key={a.kind}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: a.available ? colors.success : colors.text }]}>
            {PRINTER_TRANSPORT_LABEL[a.kind]} — {a.available ? "ready" : "unavailable"}
          </Text>
          {a.reason ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{a.reason}</Text>
          ) : null}
          {!a.available && a.guidance ? (
            <Text style={[styles.meta, { color: colors.subtext }]}>{a.guidance}</Text>
          ) : null}
        </View>
      ))}

      {adding ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Add a printer</Text>

          <View style={styles.chips}>
            {availability
              .filter((a) => a.available)
              .map((a) => (
                <Pressable
                  key={a.kind}
                  accessibilityRole="button"
                  accessibilityLabel={PRINTER_TRANSPORT_LABEL[a.kind]}
                  onPress={() => setDraft((d) => ({ ...d, transport: a.kind }))}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        draft.transport === a.kind ? colors.primary : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: draft.transport === a.kind ? colors.onAccent : colors.text,
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {PRINTER_TRANSPORT_LABEL[a.kind]}
                  </Text>
                </Pressable>
              ))}
          </View>

          <TextInput
            accessibilityLabel="Printer name"
            value={draft.name ?? ""}
            onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder="Name, e.g. MTP-II"
            placeholderTextColor={colors.subtext}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />

          {draft.transport === "wifi" ? (
            <>
              <TextInput
                accessibilityLabel="Host"
                value={draft.host ?? ""}
                onChangeText={(v) => setDraft((d) => ({ ...d, host: v }))}
                placeholder="192.168.0.20"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                accessibilityLabel="Port"
                value={String(draft.port ?? "")}
                onChangeText={(v) => setDraft((d) => ({ ...d, port: v }))}
                placeholder="9100"
                placeholderTextColor={colors.subtext}
                keyboardType="number-pad"
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
            </>
          ) : (
            <TextInput
              accessibilityLabel="Device name or address"
              value={draft.address ?? ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, address: v }))}
              placeholder={
                draft.transport === "bluetooth" ? "Name fragment to match" : "Bonded device (optional)"
              }
              placeholderTextColor={colors.subtext}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
          )}

          {draft.transport === "bluetooth" ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scan for Bluetooth printers"
                onPress={() => void scanBle()}
                disabled={scanning}
                style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
              >
                {scanning ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={[styles.btnText, { color: colors.text }]}>Scan nearby</Text>
                )}
              </Pressable>
              {discovered.map((d) => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${d.name ?? d.id}`}
                  onPress={() =>
                    setDraft((prev) => ({ ...prev, address: d.name ?? d.id, name: prev.name || (d.name ?? "") }))
                  }
                  style={[styles.found, { borderColor: colors.border }]}
                >
                  <Text style={[styles.meta, { color: colors.text }]}>{d.name ?? d.id}</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <View style={styles.chips}>
            {PAPER_WIDTHS.map((w) => (
              <Pressable
                key={w}
                accessibilityRole="button"
                accessibilityLabel={`Paper ${w}`}
                onPress={() => setDraft((d) => ({ ...d, paperWidth: w }))}
                style={[
                  styles.chip,
                  {
                    backgroundColor: draft.paperWidth === w ? colors.primary : colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: draft.paperWidth === w ? colors.onAccent : colors.text,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {w}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setAdding(false)}
              style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save printer"
              onPress={save}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.btnText, { color: colors.onAccent }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Set up a printer"
          onPress={() => setAdding(true)}
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.btnText, { color: colors.onAccent }]}>Set up printer</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  section: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10, marginTop: 6 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnText: { fontSize: 14, fontWeight: "700" },
  cta: { borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  found: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
});
