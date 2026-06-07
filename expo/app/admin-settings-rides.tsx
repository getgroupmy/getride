import React from "react";
import { Route } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsRidesScreen() {
  return (
    <AdminCrudList
      storageKey="rides"
      title="Rides"
      subtitle="Ride configuration"
      Icon={Route}
      primaryAction="Add Setting"
      testID="rides"
      fields={[
        { key: "name", label: "Setting Name", type: "text", required: true },
        { key: "value", label: "Value", type: "number", required: true },
        { key: "unit", label: "Unit", type: "text" },
      ]}
    />
  );
}
