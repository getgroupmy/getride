import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersApprovedScreen() {
  return (
    <AdminPartnerList
      status="approved"
      title="Approved Partners"
      subtitle="Active and verified partners"
    />
  );
}
