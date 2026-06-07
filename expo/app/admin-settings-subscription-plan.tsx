import React from "react";
import { Crown } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsSubscriptionPlanScreen() {
  return (
    <AdminCrudList
      storageKey="subscription-plan"
      title="Subscription Plan"
      subtitle="Partner subscription tiers"
      Icon={Crown}
      primaryAction="Add Plan"
      testID="subscription-plan"
      fields={[
        { key: "name", label: "Plan Name", type: "text", required: true },
        { key: "price", label: "Price", type: "number", required: true },
        { key: "duration", label: "Duration (days)", type: "number" },
        { key: "features", label: "Features", type: "text" },
      ]}
    />
  );
}
