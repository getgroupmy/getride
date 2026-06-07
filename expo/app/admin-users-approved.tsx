import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersApprovedScreen() {
  return (
    <AdminUserList
      status="approved"
      title="Approved Users"
      subtitle="Active and verified users"
    />
  );
}
