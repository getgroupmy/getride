import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesUnapprovedDocsScreen() {
  return (
    <AdminVehicleList
      status="unapproved-docs"
      title="Un-approved Documents"
      subtitle="Pending document review"
      emptyText="No documents pending review."
    />
  );
}
