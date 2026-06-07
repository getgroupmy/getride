import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import type {
  ProviderDocStatus,
  ProviderDocumentAiVerification,
} from "@/utils/providerDocumentsStore";

/**
 * Storage / table for vehicle-related documents (registration card,
 * road tax, insurance, inspection, etc). Mirrors `provider_documents`
 * one-to-one but is keyed by `vehicle_id` instead of `partner_id`.
 *
 * See migration 0029_vehicle_and_vehicle_documents.sql.
 */
export const VEHICLE_DOCS_BUCKET = "vehicle-documents";

export interface VehicleDocumentRow {
  id: string;
  vehicle_id: string;
  partner_id: string | null;
  auth_user_id: string | null;
  doc_id: string;
  doc_name: string;
  document_number: string | null;
  insurance_provider_id: string | null;
  insurance_provider_name: string | null;
  is_pwd: boolean;
  start_date: string | null;
  expiry_date: string | null;
  file_url: string | null;
  file_url_back: string | null;
  status: ProviderDocStatus;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
  updated_at: string;
  ai_verification: ProviderDocumentAiVerification | null;
  ai_verified: boolean | null;
  issuance_country: string | null;
  detected_document_name: string | null;
}

function guessExt(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".pdf")) return "pdf";
  return "png";
}

function guessContentType(uri: string): string {
  const ext = guessExt(uri);
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return "image/png";
}

export async function uploadVehicleDocFile(
  localUri: string,
  vehicleId: string,
  docId: string,
  side: "front" | "back" = "front"
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `${vehicleId}/${docId}/${side}-${Date.now()}.${ext}`;
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
      console.log("[vehicle-docs] upload error", error.message);
      return null;
    }
    const { data: pub } = supabase.storage
      .from(VEHICLE_DOCS_BUCKET)
      .getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[vehicle-docs] upload threw", e);
    return null;
  }
}

export async function fetchVehicleDocuments(
  vehicleId: string
): Promise<VehicleDocumentRow[]> {
  if (!isSupabaseConfigured || !supabase || !vehicleId) return [];
  try {
    const { data, error } = await supabase
      .from("vehicle_documents")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("uploaded_at", { ascending: false });
    if (error) {
      console.log("[vehicle-docs] fetch error", error.message);
      return [];
    }
    return (data as VehicleDocumentRow[]) ?? [];
  } catch (e) {
    console.log("[vehicle-docs] fetch threw", e);
    return [];
  }
}

export interface UpsertVehicleDocInput {
  vehicleId: string;
  partnerId: string | null;
  authUserId: string | null;
  docId: string;
  docName: string;
  documentNumber?: string | null;
  insuranceProviderId?: string | null;
  insuranceProviderName?: string | null;
  isPwd?: boolean;
  startDate?: string | null;
  expiryDate?: string | null;
  fileUrl?: string | null;
  fileUrlBack?: string | null;
  aiVerification?: ProviderDocumentAiVerification | null;
  issuanceCountry?: string | null;
  detectedDocumentName?: string | null;
}

/** Upsert by (vehicle_id, doc_id). Status resets to 'Pending Review' on each fresh upload. */
export async function upsertVehicleDocument(
  input: UpsertVehicleDocInput
): Promise<VehicleDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const payload = {
      vehicle_id: input.vehicleId,
      partner_id: input.partnerId,
      auth_user_id: input.authUserId,
      doc_id: input.docId,
      doc_name: input.docName,
      document_number: input.documentNumber ?? null,
      insurance_provider_id: input.insuranceProviderId ?? null,
      insurance_provider_name: input.insuranceProviderName ?? null,
      is_pwd: Boolean(input.isPwd ?? false),
      start_date: input.startDate ?? null,
      expiry_date: input.expiryDate ?? null,
      file_url: input.fileUrl ?? null,
      file_url_back: input.fileUrlBack ?? null,
      ai_verification: input.aiVerification ?? null,
      ai_verified:
        input.aiVerification == null
          ? null
          : Boolean(input.aiVerification.matchesTitle),
      issuance_country: input.issuanceCountry ?? null,
      detected_document_name: input.detectedDocumentName ?? null,
      status: "Pending Review" as ProviderDocStatus,
      reviewer_notes: null,
      reviewed_at: null,
      uploaded_at: new Date().toISOString(),
    };

    const existing = await supabase
      .from("vehicle_documents")
      .select("id")
      .eq("vehicle_id", input.vehicleId)
      .eq("doc_id", input.docId)
      .maybeSingle();

    if (existing.data?.id) {
      const { data, error } = await supabase
        .from("vehicle_documents")
        .update(payload)
        .eq("id", existing.data.id)
        .select("*")
        .single();
      if (error) {
        console.log("[vehicle-docs] update error", error.message);
        return null;
      }
      return data as VehicleDocumentRow;
    }

    const { data, error } = await supabase
      .from("vehicle_documents")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      console.log("[vehicle-docs] insert error", error.message);
      return null;
    }
    return data as VehicleDocumentRow;
  } catch (e) {
    console.log("[vehicle-docs] upsert threw", e);
    return null;
  }
}

/** Admin: fetch all vehicle documents, optionally filtered by status. */
export async function fetchAllVehicleDocuments(
  status?: ProviderDocStatus | null
): Promise<VehicleDocumentRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    let q = supabase.from("vehicle_documents").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("uploaded_at", { ascending: false });
    if (error) {
      console.log("[vehicle-docs] fetchAll error", error.message);
      return [];
    }
    return (data as VehicleDocumentRow[]) ?? [];
  } catch (e) {
    console.log("[vehicle-docs] fetchAll threw", e);
    return [];
  }
}

/** Admin: update review status of a single vehicle document. */
export async function setVehicleDocumentStatus(
  id: string,
  status: ProviderDocStatus,
  reviewerNotes?: string | null
): Promise<VehicleDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from("vehicle_documents")
      .update({
        status,
        reviewer_notes: reviewerNotes ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.log("[vehicle-docs] setStatus error", error.message);
      return null;
    }
    return data as VehicleDocumentRow;
  } catch (e) {
    console.log("[vehicle-docs] setStatus threw", e);
    return null;
  }
}

export interface UpdateVehicleDocMetadataInput {
  doc_name?: string;
  document_number?: string | null;
  insurance_provider_name?: string | null;
  issuance_country?: string | null;
  start_date?: string | null;
  expiry_date?: string | null;
  is_pwd?: boolean;
}

/** Admin: edit metadata fields on a single vehicle document. */
export async function updateVehicleDocumentMetadata(
  id: string,
  patch: UpdateVehicleDocMetadataInput
): Promise<VehicleDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from("vehicle_documents")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.log("[vehicle-docs] updateMetadata error", error.message);
      return null;
    }
    return data as VehicleDocumentRow;
  } catch (e) {
    console.log("[vehicle-docs] updateMetadata threw", e);
    return null;
  }
}

/** Admin: permanently delete a vehicle document row. */
export async function deleteVehicleDocument(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  try {
    const { error } = await supabase
      .from("vehicle_documents")
      .delete()
      .eq("id", id);
    if (error) {
      console.log("[vehicle-docs] delete error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[vehicle-docs] delete threw", e);
    return false;
  }
}

export interface VehicleDocsApprovalCheck {
  ok: boolean;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  expired: number;
  failed: number;
  hasAny: boolean;
  /** True when supabase isn't configured and we couldn't actually check. */
  unknown: boolean;
}

/**
 * Verifies every document attached to a vehicle is in `Approved` status.
 * Used to gate vehicle approval from the admin side.
 */
export async function checkVehicleDocsAllApproved(
  vehicleId: string
): Promise<VehicleDocsApprovalCheck> {
  const empty: VehicleDocsApprovalCheck = {
    ok: false,
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    expired: 0,
    failed: 0,
    hasAny: false,
    unknown: false,
  };
  if (!isSupabaseConfigured || !supabase || !vehicleId) {
    return { ...empty, unknown: true };
  }
  // VehicleRecord.id from the admin store is typically the `display_id`
  // (e.g. "v-001") while vehicle_documents.vehicle_id is the supabase UUID.
  // Try the value directly first; if nothing matches, resolve it through the
  // `vehicle` table by display_id and retry.
  let rows = await fetchVehicleDocuments(vehicleId);
  if (rows.length === 0) {
    try {
      const { data: vrow } = await supabase
        .from("vehicle")
        .select("id")
        .eq("display_id", vehicleId)
        .maybeSingle();
      if (vrow?.id && vrow.id !== vehicleId) {
        rows = await fetchVehicleDocuments(vrow.id);
      }
    } catch (e) {
      console.log("[vehicle-docs] resolve display_id threw", e);
    }
  }
  if (rows.length === 0) return empty;
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let expired = 0;
  let failed = 0;
  for (const r of rows) {
    const s = computeVehicleDocDisplayStatus(r);
    if (s === "Approved") approved += 1;
    else if (s === "Rejected") rejected += 1;
    else if (s === "Expired") expired += 1;
    else if (s === "Failed") failed += 1;
    else pending += 1;
  }
  return {
    ok: approved === rows.length,
    total: rows.length,
    approved,
    pending,
    rejected,
    expired,
    failed,
    hasAny: true,
    unknown: false,
  };
}

/** Applies the same "expired if past expiry_date" rule the DB trigger does. */
export function computeVehicleDocDisplayStatus(
  row: VehicleDocumentRow
): ProviderDocStatus {
  if (
    row.expiry_date &&
    new Date(row.expiry_date).getTime() < Date.now() &&
    row.status !== "Rejected"
  ) {
    return "Expired";
  }
  return row.status;
}
