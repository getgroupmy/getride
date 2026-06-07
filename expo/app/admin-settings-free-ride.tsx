import React from "react";
import { Sparkles } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsFreeRideScreen() {
  return (
    <AdminCrudList
      storageKey="free-ride"
      title="Free Ride"
      subtitle="Free ride campaigns"
      Icon={Sparkles}
      primaryAction="Add Campaign"
      testID="free-ride"
      fields={[
        { key: "name", label: "Campaign Name", type: "text", required: true },
        { key: "limit", label: "Limit per User", type: "number" },
        { key: "maxAmount", label: "Max Amount", type: "number" },
        { key: "active", label: "Active", type: "boolean" },
      ]}
    />
  );
}
