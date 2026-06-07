import React from "react";
import { MapPinned } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsGeoFencingScreen() {
  return (
    <AdminCrudList
      storageKey="geo-fencing"
      title="Geo Fencing"
      subtitle="Define operating zones"
      Icon={MapPinned}
      primaryAction="Add Zone"
      testID="geo-fencing"
      fields={[
        { key: "name", label: "Zone Name", type: "text", required: true },
        { key: "radius", label: "Radius (km)", type: "number", required: true },
        { key: "centerLat", label: "Center Lat", type: "number" },
        { key: "centerLng", label: "Center Lng", type: "number" },
      ]}
    />
  );
}
