import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersDeletedScreen() {
  return (
    <AdminUserList
      status="deleted"
      title="Deleted Users"
      subtitle="Marked as deleted"
      emptyText="No deleted users."
    />
  );
}
