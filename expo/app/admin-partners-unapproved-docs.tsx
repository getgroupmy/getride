import React from "react";
import AdminPartnerList from "@/components/AdminPartnerList";

export default function AdminPartnersUnapprovedDocsScreen() {
  return (
    <AdminPartnerList
      status="unapproved-docs"
      title="Un-approved Documents"
      subtitle="Pending document review"
      emptyText="No documents pending review."
    />
  );
}
