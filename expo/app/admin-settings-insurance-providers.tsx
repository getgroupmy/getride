import React from "react";
import { ShieldAlert } from "lucide-react-native";
import { useRouter } from "expo-router";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsInsuranceProvidersScreen() {
  const router = useRouter();
  return (
    <AdminCrudList
      storageKey="insurance-providers"
      title="Insurance Providers"
      subtitle="Tap a provider to manage its insurance types"
      Icon={ShieldAlert}
      primaryAction="Add Provider"
      testID="insurance-providers"
      fields={[
        { key: "name", label: "Provider Name", type: "text", required: true },
        { key: "type", label: "Category (General / Life / Takaful)", type: "text" },
        { key: "contact", label: "Contact", type: "text" },
        { key: "website", label: "Website", type: "text" },
      ]}
      onRowPress={(entry) =>
        router.push({
          pathname: "/admin-settings-insurance-types" as never,
          params: {
            providerId: entry.id,
            providerName: String(entry.values.name ?? ""),
          },
        } as never)
      }
    />
  );
}
