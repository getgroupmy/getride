import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesUnapprovedScreen() {
  return (
    <AdminVehicleList
      status="unapproved"
      title="Un-Approved Vehicles"
      subtitle="Awaiting your approval"
      emptyText="No vehicles are waiting for approval."
    />
  );
}
