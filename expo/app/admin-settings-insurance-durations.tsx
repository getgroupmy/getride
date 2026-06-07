import React, { useCallback, useMemo } from "react";
import { CalendarClock } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AdminCrudList from "@/components/AdminCrudList";
import type { SettingEntry } from "@/contexts/AdminDataContext";

const DEFAULT_DURATIONS: { name: string; unit: string; quantity: number }[] = [
  { name: "Hourly", unit: "hour", quantity: 1 },
  { name: "Daily", unit: "day", quantity: 1 },
  { name: "Weekly", unit: "week", quantity: 1 },
  { name: "Monthly", unit: "month", quantity: 1 },
  { name: "Yearly", unit: "year", quantity: 1 },
];

export default function AdminSettingsInsuranceDurationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    providerId?: string;
    providerName?: string;
    typeId?: string;
    typeName?: string;
  }>();
  const providerId = String(params.providerId ?? "");
  const providerName = String(params.providerName ?? "");
  const typeId = String(params.typeId ?? "");
  const typeName = String(params.typeName ?? "Type");

  const filterFn = useCallback(
    (e: SettingEntry) => String(e.values.typeId ?? "") === typeId,
    [typeId]
  );

  const seedDefaults = useMemo(
    () =>
      DEFAULT_DURATIONS.map((d) => ({
        name: d.name,
        unit: d.unit,
        quantity: d.quantity,
        providerId,
        typeId,
      })),
    [providerId, typeId]
  );

  return (
    <AdminCrudList
      storageKey="insurance-durations"
      title="Premium Durations"
      subtitle={`${typeName} • ${providerName}`}
      Icon={CalendarClock}
      primaryAction="Add Duration"
      testID="insurance-durations"
      fields={[
        { key: "name", label: "Duration Name", type: "text", required: true, placeholder: "e.g. Daily" },
        { key: "unit", label: "Unit (hour / day / week / month / year)", type: "text" },
        { key: "quantity", label: "Quantity per cycle", type: "number" },
      ]}
      filter={filterFn}
      extraDefaults={{ providerId, typeId }}
      seedDefaults={seedDefaults}
      onRowPress={(entry) =>
        router.push({
          pathname: "/admin-settings-insurance-premium" as never,
          params: {
            providerId,
            providerName,
            typeId,
            typeName,
            durationId: entry.id,
            durationName: String(entry.values.name ?? ""),
          },
        } as never)
      }
    />
  );
}
