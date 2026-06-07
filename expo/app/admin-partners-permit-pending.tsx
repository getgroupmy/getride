import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersPermitPendingScreen() {
  return (
    <AdminPartnerList
      status="permit-pending"
      title="Pending Permit Partners"
      subtitle="Permits awaiting check"
      emptyText="No permits awaiting check."
    />
  );
}
