import React from "react";
import { TrendingUp } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsDriverIncentiveScreen() {
  return (
    <AdminCrudList
      storageKey="driver-incentive"
      title="Partner Incentive"
      subtitle="Bonus & incentive rules"
      Icon={TrendingUp}
      primaryAction="Add Incentive"
      testID="driver-incentive"
      fields={[
        { key: "name", label: "Name", type: "text", required: true },
        { key: "minRides", label: "Minimum Rides", type: "number" },
        { key: "reward", label: "Reward", type: "number", required: true },
        { key: "active", label: "Active", type: "boolean" },
      ]}
    />
  );
}
