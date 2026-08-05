import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import { isSupabaseConfigured, supabase, uuidv4 } from "@/utils/supabase";
import {
  deletePartner as sbDeletePartner,
  deleteSetting as sbDeleteSetting,
  deleteUser as sbDeleteUser,
  deleteVehicle as sbDeleteVehicle,
  deleteVehicleMakeModel as sbDeleteVehicleMakeModel,
  deleteRegion as sbDeleteRegion,
  fetchAllSettings as sbFetchAllSettings,
  OWNER_SCOPED_CATEGORIES,
  fetchRegions as sbFetchRegions,
  fetchPartners as sbFetchPartners,
  fetchUsers as sbFetchUsers,
  fetchVehicleMakeModels as sbFetchVehicleMakeModels,
  fetchVehicles as sbFetchVehicles,
  replaceCategory as sbReplaceCategory,
  upsertPartner as sbUpsertPartner,
  upsertSetting as sbUpsertSetting,
  upsertUser as sbUpsertUser,
  upsertVehicle as sbUpsertVehicle,
  upsertVehicleMakeModel as sbUpsertVehicleMakeModel,
  upsertRegion as sbUpsertRegion,
} from "@/utils/adminSync";
import type { AdminWriteResult } from "@/utils/adminSync";

const REGIONS_CATEGORY = "country-states-cities" as const;

const STORAGE_KEY = "@admin_data_v3";
const LEGACY_STORAGE_KEY = "@admin_data_v2";

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

/** @deprecated Use PartnerStatus */
export type DriverStatus = PartnerStatus;

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

/** @deprecated Use PartnerRecord */
export type DriverRecord = PartnerRecord;

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

export interface SettingEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, string | number | boolean>;
}

interface AdminData {
  partners: PartnerRecord[];
  users: UserRecord[];
  vehicles: VehicleRecord[];
  vehicleMakeModels: VehicleMakeModelRecord[];
  entries: Record<string, SettingEntry[]>;
}

interface LegacyAdminData {
  drivers?: PartnerRecord[];
  partners?: PartnerRecord[];
  users?: UserRecord[];
  vehicles?: VehicleRecord[];
  entries?: Record<string, SettingEntry[]>;
}

const SEED_VEHICLES: VehicleRecord[] = [
  { id: "VH-3001", plate: "WPK 1234", make: "Perodua", model: "Bezza", year: "2022", color: "White", vehicleType: "Sedan", ownerName: "Ahmad Faizal", ownerPhone: "+60 12-345 6781", partnerId: "DR-1001", status: "approved", permit: "verified", documentsOk: true, joinedAt: "2023-01-12" },
  { id: "VH-3002", plate: "VBA 8821", make: "Honda", model: "City", year: "2021", color: "Silver", vehicleType: "Sedan", ownerName: "Siti Nurhaliza", ownerPhone: "+60 13-887 1102", partnerId: "DR-1002", status: "approved", permit: "verified", documentsOk: true, joinedAt: "2023-04-18" },
  { id: "VH-3003", plate: "JKL 5512", make: "Toyota", model: "Vios", year: "2023", color: "Red", vehicleType: "Sedan", ownerName: "Rajesh Kumar", ownerPhone: "+60 11-220 9911", partnerId: "DR-1003", status: "unapproved", permit: "pending", documentsOk: true, joinedAt: "2026-04-22" },
  { id: "VH-3004", plate: "PMR 7733", make: "Proton", model: "Saga", year: "2020", color: "Black", vehicleType: "Sedan", ownerName: "Lim Wei Jie", ownerPhone: "+60 16-554 1188", partnerId: "DR-1004", status: "unapproved", permit: "pending", documentsOk: false, joinedAt: "2026-04-28" },
  { id: "VH-3005", plate: "WXR 4421", make: "Perodua", model: "Myvi", year: "2019", color: "Blue", vehicleType: "Hatchback", ownerName: "Nor Aisyah", ownerPhone: "+60 19-220 7741", partnerId: "DR-1005", status: "blocked", permit: "verified", documentsOk: true, joinedAt: "2024-06-04" },
  { id: "VH-3006", plate: "BNN 1245", make: "Toyota", model: "Avanza", year: "2018", color: "Grey", vehicleType: "MPV", ownerName: "Chong Kar Mun", ownerPhone: "+60 12-991 4422", partnerId: "DR-1006", status: "rejected", permit: "non-verified", documentsOk: false, joinedAt: "2026-03-08" },
  { id: "VH-3007", plate: "WTK 2210", make: "Hyundai", model: "Starex", year: "2017", color: "White", vehicleType: "Van", ownerName: "Hafiz Rahman", ownerPhone: "+60 17-882 3320", partnerId: "DR-1007", status: "unapproved-docs", permit: "non-verified", documentsOk: false, joinedAt: "2026-04-30" },
  { id: "VH-3008", plate: "JTH 9912", make: "Perodua", model: "Axia", year: "2022", color: "Yellow", vehicleType: "Hatchback", ownerName: "Tan Mei Ling", ownerPhone: "+60 18-554 0091", partnerId: "DR-1008", status: "permit-pending", permit: "pending", documentsOk: true, joinedAt: "2025-12-11" },
  { id: "VH-3009", plate: "WJK 4421", make: "Proton", model: "X50", year: "2023", color: "Black", vehicleType: "SUV", ownerName: "Kasim Ali", ownerPhone: "+60 11-441 8821", partnerId: "DR-1009", status: "permit-non-verified", permit: "non-verified", documentsOk: true, joinedAt: "2025-10-02" },
  { id: "VH-3010", plate: "BPK 5520", make: "Honda", model: "BRV", year: "2021", color: "Silver", vehicleType: "SUV", ownerName: "Vincent Ng", ownerPhone: "+60 12-887 0021", partnerId: "DR-1010", status: "permit-verified", permit: "verified", documentsOk: true, joinedAt: "2022-09-15" },
  { id: "VH-3011", plate: "PHK 8814", make: "Perodua", model: "Bezza", year: "2024", color: "White", vehicleType: "Sedan", ownerName: "Farah Diana", ownerPhone: "+60 19-002 7733", partnerId: "DR-1011", status: "approved", permit: "verified", documentsOk: true, joinedAt: "2024-02-22" },
  { id: "VH-3012", plate: "WMM 1102", make: "Toyota", model: "Camry", year: "2020", color: "Black", vehicleType: "Sedan", ownerName: "Daniel Lee", ownerPhone: "+60 16-110 5577", partnerId: "DR-1012", status: "blocked", permit: "verified", documentsOk: true, joinedAt: "2024-08-19" },
  { id: "VH-3013", plate: "VCC 4490", make: "Nissan", model: "Almera", year: "2023", color: "Silver", vehicleType: "Sedan", ownerName: "Zainab Ismail", ownerPhone: "+60 13-557 8821", partnerId: "DR-1013", status: "permit-verified", permit: "verified", documentsOk: true, joinedAt: "2023-07-01" },
  { id: "VH-3014", plate: "JLP 2233", make: "Perodua", model: "Aruz", year: "2022", color: "Bronze", vehicleType: "SUV", ownerName: "Param Singh", ownerPhone: "+60 11-330 7798", partnerId: "DR-1014", status: "permit-pending", permit: "pending", documentsOk: false, joinedAt: "2025-11-25" },
];

const SEED_PARTNERS: PartnerRecord[] = [
  { id: "DR-1001", name: "Ahmad Faizal", phone: "+60 12-345 6781", vehicle: "Perodua Bezza", plate: "WPK 1234", status: "approved", permit: "verified", documentsOk: true, rating: 4.9, totalRides: 1284, joinedAt: "2023-01-12" },
  { id: "DR-1002", name: "Siti Nurhaliza", phone: "+60 13-887 1102", vehicle: "Honda City", plate: "VBA 8821", status: "approved", permit: "verified", documentsOk: true, rating: 4.8, totalRides: 942, joinedAt: "2023-04-18" },
  { id: "DR-1003", name: "Rajesh Kumar", phone: "+60 11-220 9911", vehicle: "Toyota Vios", plate: "JKL 5512", status: "unapproved", permit: "pending", documentsOk: true, rating: 0, totalRides: 0, joinedAt: "2026-04-22" },
  { id: "DR-1004", name: "Lim Wei Jie", phone: "+60 16-554 1188", vehicle: "Proton Saga", plate: "PMR 7733", status: "unapproved", permit: "pending", documentsOk: false, rating: 0, totalRides: 0, joinedAt: "2026-04-28" },
  { id: "DR-1005", name: "Nor Aisyah", phone: "+60 19-220 7741", vehicle: "Perodua Myvi", plate: "WXR 4421", status: "blocked", permit: "verified", documentsOk: true, rating: 4.2, totalRides: 388, joinedAt: "2024-06-04" },
  { id: "DR-1006", name: "Chong Kar Mun", phone: "+60 12-991 4422", vehicle: "Toyota Avanza", plate: "BNN 1245", status: "rejected", permit: "non-verified", documentsOk: false, rating: 0, totalRides: 0, joinedAt: "2026-03-08" },
  { id: "DR-1007", name: "Hafiz Rahman", phone: "+60 17-882 3320", vehicle: "Hyundai Starex", plate: "WTK 2210", status: "unapproved-docs", permit: "non-verified", documentsOk: false, rating: 0, totalRides: 0, joinedAt: "2026-04-30" },
  { id: "DR-1008", name: "Tan Mei Ling", phone: "+60 18-554 0091", vehicle: "Perodua Axia", plate: "JTH 9912", status: "permit-pending", permit: "pending", documentsOk: true, rating: 4.6, totalRides: 121, joinedAt: "2025-12-11" },
  { id: "DR-1009", name: "Kasim Ali", phone: "+60 11-441 8821", vehicle: "Proton X50", plate: "WJK 4421", status: "permit-non-verified", permit: "non-verified", documentsOk: true, rating: 4.4, totalRides: 56, joinedAt: "2025-10-02" },
  { id: "DR-1010", name: "Vincent Ng", phone: "+60 12-887 0021", vehicle: "Honda BRV", plate: "BPK 5520", status: "permit-verified", permit: "verified", documentsOk: true, rating: 4.95, totalRides: 2210, joinedAt: "2022-09-15" },
  { id: "DR-1011", name: "Farah Diana", phone: "+60 19-002 7733", vehicle: "Perodua Bezza", plate: "PHK 8814", status: "approved", permit: "verified", documentsOk: true, rating: 4.85, totalRides: 752, joinedAt: "2024-02-22" },
  { id: "DR-1012", name: "Daniel Lee", phone: "+60 16-110 5577", vehicle: "Toyota Camry", plate: "WMM 1102", status: "blocked", permit: "verified", documentsOk: true, rating: 3.8, totalRides: 211, joinedAt: "2024-08-19" },
  { id: "DR-1013", name: "Zainab Ismail", phone: "+60 13-557 8821", vehicle: "Nissan Almera", plate: "VCC 4490", status: "permit-verified", permit: "verified", documentsOk: true, rating: 4.7, totalRides: 1480, joinedAt: "2023-07-01" },
  { id: "DR-1014", name: "Param Singh", phone: "+60 11-330 7798", vehicle: "Perodua Aruz", plate: "JLP 2233", status: "permit-pending", permit: "pending", documentsOk: false, rating: 4.1, totalRides: 88, joinedAt: "2025-11-25" },
];

const SEED_USERS: UserRecord[] = [
  { id: "US-2001", name: "Aisyah Rahman", phone: "+60 12-100 2233", email: "aisyah@example.com", status: "approved", documentsOk: true, totalRides: 142, joinedAt: "2024-02-10" },
  { id: "US-2002", name: "Marcus Tan", phone: "+60 13-554 9921", email: "marcus.tan@example.com", status: "approved", documentsOk: true, totalRides: 88, joinedAt: "2024-08-22" },
  { id: "US-2003", name: "Priya Devi", phone: "+60 11-220 7711", email: "priya.d@example.com", status: "unapproved", documentsOk: true, totalRides: 0, joinedAt: "2026-04-26" },
  { id: "US-2004", name: "Hakim Yusof", phone: "+60 16-887 1102", email: "hakim@example.com", status: "unapproved", documentsOk: false, totalRides: 0, joinedAt: "2026-04-29" },
  { id: "US-2005", name: "Joanne Lim", phone: "+60 19-220 4421", email: "joanne@example.com", status: "blocked", documentsOk: true, totalRides: 56, joinedAt: "2024-11-04" },
  { id: "US-2006", name: "Devraj Singh", phone: "+60 12-991 7733", email: "devraj@example.com", status: "rejected", documentsOk: false, totalRides: 0, joinedAt: "2026-03-12" },
  { id: "US-2007", name: "Nur Iman", phone: "+60 17-882 4420", email: "iman@example.com", status: "unapproved-docs", documentsOk: false, totalRides: 0, joinedAt: "2026-04-30" },
  { id: "US-2008", name: "Ethan Wong", phone: "+60 18-554 8821", email: "ethan@example.com", status: "approved", documentsOk: true, totalRides: 312, joinedAt: "2023-05-18" },
  { id: "US-2009", name: "Sarah Khan", phone: "+60 11-441 6612", email: "sarah.k@example.com", status: "approved", documentsOk: true, totalRides: 67, joinedAt: "2025-01-14" },
  { id: "US-2010", name: "Brandon Lee", phone: "+60 12-887 0021", email: "brandon@example.com", status: "blocked", documentsOk: true, totalRides: 22, joinedAt: "2025-07-11" },
];

const now = () => new Date().toISOString();

const seedEntry = (values: Record<string, string | number | boolean>): SettingEntry => ({
  id: `E-${Math.random().toString(36).slice(2, 9)}`,
  createdAt: now(),
  updatedAt: now(),
  values,
});

const SEED_ENTRIES: Record<string, SettingEntry[]> = {
  // partner-type defaults live in Supabase (see supabase/seed.sql and
  // migration 0011_partner_type_defaults.sql). They are tagged isDefault=true
  // so the admin UI prevents deletion. Do NOT seed them from the app.
  "vehicle-type": [
    seedEntry({ name: "Sedan", capacity: 4, baseFare: 5 }),
    seedEntry({ name: "SUV", capacity: 6, baseFare: 8 }),
    seedEntry({ name: "MPV", capacity: 7, baseFare: 9 }),
  ],
  "required-documents": [
    seedEntry({ name: "Driving License", required: true }),
    seedEntry({ name: "Vehicle Insurance", required: true }),
    seedEntry({ name: "PSV Permit", required: false }),
  ],
  "service-settings": [
    seedEntry({ name: "Car", description: "Standard car service", iconUri: "", displayPriority: 1, active: true, isDefault: true }),
    seedEntry({ name: "Bike", description: "Motorbike service", iconUri: "", displayPriority: 2, active: true, isDefault: true }),
    seedEntry({ name: "Auto", description: "Auto rickshaw service", iconUri: "", displayPriority: 3, active: true, isDefault: true }),
    seedEntry({ name: "Delivery", description: "Parcel & courier delivery", iconUri: "", displayPriority: 4, active: true, isDefault: true }),
    seedEntry({ name: "Food", description: "Food ordering & delivery", iconUri: "", displayPriority: 5, active: true, isDefault: true }),
    seedEntry({ name: "Mart", description: "Grocery & mart delivery", iconUri: "", displayPriority: 6, active: true, isDefault: true }),
  ],
  "vehicle-services": [
    seedEntry({
      name: "Ride",
      description: "Here you offer your price and choose the driver by yourself. Save money and travel with comfort!",
      heroImageUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/35o4qbizzq6n6k49op0mv",
      iconUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/35o4qbizzq6n6k49op0mv",
      maxPax: 4,
      displayPriority: 1,
      status: true,
    }),
    seedEntry({
      name: "Comfort",
      description: "Premium vehicles with experienced drivers. Enjoy extra legroom and a smoother ride.",
      heroImageUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/c8ck0gnn45nc8rhbbnegp",
      iconUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/c8ck0gnn45nc8rhbbnegp",
      maxPax: 4,
      displayPriority: 2,
      status: true,
    }),
    seedEntry({
      name: "6-seater",
      description: "Perfect for groups and families. Spacious vehicles that fit up to 6 passengers comfortably.",
      heroImageUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/hd401jwvfmsjl8b9h440e",
      iconUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/hd401jwvfmsjl8b9h440e",
      maxPax: 6,
      displayPriority: 3,
      status: true,
    }),
    seedEntry({
      name: "Premium",
      description: "Luxury vehicles for special occasions. Travel in style with top-tier comfort and elegance.",
      heroImageUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3xa9mgdbyyt7ztpzvdlw9",
      iconUri: "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/3xa9mgdbyyt7ztpzvdlw9",
      maxPax: 4,
      displayPriority: 4,
      status: true,
    }),
  ],
  "site-settings": [
    seedEntry({ name: "App Name", value: "GET.ride" }),
    seedEntry({ name: "Support Email", value: "support@getride.app" }),
  ],
  "referral-settings": [
    seedEntry({ name: "User Referral", reward: 10 }),
    seedEntry({ name: "Driver Referral", reward: 25 }),
  ],
  "referral-tree": [
    seedEntry({ name: "Level 1", percentage: 10 }),
    seedEntry({ name: "Level 2", percentage: 5 }),
  ],
  "sub-admin": [
    seedEntry({ name: "Operations", email: "ops@getride.app", role: "Manager" }),
  ],
  "geo-fencing": [
    seedEntry({ name: "KL Central", radius: 5 }),
  ],
  "multi-gate-places": [
    seedEntry({ name: "KLCC", gates: 4 }),
  ],
  "airport-areas": [
    // Malaysia
    seedEntry({ name: "Kuala Lumpur International Airport", code: "KUL", country: "Malaysia", state: "Selangor", city: "Sepang" }),
    seedEntry({ name: "Sultan Abdul Aziz Shah Airport (Subang)", code: "SZB", country: "Malaysia", state: "Selangor", city: "Subang" }),
    seedEntry({ name: "Penang International Airport", code: "PEN", country: "Malaysia", state: "Penang", city: "Bayan Lepas" }),
    seedEntry({ name: "Langkawi International Airport", code: "LGK", country: "Malaysia", state: "Kedah", city: "Langkawi" }),
    seedEntry({ name: "Kota Kinabalu International Airport", code: "BKI", country: "Malaysia", state: "Sabah", city: "Kota Kinabalu" }),
    seedEntry({ name: "Kuching International Airport", code: "KCH", country: "Malaysia", state: "Sarawak", city: "Kuching" }),
    seedEntry({ name: "Senai International Airport", code: "JHB", country: "Malaysia", state: "Johor", city: "Senai" }),
    seedEntry({ name: "Sultan Ismail Petra Airport", code: "KBR", country: "Malaysia", state: "Kelantan", city: "Kota Bharu" }),
    seedEntry({ name: "Sultan Mahmud Airport", code: "TGG", country: "Malaysia", state: "Terengganu", city: "Kuala Terengganu" }),
    seedEntry({ name: "Sultan Ahmad Shah Airport", code: "KUA", country: "Malaysia", state: "Pahang", city: "Kuantan" }),
    seedEntry({ name: "Ipoh Sultan Azlan Shah Airport", code: "IPH", country: "Malaysia", state: "Perak", city: "Ipoh" }),
    seedEntry({ name: "Melaka International Airport", code: "MKZ", country: "Malaysia", state: "Malacca", city: "Batu Berendam" }),
    seedEntry({ name: "Bintulu Airport", code: "BTU", country: "Malaysia", state: "Sarawak", city: "Bintulu" }),
    seedEntry({ name: "Miri Airport", code: "MYY", country: "Malaysia", state: "Sarawak", city: "Miri" }),
    seedEntry({ name: "Sibu Airport", code: "SBW", country: "Malaysia", state: "Sarawak", city: "Sibu" }),
    seedEntry({ name: "Sandakan Airport", code: "SDK", country: "Malaysia", state: "Sabah", city: "Sandakan" }),
    seedEntry({ name: "Tawau Airport", code: "TWU", country: "Malaysia", state: "Sabah", city: "Tawau" }),
    // Singapore
    seedEntry({ name: "Singapore Changi Airport", code: "SIN", country: "Singapore", state: "Singapore", city: "Changi" }),
    seedEntry({ name: "Seletar Airport", code: "XSP", country: "Singapore", state: "Singapore", city: "Seletar" }),
    // Thailand
    seedEntry({ name: "Suvarnabhumi Airport", code: "BKK", country: "Thailand", state: "Samut Prakan", city: "Bangkok" }),
    seedEntry({ name: "Don Mueang International Airport", code: "DMK", country: "Thailand", state: "Bangkok", city: "Bangkok" }),
    seedEntry({ name: "Phuket International Airport", code: "HKT", country: "Thailand", state: "Phuket", city: "Phuket" }),
    seedEntry({ name: "Chiang Mai International Airport", code: "CNX", country: "Thailand", state: "Chiang Mai", city: "Chiang Mai" }),
    seedEntry({ name: "Krabi International Airport", code: "KBV", country: "Thailand", state: "Krabi", city: "Krabi" }),
    seedEntry({ name: "Hat Yai International Airport", code: "HDY", country: "Thailand", state: "Songkhla", city: "Hat Yai" }),
    // Indonesia
    seedEntry({ name: "Soekarno-Hatta International Airport", code: "CGK", country: "Indonesia", state: "Banten", city: "Tangerang" }),
    seedEntry({ name: "Halim Perdanakusuma Airport", code: "HLP", country: "Indonesia", state: "Jakarta", city: "Jakarta" }),
    seedEntry({ name: "Ngurah Rai International Airport", code: "DPS", country: "Indonesia", state: "Bali", city: "Denpasar" }),
    seedEntry({ name: "Juanda International Airport", code: "SUB", country: "Indonesia", state: "East Java", city: "Surabaya" }),
    seedEntry({ name: "Kualanamu International Airport", code: "KNO", country: "Indonesia", state: "North Sumatra", city: "Medan" }),
    seedEntry({ name: "Yogyakarta International Airport", code: "YIA", country: "Indonesia", state: "Yogyakarta", city: "Kulon Progo" }),
    // Philippines
    seedEntry({ name: "Ninoy Aquino International Airport", code: "MNL", country: "Philippines", state: "Metro Manila", city: "Manila" }),
    seedEntry({ name: "Mactan-Cebu International Airport", code: "CEB", country: "Philippines", state: "Cebu", city: "Lapu-Lapu" }),
    seedEntry({ name: "Clark International Airport", code: "CRK", country: "Philippines", state: "Pampanga", city: "Angeles" }),
    seedEntry({ name: "Davao International Airport", code: "DVO", country: "Philippines", state: "Davao del Sur", city: "Davao" }),
    // Vietnam
    seedEntry({ name: "Tan Son Nhat International Airport", code: "SGN", country: "Vietnam", state: "Ho Chi Minh", city: "Ho Chi Minh City" }),
    seedEntry({ name: "Noi Bai International Airport", code: "HAN", country: "Vietnam", state: "Hanoi", city: "Hanoi" }),
    seedEntry({ name: "Da Nang International Airport", code: "DAD", country: "Vietnam", state: "Da Nang", city: "Da Nang" }),
    seedEntry({ name: "Cam Ranh International Airport", code: "CXR", country: "Vietnam", state: "Khanh Hoa", city: "Nha Trang" }),
    // Cambodia / Laos / Myanmar / Brunei
    seedEntry({ name: "Phnom Penh International Airport", code: "PNH", country: "Cambodia", state: "Phnom Penh", city: "Phnom Penh" }),
    seedEntry({ name: "Siem Reap-Angkor International", code: "SAI", country: "Cambodia", state: "Siem Reap", city: "Siem Reap" }),
    seedEntry({ name: "Wattay International Airport", code: "VTE", country: "Laos", state: "Vientiane", city: "Vientiane" }),
    seedEntry({ name: "Yangon International Airport", code: "RGN", country: "Myanmar", state: "Yangon", city: "Yangon" }),
    seedEntry({ name: "Brunei International Airport", code: "BWN", country: "Brunei", state: "Brunei-Muara", city: "Bandar Seri Begawan" }),
    // China
    seedEntry({ name: "Beijing Capital International", code: "PEK", country: "China", state: "Beijing", city: "Beijing" }),
    seedEntry({ name: "Beijing Daxing International", code: "PKX", country: "China", state: "Beijing", city: "Beijing" }),
    seedEntry({ name: "Shanghai Pudong International", code: "PVG", country: "China", state: "Shanghai", city: "Shanghai" }),
    seedEntry({ name: "Shanghai Hongqiao International", code: "SHA", country: "China", state: "Shanghai", city: "Shanghai" }),
    seedEntry({ name: "Guangzhou Baiyun International", code: "CAN", country: "China", state: "Guangdong", city: "Guangzhou" }),
    seedEntry({ name: "Shenzhen Bao'an International", code: "SZX", country: "China", state: "Guangdong", city: "Shenzhen" }),
    seedEntry({ name: "Hong Kong International Airport", code: "HKG", country: "Hong Kong", state: "Hong Kong", city: "Chek Lap Kok" }),
    seedEntry({ name: "Macau International Airport", code: "MFM", country: "Macau", state: "Macau", city: "Taipa" }),
    seedEntry({ name: "Taiwan Taoyuan International", code: "TPE", country: "Taiwan", state: "Taoyuan", city: "Taoyuan" }),
    seedEntry({ name: "Taipei Songshan Airport", code: "TSA", country: "Taiwan", state: "Taipei", city: "Taipei" }),
    // Japan / Korea
    seedEntry({ name: "Tokyo Haneda Airport", code: "HND", country: "Japan", state: "Tokyo", city: "Tokyo" }),
    seedEntry({ name: "Tokyo Narita International", code: "NRT", country: "Japan", state: "Chiba", city: "Narita" }),
    seedEntry({ name: "Kansai International Airport", code: "KIX", country: "Japan", state: "Osaka", city: "Osaka" }),
    seedEntry({ name: "Chubu Centrair International", code: "NGO", country: "Japan", state: "Aichi", city: "Tokoname" }),
    seedEntry({ name: "New Chitose Airport", code: "CTS", country: "Japan", state: "Hokkaido", city: "Sapporo" }),
    seedEntry({ name: "Fukuoka Airport", code: "FUK", country: "Japan", state: "Fukuoka", city: "Fukuoka" }),
    seedEntry({ name: "Incheon International Airport", code: "ICN", country: "South Korea", state: "Incheon", city: "Incheon" }),
    seedEntry({ name: "Gimpo International Airport", code: "GMP", country: "South Korea", state: "Seoul", city: "Seoul" }),
    seedEntry({ name: "Jeju International Airport", code: "CJU", country: "South Korea", state: "Jeju", city: "Jeju" }),
    // South Asia
    seedEntry({ name: "Indira Gandhi International", code: "DEL", country: "India", state: "Delhi", city: "New Delhi" }),
    seedEntry({ name: "Chhatrapati Shivaji Maharaj International", code: "BOM", country: "India", state: "Maharashtra", city: "Mumbai" }),
    seedEntry({ name: "Kempegowda International", code: "BLR", country: "India", state: "Karnataka", city: "Bangalore" }),
    seedEntry({ name: "Chennai International Airport", code: "MAA", country: "India", state: "Tamil Nadu", city: "Chennai" }),
    seedEntry({ name: "Rajiv Gandhi International", code: "HYD", country: "India", state: "Telangana", city: "Hyderabad" }),
    seedEntry({ name: "Netaji Subhas Chandra Bose Intl", code: "CCU", country: "India", state: "West Bengal", city: "Kolkata" }),
    seedEntry({ name: "Cochin International Airport", code: "COK", country: "India", state: "Kerala", city: "Kochi" }),
    seedEntry({ name: "Bandaranaike International", code: "CMB", country: "Sri Lanka", state: "Western", city: "Colombo" }),
    seedEntry({ name: "Hazrat Shahjalal International", code: "DAC", country: "Bangladesh", state: "Dhaka", city: "Dhaka" }),
    seedEntry({ name: "Tribhuvan International Airport", code: "KTM", country: "Nepal", state: "Bagmati", city: "Kathmandu" }),
    seedEntry({ name: "Velana International Airport", code: "MLE", country: "Maldives", state: "Male", city: "Hulhule" }),
    // Middle East
    seedEntry({ name: "Dubai International Airport", code: "DXB", country: "UAE", state: "Dubai", city: "Dubai" }),
    seedEntry({ name: "Al Maktoum International", code: "DWC", country: "UAE", state: "Dubai", city: "Dubai" }),
    seedEntry({ name: "Abu Dhabi International Airport", code: "AUH", country: "UAE", state: "Abu Dhabi", city: "Abu Dhabi" }),
    seedEntry({ name: "Hamad International Airport", code: "DOH", country: "Qatar", state: "Doha", city: "Doha" }),
    seedEntry({ name: "King Abdulaziz International", code: "JED", country: "Saudi Arabia", state: "Mecca", city: "Jeddah" }),
    seedEntry({ name: "King Khalid International", code: "RUH", country: "Saudi Arabia", state: "Riyadh", city: "Riyadh" }),
    seedEntry({ name: "Kuwait International Airport", code: "KWI", country: "Kuwait", state: "Farwaniyah", city: "Kuwait City" }),
    seedEntry({ name: "Bahrain International Airport", code: "BAH", country: "Bahrain", state: "Muharraq", city: "Muharraq" }),
    seedEntry({ name: "Muscat International Airport", code: "MCT", country: "Oman", state: "Muscat", city: "Muscat" }),
    seedEntry({ name: "Istanbul Airport", code: "IST", country: "Turkey", state: "Istanbul", city: "Istanbul" }),
    seedEntry({ name: "Sabiha Gokcen International", code: "SAW", country: "Turkey", state: "Istanbul", city: "Istanbul" }),
    // Europe
    seedEntry({ name: "London Heathrow Airport", code: "LHR", country: "United Kingdom", state: "England", city: "London" }),
    seedEntry({ name: "London Gatwick Airport", code: "LGW", country: "United Kingdom", state: "England", city: "London" }),
    seedEntry({ name: "London Stansted Airport", code: "STN", country: "United Kingdom", state: "England", city: "London" }),
    seedEntry({ name: "Manchester Airport", code: "MAN", country: "United Kingdom", state: "England", city: "Manchester" }),
    seedEntry({ name: "Edinburgh Airport", code: "EDI", country: "United Kingdom", state: "Scotland", city: "Edinburgh" }),
    seedEntry({ name: "Charles de Gaulle Airport", code: "CDG", country: "France", state: "Ile-de-France", city: "Paris" }),
    seedEntry({ name: "Orly Airport", code: "ORY", country: "France", state: "Ile-de-France", city: "Paris" }),
    seedEntry({ name: "Nice Cote d'Azur Airport", code: "NCE", country: "France", state: "PACA", city: "Nice" }),
    seedEntry({ name: "Frankfurt Airport", code: "FRA", country: "Germany", state: "Hesse", city: "Frankfurt" }),
    seedEntry({ name: "Munich Airport", code: "MUC", country: "Germany", state: "Bavaria", city: "Munich" }),
    seedEntry({ name: "Berlin Brandenburg Airport", code: "BER", country: "Germany", state: "Brandenburg", city: "Berlin" }),
    seedEntry({ name: "Amsterdam Schiphol Airport", code: "AMS", country: "Netherlands", state: "North Holland", city: "Amsterdam" }),
    seedEntry({ name: "Madrid Barajas Airport", code: "MAD", country: "Spain", state: "Madrid", city: "Madrid" }),
    seedEntry({ name: "Barcelona-El Prat Airport", code: "BCN", country: "Spain", state: "Catalonia", city: "Barcelona" }),
    seedEntry({ name: "Leonardo da Vinci-Fiumicino", code: "FCO", country: "Italy", state: "Lazio", city: "Rome" }),
    seedEntry({ name: "Milan Malpensa Airport", code: "MXP", country: "Italy", state: "Lombardy", city: "Milan" }),
    seedEntry({ name: "Zurich Airport", code: "ZRH", country: "Switzerland", state: "Zurich", city: "Zurich" }),
    seedEntry({ name: "Vienna International Airport", code: "VIE", country: "Austria", state: "Lower Austria", city: "Schwechat" }),
    seedEntry({ name: "Brussels Airport", code: "BRU", country: "Belgium", state: "Flemish Brabant", city: "Zaventem" }),
    seedEntry({ name: "Copenhagen Airport", code: "CPH", country: "Denmark", state: "Capital Region", city: "Copenhagen" }),
    seedEntry({ name: "Stockholm Arlanda Airport", code: "ARN", country: "Sweden", state: "Stockholm", city: "Stockholm" }),
    seedEntry({ name: "Oslo Airport", code: "OSL", country: "Norway", state: "Viken", city: "Gardermoen" }),
    seedEntry({ name: "Helsinki-Vantaa Airport", code: "HEL", country: "Finland", state: "Uusimaa", city: "Vantaa" }),
    seedEntry({ name: "Lisbon Humberto Delgado", code: "LIS", country: "Portugal", state: "Lisbon", city: "Lisbon" }),
    seedEntry({ name: "Athens International Airport", code: "ATH", country: "Greece", state: "Attica", city: "Athens" }),
    seedEntry({ name: "Sheremetyevo International", code: "SVO", country: "Russia", state: "Moscow Oblast", city: "Moscow" }),
    // Americas
    seedEntry({ name: "John F. Kennedy International", code: "JFK", country: "United States", state: "New York", city: "New York" }),
    seedEntry({ name: "LaGuardia Airport", code: "LGA", country: "United States", state: "New York", city: "New York" }),
    seedEntry({ name: "Newark Liberty International", code: "EWR", country: "United States", state: "New Jersey", city: "Newark" }),
    seedEntry({ name: "Los Angeles International", code: "LAX", country: "United States", state: "California", city: "Los Angeles" }),
    seedEntry({ name: "San Francisco International", code: "SFO", country: "United States", state: "California", city: "San Francisco" }),
    seedEntry({ name: "O'Hare International Airport", code: "ORD", country: "United States", state: "Illinois", city: "Chicago" }),
    seedEntry({ name: "Hartsfield-Jackson Atlanta", code: "ATL", country: "United States", state: "Georgia", city: "Atlanta" }),
    seedEntry({ name: "Dallas/Fort Worth International", code: "DFW", country: "United States", state: "Texas", city: "Dallas" }),
    seedEntry({ name: "Miami International Airport", code: "MIA", country: "United States", state: "Florida", city: "Miami" }),
    seedEntry({ name: "Seattle-Tacoma International", code: "SEA", country: "United States", state: "Washington", city: "Seattle" }),
    seedEntry({ name: "Boston Logan International", code: "BOS", country: "United States", state: "Massachusetts", city: "Boston" }),
    seedEntry({ name: "Toronto Pearson International", code: "YYZ", country: "Canada", state: "Ontario", city: "Toronto" }),
    seedEntry({ name: "Vancouver International Airport", code: "YVR", country: "Canada", state: "British Columbia", city: "Richmond" }),
    seedEntry({ name: "Montreal-Trudeau International", code: "YUL", country: "Canada", state: "Quebec", city: "Montreal" }),
    seedEntry({ name: "Mexico City International", code: "MEX", country: "Mexico", state: "Mexico City", city: "Mexico City" }),
    seedEntry({ name: "Cancun International Airport", code: "CUN", country: "Mexico", state: "Quintana Roo", city: "Cancun" }),
    seedEntry({ name: "Sao Paulo Guarulhos International", code: "GRU", country: "Brazil", state: "Sao Paulo", city: "Guarulhos" }),
    seedEntry({ name: "Rio de Janeiro Galeao", code: "GIG", country: "Brazil", state: "Rio de Janeiro", city: "Rio de Janeiro" }),
    seedEntry({ name: "Ministro Pistarini International", code: "EZE", country: "Argentina", state: "Buenos Aires", city: "Ezeiza" }),
    // Oceania
    seedEntry({ name: "Sydney Kingsford Smith Airport", code: "SYD", country: "Australia", state: "New South Wales", city: "Sydney" }),
    seedEntry({ name: "Melbourne Airport", code: "MEL", country: "Australia", state: "Victoria", city: "Melbourne" }),
    seedEntry({ name: "Brisbane Airport", code: "BNE", country: "Australia", state: "Queensland", city: "Brisbane" }),
    seedEntry({ name: "Perth Airport", code: "PER", country: "Australia", state: "Western Australia", city: "Perth" }),
    seedEntry({ name: "Adelaide Airport", code: "ADL", country: "Australia", state: "South Australia", city: "Adelaide" }),
    seedEntry({ name: "Auckland Airport", code: "AKL", country: "New Zealand", state: "Auckland", city: "Auckland" }),
    seedEntry({ name: "Wellington International Airport", code: "WLG", country: "New Zealand", state: "Wellington", city: "Wellington" }),
    seedEntry({ name: "Christchurch International Airport", code: "CHC", country: "New Zealand", state: "Canterbury", city: "Christchurch" }),
    // Africa
    seedEntry({ name: "OR Tambo International Airport", code: "JNB", country: "South Africa", state: "Gauteng", city: "Johannesburg" }),
    seedEntry({ name: "Cape Town International Airport", code: "CPT", country: "South Africa", state: "Western Cape", city: "Cape Town" }),
    seedEntry({ name: "Cairo International Airport", code: "CAI", country: "Egypt", state: "Cairo", city: "Cairo" }),
    seedEntry({ name: "Mohammed V International", code: "CMN", country: "Morocco", state: "Casablanca-Settat", city: "Casablanca" }),
    seedEntry({ name: "Jomo Kenyatta International", code: "NBO", country: "Kenya", state: "Nairobi", city: "Nairobi" }),
    seedEntry({ name: "Murtala Muhammed International", code: "LOS", country: "Nigeria", state: "Lagos", city: "Lagos" }),
    seedEntry({ name: "Addis Ababa Bole International", code: "ADD", country: "Ethiopia", state: "Addis Ababa", city: "Addis Ababa" }),
  ],
  // Country / state / city / suburb data lives in Supabase only
  // (tables: countries, states, cities, suburbs — see migrations 0016
  // and 0017). The app never seeds region data into AsyncStorage.
  "country-states-cities": [],
  "country-states-cities-legacy-removed__disabled": [
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Petaling Jaya" }),
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Shah Alam" }),
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Subang Jaya" }),
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Klang" }),
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Kajang" }),
    seedEntry({ country: "Malaysia", state: "Selangor", city: "Sepang" }),
    seedEntry({ country: "Malaysia", state: "Kuala Lumpur", city: "Kuala Lumpur" }),
    seedEntry({ country: "Malaysia", state: "Kuala Lumpur", city: "Cheras" }),
    seedEntry({ country: "Malaysia", state: "Kuala Lumpur", city: "Setapak" }),
    seedEntry({ country: "Malaysia", state: "Putrajaya", city: "Putrajaya" }),
    seedEntry({ country: "Malaysia", state: "Penang", city: "George Town" }),
    seedEntry({ country: "Malaysia", state: "Penang", city: "Bayan Lepas" }),
    seedEntry({ country: "Malaysia", state: "Penang", city: "Butterworth" }),
    seedEntry({ country: "Malaysia", state: "Johor", city: "Johor Bahru" }),
    seedEntry({ country: "Malaysia", state: "Johor", city: "Iskandar Puteri" }),
    seedEntry({ country: "Malaysia", state: "Johor", city: "Senai" }),
    seedEntry({ country: "Malaysia", state: "Johor", city: "Batu Pahat" }),
    seedEntry({ country: "Malaysia", state: "Perak", city: "Ipoh" }),
    seedEntry({ country: "Malaysia", state: "Perak", city: "Taiping" }),
    seedEntry({ country: "Malaysia", state: "Kedah", city: "Alor Setar" }),
    seedEntry({ country: "Malaysia", state: "Kedah", city: "Sungai Petani" }),
    seedEntry({ country: "Malaysia", state: "Kedah", city: "Langkawi" }),
    seedEntry({ country: "Malaysia", state: "Perlis", city: "Kangar" }),
    seedEntry({ country: "Malaysia", state: "Kelantan", city: "Kota Bharu" }),
    seedEntry({ country: "Malaysia", state: "Terengganu", city: "Kuala Terengganu" }),
    seedEntry({ country: "Malaysia", state: "Pahang", city: "Kuantan" }),
    seedEntry({ country: "Malaysia", state: "Pahang", city: "Temerloh" }),
    seedEntry({ country: "Malaysia", state: "Pahang", city: "Cameron Highlands" }),
    seedEntry({ country: "Malaysia", state: "Negeri Sembilan", city: "Seremban" }),
    seedEntry({ country: "Malaysia", state: "Malacca", city: "Malacca City" }),
    seedEntry({ country: "Malaysia", state: "Sabah", city: "Kota Kinabalu" }),
    seedEntry({ country: "Malaysia", state: "Sabah", city: "Sandakan" }),
    seedEntry({ country: "Malaysia", state: "Sabah", city: "Tawau" }),
    seedEntry({ country: "Malaysia", state: "Sarawak", city: "Kuching" }),
    seedEntry({ country: "Malaysia", state: "Sarawak", city: "Miri" }),
    seedEntry({ country: "Malaysia", state: "Sarawak", city: "Sibu" }),
    seedEntry({ country: "Malaysia", state: "Sarawak", city: "Bintulu" }),
    seedEntry({ country: "Malaysia", state: "Labuan", city: "Labuan" }),
    // Singapore
    seedEntry({ country: "Singapore", state: "Singapore", city: "Singapore" }),
    seedEntry({ country: "Singapore", state: "Singapore", city: "Jurong" }),
    seedEntry({ country: "Singapore", state: "Singapore", city: "Tampines" }),
    // Thailand
    seedEntry({ country: "Thailand", state: "Bangkok", city: "Bangkok" }),
    seedEntry({ country: "Thailand", state: "Chiang Mai", city: "Chiang Mai" }),
    seedEntry({ country: "Thailand", state: "Phuket", city: "Phuket" }),
    seedEntry({ country: "Thailand", state: "Krabi", city: "Krabi" }),
    seedEntry({ country: "Thailand", state: "Songkhla", city: "Hat Yai" }),
    // Indonesia
    seedEntry({ country: "Indonesia", state: "Jakarta", city: "Jakarta" }),
    seedEntry({ country: "Indonesia", state: "Bali", city: "Denpasar" }),
    seedEntry({ country: "Indonesia", state: "Bali", city: "Ubud" }),
    seedEntry({ country: "Indonesia", state: "East Java", city: "Surabaya" }),
    seedEntry({ country: "Indonesia", state: "Yogyakarta", city: "Yogyakarta" }),
    seedEntry({ country: "Indonesia", state: "North Sumatra", city: "Medan" }),
    // Philippines
    seedEntry({ country: "Philippines", state: "Metro Manila", city: "Manila" }),
    seedEntry({ country: "Philippines", state: "Metro Manila", city: "Quezon City" }),
    seedEntry({ country: "Philippines", state: "Cebu", city: "Cebu City" }),
    seedEntry({ country: "Philippines", state: "Davao del Sur", city: "Davao" }),
    // Vietnam
    seedEntry({ country: "Vietnam", state: "Ho Chi Minh", city: "Ho Chi Minh City" }),
    seedEntry({ country: "Vietnam", state: "Hanoi", city: "Hanoi" }),
    seedEntry({ country: "Vietnam", state: "Da Nang", city: "Da Nang" }),
    // China / HK / Taiwan
    seedEntry({ country: "China", state: "Beijing", city: "Beijing" }),
    seedEntry({ country: "China", state: "Shanghai", city: "Shanghai" }),
    seedEntry({ country: "China", state: "Guangdong", city: "Guangzhou" }),
    seedEntry({ country: "China", state: "Guangdong", city: "Shenzhen" }),
    seedEntry({ country: "Hong Kong", state: "Hong Kong", city: "Hong Kong" }),
    seedEntry({ country: "Taiwan", state: "Taipei", city: "Taipei" }),
    seedEntry({ country: "Taiwan", state: "Taoyuan", city: "Taoyuan" }),
    // Japan / Korea
    seedEntry({ country: "Japan", state: "Tokyo", city: "Tokyo" }),
    seedEntry({ country: "Japan", state: "Osaka", city: "Osaka" }),
    seedEntry({ country: "Japan", state: "Kyoto", city: "Kyoto" }),
    seedEntry({ country: "South Korea", state: "Seoul", city: "Seoul" }),
    seedEntry({ country: "South Korea", state: "Busan", city: "Busan" }),
    // India
    seedEntry({ country: "India", state: "Delhi", city: "New Delhi" }),
    seedEntry({ country: "India", state: "Maharashtra", city: "Mumbai" }),
    seedEntry({ country: "India", state: "Maharashtra", city: "Pune" }),
    seedEntry({ country: "India", state: "Karnataka", city: "Bangalore" }),
    seedEntry({ country: "India", state: "Tamil Nadu", city: "Chennai" }),
    seedEntry({ country: "India", state: "Telangana", city: "Hyderabad" }),
    seedEntry({ country: "India", state: "West Bengal", city: "Kolkata" }),
    // Middle East
    seedEntry({ country: "UAE", state: "Dubai", city: "Dubai" }),
    seedEntry({ country: "UAE", state: "Abu Dhabi", city: "Abu Dhabi" }),
    seedEntry({ country: "Qatar", state: "Doha", city: "Doha" }),
    seedEntry({ country: "Saudi Arabia", state: "Riyadh", city: "Riyadh" }),
    seedEntry({ country: "Saudi Arabia", state: "Mecca", city: "Jeddah" }),
    seedEntry({ country: "Turkey", state: "Istanbul", city: "Istanbul" }),
    // Europe
    seedEntry({ country: "United Kingdom", state: "England", city: "London" }),
    seedEntry({ country: "United Kingdom", state: "England", city: "Manchester" }),
    seedEntry({ country: "United Kingdom", state: "Scotland", city: "Edinburgh" }),
    seedEntry({ country: "France", state: "Ile-de-France", city: "Paris" }),
    seedEntry({ country: "France", state: "PACA", city: "Nice" }),
    seedEntry({ country: "Germany", state: "Bavaria", city: "Munich" }),
    seedEntry({ country: "Germany", state: "Hesse", city: "Frankfurt" }),
    seedEntry({ country: "Germany", state: "Berlin", city: "Berlin" }),
    seedEntry({ country: "Spain", state: "Madrid", city: "Madrid" }),
    seedEntry({ country: "Spain", state: "Catalonia", city: "Barcelona" }),
    seedEntry({ country: "Italy", state: "Lazio", city: "Rome" }),
    seedEntry({ country: "Italy", state: "Lombardy", city: "Milan" }),
    seedEntry({ country: "Netherlands", state: "North Holland", city: "Amsterdam" }),
    seedEntry({ country: "Switzerland", state: "Zurich", city: "Zurich" }),
    // Americas
    seedEntry({ country: "United States", state: "New York", city: "New York" }),
    seedEntry({ country: "United States", state: "California", city: "Los Angeles" }),
    seedEntry({ country: "United States", state: "California", city: "San Francisco" }),
    seedEntry({ country: "United States", state: "Illinois", city: "Chicago" }),
    seedEntry({ country: "United States", state: "Texas", city: "Dallas" }),
    seedEntry({ country: "United States", state: "Texas", city: "Houston" }),
    seedEntry({ country: "United States", state: "Florida", city: "Miami" }),
    seedEntry({ country: "United States", state: "Washington", city: "Seattle" }),
    seedEntry({ country: "Canada", state: "Ontario", city: "Toronto" }),
    seedEntry({ country: "Canada", state: "British Columbia", city: "Vancouver" }),
    seedEntry({ country: "Canada", state: "Quebec", city: "Montreal" }),
    seedEntry({ country: "Mexico", state: "Mexico City", city: "Mexico City" }),
    seedEntry({ country: "Brazil", state: "Sao Paulo", city: "Sao Paulo" }),
    seedEntry({ country: "Brazil", state: "Rio de Janeiro", city: "Rio de Janeiro" }),
    seedEntry({ country: "Argentina", state: "Buenos Aires", city: "Buenos Aires" }),
    // Oceania
    seedEntry({ country: "Australia", state: "New South Wales", city: "Sydney" }),
    seedEntry({ country: "Australia", state: "Victoria", city: "Melbourne" }),
    seedEntry({ country: "Australia", state: "Queensland", city: "Brisbane" }),
    seedEntry({ country: "Australia", state: "Western Australia", city: "Perth" }),
    seedEntry({ country: "New Zealand", state: "Auckland", city: "Auckland" }),
    seedEntry({ country: "New Zealand", state: "Wellington", city: "Wellington" }),
    // Africa
    seedEntry({ country: "South Africa", state: "Gauteng", city: "Johannesburg" }),
    seedEntry({ country: "South Africa", state: "Western Cape", city: "Cape Town" }),
    seedEntry({ country: "Egypt", state: "Cairo", city: "Cairo" }),
    seedEntry({ country: "Morocco", state: "Casablanca-Settat", city: "Casablanca" }),
    seedEntry({ country: "Kenya", state: "Nairobi", city: "Nairobi" }),
    seedEntry({ country: "Nigeria", state: "Lagos", city: "Lagos" }),
  ].slice(0, 0),
  "payment-type": [
    seedEntry({ name: "Cash", enabled: true }),
    seedEntry({ name: "Card", enabled: true }),
    seedEntry({ name: "Wallet", enabled: false }),
  ],
  "driver-incentive": [
    seedEntry({ name: "Weekend Bonus", reward: 50 }),
  ],
  leaderboard: [
    seedEntry({ name: "Top Earner", prize: 500 }),
  ],
  rides: [
    seedEntry({ name: "Cancellation Fee", value: 5 }),
    seedEntry({ name: "Wait Time Limit", value: 5 }),
  ],
  "promocode-list": [
    seedEntry({ code: "WELCOME10", discount: 10 }),
    seedEntry({ code: "RIDE5", discount: 5 }),
  ],
  "insurance-providers": [
    seedEntry({ name: "Allianz General Insurance Malaysia", type: "General", contact: "1300 22 5542", website: "https://www.allianz.com.my" }),
    seedEntry({ name: "Allianz Life Insurance Malaysia", type: "Life", contact: "1300 22 5542", website: "https://www.allianz.com.my" }),
    seedEntry({ name: "AIA Malaysia", type: "Life", contact: "1300 88 1899", website: "https://www.aia.com.my" }),
    seedEntry({ name: "Great Eastern Life Assurance", type: "Life", contact: "1300 1300 88", website: "https://www.greateasternlife.com/my" }),
    seedEntry({ name: "Great Eastern General Insurance", type: "General", contact: "1300 1300 88", website: "https://www.greateasterngeneral.com/my" }),
    seedEntry({ name: "Etiqa General Insurance", type: "General", contact: "1300 13 8888", website: "https://www.etiqa.com.my" }),
    seedEntry({ name: "Etiqa Life Insurance", type: "Life", contact: "1300 13 8888", website: "https://www.etiqa.com.my" }),
    seedEntry({ name: "Etiqa General Takaful", type: "Takaful", contact: "1300 13 8888", website: "https://www.etiqa.com.my" }),
    seedEntry({ name: "Etiqa Family Takaful", type: "Takaful", contact: "1300 13 8888", website: "https://www.etiqa.com.my" }),
    seedEntry({ name: "Zurich General Insurance Malaysia", type: "General", contact: "1300 888 622", website: "https://www.zurich.com.my" }),
    seedEntry({ name: "Zurich Life Insurance Malaysia", type: "Life", contact: "1300 888 622", website: "https://www.zurich.com.my" }),
    seedEntry({ name: "Zurich General Takaful Malaysia", type: "Takaful", contact: "1300 888 622", website: "https://www.zurich.com.my" }),
    seedEntry({ name: "Zurich Takaful Malaysia", type: "Takaful", contact: "1300 888 622", website: "https://www.zurich.com.my" }),
    seedEntry({ name: "Tokio Marine Insurans Malaysia", type: "General", contact: "1800 88 0812", website: "https://www.tokiomarine.com/my" }),
    seedEntry({ name: "Tokio Marine Life Insurance Malaysia", type: "Life", contact: "1800 88 0812", website: "https://www.tokiomarine.com/my" }),
    seedEntry({ name: "Prudential Assurance Malaysia", type: "Life", contact: "03-2771 0228", website: "https://www.prudential.com.my" }),
    seedEntry({ name: "Prudential BSN Takaful", type: "Takaful", contact: "03-2053 7188", website: "https://www.prubsn.com.my" }),
    seedEntry({ name: "Hong Leong Assurance", type: "Life", contact: "03-7650 1818", website: "https://www.hla.com.my" }),
    seedEntry({ name: "Hong Leong MSIG Takaful", type: "Takaful", contact: "03-7650 1828", website: "https://www.hlmsigtakaful.com.my" }),
    seedEntry({ name: "MSIG Insurance Malaysia", type: "General", contact: "1800 88 6744", website: "https://www.msig.com.my" }),
    seedEntry({ name: "AmGeneral Insurance (Liberty)", type: "General", contact: "1300 88 6333", website: "https://www.libertyinsurance.com.my" }),
    seedEntry({ name: "Liberty General Insurance", type: "General", contact: "1300 88 6333", website: "https://www.libertyinsurance.com.my" }),
    seedEntry({ name: "AmMetLife Insurance", type: "Life", contact: "1300 88 8800", website: "https://www.ammetlife.com" }),
    seedEntry({ name: "AmMetLife Takaful", type: "Takaful", contact: "1300 88 8800", website: "https://www.ammetlife.com" }),
    seedEntry({ name: "Berjaya Sompo Insurance", type: "General", contact: "1800 88 9933", website: "https://www.berjayasompo.com.my" }),
    seedEntry({ name: "Pacific & Orient Insurance (P&O)", type: "General", contact: "03-2698 5033", website: "https://www.poi.com.my" }),
    seedEntry({ name: "RHB Insurance", type: "General", contact: "1300 220 007", website: "https://www.rhbinsurance.com.my" }),
    seedEntry({ name: "Lonpac Insurance", type: "General", contact: "03-2262 8688", website: "https://www.lonpac.com" }),
    seedEntry({ name: "Syarikat Takaful Malaysia Keluarga", type: "Takaful", contact: "1-300-88-252835", website: "https://www.takaful-malaysia.com.my" }),
    seedEntry({ name: "Syarikat Takaful Malaysia Am", type: "Takaful", contact: "1-300-88-252835", website: "https://www.takaful-malaysia.com.my" }),
    seedEntry({ name: "Takaful Ikhlas General", type: "Takaful", contact: "1-300-13-44552", website: "https://www.takaful-ikhlas.com.my" }),
    seedEntry({ name: "Takaful Ikhlas Family", type: "Takaful", contact: "1-300-13-44552", website: "https://www.takaful-ikhlas.com.my" }),
    seedEntry({ name: "Sun Life Malaysia Assurance", type: "Life", contact: "1300 88 5055", website: "https://www.sunlifemalaysia.com" }),
    seedEntry({ name: "Sun Life Malaysia Takaful", type: "Takaful", contact: "1300 88 5055", website: "https://www.sunlifemalaysia.com" }),
    seedEntry({ name: "Manulife Insurance Berhad", type: "Life", contact: "03-2719 9112", website: "https://www.manulife.com.my" }),
    seedEntry({ name: "Generali Insurance Malaysia", type: "General", contact: "1300 13 2121", website: "https://www.generali.com.my" }),
    seedEntry({ name: "Generali Life Insurance Malaysia", type: "Life", contact: "1300 13 2121", website: "https://www.generali.com.my" }),
    seedEntry({ name: "Chubb Insurance Malaysia", type: "General", contact: "03-2058 3000", website: "https://www.chubb.com/my" }),
    seedEntry({ name: "The Pacific Insurance", type: "General", contact: "1800 88 1629", website: "https://www.pacificinsurance.com.my" }),
    seedEntry({ name: "Progressive Insurance", type: "General", contact: "03-2118 8000", website: "https://www.progressiveinsurance.com.my" }),
    seedEntry({ name: "QBE Insurance Malaysia", type: "General", contact: "03-2785 6688", website: "https://www.qbe.com/my" }),
    seedEntry({ name: "Kurnia Insurans (Liberty)", type: "General", contact: "1300 88 6333", website: "https://www.libertyinsurance.com.my" }),
    seedEntry({ name: "FWD Takaful", type: "Takaful", contact: "03-2772 0118", website: "https://www.fwd.com.my" }),
    seedEntry({ name: "Gibraltar BSN Life", type: "Life", contact: "03-2298 1188", website: "https://www.gibraltarbsn.com" }),
    seedEntry({ name: "Tune Protect Malaysia", type: "General", contact: "03-2087 9000", website: "https://www.tuneprotect.com" }),
    seedEntry({ name: "AXA Affin General Insurance", type: "General", contact: "1300 88 1616", website: "https://www.generali.com.my" }),
    seedEntry({ name: "AIA PUBLIC Takaful", type: "Takaful", contact: "1300 88 1899", website: "https://www.aia.com.my" }),
    seedEntry({ name: "AIA General Berhad", type: "General", contact: "1300 88 1899", website: "https://www.aia.com.my" }),
  ],
  "free-ride": [
    seedEntry({ name: "First Ride Free", limit: 1 }),
  ],
  "fixed-price": [
    seedEntry({ from: "KLIA", to: "KL Sentral", price: 75 }),
  ],
  "subscription-plan": [
    seedEntry({ name: "Driver Pro", price: 49 }),
  ],
  "advertisement-banners": [
    seedEntry({ title: "New Year Promo", url: "https://example.com/promo" }),
  ],
  "push-notification": [
    seedEntry({ title: "Welcome", body: "Thanks for joining" }),
  ],
  "social-links": [
    seedEntry({ platform: "Facebook", url: "https://facebook.com/getride" }),
    seedEntry({ platform: "Instagram", url: "https://instagram.com/getride" }),
  ],
  "world-currency": [
    seedEntry({ code: "MYR", symbol: "RM", rate: 1 }),
    seedEntry({ code: "USD", symbol: "$", rate: 0.21 }),
  ],
  "app-version-setting": [
    seedEntry({ platform: "iOS", version: "1.0.0", forceUpdate: false }),
    seedEntry({ platform: "Android", version: "1.0.0", forceUpdate: false }),
  ],
  "search-radius": [
    seedEntry({ name: "City", radius: 5 }),
    seedEntry({ name: "Suburb", radius: 10 }),
  ],
  "page-list": [
    seedEntry({ name: "Privacy Policy", slug: "privacy" }),
    seedEntry({ name: "Terms", slug: "terms" }),
  ],
  "email-templates": [
    seedEntry({ name: "Welcome Email", subject: "Welcome to Teksi" }),
  ],
  "ev-vehicle-details": [
    seedEntry({
      isDefault: true,
      imageUri: "",
      make: "JUNEYAO",
      model: "JY AIR",
      price: 75000,
      exteriorColors: JSON.stringify([
        { id: "jya-ec1", name: "Pearl White", code: "#F5F5F5", enabled: true },
        { id: "jya-ec2", name: "Obsidian Black", code: "#0B0B0B", enabled: true },
        { id: "jya-ec3", name: "Sky Blue", code: "#7EC8E3", enabled: true },
        { id: "jya-ec4", name: "Cherry Red", code: "#B11226", enabled: true },
      ]),
      interiorColors: JSON.stringify([
        { id: "jya-ic1", name: "Light Beige", code: "#E8DCC4", enabled: true },
        { id: "jya-ic2", name: "Charcoal", code: "#2B2B2B", enabled: true },
      ]),
      taxes: JSON.stringify([
        { id: "jya-t1", name: "SST", description: "Sales & Service Tax (10%)", amount: 7500, enabled: true },
        { id: "jya-t2", name: "Road Tax", description: "Annual road tax", amount: 90, enabled: true },
      ]),
      features: JSON.stringify([
        { id: "jya-f1", name: "Panoramic Sunroof", price: 3500, enabled: true },
        { id: "jya-f2", name: "ADAS Driver-Assist Pack", price: 5000, enabled: true },
        { id: "jya-f3", name: "Heated & Ventilated Seats", price: 2200, enabled: true },
      ]),
      accessories: JSON.stringify([
        { id: "jya-a1", name: "Wireless Charger", price: 450, enabled: true },
        { id: "jya-a2", name: "Roof Rack", price: 1200, enabled: true },
        { id: "jya-a3", name: "All-Weather Floor Mats", price: 380, enabled: true },
      ]),
      exteriorImages: JSON.stringify([]),
      interiorImages: JSON.stringify([]),
      storageImages: JSON.stringify([]),
    }),
    seedEntry({
      isDefault: true,
      imageUri: "",
      make: "JMEV",
      model: "EVEASY ELIGHT",
      price: 65000,
      exteriorColors: JSON.stringify([
        { id: "jme-ec1", name: "Glacier White", code: "#F2F4F7", enabled: true },
        { id: "jme-ec2", name: "Midnight Black", code: "#111111", enabled: true },
        { id: "jme-ec3", name: "Mint Green", code: "#A8E6CF", enabled: true },
        { id: "jme-ec4", name: "Coral Pink", code: "#F4ACB7", enabled: true },
      ]),
      interiorColors: JSON.stringify([
        { id: "jme-ic1", name: "Cream White", code: "#FFF4DC", enabled: true },
        { id: "jme-ic2", name: "Graphite", code: "#3A3A3A", enabled: true },
      ]),
      taxes: JSON.stringify([
        { id: "jme-t1", name: "SST", description: "Sales & Service Tax (10%)", amount: 6500, enabled: true },
        { id: "jme-t2", name: "Road Tax", description: "Annual road tax", amount: 70, enabled: true },
      ]),
      features: JSON.stringify([
        { id: "jme-f1", name: "Fast Charging Pack", price: 2800, enabled: true },
        { id: "jme-f2", name: "Smart Connect Infotainment", price: 1800, enabled: true },
        { id: "jme-f3", name: "360° Camera", price: 1500, enabled: true },
      ]),
      accessories: JSON.stringify([
        { id: "jme-a1", name: "Portable Charger Cable", price: 350, enabled: true },
        { id: "jme-a2", name: "Cargo Organizer", price: 220, enabled: true },
        { id: "jme-a3", name: "Sunshade Set", price: 180, enabled: true },
      ]),
      exteriorImages: JSON.stringify([]),
      interiorImages: JSON.stringify([]),
      storageImages: JSON.stringify([]),
    }),
  ],
};

export const [AdminDataProvider, useAdminData] = createContextHook(() => {
  const [data, setData] = useState<AdminData>({
    partners: SEED_PARTNERS,
    users: SEED_USERS,
    vehicles: SEED_VEHICLES,
    vehicleMakeModels: [],
    entries: SEED_ENTRIES,
  });
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  /**
   * Latest `data` for callbacks that need to read the current record *and*
   * return the result of its remote sync (see `updatePartner`) — the `setData`
   * updater runs during reconciliation, so it can't hand a value back.
   */
  const dataRef = useRef<AdminData>(data);
  dataRef.current = data;

  useEffect(() => {
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          // Migrate from legacy v2 storage where partners were stored as `drivers`.
          raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        }
        if (raw) {
          const parsed = JSON.parse(raw) as LegacyAdminData;
          const mergedEntries = { ...SEED_ENTRIES, ...(parsed.entries ?? {}) };
          // Persist all user-added country-states-cities entries (custom
          // regions, geofence overrides, suburbs). Only drop entries that
          // have absolutely no identifying value.
          const cscKey = "country-states-cities";
          const cscList = mergedEntries[cscKey] ?? [];
          mergedEntries[cscKey] = cscList.filter((e) => {
            const v = e.values ?? {};
            return (
              !!String(v.country ?? "").trim() ||
              !!String(v.state ?? "").trim() ||
              !!String(v.city ?? "").trim() ||
              !!String(v.suburb ?? "").trim()
            );
          });
          // Ensure default vehicle-services seeds (Ride, Comfort, 6-seater,
          // Premium) are always present even if user storage was created
          // before they were added. Match by lowercased name.
          const vsKey = "vehicle-services";
          const vsExisting = mergedEntries[vsKey] ?? [];
          const existingNames = new Set(
            vsExisting.map((e) =>
              String(e.values?.name ?? "").trim().toLowerCase()
            )
          );
          const missingSeeds = (SEED_ENTRIES[vsKey] ?? []).filter(
            (s) =>
              !existingNames.has(
                String(s.values?.name ?? "").trim().toLowerCase()
              )
          );
          if (missingSeeds.length > 0) {
            mergedEntries[vsKey] = [...missingSeeds, ...vsExisting];
          }
          // Ensure default service-settings seeds (Car, Bike, Auto, Delivery,
          // Food, Mart) are always present and flagged as default.
          const ssKey = "service-settings";
          const ssExisting = mergedEntries[ssKey] ?? [];
          const ssExistingNames = new Set(
            ssExisting.map((e) =>
              String(e.values?.name ?? "").trim().toLowerCase()
            )
          );
          const ssMissing = (SEED_ENTRIES[ssKey] ?? []).filter(
            (s) =>
              !ssExistingNames.has(
                String(s.values?.name ?? "").trim().toLowerCase()
              )
          );
          if (ssMissing.length > 0) {
            mergedEntries[ssKey] = [...ssMissing, ...ssExisting];
          }
          // Ensure default EV vehicle seeds (JUNEYAO JY AIR, JMEV EVEASY
          // ELIGHT) are present. Match by `${make} ${model}` lowercased so
          // edits to other fields don't duplicate them.
          const evKey = "ev-vehicle-details";
          const evExisting = mergedEntries[evKey] ?? [];
          const evKeyOf = (v: Record<string, string | number | boolean>) =>
            `${String(v.make ?? "").trim()} ${String(v.model ?? "").trim()}`.toLowerCase();
          const evExistingKeys = new Set(evExisting.map((e) => evKeyOf(e.values)));
          const evMissing = (SEED_ENTRIES[evKey] ?? []).filter(
            (s) => !evExistingKeys.has(evKeyOf(s.values))
          );
          if (evMissing.length > 0) {
            mergedEntries[evKey] = [...evMissing, ...evExisting];
          }
          setData((prev) => ({
            partners: parsed.partners ?? parsed.drivers ?? SEED_PARTNERS,
            users: parsed.users ?? SEED_USERS,
            vehicles: parsed.vehicles ?? SEED_VEHICLES,
            vehicleMakeModels: prev.vehicleMakeModels,
            entries: mergedEntries,
          }));
        }

        // Best-effort Supabase hydration: if a project is connected, prefer
        // its data over the AsyncStorage cache. Failures fall through to the
        // local cache so the admin panel keeps working offline.
        if (isSupabaseConfigured) {
          const [remoteEntries, remotePartners, remoteUsers, remoteVehicles, remoteVMM, remoteRegions] = await Promise.all([
            sbFetchAllSettings(),
            sbFetchPartners(),
            sbFetchUsers(),
            sbFetchVehicles(),
            sbFetchVehicleMakeModels(),
            sbFetchRegions(),
          ]);

          // Regions live in dedicated tables (countries/states/cities/suburbs).
          // Merge them into the legacy `country-states-cities` entries slot so
          // the existing admin screen keeps working unchanged.
          if (remoteEntries && remoteRegions) {
            remoteEntries[REGIONS_CATEGORY] = remoteRegions;
          } else if (remoteRegions) {
            // No other remote entries fetched, but regions came back.
          }

          // First-run seed push: for each SEED_ENTRIES category that has no
          // rows on the server, upsert each seed via sbUpsertSetting so the
          // Supabase `settings_entries` table reflects the in-app defaults
          // from day one. Categories explicitly intended to be empty (e.g.
          // country-states-cities, which is sourced at runtime) are skipped.
          const SEED_PUSH_SKIP = new Set<string>(["country-states-cities"]);
          // The four categories below now live in dedicated typed tables
          // (see migration 0019). sbUpsertSetting already routes them to
          // the right table, so we don't need to skip them — but we DO need
          // sbFetchAllSettings to surface their rows, which it does via
          // fetchDedicatedSettings(). No special-casing required here.
          const seededIds: Record<string, Record<string, string>> = {};
          if (remoteEntries) {
            for (const [category, seeds] of Object.entries(SEED_ENTRIES)) {
              if (SEED_PUSH_SKIP.has(category)) continue;
              const remoteList = remoteEntries[category] ?? [];
              if (remoteList.length > 0) continue;
              if (!seeds || seeds.length === 0) continue;
              const pushed: SettingEntry[] = [];
              const idMap: Record<string, string> = {};
              for (let i = 0; i < seeds.length; i++) {
                const s = seeds[i];
                // Settings_entries.id is a uuid — promote the local seed id to
                // a real uuid before pushing so subsequent edits hit the same
                // row, then mirror that id back into local state.
                const newId = uuidv4();
                idMap[s.id] = newId;
                const next: SettingEntry = { ...s, id: newId };
                pushed.push(next);
                void sbUpsertSetting(category, next, i);
              }
              remoteEntries[category] = pushed;
              seededIds[category] = idMap;
            }
          }

          setData((prev) => {
            const mergedEntries = remoteEntries
              ? { ...prev.entries, ...remoteEntries }
              : prev.entries;
            // Owner-scoped categories (EV orders) hold customer data written
            // from the device that created it. A row that never reached the
            // server — offline, or a legacy local-PIN session — must survive
            // the remote fetch replacing its category, so keep the local-only
            // rows and retry their sync.
            if (remoteEntries) {
              for (const category of OWNER_SCOPED_CATEGORIES) {
                const remoteList = remoteEntries[category];
                if (!remoteList) continue;
                const remoteIds = new Set(remoteList.map((e) => e.id));
                const localOnly = (prev.entries[category] ?? []).filter(
                  (e) => !remoteIds.has(e.id)
                );
                if (localOnly.length === 0) continue;
                mergedEntries[category] = [...localOnly, ...remoteList];
                localOnly.forEach((e, i) => void sbUpsertSetting(category, e, i));
              }
            }
            return {
              // Partners are the source of truth in Supabase — always replace
              // local cache (including empty array) so the admin panel reflects
              // the live `partners` table, never stale seeds.
              partners: remotePartners ?? prev.partners,
              users: remoteUsers && remoteUsers.length > 0 ? remoteUsers : prev.users,
              // Vehicles are the source of truth in Supabase — always replace
              // local cache (including empty array) so admin-vehicles-*.tsx
              // reflects the live `vehicles` table, never stale seeds.
              vehicles: remoteVehicles ?? prev.vehicles,
              // Vehicle make/model catalog is exclusively sourced from Supabase
              // (see migration 0015). No local seed/fallback.
              vehicleMakeModels: remoteVMM ?? prev.vehicleMakeModels,
              entries: mergedEntries,
            };
          });
        }
      } catch (e) {
        console.log("[AdminData] hydrate error", e);
      } finally {
        setIsHydrated(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: AdminData) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.log("[AdminData] persist error", e);
    }
  }, []);

  const update = useCallback(
    (mutator: (prev: AdminData) => AdminData) => {
      setData((prev) => {
        const next = mutator(prev);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  // Partners
  const addPartner = useCallback(
    (input: Omit<PartnerRecord, "id" | "joinedAt"> & Partial<Pick<PartnerRecord, "id" | "joinedAt">>) => {
      const partner: PartnerRecord = {
        ...input,
        id: input.id ?? `PR-${Date.now().toString().slice(-6)}`,
        joinedAt: input.joinedAt ?? now(),
        rating: input.rating ?? 0,
        totalRides: input.totalRides ?? 0,
      } as PartnerRecord;
      update((p) => ({ ...p, partners: [partner, ...p.partners] }));
      void sbUpsertPartner(partner);
      return partner;
    },
    [update]
  );

  /**
   * Patch a partner locally and push it to Supabase. Resolves with the remote
   * write's outcome so a screen can tell the operator when the change was
   * rejected — the local cache is optimistic and the next hydrate replaces
   * partners wholesale from the server, so a silent failure would look like a
   * save that quietly reverted.
   */
  const updatePartner = useCallback(
    (id: string, patch: Partial<PartnerRecord>): Promise<AdminWriteResult> => {
      const current = dataRef.current.partners.find((d) => d.id === id);
      update((p) => ({
        ...p,
        partners: p.partners.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      }));
      if (!current) {
        return Promise.resolve({ ok: false, error: "Partner not found." });
      }
      return sbUpsertPartner({ ...current, ...patch });
    },
    [update]
  );

  const removePartner = useCallback(
    (id: string) => {
      update((p) => ({ ...p, partners: p.partners.filter((d) => d.id !== id) }));
      void sbDeletePartner(id);
    },
    [update]
  );

  const setPartnerStatus = useCallback(
    (id: string, status: PartnerStatus) => {
      updatePartner(id, { status });
    },
    [updatePartner]
  );

  // Users
  const addUser = useCallback(
    (input: Omit<UserRecord, "id" | "joinedAt"> & Partial<Pick<UserRecord, "id" | "joinedAt">>) => {
      const user: UserRecord = {
        ...input,
        id: input.id ?? `US-${Date.now().toString().slice(-6)}`,
        joinedAt: input.joinedAt ?? now(),
        totalRides: input.totalRides ?? 0,
      } as UserRecord;
      update((p) => ({ ...p, users: [user, ...p.users] }));
      void sbUpsertUser(user);
      return user;
    },
    [update]
  );

  const updateUser = useCallback(
    (id: string, patch: Partial<UserRecord>) => {
      update((p) => {
        const next = {
          ...p,
          users: p.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
        };
        const updated = next.users.find((u) => u.id === id);
        if (updated) void sbUpsertUser(updated);
        return next;
      });
    },
    [update]
  );

  const removeUser = useCallback(
    (id: string) => {
      update((p) => ({ ...p, users: p.users.filter((u) => u.id !== id) }));
      void sbDeleteUser(id);
    },
    [update]
  );

  const setUserStatus = useCallback(
    (id: string, status: UserStatus) => {
      updateUser(id, { status });
    },
    [updateUser]
  );

  // Vehicles
  const addVehicle = useCallback(
    (input: Omit<VehicleRecord, "id" | "joinedAt"> & Partial<Pick<VehicleRecord, "id" | "joinedAt">>) => {
      const vehicle: VehicleRecord = {
        id: input.id ?? `VH-${Date.now().toString().slice(-6)}`,
        joinedAt: input.joinedAt ?? now(),
        ...input,
      } as VehicleRecord;
      update((p) => ({ ...p, vehicles: [vehicle, ...p.vehicles] }));
      void sbUpsertVehicle(vehicle);
      return vehicle;
    },
    [update]
  );

  const updateVehicle = useCallback(
    (id: string, patch: Partial<VehicleRecord>) => {
      update((p) => {
        const next = {
          ...p,
          vehicles: p.vehicles.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        };
        const updated = next.vehicles.find((v) => v.id === id);
        if (updated) void sbUpsertVehicle(updated);
        return next;
      });
    },
    [update]
  );

  const removeVehicle = useCallback(
    (id: string) => {
      update((p) => ({ ...p, vehicles: p.vehicles.filter((v) => v.id !== id) }));
      void sbDeleteVehicle(id);
    },
    [update]
  );

  const setVehicleStatus = useCallback(
    (id: string, status: VehicleStatus) => {
      updateVehicle(id, { status });
    },
    [updateVehicle]
  );

  // Settings entries
  const getEntries = useCallback(
    (key: string): SettingEntry[] => data.entries[key] ?? [],
    [data.entries]
  );

  const addEntry = useCallback(
    (key: string, values: Record<string, string | number | boolean>) => {
      // Use a UUID so the local id matches the Supabase row id when synced.
      const entry: SettingEntry = {
        id: isSupabaseConfigured
          ? uuidv4()
          : `E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now(),
        updatedAt: now(),
        values,
      };
      update((p) => ({
        ...p,
        entries: { ...p.entries, [key]: [entry, ...(p.entries[key] ?? [])] },
      }));
      if (key === REGIONS_CATEGORY) {
        void sbUpsertRegion(entry, 0);
      } else {
        void sbUpsertSetting(key, entry, 0);
      }
      return entry;
    },
    [update]
  );

  const updateEntry = useCallback(
    (key: string, id: string, values: Record<string, string | number | boolean>) => {
      update((p) => {
        const list = (p.entries[key] ?? []).map((e) =>
          e.id === id ? { ...e, values, updatedAt: now() } : e
        );
        const updated = list.find((e) => e.id === id);
        if (updated) {
          const idx = list.findIndex((e) => e.id === id);
          if (key === REGIONS_CATEGORY) {
            void sbUpsertRegion(updated, idx >= 0 ? idx : 0);
          } else {
            void sbUpsertSetting(key, updated, idx >= 0 ? idx : 0);
          }
        }
        return { ...p, entries: { ...p.entries, [key]: list } };
      });
    },
    [update]
  );

  const removeEntry = useCallback(
    (key: string, id: string) => {
      update((p) => ({
        ...p,
        entries: {
          ...p.entries,
          [key]: (p.entries[key] ?? []).filter((e) => e.id !== id),
        },
      }));
      if (key === REGIONS_CATEGORY) {
        void sbDeleteRegion(id);
      } else {
        void sbDeleteSetting(id, key);
      }
    },
    [update]
  );

  const replaceEntries = useCallback(
    (
      key: string,
      valuesList: Array<Record<string, string | number | boolean>>
    ) => {
      const list: SettingEntry[] = valuesList.map((values, idx) => ({
        id: isSupabaseConfigured
          ? uuidv4()
          : `E-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now(),
        updatedAt: now(),
        values,
      }));
      update((p) => ({
        ...p,
        entries: { ...p.entries, [key]: list },
      }));
      void sbReplaceCategory(key, list);
    },
    [update]
  );

  const counts = useMemo(() => {
    const partnerByStatus: Record<PartnerStatus, number> = {
      approved: 0,
      unapproved: 0,
      blocked: 0,
      rejected: 0,
      "unapproved-docs": 0,
      "permit-pending": 0,
      "permit-non-verified": 0,
      "permit-verified": 0,
    };
    const userByStatus: Record<UserStatus, number> = {
      approved: 0,
      unapproved: 0,
      blocked: 0,
      rejected: 0,
      deleted: 0,
      "unapproved-docs": 0,
    };
    const vehicleByStatus: Record<VehicleStatus, number> = {
      approved: 0,
      unapproved: 0,
      blocked: 0,
      rejected: 0,
      "unapproved-docs": 0,
      "permit-pending": 0,
      "permit-non-verified": 0,
      "permit-verified": 0,
    };
    data.partners.forEach((d) => {
      partnerByStatus[d.status] = (partnerByStatus[d.status] ?? 0) + 1;
    });
    data.users.forEach((u) => {
      userByStatus[u.status] = (userByStatus[u.status] ?? 0) + 1;
    });
    data.vehicles.forEach((v) => {
      vehicleByStatus[v.status] = (vehicleByStatus[v.status] ?? 0) + 1;
    });
    return {
      partnerByStatus,
      userByStatus,
      vehicleByStatus,
      totalPartners: data.partners.length,
      totalUsers: data.users.length,
      totalVehicles: data.vehicles.length,
    };
  }, [data.partners, data.users, data.vehicles]);

  const refreshPartners = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const remote = await sbFetchPartners();
    if (remote) {
      setData((prev) => ({ ...prev, partners: remote }));
    }
  }, []);

  const refreshVehicles = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const remote = await sbFetchVehicles();
    if (remote) {
      setData((prev) => ({ ...prev, vehicles: remote }));
    }
  }, []);

  const refreshVehicleMakeModels = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const remote = await sbFetchVehicleMakeModels();
    if (remote) {
      setData((prev) => ({ ...prev, vehicleMakeModels: remote }));
    }
  }, []);

  const addVehicleMakeModel = useCallback(
    (
      input: Omit<VehicleMakeModelRecord, "id" | "createdAt" | "updatedAt" | "position"> &
        Partial<Pick<VehicleMakeModelRecord, "id" | "position">>
    ) => {
      const ts = now();
      const record: VehicleMakeModelRecord = {
        id: input.id ?? uuidv4(),
        vehicleType: input.vehicleType,
        energyType: input.energyType,
        make: input.make,
        model: input.model,
        yearFrom: input.yearFrom ?? "",
        yearTo: input.yearTo ?? "",
        iconUri: input.iconUri ?? "",
        status: input.status ?? true,
        isDefault: input.isDefault ?? false,
        position: input.position ?? 0,
        createdAt: ts,
        updatedAt: ts,
      };
      update((p) => ({
        ...p,
        vehicleMakeModels: [record, ...p.vehicleMakeModels],
      }));
      void sbUpsertVehicleMakeModel(record);
      return record;
    },
    [update]
  );

  const updateVehicleMakeModel = useCallback(
    (id: string, patch: Partial<VehicleMakeModelRecord>) => {
      update((p) => {
        const next = {
          ...p,
          vehicleMakeModels: p.vehicleMakeModels.map((v) =>
            v.id === id ? { ...v, ...patch, updatedAt: now() } : v
          ),
        };
        const updated = next.vehicleMakeModels.find((v) => v.id === id);
        if (updated) void sbUpsertVehicleMakeModel(updated);
        return next;
      });
    },
    [update]
  );

  const removeVehicleMakeModel = useCallback(
    (id: string) => {
      update((p) => ({
        ...p,
        vehicleMakeModels: p.vehicleMakeModels.filter((v) => v.id !== id),
      }));
      void sbDeleteVehicleMakeModel(id);
    },
    [update]
  );

  const refreshSettings = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const remote = await sbFetchAllSettings();
    if (remote) {
      setData((prev) => ({
        ...prev,
        entries: { ...prev.entries, ...remote },
      }));
    }
  }, []);

  // Realtime subscription: any insert/update/delete on the `partners` table
  // re-fetches the list so admin-partners-*.tsx screens stay live.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("admin-partners-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "partners" },
        () => {
          void refreshPartners();
        }
      )
      .subscribe();
    return () => {
      try {
        void supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[AdminData] removeChannel error", e);
      }
    };
  }, [refreshPartners]);

  // Realtime subscription: any insert/update/delete on the `vehicles` table
  // re-fetches the list so admin-vehicles-*.tsx screens stay live.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("admin-vehicles-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle" },
        () => {
          void refreshVehicles();
        }
      )
      .subscribe();
    return () => {
      try {
        void supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[AdminData] removeChannel(vehicles) error", e);
      }
    };
  }, [refreshVehicles]);

  // Realtime subscription on settings_entries so screens like
  // admin-settings-partner-type.tsx stay in sync with Supabase across devices.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("admin-settings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settings_entries" },
        () => {
          void refreshSettings();
        }
      )
      .subscribe();
    return () => {
      try {
        void supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[AdminData] removeChannel(settings) error", e);
      }
    };
  }, [refreshSettings]);

  // Realtime subscription on vehicle_make_models so the catalog screen stays
  // in sync with Supabase across devices.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("admin-vmm-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_make_models" },
        () => {
          void refreshVehicleMakeModels();
        }
      )
      .subscribe();
    return () => {
      try {
        void supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[AdminData] removeChannel(vmm) error", e);
      }
    };
  }, [refreshVehicleMakeModels]);

  return {
    isHydrated,
    partners: data.partners,
    refreshPartners,
    refreshVehicles,
    refreshVehicleMakeModels,
    refreshSettings,
    users: data.users,
    vehicles: data.vehicles,
    vehicleMakeModels: data.vehicleMakeModels,
    addVehicleMakeModel,
    updateVehicleMakeModel,
    removeVehicleMakeModel,
    entries: data.entries,
    counts,
    addPartner,
    updatePartner,
    removePartner,
    setPartnerStatus,
    addUser,
    updateUser,
    removeUser,
    setUserStatus,
    addVehicle,
    updateVehicle,
    removeVehicle,
    setVehicleStatus,
    getEntries,
    addEntry,
    updateEntry,
    removeEntry,
    replaceEntries,
  };
});
