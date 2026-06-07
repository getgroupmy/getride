import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersRejectedScreen() {
  return (
    <AdminUserList
      status="rejected"
      title="Rejected Users"
      subtitle="Application rejected"
    />
  );
}
