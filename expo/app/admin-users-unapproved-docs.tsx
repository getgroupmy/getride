import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersUnapprovedDocsScreen() {
  return (
    <AdminUserList
      status="unapproved-docs"
      title="Un-approved Documents"
      subtitle="Pending document review"
    />
  );
}
