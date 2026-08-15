import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useColors } from "@/hooks/useColors";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { fetchAllSettings, upsertSetting } from "@/utils/adminSync";
import type { SettingEntry } from "@/types/admin";
import {
  EV_STEP_KEYS,
  deriveEvOrderStep,
  evOrderStatusLabel,
  mapAdminTypeToFinanceType,
  type EvOrderValues,
  type EvStepKey,
} from "@/utils/evOrders";
import {
  clearActiveEvOrderId,
  loadActiveEvOrderId,
  saveActiveEvOrderId,
} from "@/utils/evOrderStore";
import { uuidv4 } from "@/utils/supabase";

/**
 * Book a TEKSI EV.
 *
 * Every catalogue on this screen is admin-configured — models, specifications,
 * the order fee, finance options and delivery advisors all come from
 * `settings_entries`, so the wizard shows what the operator is actually selling
 * rather than anything hardcoded here.
 *
 * Which step the customer is on is *derived* from the stored order
 * (`deriveEvOrderStep`, pure and tested) rather than tracked separately. That
 * is what makes an abandoned order resumable: re-opening reads the row and
 * lands on the furthest step already satisfied, with no second source of truth
 * to drift.
 *
 * The order row only exists from the deposit step onward, which is why the two
 * steps before it are held locally and committed when the fee is paid.
 */

const CATEGORY = "ev-orders";

const STEP_TITLE: Record<EvStepKey, string> = {
  model: "Choose a model",
  specification: "Choose a specification",
  deposit: "Order fee",
  ownership: "Registered owner",
  plate: "Number plate",
  financing: "How you'll pay",
  advisor: "Your delivery advisor",
  schedule: "Delivery date",
  delivery: "Handover",
};

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * A text field that commits on blur rather than on every keystroke.
 *
 * It owns its own text so typing is not a write: each save is a network round
 * trip against the order row, and one per character would be both slow and a
 * good way to lose the last few letters to a race.
 */
function Field({
  label,
  placeholder,
  initial,
  onCommit,
}: {
  label: string;
  placeholder: string;
  initial: string;
  onCommit: (text: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState(initial);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={setText}
        onBlur={() => {
          if (text !== initial) onCommit(text);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </View>
  );
}

/** A catalogue row's display name, whatever key the admin used for it. */
function labelOf(e: SettingEntry): string {
  const v = e.values ?? {};
  return (
    str(v.name) || str(v.title) || str(v.label) || str(v.model) || str(v.type) || e.id.slice(0, 8)
  );
}

export default function TeksiEv() {
  const { ready } = useRequireAuth();
  const colors = useColors();
  const { authState } = useAuth();

  const [catalogues, setCatalogues] = useState<Record<string, SettingEntry[]>>({});
  const [values, setValues] = useState<EvOrderValues>({});
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- load catalogues + resume any unfinished order -------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await fetchAllSettings();
      if (cancelled) return;
      setCatalogues(all ?? {});

      const savedId = await loadActiveEvOrderId();
      const orders = (all ?? {})[CATEGORY] ?? [];
      // Prefer the id this device remembers; otherwise adopt this account's
      // newest unfinished order, so a reinstall does not strand one.
      const mine = orders.filter(
        (o) => !authState.userId || str(o.values?.userId) === authState.userId
      );
      const resumed =
        mine.find((o) => o.id === savedId) ??
        [...mine]
          .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))
          .find((o) => str(o.values?.status) !== "delivered");

      if (!cancelled && resumed) {
        setOrderId(resumed.id);
        setValues(resumed.values as EvOrderValues);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authState.userId]);

  const cat = useCallback(
    (name: string): SettingEntry[] => catalogues[name] ?? [],
    [catalogues]
  );

  // Before the fee is paid there is no row, so the step is whatever the local
  // draft has answered; afterwards it is derived from the stored order.
  const step: EvStepKey = useMemo(() => {
    if (!str(values.modelId)) return "model";
    if (!str(values.specId)) return "specification";
    if (!orderId) return "deposit";
    return deriveEvOrderStep(values);
  }, [values, orderId]);

  const orderFee = useMemo(() => {
    const row = cat("ev-order-fee")[0];
    const n = Number(row?.values?.amount ?? row?.values?.fee ?? 0);
    return Number.isFinite(n) ? n : 0;
  }, [cat]);

  /** Merge into the draft, and persist once a row exists. */
  const patch = useCallback(
    async (next: EvOrderValues) => {
      const merged = { ...values, ...next };
      setValues(merged);
      if (!orderId) return;
      setSaving(true);
      setError(null);
      try {
        await upsertSetting(CATEGORY, {
          id: orderId,
          createdAt: str(values.createdAt) || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          values: merged as Record<string, string | number | boolean>,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "That step did not save.");
      } finally {
        setSaving(false);
      }
    },
    [values, orderId]
  );

  /** Paying the fee is what creates the order row. */
  const payFee = useCallback(async () => {
    if (!authState.userId) {
      Alert.alert("Sign in needed", "Please sign in before placing an order.");
      return;
    }
    setSaving(true);
    setError(null);
    const id = uuidv4();
    const now = new Date().toISOString();
    const merged: EvOrderValues = {
      ...values,
      userId: authState.userId,
      status: "pending",
      orderFeePaid: true,
      orderFeeAmount: orderFee,
      createdAt: now,
    };
    try {
      await upsertSetting(CATEGORY, {
        id,
        createdAt: now,
        updatedAt: now,
        values: merged as Record<string, string | number | boolean>,
      });
      await saveActiveEvOrderId(id);
      setOrderId(id);
      setValues(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The order fee did not go through.");
    } finally {
      setSaving(false);
    }
  }, [authState.userId, values, orderFee]);

  // ---- rendering helpers ----------------------------------------------
  const picker = (
    rows: SettingEntry[],
    selectedId: string,
    onPick: (e: SettingEntry) => void,
    emptyNote: string
  ) =>
    rows.length === 0 ? (
      <Text style={[styles.note, { color: colors.subtext }]}>{emptyNote}</Text>
    ) : (
      rows.map((e) => (
        <Pressable
          key={e.id}
          accessibilityRole="button"
          accessibilityLabel={labelOf(e)}
          onPress={() => onPick(e)}
          style={[
            styles.option,
            {
              backgroundColor: selectedId === e.id ? colors.primary : colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text
            style={{
              color: selectedId === e.id ? colors.onAccent : colors.text,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            {labelOf(e)}
          </Text>
          {str(e.values?.price) ? (
            <Text
              style={{
                color: selectedId === e.id ? colors.onAccent : colors.textSecondary,
                fontSize: 13,
              }}
            >
              RM {str(e.values.price)}
            </Text>
          ) : null}
        </Pressable>
      ))
    );

  const field = (label: string, key: keyof EvOrderValues, placeholder: string) => (
    <Field
      key={String(key)}
      label={label}
      placeholder={placeholder}
      initial={str(values[key])}
      onCommit={(text) => void patch({ [key]: text } as EvOrderValues)}
    />
  );


  // A deep link can mount this route without passing through the launch
  // buffer, so the screen answers for its own access.
  if (!ready) return null;
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const stepIndex = EV_STEP_KEYS.indexOf(step);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.progress, { color: colors.textSecondary }]}>
        Step {stepIndex + 1} of {EV_STEP_KEYS.length}
        {orderId ? `  ·  ${evOrderStatusLabel(values.status)}` : ""}
      </Text>
      <Text style={[styles.title, { color: colors.text }]}>{STEP_TITLE[step]}</Text>

      {step === "model"
        ? picker(
            cat("ev-vehicle-details"),
            str(values.modelId),
            (e) => void patch({ modelId: e.id, modelName: labelOf(e) }),
            "No models are published yet. Please check back."
          )
        : null}

      {step === "specification"
        ? picker(
            cat("ev-vehicle-inventory"),
            str(values.specId),
            (e) => void patch({ specId: e.id, specName: labelOf(e) }),
            "No specifications are published for this model yet."
          )
        : null}

      {step === "deposit" ? (
        <>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {values.modelName ? `${values.modelName} · ` : ""}
            {str(values.specName)}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Order fee</Text>
            <Text style={[styles.amount, { color: colors.text }]}>RM {orderFee.toFixed(2)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pay the order fee"
            onPress={payFee}
            disabled={saving}
            style={[styles.cta, { backgroundColor: saving ? colors.border : colors.primary }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.onAccent }]}>
                Pay RM {orderFee.toFixed(2)} and place order
              </Text>
            )}
          </Pressable>
          <Text style={[styles.note, { color: colors.subtext }]}>
            Paying the fee places your order. You can come back and finish the rest later.
          </Text>
        </>
      ) : null}

      {step === "ownership" ? (
        <>
          {field("Full name", "ownerFullName", "As on your IC")}
          {field("IC / ID number", "ownerIdNumber", "")}
          {field("Address", "ownerAddress", "Where the vehicle is registered")}
        </>
      ) : null}

      {step === "plate" ? (
        <>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            Are you transferring an existing number plate?
          </Text>
          <View style={styles.row}>
            {["yes", "no"].map((answer) => (
              <Pressable
                key={answer}
                accessibilityRole="button"
                accessibilityLabel={answer === "yes" ? "Yes, transfer a plate" : "No, issue a new plate"}
                onPress={() => void patch({ plateTransfer: answer })}
                style={[
                  styles.option,
                  {
                    flex: 1,
                    backgroundColor:
                      str(values.plateTransfer) === answer ? colors.primary : colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: str(values.plateTransfer) === answer ? colors.onAccent : colors.text,
                    fontWeight: "600",
                  }}
                >
                  {answer === "yes" ? "Yes" : "No"}
                </Text>
              </Pressable>
            ))}
          </View>
          {str(values.plateTransfer) === "yes"
            ? field("Plate number", "plateNumber", "e.g. WXY 1234")
            : null}
        </>
      ) : null}

      {step === "financing" ? (
        <>
          {picker(
            cat("ev-finance-options"),
            str(values.financeChoice),
            (e) =>
              void patch({
                financeChoice: e.id,
                financeType: str(e.values?.type) || labelOf(e),
              }),
            "No finance options are published yet."
          )}
          {/* Cash and leasing need one more answer before this step is done —
              the predicate is in evOrders.ts, so the UI just asks for what it
              requires rather than re-deciding when financing is complete. */}
          {mapAdminTypeToFinanceType(values.financeType) === "cash" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm balance paid"
              onPress={() => void patch({ cashBalancePaid: true })}
              style={[styles.cta, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.ctaText, { color: colors.onAccent }]}>
                I&apos;ve paid the balance
              </Text>
            </Pressable>
          ) : null}
          {mapAdminTypeToFinanceType(values.financeType) === "leasing" ? (
            <View style={styles.row}>
              {["yes", "no"].map((a) => (
                <Pressable
                  key={a}
                  accessibilityRole="button"
                  accessibilityLabel={a === "yes" ? "Add-on required" : "No add-on"}
                  onPress={() =>
                    void patch({
                      leasingAddonRequired: a,
                      ...(a === "yes" ? {} : { leasingAddonPaid: false }),
                    })
                  }
                  style={[
                    styles.option,
                    {
                      flex: 1,
                      backgroundColor:
                        str(values.leasingAddonRequired) === a ? colors.primary : colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        str(values.leasingAddonRequired) === a ? colors.onAccent : colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {a === "yes" ? "Add-on required" : "No add-on"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {str(values.leasingAddonRequired) === "yes" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm add-on paid"
              onPress={() => void patch({ leasingAddonPaid: true })}
              style={[styles.cta, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.ctaText, { color: colors.onAccent }]}>
                I&apos;ve paid the add-on
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {step === "advisor"
        ? picker(
            cat("ev-delivery-advisors"),
            str(values.advisorId),
            (e) => void patch({ advisorId: e.id, advisorName: labelOf(e) }),
            "No delivery advisors are available yet — we'll assign one for you."
          )
        : null}

      {step === "schedule" ? (
        <>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            When would you like to collect your vehicle?
          </Text>
          {field("Delivery date", "deliveryDate", "YYYY-MM-DD")}
        </>
      ) : null}

      {step === "delivery" ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Your order</Text>
          <Text style={[styles.amount, { color: colors.text }]}>
            {str(values.modelName) || "TEKSI EV"}
          </Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {str(values.specName)}
          </Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            Delivery {str(values.deliveryDate) || "to be arranged"}
            {str(values.advisorName) ? ` · ${str(values.advisorName)}` : ""}
          </Text>
          <Text style={[styles.note, { color: colors.subtext }]}>
            Your advisor completes the handover checklist, then you accept it here to
            confirm delivery.
          </Text>
        </View>
      ) : null}

      {saving ? (
        <Text style={[styles.note, { color: colors.subtext }]}>Saving…</Text>
      ) : null}
      {error ? <Text style={[styles.note, { color: colors.error }]}>{error}</Text> : null}

      {orderId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a different order"
          onPress={async () => {
            await clearActiveEvOrderId();
            setOrderId(null);
            setValues({});
          }}
        >
          <Text style={[styles.note, { color: colors.subtext }]}>Start a different order</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  progress: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4, marginBottom: 4 },
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 2,
    alignItems: "flex-start",
  },
  row: { flexDirection: "row", gap: 10 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 4 },
  label: { fontSize: 13 },
  amount: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  field: { gap: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  cta: { borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  ctaText: { fontSize: 15, fontWeight: "700" },
  note: { fontSize: 13, lineHeight: 19 },
});
