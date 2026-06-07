import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersUnapprovedScreen() {
  return (
    <AdminUserList
      status="unapproved"
      title="Un-Approved Users"
      subtitle="Awaiting approval"
    />
  );
}
