import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

export const PROVIDER_DOCS_BUCKET = "provider-documents";

export type ProviderDocStatus =
  | "Approved"
  | "Pending Review"
  | "Rejected"
  | "Expired";

export interface ProviderDocumentAiVerification {
  isReal: boolean;
  isRelevant: boolean;
  matchesTitle: boolean;
  detectedTitle: string;
  confidence: number;
  reason: string;
  verifiedAt: string;
  rawText?: string;
  extracted?: {
    documentNumber?: string | null;
    documentNumbers?: string[];
    startDate?: string | null;
    expiryDate?: string | null;
    insuranceProviderName?: string | null;
    isPwd?: boolean | null;
    issuanceCountry?: string | null;
    documentName?: string | null;
    taxiPermit?: {
      name?: string | null;
      idNumber?: string | null;
      validityFrom?: string | null;
      validityTo?: string | null;
      driverType?: string | null;
      licenceReferenceNumber?: string | null;
      vehicleNumber?: string | null;
      licenceClass?: string | null;
      companyName?: string | null;
      address?: string | null;
      hasImageOnPermit?: boolean | null;
      photoBox?: { x: number; y: number; width: number; height: number } | null;
      hasQrCode?: boolean | null;
      photoUrl?: string | null;
    } | null;
  };
}

export interface ProviderDocumentRow {
  id: string;
  partner_id: string;
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

export async function uploadProviderDocFile(
  localUri: string,
  partnerId: string,
  docId: string,
  side: "front" | "back" | "permit-photo" = "front"
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `${partnerId}/${docId}/${side}-${Date.now()}.${ext}`;
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
      .from(PROVIDER_DOCS_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) {
      console.log("[provider-docs] upload error", error.message);
      return null;
    }
    const { data: pub } = supabase.storage
      .from(PROVIDER_DOCS_BUCKET)
      .getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[provider-docs] upload threw", e);
    return null;
  }
}

export async function fetchProviderDocuments(
  partnerId: string
): Promise<ProviderDocumentRow[]> {
  if (!isSupabaseConfigured || !supabase || !partnerId) return [];
  try {
    const { data, error } = await supabase
      .from("provider_documents")
      .select("*")
      .eq("partner_id", partnerId)
      .order("uploaded_at", { ascending: false });
    if (error) {
      console.log("[provider-docs] fetch error", error.message);
      return [];
    }
    return (data as ProviderDocumentRow[]) ?? [];
  } catch (e) {
    console.log("[provider-docs] fetch threw", e);
    return [];
  }
}

export interface UpsertDocInput {
  partnerId: string;
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

/**
 * Upsert by (partner_id, doc_id) — overwrites the previous upload for the
 * same document. Status is reset to 'Pending Review' on every fresh upload.
 */
export async function upsertProviderDocument(
  input: UpsertDocInput
): Promise<ProviderDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const payload = {
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

    // Try update first (by partner+doc) — fall back to insert.
    const existing = await supabase
      .from("provider_documents")
      .select("id")
      .eq("partner_id", input.partnerId)
      .eq("doc_id", input.docId)
      .maybeSingle();

    if (existing.data?.id) {
      const { data, error } = await supabase
        .from("provider_documents")
        .update(payload)
        .eq("id", existing.data.id)
        .select("*")
        .single();
      if (error) {
        console.log("[provider-docs] update error", error.message);
        return null;
      }
      return data as ProviderDocumentRow;
    }

    const { data, error } = await supabase
      .from("provider_documents")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      console.log("[provider-docs] insert error", error.message);
      return null;
    }
    return data as ProviderDocumentRow;
  } catch (e) {
    console.log("[provider-docs] upsert threw", e);
    return null;
  }
}

/** Admin: fetch all provider documents, optionally filtered by status. */
export async function fetchAllProviderDocuments(
  status?: ProviderDocStatus | null
): Promise<ProviderDocumentRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    let q = supabase.from("provider_documents").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("uploaded_at", { ascending: false });
    if (error) {
      console.log("[provider-docs] fetchAll error", error.message);
      return [];
    }
    return (data as ProviderDocumentRow[]) ?? [];
  } catch (e) {
    console.log("[provider-docs] fetchAll threw", e);
    return [];
  }
}

/** Admin: update review status of a single provider document. */
export async function setProviderDocumentStatus(
  id: string,
  status: ProviderDocStatus,
  reviewerNotes?: string | null
): Promise<ProviderDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from("provider_documents")
      .update({
        status,
        reviewer_notes: reviewerNotes ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.log("[provider-docs] setStatus error", error.message);
      return null;
    }
    return data as ProviderDocumentRow;
  } catch (e) {
    console.log("[provider-docs] setStatus threw", e);
    return null;
  }
}

export interface UpdateProviderDocMetadataInput {
  doc_name?: string;
  document_number?: string | null;
  insurance_provider_name?: string | null;
  issuance_country?: string | null;
  start_date?: string | null;
  expiry_date?: string | null;
  is_pwd?: boolean;
}

/** Admin: edit metadata fields on a single provider document. */
export async function updateProviderDocumentMetadata(
  id: string,
  patch: UpdateProviderDocMetadataInput
): Promise<ProviderDocumentRow | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from("provider_documents")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.log("[provider-docs] updateMetadata error", error.message);
      return null;
    }
    return data as ProviderDocumentRow;
  } catch (e) {
    console.log("[provider-docs] updateMetadata threw", e);
    return null;
  }
}

/** Admin: permanently delete a provider document row. */
export async function deleteProviderDocument(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  try {
    const { error } = await supabase
      .from("provider_documents")
      .delete()
      .eq("id", id);
    if (error) {
      console.log("[provider-docs] delete error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[provider-docs] delete threw", e);
    return false;
  }
}

/** Local helper: applies the same "expired if past expiry_date" rule the DB trigger does. */
export function computeDisplayStatus(row: ProviderDocumentRow): ProviderDocStatus {
  if (
    row.expiry_date &&
    new Date(row.expiry_date).getTime() < Date.now() &&
    row.status !== "Rejected"
  ) {
    return "Expired";
  }
  return row.status;
}
