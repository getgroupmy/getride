import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersUnapprovedScreen() {
  return (
    <AdminPartnerList
      status="unapproved"
      title="Un-Approved Partners"
      subtitle="Awaiting your approval"
      emptyText="No partners are waiting for approval."
    />
  );
}
