import React from "react";
import AdminUserList from "@/components/AdminUserList";

export default function AdminUsersAllScreen() {
  return (
    <AdminUserList
      status="all"
      title="All Users"
      subtitle="Complete user list"
      emptyText="No users in the system."
    />
  );
}
