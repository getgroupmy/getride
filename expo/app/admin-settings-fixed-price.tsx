import React from "react";
import { Tag } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsFixedPriceScreen() {
  return (
    <AdminCrudList
      storageKey="fixed-price"
      title="Fixed Price"
      subtitle="Fixed-fare routes"
      Icon={Tag}
      primaryAction="Add Route"
      testID="fixed-price"
      primaryDisplayKey="from"
      secondaryDisplayKey="to"
      fields={[
        { key: "from", label: "From", type: "text", required: true },
        { key: "to", label: "To", type: "text", required: true },
        { key: "price", label: "Price", type: "number", required: true },
      ]}
    />
  );
}
