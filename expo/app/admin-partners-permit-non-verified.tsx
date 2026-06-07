import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersPermitNonVerifiedScreen() {
  return (
    <AdminPartnerList
      status="permit-non-verified"
      title="Non-Verified Permit Partners"
      subtitle="Permits not yet verified"
      emptyText="No non-verified permits."
    />
  );
}
