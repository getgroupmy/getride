import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesApprovedScreen() {
  return (
    <AdminVehicleList
      status="approved"
      title="Approved Vehicles"
      subtitle="Active and verified vehicles"
    />
  );
}
