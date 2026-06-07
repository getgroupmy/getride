import React from "react";
import AdminVehicleList from "@/components/AdminVehicleList";

export default function AdminVehiclesPermitNonVerifiedScreen() {
  return (
    <AdminVehicleList
      status="permit-non-verified"
      title="Non-Verified Permit Vehicles"
      subtitle="Permits not yet verified"
      emptyText="No non-verified permits."
    />
  );
}
