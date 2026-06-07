import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersAllScreen() {
  return (
    <AdminPartnerList
      status="all"
      title="All Partners"
      subtitle="Complete partner list"
      emptyText="No partners in the system."
    />
  );
}
