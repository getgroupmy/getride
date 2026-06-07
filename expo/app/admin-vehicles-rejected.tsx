import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesRejectedScreen() {
  return (
    <AdminVehicleList
      status="rejected"
      title="Reject Vehicles"
      subtitle="Applications that were rejected"
      emptyText="No rejected vehicles."
    />
  );
}
