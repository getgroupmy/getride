import React from "react";
import { AppWindow } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsAppVersionScreen() {
  return (
    <AdminCrudList
      storageKey="app-version-setting"
      title="App Version"
      subtitle="Force update controls"
      Icon={AppWindow}
      primaryAction="Add Version"
      testID="app-version"
      primaryDisplayKey="platform"
      secondaryDisplayKey="version"
      fields={[
        { key: "platform", label: "Platform", type: "text", required: true, placeholder: "iOS / Android" },
        { key: "version", label: "Latest Version", type: "text", required: true },
        { key: "minVersion", label: "Min Version", type: "text" },
        { key: "forceUpdate", label: "Force Update", type: "boolean" },
      ]}
    />
  );
}
