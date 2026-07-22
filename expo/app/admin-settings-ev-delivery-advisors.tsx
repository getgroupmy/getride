import React from "react";
import { UserCheck } from "lucide-react-native";
import AdminCrudList from "@/components/AdminCrudList";

export default function AdminSettingsEvDeliveryAdvisorsScreen() {
  return (
    <AdminCrudList
      storageKey="ev-delivery-advisors"
      title="Delivery Advisors"
      subtitle="Assign DAs to handle EV deliveries"
      Icon={UserCheck}
      primaryAction="Add Advisor"
      testID="ev-delivery-advisors"
      fields={[
        { key: "country", label: "Country", type: "text", required: true, placeholder: "Malaysia" },
        { key: "state", label: "State", type: "text", required: true, placeholder: "Selangor" },
        { key: "city", label: "City", type: "text", required: true, placeholder: "Petaling Jaya" },
        { key: "dealership", label: "Dealership Name", type: "text", required: true, placeholder: "TEKSI Centre PJ" },
        { key: "name", label: "Advisor Name", type: "text", required: true, placeholder: "Ahmad Faizal" },
        { key: "idNumber", label: "ID / Passport Number", type: "text", placeholder: "800101-10-1234" },
        { key: "contact", label: "Contact Number", type: "text", required: true, placeholder: "+60 12-345 6789" },
        { key: "email", label: "Email Address", type: "text", required: true, placeholder: "advisor@getride.app" },
        { key: "daNumber", label: "DA Number", type: "text", placeholder: "DA-0001" },
      ]}
      primaryDisplayKey="name"
      secondaryDisplayKey="dealership"
    />
  );
}
