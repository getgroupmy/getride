import React from "react";
import { Mail } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsEmailTemplatesScreen() {
  return (
    <AdminCrudList
      storageKey="email-templates"
      title="Email Templates"
      subtitle="Manage email content"
      Icon={Mail}
      primaryAction="Add Template"
      testID="email-templates"
      fields={[
        { key: "name", label: "Template Name", type: "text", required: true },
        { key: "subject", label: "Subject", type: "text", required: true },
        { key: "body", label: "Body", type: "text" },
      ]}
    />
  );
}
