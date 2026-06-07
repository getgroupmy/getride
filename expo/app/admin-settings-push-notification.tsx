import React from "react";
import { Bell } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsPushNotificationScreen() {
  return (
    <AdminCrudList
      storageKey="push-notification"
      title="Push Notification"
      subtitle="Send push messages"
      Icon={Bell}
      primaryAction="Add Notification"
      testID="push-notification"
      primaryDisplayKey="title"
      secondaryDisplayKey="body"
      fields={[
        { key: "title", label: "Title", type: "text", required: true },
        { key: "body", label: "Message", type: "text", required: true },
        { key: "audience", label: "Audience", type: "text", placeholder: "all / drivers / users" },
      ]}
    />
  );
}
