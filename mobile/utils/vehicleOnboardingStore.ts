import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { VEHICLE_DOCS_BUCKET } from "@/utils/vehicleDocumentsStore";

/**
 * Row shape for the singular `public.vehicle` profile table
 * created in migration 0029. This is the canonical home for
 * vehicle identity, ownership, and onboarding lifecycle.
 */
export interface VehicleRow {
  id: string;
  display_id: string | null;
  auth_user_id: string | null;
  owner_partner_id: string | null;
  owner_partner_display_id: string | null;
  owner_name: string;
  owner_phone: string;
  owner_ic: string | null;
  plate: string;
  make: string;
  model: string;
  year: string | null;
  color: string | null;
  vehicle_type: string | null;
  vin: string | null;
  engine_number: string | null;
  status: string;
  permit: string;
  documents_ok: boolean;
  onboarding_step: string | null;
  image_front: string | null;
  image_left: string | null;
  image_right: string | null;
  image_back: string | null;
}

export type VehiclePhotoSlot = "front" | "left" | "right" | "back";

export const VEHICLE_PHOTO_SLOTS: VehiclePhotoSlot[] = [
  "front",
  "left",
  "right",
  "back",
];

export type VehicleOnboardingStep =
  | "plate"
  | "confirm-existing"
  | "verify-owner"
  | "make-model"
  | "year-color"
  | "owner"
  | "documents"
  | "photos"
  | "status"
  | "done";

/** Fetch a single vehicle by id. Returns null if not found or on error. */
export async function fetchVehicleById(
  vehicleId: string
): Promise<VehicleRow | null> {
  if (!isSupabaseConfigured || !supabase || !vehicleId) return null;
  try {
    const { data, error } = await supabase
      .from(VEHICLE_TABLE)
      .select(VEHICLE_COLS)
      .eq("id", vehicleId)
      .maybeSingle();
    if (error) {
      console.log("[vehicle-onboarding] fetchVehicleById error", error.message);
      return null;
    }
    return (data as VehicleRow | null) ?? null;
  } catch (e) {
    console.log("[vehicle-onboarding] fetchVehicleById threw", e);
    return null;
  }
}

const VEHICLE_TABLE = "vehicle" as const;

// Use `*` so the select tolerates schemas where migration 0030 (image_* columns)
// hasn't been applied yet. Missing columns simply come back as undefined.
const VEHICLE_COLS = "*";

const normalizePlate = (plate: string): string =>
  plate.replace(/\s+/g, " ").trim().toUpperCase();

/** Look up a vehicle by its plate (case-insensitive, whitespace-normalized). */
export async function findVehicleByPlate(plate: string): Promise<VehicleRow | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const p = normalizePlate(plate);
  if (!p) return null;
  try {
    const { data, error } = await supabase
      .from(VEHICLE_TABLE)
      .select(VEHICLE_COLS)
      .ilike("plate", p)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.log("[vehicle-onboarding] findVehicleByPlate error", error.message);
      return null;
    }
    return (data as VehicleRow | null) ?? null;
  } catch (e) {
    console.log("[vehicle-onboarding] findVehicleByPlate threw", e);
    return null;
  }
}

/** Get the vehicle currently assigned to a partner (if any). */
export async function fetchPartnerVehicle(partnerId: string): Promise<VehicleRow | null> {
  if (!isSupabaseConfigured || !supabase || !partnerId) return null;
  try {
    const { data, error } = await supabase
      .from(VEHICLE_TABLE)
      .select(VEHICLE_COLS)
      .eq("owner_partner_id", partnerId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.log("[vehicle-onboarding] fetchPartnerVehicle error", error.message);
      return null;
    }
    return (data as VehicleRow | null) ?? null;
  } catch (e) {
    console.log("[vehicle-onboarding] fetchPartnerVehicle threw", e);
    return null;
  }
}

/** Fetch the IC number of a partner by id. Used to verify an existing vehicle owner. */
export async function fetchPartnerIc(partnerId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !partnerId) return null;
  try {
    const { data, error } = await supabase
      .from("partners")
      .select("ic")
      .eq("id", partnerId)
      .maybeSingle();
    if (error) {
      console.log("[vehicle-onboarding] fetchPartnerIc error", error.message);
      return null;
    }
    return ((data as { ic?: string | null } | null)?.ic ?? null) || null;
  } catch (e) {
    console.log("[vehicle-onboarding] fetchPartnerIc threw", e);
    return null;
  }
}

/** Patch a vehicle row. */
export async function patchVehicle(
  vehicleId: string,
  patch: Partial<VehicleRow>
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from(VEHICLE_TABLE).update(patch).eq("id", vehicleId);
    if (error) {
      console.log("[vehicle-onboarding] patchVehicle error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[vehicle-onboarding] patchVehicle threw", e);
    return false;
  }
}

/**
 * Create a new minimal vehicle row with just the plate. Returns the inserted row.
 * On failure, returns `{ error }` with the Supabase error message so the caller
 * can surface a useful message to the user.
 */
export async function createVehicleStub(
  plate: string,
  ownerName: string,
  ownerPhone: string,
  partnerId: string | null,
  partnerDisplayId: string | null,
  authUserId: string | null
): Promise<{ row: VehicleRow | null; error: string | null }> {
  if (!isSupabaseConfigured || !supabase) {
    return { row: null, error: "Supabase is not configured." };
  }
  const id = uuidv4();
  // Minimal payload — relies on table defaults for status/permit/documents_ok/
  // service_*/joined_at/created_at/updated_at and leaves the photo columns
  // unset so this still works if migration 0030 hasn't been applied yet.
  const stub: Record<string, unknown> = {
    id,
    display_id: `VH-${Date.now().toString().slice(-6)}`,
    auth_user_id: authUserId,
    owner_partner_id: partnerId,
    owner_partner_display_id: partnerDisplayId,
    owner_name: ownerName || "",
    owner_phone: ownerPhone || "",
    plate: normalizePlate(plate),
    onboarding_step: "make-model",
  };
  try {
    const { data, error } = await supabase
      .from(VEHICLE_TABLE)
      .insert(stub)
      .select(VEHICLE_COLS)
      .maybeSingle();
    if (error) {
      console.log("[vehicle-onboarding] createVehicleStub error", error.message, error);
      return { row: null, error: error.message || "Insert failed." };
    }
    const row = (data as VehicleRow | null) ?? ({ ...stub } as unknown as VehicleRow);
    return { row, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[vehicle-onboarding] createVehicleStub threw", e);
    return { row: null, error: msg };
  }
}

/**
 * Decide which step a vehicle is currently on based on what's been filled.
 * Used when resuming an incomplete registration.
 */
export function computeFirstVehicleStep(v: VehicleRow | null): VehicleOnboardingStep {
  if (!v) return "plate";
  if (!v.make?.trim() || !v.model?.trim()) return "make-model";
  if (!v.year?.toString().trim() || !v.color?.toString().trim()) return "year-color";
  // Resume order matches the visual flow: photos -> owner -> documents.
  if (
    !v.image_front?.trim() ||
    !v.image_left?.trim() ||
    !v.image_right?.trim() ||
    !v.image_back?.trim()
  ) {
    return "photos";
  }
  if (!v.owner_name?.trim() || !v.owner_phone?.trim() || !v.owner_ic?.trim()) return "owner";
  if (!v.documents_ok) return "documents";
  return "done";
}

function guessExt(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  return "png";
}

function guessContentType(uri: string): string {
  const ext = guessExt(uri);
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

/**
 * Upload one of the four vehicle photos to the `vehicle-documents` storage
 * bucket under `${vehicleId}/photos/${slot}-...`. Returns the public URL.
 */
export async function uploadVehiclePhoto(
  localUri: string,
  vehicleId: string,
  slot: VehiclePhotoSlot
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `${vehicleId}/photos/${slot}-${Date.now()}.${ext}`;
    let body: ArrayBuffer;
    if (localUri.startsWith("data:")) {
      const commaIdx = localUri.indexOf(",");
      body = decodeBase64(commaIdx >= 0 ? localUri.slice(commaIdx + 1) : "");
    } else if (localUri.startsWith("http")) {
      body = await (await fetch(localUri)).arrayBuffer();
    } else {
      const b64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      body = decodeBase64(b64);
    }
    const { error } = await supabase.storage
      .from(VEHICLE_DOCS_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) {
      console.log("[vehicle-onboarding] uploadVehiclePhoto error", error.message);
      return null;
    }
    const { data: pub } = supabase.storage
      .from(VEHICLE_DOCS_BUCKET)
      .getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[vehicle-onboarding] uploadVehiclePhoto threw", e);
    return null;
  }
}

/** Assign a vehicle to a partner (taking ownership). */
export async function assignVehicleToPartner(
  vehicleId: string,
  partnerId: string,
  partnerDisplayId: string | null,
  authUserId: string | null
): Promise<boolean> {
  return patchVehicle(vehicleId, {
    owner_partner_id: partnerId,
    owner_partner_display_id: partnerDisplayId,
    auth_user_id: authUserId,
  });
}
