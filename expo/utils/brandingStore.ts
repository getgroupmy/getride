import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

export const BRANDING_BUCKET = "app-branding";
export const BRANDING_TABLE = "app_branding";
export const BRANDING_ROW_ID = "global";

export interface RemoteBranding {
  splash_image_url: string | null;
  splash_bg_color: string;
  app_icon_url: string | null;
  icon_changed_at: string | null;
  updated_at: string | null;
}

const DEFAULT_REMOTE: RemoteBranding = {
  splash_image_url: null,
  splash_bg_color: "#ff007f",
  app_icon_url: null,
  icon_changed_at: null,
  updated_at: null,
};

export async function fetchRemoteBranding(): Promise<RemoteBranding | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from(BRANDING_TABLE)
      .select("splash_image_url, splash_bg_color, app_icon_url, icon_changed_at, updated_at")
      .eq("id", BRANDING_ROW_ID)
      .maybeSingle();
    if (error) {
      console.log("[branding] fetch error", error.message);
      return null;
    }
    if (!data) return DEFAULT_REMOTE;
    return {
      splash_image_url: (data.splash_image_url as string | null) ?? null,
      splash_bg_color: (data.splash_bg_color as string | null) ?? DEFAULT_REMOTE.splash_bg_color,
      app_icon_url: (data.app_icon_url as string | null) ?? null,
      icon_changed_at: (data.icon_changed_at as string | null) ?? null,
      updated_at: (data.updated_at as string | null) ?? null,
    };
  } catch (e) {
    console.log("[branding] fetch threw", e);
    return null;
  }
}

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function guessExt(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  return "png";
}

/**
 * Upload a local image URI to the `app-branding` bucket and return its public
 * URL. Returns null if Supabase is not configured or the upload fails.
 */
export async function uploadBrandingImage(
  localUri: string,
  kind: "splash" | "icon"
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `${kind}-${Date.now()}.${ext}`;

    let body: ArrayBuffer;
    if (localUri.startsWith("data:")) {
      const commaIdx = localUri.indexOf(",");
      const b64 = commaIdx >= 0 ? localUri.slice(commaIdx + 1) : "";
      body = decodeBase64(b64);
    } else if (localUri.startsWith("http://") || localUri.startsWith("https://")) {
      const res = await fetch(localUri);
      body = await res.arrayBuffer();
    } else {
      const b64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      body = decodeBase64(b64);
    }

    const { error: upErr } = await supabase.storage
      .from(BRANDING_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (upErr) {
      console.log("[branding] upload error", upErr.message);
      return null;
    }

    const { data: pub } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[branding] upload threw", e);
    return null;
  }
}

export async function updateRemoteBranding(
  patch: Partial<Omit<RemoteBranding, "updated_at">>
): Promise<RemoteBranding | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const row = {
      id: BRANDING_ROW_ID,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from(BRANDING_TABLE)
      .upsert(row, { onConflict: "id" })
      .select("splash_image_url, splash_bg_color, app_icon_url, icon_changed_at, updated_at")
      .maybeSingle();
    if (error) {
      console.log("[branding] update error", error.message);
      return null;
    }
    if (!data) return null;
    return {
      splash_image_url: (data.splash_image_url as string | null) ?? null,
      splash_bg_color: (data.splash_bg_color as string | null) ?? DEFAULT_REMOTE.splash_bg_color,
      app_icon_url: (data.app_icon_url as string | null) ?? null,
      icon_changed_at: (data.icon_changed_at as string | null) ?? null,
      updated_at: (data.updated_at as string | null) ?? null,
    };
  } catch (e) {
    console.log("[branding] update threw", e);
    return null;
  }
}
