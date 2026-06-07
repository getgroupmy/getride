import React, { useCallback } from "react";
import { ShieldCheck } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AdminCrudList from "@/components/AdminCrudList";
import type { SettingEntry } from "@/contexts/AdminDataContext";

export default function AdminSettingsInsuranceTypesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ providerId?: string; providerName?: string }>();
  const providerId = String(params.providerId ?? "");
  const providerName = String(params.providerName ?? "Provider");

  const filterFn = useCallback(
    (e: SettingEntry) => String(e.values.providerId ?? "") === providerId,
    [providerId]
  );

  return (
    <AdminCrudList
      storageKey="insurance-types"
      title="Insurance Types"
      subtitle={providerName}
      Icon={ShieldCheck}
      primaryAction="Add Type"
      testID="insurance-types"
      fields={[
        { key: "name", label: "Insurance Type Name", type: "text", required: true },
        { key: "description", label: "Description", type: "text" },
        { key: "coverage", label: "Coverage Summary", type: "text" },
      ]}
      filter={filterFn}
      extraDefaults={{ providerId }}
      onRowPress={(entry) =>
        router.push({
          pathname: "/admin-settings-insurance-durations" as never,
          params: {
            providerId,
            providerName,
            typeId: entry.id,
            typeName: String(entry.values.name ?? ""),
          },
        } as never)
      }
    />
  );
}
