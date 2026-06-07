import React from "react";
import { Coins } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsWorldCurrencyScreen() {
  return (
    <AdminCrudList
      storageKey="world-currency"
      title="World Currency"
      subtitle="Supported currencies"
      Icon={Coins}
      primaryAction="Add Currency"
      testID="world-currency"
      primaryDisplayKey="code"
      secondaryDisplayKey="symbol"
      fields={[
        { key: "code", label: "Currency Code", type: "text", required: true, placeholder: "MYR" },
        { key: "symbol", label: "Symbol", type: "text", required: true, placeholder: "RM" },
        { key: "rate", label: "Exchange Rate", type: "number" },
      ]}
    />
  );
}
