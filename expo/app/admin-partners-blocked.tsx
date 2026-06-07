import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersBlockedScreen() {
  return (
    <AdminPartnerList
      status="blocked"
      title="Blocked Partners"
      subtitle="Temporarily blocked from the platform"
      emptyText="No blocked partners."
    />
  );
}
