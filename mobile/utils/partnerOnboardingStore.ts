import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

export const PARTNER_BUCKET = "partner-uploads";

export interface PartnerProfileRow {
  id: string;
  display_id: string | null;
  auth_user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  ic: string | null;
  address: string | null;
  avatar_url: string | null;
  partner_types: string[] | null;
  service_countries: string[] | null;
  service_states: string[] | null;
  service_cities: string[] | null;
  documents_ok: boolean;
  onboarding_step: string | null;
}

export interface UserProfileRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  ic: string | null;
  address: string | null;
  avatar_url: string | null;
  profile_image: string | null;
  id_image: string | null;
}

export type PartnerOnboardingStep =
  | "avatar"
  | "id"
  | "address"
  | "service-area"
  | "partner-type"
  | "requirements"
  | "done";

const STEP_ORDER: PartnerOnboardingStep[] = [
  "avatar",
  "id",
  "address",
  "service-area",
  "partner-type",
  "requirements",
  "done",
];

export function nextStep(step: PartnerOnboardingStep): PartnerOnboardingStep {
  const idx = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
}

export interface OnboardingSnapshot {
  profile: UserProfileRow | null;
  partner: PartnerProfileRow | null;
  step: PartnerOnboardingStep;
}

/** Compute the first incomplete step given a profile + partner row. */
export function computeFirstStep(
  profile: UserProfileRow | null,
  partner: PartnerProfileRow | null
): PartnerOnboardingStep {
  const avatar = partner?.avatar_url || profile?.avatar_url || profile?.profile_image;
  if (!avatar) return "avatar";
  const ic = partner?.ic || profile?.ic;
  if (!ic || !String(ic).trim()) return "id";
  const address = partner?.address || profile?.address;
  if (!address || !String(address).trim()) return "address";
  const hasArea =
    (partner?.service_countries?.length ?? 0) > 0 &&
    (partner?.service_states?.length ?? 0) > 0 &&
    (partner?.service_cities?.length ?? 0) > 0;
  if (!hasArea) return "service-area";
  if ((partner?.partner_types?.length ?? 0) === 0) return "partner-type";
  if (!partner?.documents_ok) return "requirements";
  return "done";
}

/**
 * Whether a partner row belongs to someone actually operating as a partner.
 *
 * `findOrCreatePartner` inserts a stub the moment anyone taps "Partner mode",
 * so the mere existence of a row proves nothing. A partner has committed once
 * they have picked at least one partner type — or once an admin has approved
 * them / issued a permit.
 */
export function isActivePartner(partner: PartnerProfileRow | null): boolean {
  if (!partner) return false;
  if ((partner.partner_types?.length ?? 0) > 0) return true;
  return partner.documents_ok === true;
}

/**
 * Read-only partner lookup for the current user. Unlike
 * {@link findOrCreatePartner} this never inserts a stub row, so it is safe to
 * call from screens that merely need to know whether the user is a partner.
 */
export async function fetchPartnerForUser(
  userId: string
): Promise<PartnerProfileRow | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("partners")
      .select(
        "id, display_id, auth_user_id, name, phone, email, ic, address, avatar_url, partner_types, service_countries, service_states, service_cities, documents_ok, onboarding_step"
      )
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (error) {
      console.log("[partner-onboarding] partner lookup error", error.message);
      return null;
    }
    return (data as PartnerProfileRow | null) ?? null;
  } catch (e) {
    console.log("[partner-onboarding] partner lookup threw", e);
    return null;
  }
}

export async function fetchUserProfile(userId: string): Promise<UserProfileRow | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, phone, email, ic, address, avatar_url, profile_image, id_image")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.log("[partner-onboarding] profile fetch error", error.message);
      return null;
    }
    return (data as UserProfileRow | null) ?? null;
  } catch (e) {
    console.log("[partner-onboarding] profile fetch threw", e);
    return null;
  }
}

/**
 * Find a partner row for the current user by `auth_user_id`, falling back to
 * phone. If none exists, creates a stub row tied to the auth user and returns
 * it. Never throws — returns null when Supabase isn't available.
 */
export async function findOrCreatePartner(
  userId: string,
  profile: UserProfileRow | null
): Promise<PartnerProfileRow | null> {
  if (!isSupabaseConfigured || !supabase || !userId) return null;
  const cols =
    "id, display_id, auth_user_id, name, phone, email, ic, address, avatar_url, partner_types, service_countries, service_states, service_cities, documents_ok, onboarding_step";
  try {
    // 1. Try by auth_user_id
    const byUid = await supabase
      .from("partners")
      .select(cols)
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (byUid.data) return byUid.data as PartnerProfileRow;

    // 2. Try by phone (link existing partner row if admin pre-added them)
    const phone = profile?.phone?.trim();
    if (phone) {
      const byPhone = await supabase
        .from("partners")
        .select(cols)
        .eq("phone", phone)
        .maybeSingle();
      if (byPhone.data) {
        await supabase.from("partners").update({ auth_user_id: userId }).eq("id", (byPhone.data as { id: string }).id);
        return { ...(byPhone.data as PartnerProfileRow), auth_user_id: userId };
      }
    }

    // 3. Create a new stub row
    const id = uuidv4();
    const displayId = `PR-${Date.now().toString().slice(-6)}`;
    const stub = {
      id,
      display_id: displayId,
      auth_user_id: userId,
      name: profile?.name ?? "",
      phone: profile?.phone ?? "",
      email: profile?.email ?? null,
      ic: profile?.ic ?? null,
      address: profile?.address ?? null,
      avatar_url: profile?.avatar_url ?? profile?.profile_image ?? null,
      partner_types: [],
      service_countries: [],
      service_states: [],
      service_cities: [],
      status: "unapproved",
      permit: "none",
      documents_ok: false,
      rating: 0,
      total_rides: 0,
      joined_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("partners").insert(stub);
    if (error) {
      console.log("[partner-onboarding] insert partner error", error.message);
      return null;
    }
    return stub as unknown as PartnerProfileRow;
  } catch (e) {
    console.log("[partner-onboarding] findOrCreate threw", e);
    return null;
  }
}

export async function patchPartner(
  partnerId: string,
  patch: Partial<PartnerProfileRow>
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from("partners").update(patch).eq("id", partnerId);
    if (error) {
      console.log("[partner-onboarding] patch partner error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[partner-onboarding] patch partner threw", e);
    return false;
  }
}

export async function patchProfile(
  userId: string,
  patch: Partial<UserProfileRow>
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) {
      console.log("[partner-onboarding] patch profile error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[partner-onboarding] patch profile threw", e);
    return false;
  }
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

/**
 * Upload a local file to the partner-uploads bucket (created lazily via SQL or
 * Supabase dashboard). Returns the public URL, or null on failure.
 */
export async function uploadPartnerFile(
  localUri: string,
  userId: string,
  kind: "avatar" | "id" | "doc"
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `${userId}/${kind}-${Date.now()}.${ext}`;
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
      .from(PARTNER_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) {
      console.log("[partner-onboarding] upload error", error.message);
      return null;
    }
    const { data: pub } = supabase.storage.from(PARTNER_BUCKET).getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[partner-onboarding] upload threw", e);
    return null;
  }
}
