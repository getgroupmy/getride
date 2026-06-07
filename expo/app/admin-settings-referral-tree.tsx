import React from "react";
import { GitBranch } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsReferralTreeScreen() {
  return (
    <AdminCrudList
      storageKey="referral-tree"
      title="Referral Tree"
      subtitle="Multi-level rewards"
      Icon={GitBranch}
      primaryAction="Add Level"
      testID="referral-tree"
      fields={[
        { key: "name", label: "Level Name", type: "text", required: true },
        { key: "percentage", label: "Percentage %", type: "number", required: true },
      ]}
    />
  );
}
