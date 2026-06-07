import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesAllScreen() {
  return (
    <AdminVehicleList
      status="all"
      title="All Vehicles"
      subtitle="Complete vehicle list"
      emptyText="No vehicles in the system."
    />
  );
}
