import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersBlockedScreen() {
  return (
    <AdminUserList
      status="blocked"
      title="Blocked Users"
      subtitle="Temporarily blocked"
    />
  );
}
