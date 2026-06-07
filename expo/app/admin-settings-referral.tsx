import React from "react";
import { Gift } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsReferralScreen() {
  return (
    <AdminCrudList
      storageKey="referral-settings"
      title="Referral Settings"
      subtitle="Configure referral rewards"
      Icon={Gift}
      primaryAction="Add Reward"
      testID="referral-settings"
      fields={[
        { key: "name", label: "Name", type: "text", required: true },
        { key: "reward", label: "Reward Amount", type: "number", required: true },
        { key: "type", label: "Type", type: "text", placeholder: "user / driver" },
      ]}
    />
  );
}
