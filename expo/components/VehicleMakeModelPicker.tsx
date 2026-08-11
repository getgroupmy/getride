import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Image,
  Platform,
} from "react-native";
import {
  Car,
  Fuel,
  Factory,
  Tag,
  ChevronRight,
  ChevronLeft,
  X,
  Search,
  Inbox,
  Check,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, VehicleMakeModelRecord } from "@/contexts/AdminDataContext";

export interface VehicleSelection {
  vehicleType: string;
  energyType: string;
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  iconUri?: string;
}

interface Props {
  value?: Partial<VehicleSelection> | null;
  onChange: (selection: VehicleSelection) => void;
  testID?: string;
}

type Step = 0 | 1 | 2 | 3;

const readEntry = (e: VehicleMakeModelRecord) => ({
  id: e.id,
  vehicleType: String(e.vehicleType ?? "").trim(),
  energyType: String(e.energyType ?? "").trim(),
  make: String(e.make ?? "").trim(),
  model: String(e.model ?? "").trim(),
  yearFrom: String(e.yearFrom ?? "").trim(),
  yearTo: String(e.yearTo ?? "").trim(),
  iconUri: String(e.iconUri ?? ""),
  status: e.status === undefined ? true : Boolean(e.status),
});

const formatYearRange = (from: string, to: string): string => {
  const f = from.trim();
  const t = to.trim();
  if (!f && !t) return "";
  if (f && !t) return `(${f} ~)`;
  if (!f && t) return `(~ ${t})`;
  if (t === "~") return `(${f} ~)`;
  return `(${f} - ${t})`;
};

export const formatVehicleLabel = (s: Partial<VehicleSelection>): string => {
  const yr = formatYearRange(s.yearFrom ?? "", s.yearTo ?? "");
  const parts = [s.make, s.model].filter(Boolean).join(" ");
  return [parts, yr].filter(Boolean).join(" ").trim();
};

export default function VehicleMakeModelPicker({ value, onChange, testID }: Props) {
  const Colors = useColors();
  const { vehicleMakeModels } = useAdminData();
  const parsed = useMemo(
    () => vehicleMakeModels.map(readEntry).filter((p) => p.status),
    [vehicleMakeModels]
  );

  const [open, setOpen] = useState<boolean>(false);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Partial<VehicleSelection>>({});
  const [query, setQuery] = useState<string>("");

  const startPicker = useCallback(() => {
    setDraft(value ?? {});
    setStep(value?.vehicleType ? (value.energyType ? (value.make ? 3 : 2) : 1) : 0);
    setQuery("");
    setOpen(true);
  }, [value]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const goBack = () => {
    setQuery("");
    if (step === 0) {
      close();
      return;
    }
    setStep((s) => (s - 1) as Step);
  };

  // Lists per step
  const vehicleTypes = useMemo(() => {
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (!p.vehicleType) return;
      set.set(p.vehicleType, (set.get(p.vehicleType) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed]);

  const energyTypes = useMemo(() => {
    if (!draft.vehicleType) return [];
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (p.vehicleType !== draft.vehicleType) return;
      if (!p.energyType) return;
      set.set(p.energyType, (set.get(p.energyType) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed, draft.vehicleType]);

  const makes = useMemo(() => {
    if (!draft.vehicleType || !draft.energyType) return [];
    const set = new Map<string, number>();
    parsed.forEach((p) => {
      if (p.vehicleType !== draft.vehicleType) return;
      if (p.energyType !== draft.energyType) return;
      if (!p.make) return;
      set.set(p.make, (set.get(p.make) ?? 0) + (p.model ? 1 : 0));
    });
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [parsed, draft.vehicleType, draft.energyType]);

  const models = useMemo(() => {
    if (!draft.vehicleType || !draft.energyType || !draft.make) return [];
    return parsed
      .filter(
        (p) =>
          p.vehicleType === draft.vehicleType &&
          p.energyType === draft.energyType &&
          p.make === draft.make &&
          p.model
      )
      .sort((a, b) => a.model.localeCompare(b.model));
  }, [parsed, draft]);

  const q = query.trim().toLowerCase();
  const filterByName = <T extends { name: string }>(arr: T[]): T[] =>
    !q ? arr : arr.filter((v) => v.name.toLowerCase().includes(q));

  const filteredVehicleTypes = useMemo(() => filterByName(vehicleTypes), [vehicleTypes, q]);
  const filteredEnergyTypes = useMemo(() => filterByName(energyTypes), [energyTypes, q]);
  const filteredMakes = useMemo(() => filterByName(makes), [makes, q]);
  const filteredModels = useMemo(
    () =>
      !q
        ? models
        : models.filter(
            (m) =>
              m.model.toLowerCase().includes(q) ||
              m.yearFrom.toLowerCase().includes(q) ||
              m.yearTo.toLowerCase().includes(q)
          ),
    [models, q]
  );

  const meta = useMemo(() => {
    if (step === 0) return { title: "Vehicle Type", placeholder: "Search vehicle types", Icon: Car };
    if (step === 1) return { title: "Energy Type", placeholder: "Search energy types", Icon: Fuel };
    if (step === 2) return { title: "Make", placeholder: "Search makes", Icon: Factory };
    return { title: "Model", placeholder: "Search models", Icon: Tag };
  }, [step]);

  const selectVehicleType = (name: string) => {
    setDraft({ vehicleType: name });
    setQuery("");
    setStep(1);
  };
  const selectEnergyType = (name: string) => {
    setDraft((d) => ({ ...d, energyType: name, make: undefined, model: undefined }));
    setQuery("");
    setStep(2);
  };
  const selectMake = (name: string) => {
    setDraft((d) => ({ ...d, make: name, model: undefined }));
    setQuery("");
    setStep(3);
  };
  const selectModel = (m: ReturnType<typeof readEntry>) => {
    const result: VehicleSelection = {
      vehicleType: draft.vehicleType ?? m.vehicleType,
      energyType: draft.energyType ?? m.energyType,
      make: draft.make ?? m.make,
      model: m.model,
      yearFrom: m.yearFrom,
      yearTo: m.yearTo,
      iconUri: m.iconUri || undefined,
    };
    onChange(result);
    setOpen(false);
  };

  const summary = formatVehicleLabel(value ?? {});
  const hasValue = !!(value && value.model);

  return (
    <>
      <TouchableOpacity
        onPress={startPicker}
        style={[
          styles.trigger,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
        testID={testID ?? "vmm-picker-trigger"}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[styles.triggerIcon, { backgroundColor: Colors.accent + "22" }]}>
          {value?.iconUri ? (
            <Image source={{ uri: value.iconUri }} style={styles.triggerImg} />
          ) : (
            <Car color={Colors.accent} size={18} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          {hasValue ? (
            <>
              <Text style={[styles.triggerTitle, { color: Colors.text }]} numberOfLines={1}>
                {summary || `${value?.make ?? ""} ${value?.model ?? ""}`.trim()}
              </Text>
              <Text style={[styles.triggerMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                {[value?.vehicleType, value?.energyType].filter(Boolean).join(" • ")}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.triggerTitle, { color: Colors.text }]}>Select vehicle</Text>
              <Text style={[styles.triggerMeta, { color: Colors.textSecondary }]}>
                Type › Energy › Make › Model
              </Text>
            </>
          )}
        </View>
        <ChevronRight color={Colors.textSecondary} size={18} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: Colors.border }]}>
              <TouchableOpacity
                onPress={goBack}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="vmm-picker-back"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                {step === 0 ? (
                  <X color={Colors.text} size={20} />
                ) : (
                  <ChevronLeft color={Colors.text} size={20} />
                )}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <meta.Icon color={Colors.accent} size={16} />
                  <Text style={[styles.title, { color: Colors.text }]}>Select {meta.title}</Text>
                </View>
                <Text style={[styles.subtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
                  Step {step + 1} of 4
                  {draft.vehicleType ? ` • ${draft.vehicleType}` : ""}
                  {draft.energyType ? ` › ${draft.energyType}` : ""}
                  {draft.make ? ` › ${draft.make}` : ""}
                </Text>
              </View>
              <TouchableOpacity
                onPress={close}
                style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
                testID="vmm-picker-close"
                accessibilityRole="button"
              >
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>

            <View style={[styles.searchWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Search color={Colors.textSecondary} size={18} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={meta.placeholder}
                placeholderTextColor={Colors.textSecondary}
                style={[styles.searchInput, { color: Colors.text }]}
                autoCapitalize="none"
                testID="vmm-picker-search"
                accessibilityLabel="Search"
              />
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {step === 0 &&
                (filteredVehicleTypes.length === 0 ? (
                  <Empty title="No vehicle types" desc="Add vehicle types in Settings › Vehicle Make/Model." />
                ) : (
                  filteredVehicleTypes.map((v) => (
                    <Row
                      key={`vt-${v.name}`}
                      Icon={Car}
                      label={v.name}
                      meta={`${v.count} model${v.count === 1 ? "" : "s"}`}
                      selected={draft.vehicleType === v.name}
                      onPress={() => selectVehicleType(v.name)}
                    />
                  ))
                ))}
              {step === 1 &&
                (filteredEnergyTypes.length === 0 ? (
                  <Empty title="No energy types" desc="Add energy types under this vehicle type." />
                ) : (
                  filteredEnergyTypes.map((v) => (
                    <Row
                      key={`et-${v.name}`}
                      Icon={Fuel}
                      label={v.name}
                      meta={`${v.count} model${v.count === 1 ? "" : "s"}`}
                      selected={draft.energyType === v.name}
                      onPress={() => selectEnergyType(v.name)}
                    />
                  ))
                ))}
              {step === 2 &&
                (filteredMakes.length === 0 ? (
                  <Empty title="No makes" desc="Add makes under this energy type." />
                ) : (
                  filteredMakes.map((v) => (
                    <Row
                      key={`mk-${v.name}`}
                      Icon={Factory}
                      label={v.name}
                      meta={`${v.count} model${v.count === 1 ? "" : "s"}`}
                      selected={draft.make === v.name}
                      onPress={() => selectMake(v.name)}
                    />
                  ))
                ))}
              {step === 3 &&
                (filteredModels.length === 0 ? (
                  <Empty title="No models" desc="Add models under this make." />
                ) : (
                  filteredModels.map((m) => (
                    <Row
                      key={`md-${m.id}`}
                      Icon={Tag}
                      iconUri={m.iconUri || undefined}
                      label={`${m.model} ${formatYearRange(m.yearFrom, m.yearTo)}`.trim()}
                      meta={[m.make, m.energyType, m.vehicleType].filter(Boolean).join(" • ")}
                      selected={value?.model === m.model && value?.yearFrom === m.yearFrom}
                      onPress={() => selectModel(m)}
                    />
                  ))
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

interface RowProps {
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  iconUri?: string;
  label: string;
  meta?: string;
  selected?: boolean;
  onPress: () => void;
}

function Row({ Icon, iconUri, label, meta, selected, onPress }: RowProps) {
  const Colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: Colors.gray[100],
          borderColor: selected ? Colors.accent : Colors.border,
          borderWidth: selected ? 1.5 : 1,
        },
      ]}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={[styles.rowIcon, { backgroundColor: Colors.accent + "22" }]}>
        {iconUri ? (
          <Image source={{ uri: iconUri }} style={styles.rowIconImg} />
        ) : (
          <Icon color={Colors.accent} size={18} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: Colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        {!!meta && (
          <Text style={[styles.rowMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {selected ? (
        <Check color={Colors.accent} size={18} />
      ) : (
        <ChevronRight color={Colors.textSecondary} size={18} />
      )}
    </TouchableOpacity>
  );
}

function Empty({ title, desc }: { title: string; desc: string }) {
  const Colors = useColors();
  return (
    <View style={[styles.emptyBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
      <Inbox color={Colors.textSecondary} size={26} />
      <Text style={[styles.emptyTitle, { color: Colors.text }]}>{title}</Text>
      <Text style={[styles.emptyDesc, { color: Colors.textSecondary }]}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
  },
  triggerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  triggerImg: { width: 36, height: 36, resizeMode: "cover" as const },
  triggerTitle: { fontSize: 14, fontWeight: "700" as const },
  triggerMeta: { fontSize: 12, marginTop: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end" as const,
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
    maxHeight: "85%",
  },
  sheetHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  titleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  title: { fontSize: 16, fontWeight: "800" as const },
  subtitle: { fontSize: 12, marginTop: 2 },
  searchWrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14 },
  list: { gap: 8, paddingBottom: 12 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  rowIconImg: { width: 36, height: 36, resizeMode: "cover" as const },
  rowLabel: { fontSize: 14, fontWeight: "700" as const },
  rowMeta: { fontSize: 12, marginTop: 2 },
  emptyBox: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    gap: 6,
  },
  emptyTitle: { fontSize: 14, fontWeight: "800" as const },
  emptyDesc: { fontSize: 12, textAlign: "center" as const },
});
