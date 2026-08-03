import React from "react";
import { ClipboardList } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

/**
 * Handover checklist template for TEKSI EV deliveries.
 *
 * The Delivery Advisor works through these items on `admin-orders` and submits
 * the result onto the order; the customer then reviews and accepts them on the
 * final step of the EV wizard. Items are ordered — a handover runs top to
 * bottom — so the list is reorderable.
 */
export default function AdminSettingsEvDeliveryChecklistScreen() {
  return (
    <AdminCrudList
      storageKey="ev-delivery-checklist"
      title="Delivery Checklist"
      subtitle="Handover items advisors confirm with the customer"
      Icon={ClipboardList}
      primaryAction="Add Item"
      testID="ev-delivery-checklist"
      reorderable
      fields={[
        { key: "name", label: "Checklist Item", type: "text", required: true, placeholder: "Charging cable & adapters" },
        { key: "details", label: "Guidance", type: "text", placeholder: "What the advisor should confirm" },
        { key: "displayPriority", label: "Order", type: "number" },
      ]}
      primaryDisplayKey="name"
      secondaryDisplayKey="details"
      seedDefaults={[
        { name: "Vehicle exterior inspected", details: "No transit damage, panels aligned", displayPriority: 1 },
        { name: "Interior & upholstery checked", details: "Clean, undamaged, all trim present", displayPriority: 2 },
        { name: "Charging cable & adapters", details: "Cable, portable charger and adapters handed over", displayPriority: 3 },
        { name: "Keys handed over", details: "All key fobs accounted for", displayPriority: 4 },
        { name: "Battery state of charge", details: "Delivered at the agreed charge level", displayPriority: 5 },
        { name: "Tyres & spare/repair kit", details: "Pressures set, kit present", displayPriority: 6 },
        { name: "Registration & insurance documents", details: "JPJ registration and cover note provided", displayPriority: 7 },
        { name: "App pairing & account setup", details: "Vehicle paired to the customer's account", displayPriority: 8 },
        { name: "Warranty & service schedule explained", details: "Coverage and first service date confirmed", displayPriority: 9 },
      ]}
    />
  );
}
