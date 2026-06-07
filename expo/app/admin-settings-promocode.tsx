import React from "react";
import { Ticket } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsPromocodeScreen() {
  return (
    <AdminCrudList
      storageKey="promocode-list"
      title="Promocode"
      subtitle="Promo code campaigns"
      Icon={Ticket}
      primaryAction="Add Promocode"
      testID="promocode"
      primaryDisplayKey="code"
      secondaryDisplayKey="description"
      fields={[
        { key: "code", label: "Code", type: "text", required: true },
        { key: "description", label: "Description", type: "text" },
        { key: "discount", label: "Discount", type: "number", required: true },
        { key: "maxUses", label: "Max Uses", type: "number" },
        { key: "active", label: "Active", type: "boolean" },
      ]}
    />
  );
}
