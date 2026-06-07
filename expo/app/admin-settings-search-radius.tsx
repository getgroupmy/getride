import React from "react";
import { Radius } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsSearchRadiusScreen() {
  return (
    <AdminCrudList
      storageKey="search-radius"
      title="Search Radius"
      subtitle="Partner search range"
      Icon={Radius}
      primaryAction="Add Tier"
      testID="search-radius"
      fields={[
        { key: "name", label: "Tier Name", type: "text", required: true },
        { key: "radius", label: "Radius (km)", type: "number", required: true },
      ]}
    />
  );
}
