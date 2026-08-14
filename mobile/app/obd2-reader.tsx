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

import { useCanbus } from "@/hooks/useCanbus";
import { useColors } from "@/hooks/useColors";
import {
  describeAdapter,
  normalizeAdapterDraft,
  removeAdapter,
  saveCanbusAdapters,
  setSelectedAdapterId,
  upsertAdapter,
  type CanAdapterDraft,
  type SavedCanAdapter,
} from "@/utils/canbusAdapterStore";
import type { CanTransportKind } from "@/utils/canbus/types";
import { uuidv4 } from "@/utils/supabase";

const TRANSPORT_LABEL: Record<CanTransportKind, string> = {
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth LE",
  mfi: "Bluetooth MFi",
  usb: "USB",
};

/**
 * The driver's OBD-II reader book.
 *
 * Adapters are saved device-locally — a reader belongs to the phone in the car,
 * not to the account. Availability is reported per transport by the CANBus
 * layer, which distinguishes "package resolves" from "native module linked into
 * this binary": the JS half resolves either way, so a build made before a
 * transport shipped needs a *new native build*, not an OTA update. That wording
 * comes from `utils/canbus/availability.ts` rather than being hardcoded here.
 */
export default function Obd2Reader() {
  const colors = useColors();
  const {
    state,
    availability,
    availableTransports,
    savedAdapters,
    reloadAdapters,
    connecting,
    connect,
    connectDemo,
    disconnect,
  } = useCanbus();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CanAdapterDraft>({ transport: "wifi" });

  useEffect(() => {
    void reloadAdapters();
  }, [reloadAdapters]);

  const add = useCallback(async () => {
    const result = normalizeAdapterDraft(draft);
    if (!result.ok || !result.value) {
      Alert.alert("Check those details", result.error ?? "That reader could not be saved.");
      return;
    }
    const adapter: SavedCanAdapter = {
      ...result.value,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    await saveCanbusAdapters(upsertAdapter(savedAdapters, adapter));
    await setSelectedAdapterId(adapter.id);
    await reloadAdapters();
    setAdding(false);
    setDraft({ transport: "wifi" });
  }, [draft, savedAdapters, reloadAdapters]);

  const forget = useCallback(
    async (adapter: SavedCanAdapter) => {
      await saveCanbusAdapters(removeAdapter(savedAdapters, adapter.id));
      await reloadAdapters();
    },
    [savedAdapters, reloadAdapters]
  );

  const online = state.phase === "online";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {online ? (state.simulated ? "Demo Mode" : "Connected") : "Not connected"}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {state.device?.name ?? state.protocol ?? "No reader linked."}
        </Text>
        {state.error ? (
          <Text style={[styles.meta, { color: colors.error }]}>{state.error}</Text>
        ) : null}
        <View style={styles.row}>
          {online ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Disconnect reader"
              onPress={disconnect}
              style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start demo mode"
              onPress={connectDemo}
              style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Demo Mode</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={[styles.section, { color: colors.textSecondary }]}>Your readers</Text>

      {savedAdapters.length === 0 ? (
        <Text style={[styles.meta, { color: colors.subtext }]}>
          No readers saved yet. Add the dongle in your car below.
        </Text>
      ) : (
        savedAdapters.map((a) => (
          <View
            key={a.id}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>{a.name}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{describeAdapter(a)}</Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Connect to ${a.name}`}
                onPress={() => void connect(a.transport, { adapter: a })}
                disabled={connecting}
                style={[styles.btn, { backgroundColor: connecting ? colors.border : colors.primary }]}
              >
                {connecting ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={[styles.btnText, { color: colors.onAccent }]}>Connect</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forget ${a.name}`}
                onPress={() => void forget(a)}
                style={[styles.btn, { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.btnText, { color: colors.error }]}>Forget</Text>
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
            {TRANSPORT_LABEL[a.kind]} — {a.available ? "ready" : "unavailable"}
          </Text>
          {a.reason ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{a.reason}</Text>
          ) : null}
          {/* Runtime-aware: Expo Go is told to use a development build, an
              installed build is told a new native build is needed. */}
          {!a.available && a.guidance ? (
            <Text style={[styles.meta, { color: colors.subtext }]}>{a.guidance}</Text>
          ) : null}
        </View>
      ))}

      {adding ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Add a reader</Text>

          <View style={styles.chips}>
            {availableTransports.map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityLabel={TRANSPORT_LABEL[t]}
                onPress={() => setDraft((d) => ({ ...d, transport: t }))}
                style={[
                  styles.chip,
                  {
                    backgroundColor: draft.transport === t ? colors.primary : colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: draft.transport === t ? colors.onAccent : colors.text,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {TRANSPORT_LABEL[t]}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            accessibilityLabel="Reader name"
            value={draft.name ?? ""}
            onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder="Name, e.g. Vgate iCar Pro"
            placeholderTextColor={colors.subtext}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />

          {draft.transport === "wifi" ? (
            <>
              <TextInput
                accessibilityLabel="Host"
                value={draft.host ?? ""}
                onChangeText={(v) => setDraft((d) => ({ ...d, host: v }))}
                placeholder="192.168.0.10"
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
              <TextInput
                accessibilityLabel="Port"
                value={String(draft.port ?? "")}
                onChangeText={(v) => setDraft((d) => ({ ...d, port: v }))}
                placeholder="35000"
                placeholderTextColor={colors.subtext}
                keyboardType="number-pad"
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              />
            </>
          ) : null}

          {draft.transport === "mfi" ? (
            <TextInput
              accessibilityLabel="Paired accessory name"
              value={draft.accessory ?? ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, accessory: v }))}
              placeholder="Paired name in iOS Settings (optional)"
              placeholderTextColor={colors.subtext}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
          ) : null}

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
              accessibilityLabel="Save reader"
              onPress={add}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.btnText, { color: colors.onAccent }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a reader"
          onPress={() => setAdding(true)}
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.btnText, { color: colors.onAccent }]}>Add a reader</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: "700", marginTop: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10, marginTop: 6 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnText: { fontSize: 14, fontWeight: "700" },
  cta: { borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
});
