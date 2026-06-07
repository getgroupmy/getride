import React from "react";
import { Megaphone } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsAdvertisementBannersScreen() {
  return (
    <AdminCrudList
      storageKey="advertisement-banners"
      title="Advertisement Banners"
      subtitle="In-app banner ads"
      Icon={Megaphone}
      primaryAction="Add Banner"
      testID="advertisement-banners"
      primaryDisplayKey="title"
      secondaryDisplayKey="url"
      fields={[
        { key: "title", label: "Title", type: "text", required: true },
        { key: "url", label: "Image URL", type: "text" },
        { key: "link", label: "Link", type: "text" },
        { key: "active", label: "Active", type: "boolean" },
      ]}
    />
  );
}
