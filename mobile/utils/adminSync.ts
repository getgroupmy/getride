import { isSupabaseConfigured, supabase, uuidv4 } from "@/utils/supabase";
import type {
  PartnerRecord,
  PartnerStatus,
  PermitStatus,
  SettingEntry,
  UserRecord,
  UserStatus,
  VehicleMakeModelRecord,
  VehicleRecord,
  VehicleStatus,
} from "@/types/admin";

/**
 * Thin Supabase data-access layer used by AdminDataContext.
 *
 * Every function is safe to call when Supabase is not configured — it will
 * silently no-op and return a sensible default. This lets the context fall
 * back to AsyncStorage in dev / offline scenarios.
 */

type SettingsRow = {
  id: string;
  category: string;
  values: Record<string, string | number | boolean> | null;
  position: number | null;
  created_at: string;
  updated_at: string;
};

type PartnerRow = {
  id: string;
  display_id: string | null;
  auth_user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  ic: string | null;
  vehicle: string | null;
  plate: string | null;
  vehicle_type: string | null;
  energy_type: string | null;
  make: string | null;
  model: string | null;
  year_from: string | null;
  year_to: string | null;
  partner_type: string | null;
  partner_types: string[] | null;
  service_countries: string[] | null;
  service_states: string[] | null;
  service_cities: string[] | null;
  avatar_url: string | null;
  address: string | null;
  onboarding_step: string | null;
  permit_number: string | null;
  status: PartnerStatus;
  permit: PermitStatus;
  documents_ok: boolean;
  rating: number;
  total_rides: number;
  joined_at: string;
};

type ProfileRow = {
  id: string;
  display_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  ic: string | null;
  address: string | null;
  profile_image: string | null;
  id_image: string | null;
  nationality: string | null;
  gender: "male" | "female" | "other" | null;
  birth_date: string | null;
  referral_code: string | null;
  status: UserStatus;
  profile_status: "Approved" | "Un-Approved" | "Blocked" | "Rejected" | "Deleted" | null;
  id_verified: "Verified" | "Failed" | null;
  documents_ok: boolean;
  total_rides: number;
  joined_at: string;
};

const log = (...args: unknown[]) => console.log("[adminSync]", ...args);

// ---------------------------------------------------------------------------
// Settings entries
// ---------------------------------------------------------------------------

/**
 * Categories whose rows belong to the signed-in customer rather than to the
 * admin panel. They live in tables with owner-or-admin RLS (migration 0080),
 * so a customer fetch returns only their own rows and an admin fetch returns
 * everything. They cannot live in `settings_entries`, whose writes have been
 * admin-only since 0069.
 */
export const OWNER_SCOPED_CATEGORY_TABLE_MAP: Record<string, string> = {
  "ev-orders": "ev_orders",
};

/** Category names from {@link OWNER_SCOPED_CATEGORY_TABLE_MAP}. */
export const OWNER_SCOPED_CATEGORIES = Object.keys(OWNER_SCOPED_CATEGORY_TABLE_MAP);

/**
 * Categories that live in their own typed Supabase table instead of the shared
 * `settings_entries` table. Each table mirrors the settings_entries shape
 * (id / values / position / timestamps) so SettingEntry can be reused.
 */
export const CATEGORY_TABLE_MAP: Record<string, string> = {
  "airport-areas": "airport_areas",
  "required-documents": "required_document",
  "document-type": "document_type",
  "driver-incentive": "driver_incentive",
  "insurance-providers": "insurance_providers",
  "insurance-types": "insurance_types",
  "insurance-durations": "insurance_durations",
  "insurance-premium": "insurance_premium",
  "ev-delivery-advisors": "ev_delivery_advisors",
  "ev-finance-options": "ev_finance_options",
  "ev-order-fee": "ev_order_fee",
  "ev-vehicle-details": "ev_vehicle_details",
  "ev-vehicle-inventory": "ev_vehicle_inventory",
  ...OWNER_SCOPED_CATEGORY_TABLE_MAP,
};

/**
 * True when the database has no such table — i.e. it predates the migration
 * that introduced it. Callers fall back to the legacy `settings_entries`
 * storage so the app keeps working against an older database.
 */
export function isMissingTableError(
  error: { message?: string | null; code?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("could not find the table")) return true;
  return msg.includes("relation") && msg.includes("does not exist");
}

/**
 * Categories that share a single physical table via a `kind` discriminator
 * column. Keeps the SettingEntry shape compatible while letting the screens
 * use distinct storage keys.
 */
export const CATEGORY_KIND_TABLE_MAP: Record<string, { table: string; kind: string }> = {
  "multi-gate-places": { table: "multi_gate", kind: "place" },
  "multi-gate-place-gates": { table: "multi_gate", kind: "gate" },
};

export const DEDICATED_CATEGORIES = [
  ...Object.keys(CATEGORY_TABLE_MAP),
  ...Object.keys(CATEGORY_KIND_TABLE_MAP),
];
export const DEDICATED_TABLES = [
  ...Object.values(CATEGORY_TABLE_MAP),
  ...Array.from(new Set(Object.values(CATEGORY_KIND_TABLE_MAP).map((v) => v.table))),
];

async function fetchDedicatedCategory(
  category: string,
  table: string
): Promise<SettingEntry[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from(table)
      .select("id, values, position, created_at, updated_at")
      .order("position", { ascending: true });
    if (error) {
      log("fetchDedicatedCategory error", category, error.message);
      return null;
    }
    return (data ?? []).map((row: { id: string; values: Record<string, string | number | boolean> | null; created_at: string; updated_at: string }) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      values: row.values ?? {},
    }));
  } catch (e) {
    log("fetchDedicatedCategory threw", category, e);
    return null;
  }
}

async function fetchKindCategory(
  category: string,
  table: string,
  kind: string
): Promise<SettingEntry[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from(table)
      .select("id, values, position, created_at, updated_at")
      .eq("kind", kind)
      .order("position", { ascending: true });
    if (error) {
      log("fetchKindCategory error", category, error.message);
      return null;
    }
    return (data ?? []).map((row: { id: string; values: Record<string, string | number | boolean> | null; created_at: string; updated_at: string }) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      values: row.values ?? {},
    }));
  } catch (e) {
    log("fetchKindCategory threw", category, e);
    return null;
  }
}

/** Fetch every dedicated category at once, keyed by its legacy category name. */
export async function fetchDedicatedSettings(): Promise<
  Record<string, SettingEntry[]>
> {
  const out: Record<string, SettingEntry[]> = {};
  await Promise.all([
    ...Object.entries(CATEGORY_TABLE_MAP).map(async ([cat, tbl]) => {
      const rows = await fetchDedicatedCategory(cat, tbl);
      if (rows) out[cat] = rows;
    }),
    ...Object.entries(CATEGORY_KIND_TABLE_MAP).map(async ([cat, cfg]) => {
      const rows = await fetchKindCategory(cat, cfg.table, cfg.kind);
      if (rows) out[cat] = rows;
    }),
  ]);
  return out;
}

export async function fetchAllSettings(): Promise<
  Record<string, SettingEntry[]> | null
> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("settings_entries")
      .select("id, category, values, position, created_at, updated_at")
      .order("position", { ascending: true });
    if (error) {
      log("fetchAllSettings error", error.message);
      return null;
    }
    const grouped: Record<string, SettingEntry[]> = {};
    for (const row of (data ?? []) as SettingsRow[]) {
      const entry: SettingEntry = {
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        values: row.values ?? {},
      };
      (grouped[row.category] ??= []).push(entry);
    }
    // Merge dedicated tables in so callers see the legacy shape.
    const dedicated = await fetchDedicatedSettings();
    for (const [cat, rows] of Object.entries(dedicated)) {
      grouped[cat] = rows;
    }
    return grouped;
  } catch (e) {
    log("fetchAllSettings threw", e);
    return null;
  }
}

export async function upsertSetting(
  category: string,
  entry: SettingEntry,
  position?: number
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const dedicated = CATEGORY_TABLE_MAP[category];
    if (dedicated) {
      const { error } = await supabase.from(dedicated).upsert(
        {
          id: entry.id,
          values: entry.values,
          position: position ?? 0,
        },
        { onConflict: "id" }
      );
      // A database that predates this category's table still holds the rows in
      // settings_entries — fall through to the legacy write instead of losing
      // the change.
      if (error && !isMissingTableError(error)) {
        log("upsertSetting (dedicated) error", category, error.message);
        return;
      }
      if (!error) return;
      log("upsertSetting (dedicated) table missing, using settings_entries", category);
    }
    const kindCfg = CATEGORY_KIND_TABLE_MAP[category];
    if (kindCfg) {
      const { error } = await supabase.from(kindCfg.table).upsert(
        {
          id: entry.id,
          kind: kindCfg.kind,
          values: entry.values,
          position: position ?? 0,
        },
        { onConflict: "id" }
      );
      if (error) log("upsertSetting (kind) error", category, error.message);
      return;
    }
    const { error } = await supabase.from("settings_entries").upsert(
      {
        id: entry.id,
        category,
        values: entry.values,
        position: position ?? 0,
      },
      { onConflict: "id" }
    );
    if (error) log("upsertSetting error", category, error.message);
  } catch (e) {
    log("upsertSetting threw", e);
  }
}

export async function deleteSetting(id: string, category?: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    if (category && CATEGORY_TABLE_MAP[category]) {
      const { error } = await supabase
        .from(CATEGORY_TABLE_MAP[category])
        .delete()
        .eq("id", id);
      if (error && !isMissingTableError(error)) {
        log("deleteSetting (dedicated) error", category, error.message);
        return;
      }
      if (!error) return;
      log("deleteSetting (dedicated) table missing, using settings_entries", category);
      const legacy = await supabase.from("settings_entries").delete().eq("id", id);
      if (legacy.error) log("deleteSetting error", category, legacy.error.message);
      return;
    }
    if (category && CATEGORY_KIND_TABLE_MAP[category]) {
      const cfg = CATEGORY_KIND_TABLE_MAP[category];
      const { error } = await supabase
        .from(cfg.table)
        .delete()
        .eq("id", id)
        .eq("kind", cfg.kind);
      if (error) log("deleteSetting (kind) error", category, error.message);
      return;
    }
    // Unknown category: try settings_entries plus every dedicated table.
    const { error } = await supabase
      .from("settings_entries")
      .delete()
      .eq("id", id);
    if (error) log("deleteSetting error", error.message);
    await Promise.all(
      DEDICATED_TABLES.map(async (t) => {
        const { error: e } = await supabase!.from(t).delete().eq("id", id);
        if (e) log("deleteSetting sweep error", t, e.message);
      })
    );
  } catch (e) {
    log("deleteSetting threw", e);
  }
}

export async function replaceCategory(
  category: string,
  entries: SettingEntry[]
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const dedicated = CATEGORY_TABLE_MAP[category];
    if (dedicated) {
      const del = await supabase.from(dedicated).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (del.error) {
        log("replaceCategory delete (dedicated) error", category, del.error.message);
        return;
      }
      if (entries.length === 0) return;
      const rows = entries.map((e, idx) => ({
        id: e.id,
        values: e.values,
        position: idx,
      }));
      const ins = await supabase.from(dedicated).insert(rows);
      if (ins.error) log("replaceCategory insert (dedicated) error", category, ins.error.message);
      return;
    }
    const kindCfg = CATEGORY_KIND_TABLE_MAP[category];
    if (kindCfg) {
      const del = await supabase.from(kindCfg.table).delete().eq("kind", kindCfg.kind);
      if (del.error) {
        log("replaceCategory delete (kind) error", category, del.error.message);
        return;
      }
      if (entries.length === 0) return;
      const rows = entries.map((e, idx) => ({
        id: e.id,
        kind: kindCfg.kind,
        values: e.values,
        position: idx,
      }));
      const ins = await supabase.from(kindCfg.table).insert(rows);
      if (ins.error) log("replaceCategory insert (kind) error", category, ins.error.message);
      return;
    }
    const del = await supabase
      .from("settings_entries")
      .delete()
      .eq("category", category);
    if (del.error) {
      log("replaceCategory delete error", category, del.error.message);
      return;
    }
    if (entries.length === 0) return;
    const rows = entries.map((e, idx) => ({
      id: e.id,
      category,
      values: e.values,
      position: idx,
    }));
    const ins = await supabase.from("settings_entries").insert(rows);
    if (ins.error) log("replaceCategory insert error", category, ins.error.message);
  } catch (e) {
    log("replaceCategory threw", e);
  }
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

function partnerToRow(p: PartnerRecord, supabaseId: string) {
  return {
    id: supabaseId,
    display_id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email ?? null,
    ic: p.ic ?? null,
    vehicle: p.vehicle ?? null,
    plate: p.plate ?? null,
    vehicle_type: p.vehicleType ?? null,
    energy_type: p.energyType ?? null,
    make: p.make ?? null,
    model: p.model ?? null,
    year_from: p.yearFrom ?? null,
    year_to: p.yearTo ?? null,
    partner_type: (p.partnerTypes && p.partnerTypes.length > 0)
      ? p.partnerTypes.join(",")
      : (p.partnerType ?? null),
    partner_types: p.partnerTypes ?? [],
    service_countries: (p as PartnerRecord & { serviceCountries?: string[] }).serviceCountries ?? [],
    service_states: (p as PartnerRecord & { serviceStates?: string[] }).serviceStates ?? [],
    service_cities: (p as PartnerRecord & { serviceCities?: string[] }).serviceCities ?? [],
    permit_number: p.permitNumber ?? null,
    status: p.status,
    permit: p.permit,
    documents_ok: p.documentsOk,
    rating: p.rating,
    total_rides: p.totalRides,
    joined_at: p.joinedAt,
  };
}

function rowToPartner(row: PartnerRow): PartnerRecord {
  return {
    id: row.display_id ?? row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    ic: row.ic ?? undefined,
    vehicle: row.vehicle ?? "",
    plate: row.plate ?? "",
    vehicleType: row.vehicle_type ?? undefined,
    energyType: row.energy_type ?? undefined,
    make: row.make ?? undefined,
    model: row.model ?? undefined,
    yearFrom: row.year_from ?? undefined,
    yearTo: row.year_to ?? undefined,
    partnerType: row.partner_type
      ? String(row.partner_type).split(",").map((s) => s.trim()).filter((s) => s.length > 0)[0]
      : undefined,
    partnerTypes: (row.partner_types && row.partner_types.length > 0)
      ? row.partner_types
      : row.partner_type
      ? String(row.partner_type).split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined,
    serviceCountries: row.service_countries ?? undefined,
    serviceStates: row.service_states ?? undefined,
    serviceCities: row.service_cities ?? undefined,
    permitNumber: row.permit_number ?? undefined,
    status: row.status,
    permit: row.permit,
    documentsOk: row.documents_ok,
    rating: Number(row.rating),
    totalRides: row.total_rides,
    joinedAt: row.joined_at,
  };
}

export async function fetchPartners(): Promise<PartnerRecord[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("partners")
      .select("*")
      .order("joined_at", { ascending: false });
    if (error) {
      log("fetchPartners error", error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToPartner(r as PartnerRow));
  } catch (e) {
    log("fetchPartners threw", e);
    return null;
  }
}

const partnerIdMap = new Map<string, string>();

export async function resolvePartnerSupabaseId(displayId: string): Promise<string | null> {
  if (partnerIdMap.has(displayId)) return partnerIdMap.get(displayId)!;
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("partners")
    .select("id")
    .eq("display_id", displayId)
    .maybeSingle();
  if (error || !data) return null;
  partnerIdMap.set(displayId, data.id);
  return data.id;
}

/**
 * Outcome of an admin write that syncs to Supabase, so the calling screen can
 * tell the operator the change did not land instead of reporting "Saved" over
 * a rejected write.
 */
export type AdminWriteResult = { ok: boolean; error?: string };

const NOT_CONFIGURED: AdminWriteResult = {
  ok: false,
  error: "Not connected to the server.",
};

/**
 * Write a partner row.
 *
 * An existing row is UPDATEd rather than upserted: `partnerToRow` deliberately
 * carries no `auth_user_id` (the back office must not be able to re-own a
 * partner), and an upsert is an `insert … on conflict do update`, so Postgres
 * still evaluates the INSERT policy's WITH CHECK against the proposed row —
 * where `auth_user_id` is null. That fails `partners self insert` and the whole
 * statement is rejected, even when the caller is editing their own row. An
 * UPDATE only has to satisfy `partners self update` / `partners admin update`
 * (migration 0083).
 */
export async function upsertPartner(p: PartnerRecord): Promise<AdminWriteResult> {
  if (!isSupabaseConfigured || !supabase) return NOT_CONFIGURED;
  try {
    const existing = await resolvePartnerSupabaseId(p.id);
    if (existing) {
      const { id: _id, ...patch } = partnerToRow(p, existing);
      const { error } = await supabase.from("partners").update(patch).eq("id", existing);
      if (error) {
        log("upsertPartner update error", p.id, error.message);
        return { ok: false, error: error.message };
      }
      partnerIdMap.set(p.id, existing);
      return { ok: true };
    }
    const supabaseId = uuidv4();
    const { error } = await supabase.from("partners").insert(partnerToRow(p, supabaseId));
    if (error) {
      log("upsertPartner insert error", p.id, error.message);
      return { ok: false, error: error.message };
    }
    partnerIdMap.set(p.id, supabaseId);
    return { ok: true };
  } catch (e) {
    log("upsertPartner threw", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deletePartner(displayId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const supabaseId = await resolvePartnerSupabaseId(displayId);
    if (!supabaseId) return;
    const { error } = await supabase.from("partners").delete().eq("id", supabaseId);
    if (error) log("deletePartner error", error.message);
    else partnerIdMap.delete(displayId);
  } catch (e) {
    log("deletePartner threw", e);
  }
}

// ---------------------------------------------------------------------------
// Users (profiles)
// ---------------------------------------------------------------------------

/**
 * Map the capitalized `profile_status` enum used by the rest of the app
 * ('Approved' / 'Un-Approved' / 'Blocked' / 'Rejected' / 'Deleted') to the
 * lowercase UserStatus values the admin UI filters by. Fall back to the
 * lowercase `status` column for older rows that haven't been migrated.
 */
function mapProfileStatus(row: ProfileRow): UserStatus {
  const ps = (row.profile_status ?? "").toString().toLowerCase().replace(/\s+/g, "");
  switch (ps) {
    case "approved": return "approved";
    case "un-approved":
    case "unapproved": return "unapproved";
    case "blocked": return "blocked";
    case "rejected": return "rejected";
    case "deleted": return "deleted";
    default: return row.status ?? "unapproved";
  }
}

function rowToUser(row: ProfileRow): UserRecord {
  return {
    id: row.display_id ?? row.id,
    name: row.name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    ic: row.ic ?? undefined,
    address: row.address ?? undefined,
    profileImage: row.profile_image ?? undefined,
    idImage: row.id_image ?? undefined,
    nationality: row.nationality ?? undefined,
    gender: row.gender ?? undefined,
    birthDate: row.birth_date ?? undefined,
    referralCode: row.referral_code ?? undefined,
    status: mapProfileStatus(row),
    idVerified: row.id_verified === "Verified" ? "verified" : row.id_verified === "Failed" ? "failed" : undefined,
    documentsOk: row.documents_ok,
    totalRides: row.total_rides,
    joinedAt: row.joined_at,
  };
}

export async function fetchUsers(): Promise<UserRecord[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("joined_at", { ascending: false });
    if (error) {
      log("fetchUsers error", error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToUser(r as ProfileRow));
  } catch (e) {
    log("fetchUsers threw", e);
    return null;
  }
}

const userIdMap = new Map<string, string>();

async function resolveUserSupabaseId(displayId: string): Promise<string | null> {
  if (userIdMap.has(displayId)) return userIdMap.get(displayId)!;
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("display_id", displayId)
    .maybeSingle();
  if (error || !data) return null;
  userIdMap.set(displayId, data.id);
  return data.id;
}

/**
 * Profiles are normally created by the `handle_new_auth_user` trigger when an
 * auth user signs up. From the admin panel we only update existing rows; if
 * none exists we no-op rather than create an orphaned profile without an
 * auth.users entry (which the `id` foreign key would reject anyway).
 */
export async function upsertUser(u: UserRecord): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const supabaseId = await resolveUserSupabaseId(u.id);
    if (!supabaseId) {
      log("upsertUser skipped (no matching profile)", u.id);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        display_id: u.id,
        name: u.name,
        phone: u.phone,
        email: u.email,
        ic: u.ic ?? null,
        address: u.address ?? null,
        profile_image: u.profileImage ?? null,
        id_image: u.idImage ?? null,
        nationality: u.nationality ?? null,
        gender: u.gender ?? null,
        birth_date: u.birthDate ?? null,
        referral_code: u.referralCode ?? null,
        status: u.status,
        profile_status: ((): "Approved" | "Un-Approved" | "Blocked" | "Rejected" | "Deleted" => {
          switch (u.status) {
            case "approved": return "Approved";
            case "blocked": return "Blocked";
            case "rejected": return "Rejected";
            case "deleted": return "Deleted";
            default: return "Un-Approved";
          }
        })(),
        documents_ok: u.documentsOk,
        total_rides: u.totalRides,
      })
      .eq("id", supabaseId);
    if (error) log("upsertUser error", u.id, error.message);
  } catch (e) {
    log("upsertUser threw", e);
  }
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

type VehicleRow = {
  id: string;
  display_id: string | null;
  owner_partner_id: string | null;
  owner_partner_display_id: string | null;
  plate: string;
  make: string | null;
  model: string | null;
  year: string | null;
  color: string | null;
  vehicle_type: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_ic: string | null;
  auth_user_id: string | null;
  vin: string | null;
  engine_number: string | null;
  service_countries: string[] | null;
  service_states: string[] | null;
  service_cities: string[] | null;
  partner_types: string[] | null;
  onboarding_step: string | null;
  status: VehicleStatus;
  permit: PermitStatus;
  documents_ok: boolean;
  joined_at: string;
};

function vehicleToRow(v: VehicleRecord, supabaseId: string) {
  return {
    id: supabaseId,
    display_id: v.id,
    owner_partner_id: v.ownerPartnerUuid ?? null,
    owner_partner_display_id: v.partnerId ?? null,
    plate: v.plate,
    make: v.make,
    model: v.model,
    year: v.year ?? null,
    color: v.color ?? null,
    vehicle_type: v.vehicleType ?? null,
    owner_name: v.ownerName,
    owner_phone: v.ownerPhone,
    service_countries: v.serviceCountries ?? [],
    service_states: v.serviceStates ?? [],
    service_cities: v.serviceCities ?? [],
    status: v.status,
    permit: v.permit,
    documents_ok: v.documentsOk,
    joined_at: v.joinedAt,
  };
}

function rowToVehicle(row: VehicleRow): VehicleRecord {
  return {
    id: row.display_id ?? row.id,
    plate: row.plate,
    make: row.make ?? "",
    model: row.model ?? "",
    year: row.year ?? undefined,
    color: row.color ?? undefined,
    vehicleType: row.vehicle_type ?? undefined,
    ownerName: row.owner_name ?? "",
    ownerPhone: row.owner_phone ?? "",
    partnerId: row.owner_partner_display_id ?? undefined,
    ownerPartnerUuid: row.owner_partner_id ?? undefined,
    status: row.status,
    permit: row.permit,
    documentsOk: row.documents_ok,
    joinedAt: row.joined_at,
    serviceCountries: row.service_countries ?? [],
    serviceStates: row.service_states ?? [],
    serviceCities: row.service_cities ?? [],
  };
}

export async function fetchVehicles(): Promise<VehicleRecord[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("vehicle")
      .select("*")
      .order("joined_at", { ascending: false });
    if (error) {
      log("fetchVehicles error", error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToVehicle(r as VehicleRow));
  } catch (e) {
    log("fetchVehicles threw", e);
    return null;
  }
}

const vehicleIdMap = new Map<string, string>();

async function resolveVehicleSupabaseId(displayId: string): Promise<string | null> {
  if (vehicleIdMap.has(displayId)) return vehicleIdMap.get(displayId)!;
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from("vehicle")
    .select("id")
    .eq("display_id", displayId)
    .maybeSingle();
  if (error || !data) return null;
  vehicleIdMap.set(displayId, data.id);
  return data.id;
}

export async function upsertVehicle(v: VehicleRecord): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const existing = await resolveVehicleSupabaseId(v.id);
    const supabaseId = existing ?? uuidv4();
    const { error } = await supabase
      .from("vehicle")
      .upsert(vehicleToRow(v, supabaseId), { onConflict: "id" });
    if (error) {
      log("upsertVehicle error", v.id, error.message);
      return;
    }
    vehicleIdMap.set(v.id, supabaseId);
  } catch (e) {
    log("upsertVehicle threw", e);
  }
}

export async function deleteVehicle(displayId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const supabaseId = await resolveVehicleSupabaseId(displayId);
    if (!supabaseId) return;
    const { error } = await supabase.from("vehicle").delete().eq("id", supabaseId);
    if (error) log("deleteVehicle error", error.message);
    else vehicleIdMap.delete(displayId);
  } catch (e) {
    log("deleteVehicle threw", e);
  }
}

// ---------------------------------------------------------------------------
// Vehicle make/model catalog
// ---------------------------------------------------------------------------

type VehicleMakeModelRow = {
  id: string;
  vehicle_type: string;
  energy_type: string;
  make: string;
  model: string;
  year_from: string | null;
  year_to: string | null;
  icon_uri: string | null;
  status: boolean;
  is_default: boolean;
  position: number | null;
  created_at: string;
  updated_at: string;
};

function rowToVMM(row: VehicleMakeModelRow): VehicleMakeModelRecord {
  return {
    id: row.id,
    vehicleType: row.vehicle_type,
    energyType: row.energy_type,
    make: row.make,
    model: row.model,
    yearFrom: row.year_from ?? "",
    yearTo: row.year_to ?? "",
    iconUri: row.icon_uri ?? "",
    status: Boolean(row.status),
    isDefault: Boolean(row.is_default),
    position: row.position ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchVehicleMakeModels(): Promise<
  VehicleMakeModelRecord[] | null
> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("vehicle_make_models")
      .select("*")
      .order("position", { ascending: true });
    if (error) {
      log("fetchVehicleMakeModels error", error.message);
      return null;
    }
    return (data ?? []).map((r) => rowToVMM(r as VehicleMakeModelRow));
  } catch (e) {
    log("fetchVehicleMakeModels threw", e);
    return null;
  }
}

export async function upsertVehicleMakeModel(
  v: VehicleMakeModelRecord
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase
      .from("vehicle_make_models")
      .upsert(
        {
          id: v.id,
          vehicle_type: v.vehicleType,
          energy_type: v.energyType,
          make: v.make,
          model: v.model,
          year_from: v.yearFrom ?? "",
          year_to: v.yearTo ?? "",
          icon_uri: v.iconUri ?? "",
          status: Boolean(v.status),
          is_default: Boolean(v.isDefault),
          position: v.position ?? 0,
        },
        { onConflict: "id" }
      );
    if (error) log("upsertVehicleMakeModel error", v.id, error.message);
  } catch (e) {
    log("upsertVehicleMakeModel threw", e);
  }
}

export async function deleteVehicleMakeModel(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase
      .from("vehicle_make_models")
      .delete()
      .eq("id", id);
    if (error) log("deleteVehicleMakeModel error", error.message);
  } catch (e) {
    log("deleteVehicleMakeModel threw", e);
  }
}

// ---------------------------------------------------------------------------
// Regions: countries / states / cities / suburbs
// ---------------------------------------------------------------------------

type RegionRow = {
  id: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  name: string;
  values: Record<string, string | number | boolean> | null;
  geofence: { boundary?: string; source?: string; updatedAt?: string } | null;
  position: number | null;
  created_at: string;
  updated_at: string;
};

function regionLevel(values: Record<string, string | number | boolean>):
  | "country"
  | "state"
  | "city"
  | "suburb" {
  const s = String(values.state ?? "").trim();
  const c = String(values.city ?? "").trim();
  const sb = String(values.suburb ?? "").trim();
  if (sb) return "suburb";
  if (c) return "city";
  if (s) return "state";
  return "country";
}

function rowToRegionEntry(
  row: RegionRow,
  level: "country" | "state" | "city" | "suburb"
): SettingEntry {
  const base = row.values ?? {};
  const values: Record<string, string | number | boolean> = { ...base };
  // Re-hydrate the legacy boundary keys from the dedicated geofence column so
  // the admin screen (which still reads values.boundary) keeps working.
  const gf = row.geofence;
  if (gf && typeof gf === "object") {
    if (typeof gf.boundary === "string" && gf.boundary.length > 0) {
      values.boundary = gf.boundary;
    }
    if (typeof gf.source === "string" && gf.source.length > 0) {
      values.boundarySource = gf.source;
    }
    if (typeof gf.updatedAt === "string" && gf.updatedAt.length > 0) {
      values.boundaryUpdatedAt = gf.updatedAt;
    }
  }
  if (level === "country") {
    values.country = row.name;
    values.state = "";
    values.city = "";
    values.suburb = "";
  } else if (level === "state") {
    values.country = row.country ?? "";
    values.state = row.name;
    values.city = "";
    values.suburb = "";
  } else if (level === "city") {
    values.country = row.country ?? "";
    values.state = row.state ?? "";
    values.city = row.name;
    values.suburb = "";
  } else {
    values.country = row.country ?? "";
    values.state = row.state ?? "";
    values.city = row.city ?? "";
    values.suburb = row.name;
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    values,
  };
}

/** Fetch all region rows merged back into the legacy SettingEntry[] shape. */
export async function fetchRegions(): Promise<SettingEntry[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const [countries, states, cities, suburbs] = await Promise.all([
      supabase.from("countries").select("id, name, values, geofence, position, created_at, updated_at").order("position", { ascending: true }),
      supabase.from("states").select("id, country, name, values, geofence, position, created_at, updated_at").order("position", { ascending: true }),
      supabase.from("cities").select("id, country, state, name, values, geofence, position, created_at, updated_at").order("position", { ascending: true }),
      supabase.from("suburbs").select("id, country, state, city, name, values, geofence, position, created_at, updated_at").order("position", { ascending: true }),
    ]);
    if (countries.error) log("fetchRegions countries error", countries.error.message);
    if (states.error) log("fetchRegions states error", states.error.message);
    if (cities.error) log("fetchRegions cities error", cities.error.message);
    if (suburbs.error) log("fetchRegions suburbs error", suburbs.error.message);
    const out: SettingEntry[] = [];
    (countries.data ?? []).forEach((r) => out.push(rowToRegionEntry(r as RegionRow, "country")));
    (states.data ?? []).forEach((r) => out.push(rowToRegionEntry(r as RegionRow, "state")));
    (cities.data ?? []).forEach((r) => out.push(rowToRegionEntry(r as RegionRow, "city")));
    (suburbs.data ?? []).forEach((r) => out.push(rowToRegionEntry(r as RegionRow, "suburb")));
    return out;
  } catch (e) {
    log("fetchRegions threw", e);
    return null;
  }
}

/** Route an entry to the right regions table based on its level. */
export async function upsertRegion(entry: SettingEntry, position?: number): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const v = entry.values ?? {};
    const country = String(v.country ?? "").trim();
    const state = String(v.state ?? "").trim();
    const city = String(v.city ?? "").trim();
    const suburb = String(v.suburb ?? "").trim();
    if (!country) {
      log("upsertRegion skipped: missing country", entry.id);
      return;
    }
    const level = regionLevel(v);

    // Strip the level columns from the JSONB payload — they live as real
    // columns on the destination table so we don't need them duplicated.
    const payloadValues: Record<string, string | number | boolean> = { ...v };
    delete payloadValues.country;
    delete payloadValues.state;
    delete payloadValues.city;
    delete payloadValues.suburb;

    // Promote the boundary keys to the dedicated geofence column.
    const boundaryRaw = typeof v.boundary === "string" ? v.boundary : "";
    const boundarySource = typeof v.boundarySource === "string" ? v.boundarySource : "";
    const boundaryUpdatedAt = typeof v.boundaryUpdatedAt === "string" ? v.boundaryUpdatedAt : "";
    delete payloadValues.boundary;
    delete payloadValues.boundarySource;
    delete payloadValues.boundaryUpdatedAt;
    const geofence: { boundary?: string; source?: string; updatedAt?: string } | null = boundaryRaw
      ? {
          boundary: boundaryRaw,
          ...(boundarySource ? { source: boundarySource } : {}),
          ...(boundaryUpdatedAt ? { updatedAt: boundaryUpdatedAt } : {}),
        }
      : null;

    // Before inserting, remove any existing rows for the same id from the
    // *other* level tables so a row that gets re-classified (e.g. country →
    // city when extra fields are filled in) doesn't end up duplicated.
    const allTables = ["countries", "states", "cities", "suburbs"] as const;
    const targetTable = (
      level === "country"
        ? "countries"
        : level === "state"
        ? "states"
        : level === "city"
        ? "cities"
        : "suburbs"
    ) as (typeof allTables)[number];
    for (const t of allTables) {
      if (t === targetTable) continue;
      const { error } = await supabase.from(t).delete().eq("id", entry.id);
      if (error) log("upsertRegion cleanup error", t, error.message);
    }

    if (level === "country") {
      const { error } = await supabase.from("countries").upsert(
        {
          id: entry.id,
          name: country,
          values: payloadValues,
          geofence,
          position: position ?? 0,
        },
        { onConflict: "name" }
      );
      if (error) log("upsertRegion countries error", entry.id, error.message);
    } else if (level === "state") {
      const { error } = await supabase.from("states").upsert(
        {
          id: entry.id,
          country,
          name: state,
          values: payloadValues,
          geofence,
          position: position ?? 0,
        },
        { onConflict: "country,name" }
      );
      if (error) log("upsertRegion states error", entry.id, error.message);
    } else if (level === "city") {
      const { error } = await supabase.from("cities").upsert(
        {
          id: entry.id,
          country,
          state,
          name: city,
          values: payloadValues,
          geofence,
          position: position ?? 0,
        },
        { onConflict: "country,state,name" }
      );
      if (error) log("upsertRegion cities error", entry.id, error.message);
    } else {
      const { error } = await supabase.from("suburbs").upsert(
        {
          id: entry.id,
          country,
          state,
          city,
          name: suburb,
          values: payloadValues,
          geofence,
          position: position ?? 0,
        },
        { onConflict: "country,state,city,name" }
      );
      if (error) log("upsertRegion suburbs error", entry.id, error.message);
    }
  } catch (e) {
    log("upsertRegion threw", e);
  }
}

/** Delete a region row by id — we don't know which table holds it, so try all. */
export async function deleteRegion(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const tables = ["countries", "states", "cities", "suburbs"] as const;
    await Promise.all(
      tables.map(async (t) => {
        const { error } = await supabase!.from(t).delete().eq("id", id);
        if (error) log("deleteRegion error", t, error.message);
      })
    );
  } catch (e) {
    log("deleteRegion threw", e);
  }
}

export async function deleteUser(displayId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const supabaseId = await resolveUserSupabaseId(displayId);
    if (!supabaseId) return;
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", supabaseId);
    if (error) log("deleteUser error", error.message);
    else userIdMap.delete(displayId);
  } catch (e) {
    log("deleteUser threw", e);
  }
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/** True when an RPC isn't in the live database yet (pre-0069 schema). */
function isMissingFunctionError(err: unknown): boolean {
  const msg = (
    typeof err === "object" && err !== null
      ? String((err as { message?: string }).message ?? "") +
        " " +
        String((err as { code?: string }).code ?? "")
      : String(err ?? "")
  ).toLowerCase();
  return (
    msg.includes("pgrst202") ||
    msg.includes("could not find") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

// Once the DB reports the push RPCs are missing (migration 0069 not applied
// yet), go straight to the legacy direct writes.
let pushRpcMissing = false;

/**
 * Register (or refresh) an Expo push token for a device. Uses the
 * owner-scoped `push_register_token` RPC (0069 — the push_tokens table is no
 * longer writable directly); falls back to the legacy upsert on older
 * databases.
 */
export async function savePushToken(
  token: string,
  profileId: string | null,
  platform: string,
  deviceName?: string | null
): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !token) return;
  try {
    if (!pushRpcMissing) {
      const { error } = await supabase.rpc("push_register_token", {
        p_token: token,
        p_platform: platform,
        p_device_name: deviceName ?? null,
      });
      if (!error) return;
      if (!isMissingFunctionError(error)) {
        log("savePushToken rpc error", error.message);
        return;
      }
      pushRpcMissing = true;
    }
    const { error } = await supabase.from("push_tokens").upsert(
      {
        token,
        profile_id: profileId,
        platform,
        device_name: deviceName ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" }
    );
    if (error) log("savePushToken error", error.message);
  } catch (e) {
    log("savePushToken threw", e);
  }
}

/**
 * Remove a device's push token (e.g. on logout). The `push_unregister_token`
 * RPC works even after the auth session is gone (knowing the token is the
 * capability); falls back to the legacy delete on older databases.
 */
export async function removePushToken(token: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !token) return;
  try {
    if (!pushRpcMissing) {
      const { error } = await supabase.rpc("push_unregister_token", { p_token: token });
      if (!error) return;
      if (!isMissingFunctionError(error)) {
        log("removePushToken rpc error", error.message);
        return;
      }
      pushRpcMissing = true;
    }
    const { error } = await supabase.from("push_tokens").delete().eq("token", token);
    if (error) log("removePushToken error", error.message);
  } catch (e) {
    log("removePushToken threw", e);
  }
}

/** Count registered devices (for the admin dashboard). */
export async function countPushTokens(): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return 0;
  try {
    const { count, error } = await supabase
      .from("push_tokens")
      .select("id", { count: "exact", head: true });
    if (error) {
      log("countPushTokens error", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    log("countPushTokens threw", e);
    return 0;
  }
}

export interface SendPushResult {
  ok: boolean;
  recipients: number;
  sent: number;
  failed: number;
  error?: string;
}

/**
 * Dispatch a push broadcast via the `send-push` edge function. The function
 * resolves the audience to a token set, calls Expo's push service, and logs the
 * dispatch to `public.push_notifications`.
 */
export async function sendPushNotification(
  title: string,
  body: string,
  audience: string
): Promise<SendPushResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, recipients: 0, sent: 0, failed: 0, error: "Supabase is not configured" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("send-push", {
      body: { title, body, audience },
    });
    if (error) {
      log("sendPushNotification error", error.message);
      return { ok: false, recipients: 0, sent: 0, failed: 0, error: error.message };
    }
    const r = (data ?? {}) as {
      recipients?: number;
      sent?: number;
      failed?: number;
      error?: string;
    };
    if (r.error) {
      return { ok: false, recipients: 0, sent: 0, failed: 0, error: r.error };
    }
    return {
      ok: true,
      recipients: r.recipients ?? 0,
      sent: r.sent ?? 0,
      failed: r.failed ?? 0,
    };
  } catch (e) {
    log("sendPushNotification threw", e);
    return { ok: false, recipients: 0, sent: 0, failed: 0, error: String(e) };
  }
}
