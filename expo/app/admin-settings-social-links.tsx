import React from "react";
import { Share2 } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsSocialLinksScreen() {
  return (
    <AdminCrudList
      storageKey="social-links"
      title="Social Links"
      subtitle="Manage social profiles"
      Icon={Share2}
      primaryAction="Add Link"
      testID="social-links"
      primaryDisplayKey="platform"
      secondaryDisplayKey="url"
      fields={[
        { key: "platform", label: "Platform", type: "text", required: true },
        { key: "url", label: "URL", type: "text", required: true },
      ]}
    />
  );
}
