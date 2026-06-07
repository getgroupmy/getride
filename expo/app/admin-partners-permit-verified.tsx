import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersPermitVerifiedScreen() {
  return (
    <AdminPartnerList
      status="permit-verified"
      title="Verified Permit Partners"
      subtitle="Permits successfully confirmed"
      emptyText="No verified permits yet."
    />
  );
}
