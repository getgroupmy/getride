import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesPermitVerifiedScreen() {
  return (
    <AdminVehicleList
      status="permit-verified"
      title="Verified Permit Vehicles"
      subtitle="Permits successfully confirmed"
      emptyText="No verified permits yet."
    />
  );
}
