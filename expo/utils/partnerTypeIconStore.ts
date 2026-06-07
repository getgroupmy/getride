import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

export const PARTNER_TYPE_ICONS_BUCKET = "partner-type-icons";

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function guessExt(uri: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".svg")) return "svg";
  return "png";
}

/**
 * Upload a local image URI to the `partner-type-icons` bucket and return its
 * public URL. Returns null if Supabase is not configured or the upload fails.
 */
export async function uploadPartnerTypeIcon(localUri: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const ext = guessExt(localUri);
    const contentType = guessContentType(localUri);
    const path = `icon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
      .from(PARTNER_TYPE_ICONS_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (upErr) {
      console.log("[partner-type-icon] upload error", upErr.message);
      return null;
    }

    const { data: pub } = supabase.storage
      .from(PARTNER_TYPE_ICONS_BUCKET)
      .getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[partner-type-icon] upload threw", e);
    return null;
  }
}
