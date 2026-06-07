import React from "react";
import { FileText } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsPageListScreen() {
  return (
    <AdminCrudList
      storageKey="page-list"
      title="Page List"
      subtitle="Static content pages"
      Icon={FileText}
      primaryAction="Add Page"
      testID="page-list"
      fields={[
        { key: "name", label: "Page Name", type: "text", required: true },
        { key: "slug", label: "Slug", type: "text", required: true },
        { key: "content", label: "Content", type: "text" },
      ]}
    />
  );
}
