import React from "react";
import { Trophy } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsLeaderboardScreen() {
  return (
    <AdminCrudList
      storageKey="leaderboard"
      title="Leaderboard"
      subtitle="Top partner rankings"
      Icon={Trophy}
      primaryAction="Add Tier"
      testID="leaderboard"
      fields={[
        { key: "name", label: "Tier Name", type: "text", required: true },
        { key: "minRides", label: "Min Rides", type: "number" },
        { key: "prize", label: "Prize", type: "number" },
      ]}
    />
  );
}
