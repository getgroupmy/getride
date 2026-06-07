import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersRejectedScreen() {
  return (
    <AdminPartnerList
      status="rejected"
      title="Reject Partners"
      subtitle="Applications that were rejected"
      emptyText="No rejected applications."
    />
  );
}
