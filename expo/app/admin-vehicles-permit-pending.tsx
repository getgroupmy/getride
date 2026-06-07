import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesPermitPendingScreen() {
  return (
    <AdminVehicleList
      status="permit-pending"
      title="Pending Permit Vehicles"
      subtitle="Permits awaiting check"
      emptyText="No permits awaiting check."
    />
  );
}
