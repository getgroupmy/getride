import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesBlockedScreen() {
  return (
    <AdminVehicleList
      status="blocked"
      title="Blocked Vehicles"
      subtitle="Temporarily blocked from the platform"
      emptyText="No blocked vehicles."
    />
  );
}
