/**
 * Back-office domain records.
 *
 * In the legacy app these lived inside `contexts/AdminDataContext.tsx`, which
 * meant the pure data layer (`utils/adminSync.ts`) had to import from a React
 * context just to name its own row shapes. They are plain domain types with no
 * UI involvement, so they live here instead and the context consumes them.
 */

export type PartnerStatus =
  | "approved"
  | "unapproved"
  | "blocked"
  | "rejected"
  | "unapproved-docs"
  | "permit-pending"
  | "permit-non-verified"
  | "permit-verified";

export type PermitStatus = "pending" | "non-verified" | "verified" | "none";

export type VehicleStatus = PartnerStatus;

export interface VehicleRecord {
  id: string;
  plate: string;
  make: string;
  model: string;
  year?: string;
  color?: string;
  vehicleType?: string;
  ownerName: string;
  ownerPhone: string;
  partnerId?: string;
  /** Supabase UUID of the owning partner (maps to vehicle.owner_partner_id). */
  ownerPartnerUuid?: string;
  status: VehicleStatus;
  permit: PermitStatus;
  documentsOk: boolean;
  joinedAt: string;
  serviceCountries?: string[];
  serviceStates?: string[];
  serviceCities?: string[];
}

export interface PartnerRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  ic?: string;
  vehicle: string;
  plate: string;
  vehicleType?: string;
  energyType?: string;
  make?: string;
  model?: string;
  yearFrom?: string;
  yearTo?: string;
  partnerType?: string;
  partnerTypes?: string[];
  permitNumber?: string;
  status: PartnerStatus;
  permit: PermitStatus;
  documentsOk: boolean;
  rating: number;
  totalRides: number;
  joinedAt: string;
  serviceCountries?: string[];
  serviceStates?: string[];
  serviceCities?: string[];
}

export type UserStatus =
  | "approved"
  | "unapproved"
  | "blocked"
  | "rejected"
  | "deleted"
  | "unapproved-docs";

export type IdVerifiedStatus = "verified" | "failed";

export interface UserRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  ic?: string;
  address?: string;
  profileImage?: string;
  idImage?: string;
  nationality?: string;
  gender?: "male" | "female" | "other";
  birthDate?: string;
  referralCode?: string;
  status: UserStatus;
  idVerified?: IdVerifiedStatus;
  documentsOk: boolean;
  totalRides: number;
  joinedAt: string;
}

export interface VehicleMakeModelRecord {
  id: string;
  vehicleType: string;
  energyType: string;
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  iconUri: string;
  status: boolean;
  isDefault: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The free-form key/value bag every admin-configurable setting is stored as.
 * Rows are grouped by a `category` string in `settings_entries`.
 */
export interface SettingEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, string | number | boolean>;
}

export type PartnerMode = string;

/** One selectable partner mode (TEKSI, eHailing, …) on the mode picker. */
export interface PartnerModeOption {
  id: string;
  name: string;
  description?: string;
  /** Public URL for a custom uploaded icon (partner-type-icons bucket). */
  iconUrl?: string;
}
