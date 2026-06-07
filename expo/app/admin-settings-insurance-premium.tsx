import React, { useCallback } from "react";
import { Coins } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import AdminCrudList from "@/components/AdminCrudList";
import type { SettingEntry } from "@/contexts/AdminDataContext";

export default function AdminSettingsInsurancePremiumScreen() {
  const params = useLocalSearchParams<{
    providerId?: string;
    providerName?: string;
    typeId?: string;
    typeName?: string;
    durationId?: string;
    durationName?: string;
  }>();
  const providerId = String(params.providerId ?? "");
  const typeId = String(params.typeId ?? "");
  const durationId = String(params.durationId ?? "");
  const durationName = String(params.durationName ?? "Duration");
  const typeName = String(params.typeName ?? "");
  const providerName = String(params.providerName ?? "");

  const filterFn = useCallback(
    (e: SettingEntry) => String(e.values.durationId ?? "") === durationId,
    [durationId]
  );

  return (
    <AdminCrudList
      storageKey="insurance-premium"
      title="Premium Plans"
      subtitle={`${durationName} • ${typeName} • ${providerName}`}
      Icon={Coins}
      primaryAction="Add Premium"
      testID="insurance-premium"
      fields={[
        { key: "name", label: "Plan Name", type: "text", required: true, placeholder: "e.g. Basic" },
        { key: "cost", label: "Premium Cost", type: "number", required: true },
        { key: "currency", label: "Currency (e.g. MYR)", type: "text", placeholder: "MYR" },
        {
          key: "startCalc",
          label: "Start Time Calculation",
          type: "text",
          placeholder: "e.g. On purchase / On first ride / 00:00 next day",
        },
        {
          key: "endCalc",
          label: "End Time Calculation",
          type: "text",
          placeholder: "e.g. Start + duration / End of day / Manual cancel",
        },
        { key: "notes", label: "Notes", type: "text" },
      ]}
      filter={filterFn}
      extraDefaults={{ providerId, typeId, durationId }}
    />
  );
}
