import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";

/**
 * VoiceProtection data layer.
 *
 * When enabled, the app records trip audio with the device microphone while a
 * ride is in progress. Recordings are stored on the DEVICE only and are never
 * surfaced to the user. Each recording is kept locally for 24 hours, then
 * purged. A metadata row is written to `voice_protection_recordings` so an
 * admin can REQUEST an upload (e.g. when the user opens a ride-related support
 * ticket). When requested, the device uploads the still-retained local file to
 * the private `voice-protection` bucket and fills in `media_url`.
 */

export const VOICE_PROTECTION_BUCKET = "voice-protection";

/** Recordings are retained locally for 24 hours before purge. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Per-profile toggle persistence key. */
export const enabledStorageKey = (profileId: string): string =>
  `@voice_protection_enabled_${profileId}`;

/** Local manifest mapping recording id -> on-device file uri. */
const MANIFEST_KEY = "@voice_protection_manifest";

/** Directory that holds the (user-inaccessible) local trip recordings. */
export const RECORDINGS_DIR = `${FileSystem.documentDirectory ?? ""}voice-protection/`;

export interface VoiceProtectionRecording {
  id: string;
  profile_id: string;
  ride_id: string | null;
  ride_label: string | null;
  recorded_at: string;
  duration_sec: number;
  expires_at: string;
  upload_requested: boolean;
  upload_requested_by: string | null;
  upload_requested_at: string | null;
  ticket_id: string | null;
  uploaded: boolean;
  uploaded_at: string | null;
  media_url: string | null;
  unavailable: boolean;
  created_at: string;
  updated_at: string;
}

type Manifest = Record<string, string>;

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as Manifest) : {};
  } catch {
    return {};
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  try {
    await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
  } catch (e) {
    console.log("[voiceProtection] writeManifest failed", e);
  }
}

async function ensureDir(): Promise<void> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    }
  } catch (e) {
    console.log("[voiceProtection] ensureDir failed", e);
  }
}

/**
 * Persist a freshly captured recording: move the temp file into our private
 * directory, register it in the local manifest, and write a metadata row.
 * Returns the created recording id (or null on failure).
 */
export async function saveRecording(input: {
  profileId: string;
  tempUri: string;
  durationSec: number;
  rideId?: string | null;
  rideLabel?: string | null;
}): Promise<string | null> {
  const id = uuidv4();
  const recordedAt = new Date();
  const expiresAt = new Date(recordedAt.getTime() + RETENTION_MS);

  // 1) Move the temp file into the private dir (skip on web — no FS).
  let storedUri: string | null = null;
  if (Platform.OS !== "web" && FileSystem.documentDirectory) {
    try {
      await ensureDir();
      const ext = input.tempUri.toLowerCase().split("?")[0].match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "m4a";
      storedUri = `${RECORDINGS_DIR}${id}.${ext}`;
      await FileSystem.moveAsync({ from: input.tempUri, to: storedUri });
      const manifest = await readManifest();
      manifest[id] = storedUri;
      await writeManifest(manifest);
    } catch (e) {
      console.log("[voiceProtection] saveRecording file move failed", e);
      storedUri = null;
    }
  }

  // 2) Write metadata so admins can later request an upload.
  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.from("voice_protection_recordings").insert({
        id,
        profile_id: input.profileId,
        ride_id: input.rideId ?? null,
        ride_label: input.rideLabel ?? null,
        recorded_at: recordedAt.toISOString(),
        duration_sec: Math.max(0, Math.round(input.durationSec)),
        expires_at: expiresAt.toISOString(),
        unavailable: storedUri === null,
      });
      if (error) console.log("[voiceProtection] insert metadata error", error.message);
    } catch (e) {
      console.log("[voiceProtection] insert metadata threw", e);
    }
  }
  return id;
}

/**
 * Delete local files whose retention window has passed and clear them from the
 * manifest. Also flags the matching DB rows as unavailable so admins know the
 * recording can no longer be uploaded.
 */
export async function purgeExpired(profileId: string): Promise<void> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return;
  const manifest = await readManifest();
  const now = Date.now();
  let changed = false;

  // Use DB metadata (when available) to decide what's expired; fall back to
  // file mtime so we still clean up even if the row is gone.
  let expiredIds: string[] = [];
  if (isSupabaseConfigured && supabase && profileId) {
    try {
      const { data } = await supabase
        .from("voice_protection_recordings")
        .select("id, expires_at")
        .eq("profile_id", profileId)
        .lt("expires_at", new Date(now).toISOString());
      expiredIds = (data ?? []).map((r: { id: string }) => r.id);
    } catch (e) {
      console.log("[voiceProtection] purge query threw", e);
    }
  }

  for (const id of Object.keys(manifest)) {
    const uri = manifest[id];
    let shouldDelete = expiredIds.includes(id);
    if (!shouldDelete) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        // Belt-and-braces: also delete anything older than the retention window.
        if (info.exists && info.modificationTime && now - info.modificationTime * 1000 > RETENTION_MS) {
          shouldDelete = true;
        }
        if (!info.exists) shouldDelete = true;
      } catch {
        shouldDelete = true;
      }
    }
    if (shouldDelete) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        /* ignore */
      }
      delete manifest[id];
      changed = true;
    }
  }
  if (changed) await writeManifest(manifest);

  // Flag purged rows so admins don't keep waiting on an upload.
  if (expiredIds.length > 0 && isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from("voice_protection_recordings")
        .update({ unavailable: true })
        .in("id", expiredIds)
        .eq("uploaded", false);
    } catch (e) {
      console.log("[voiceProtection] purge flag threw", e);
    }
  }
}

/** Upload the local file for a recording to the private bucket. */
export async function uploadRecording(rec: VoiceProtectionRecording): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  if (rec.uploaded) return true;

  const manifest = await readManifest();
  const localUri = manifest[rec.id];

  // No local file (web, purged, or never captured) → mark unavailable.
  if (!localUri || Platform.OS === "web") {
    try {
      await supabase
        .from("voice_protection_recordings")
        .update({ unavailable: true })
        .eq("id", rec.id);
    } catch {
      /* ignore */
    }
    return false;
  }

  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) {
      await supabase
        .from("voice_protection_recordings")
        .update({ unavailable: true })
        .eq("id", rec.id);
      delete manifest[rec.id];
      await writeManifest(manifest);
      return false;
    }
    const ext = localUri.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "m4a";
    const ct = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/m4a";
    const path = `${rec.profile_id}/${rec.id}.${ext}`;
    const b64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const body = decodeBase64(b64);
    const { error } = await supabase.storage
      .from(VOICE_PROTECTION_BUCKET)
      .upload(path, body, { contentType: ct, upsert: true });
    if (error) {
      console.log("[voiceProtection] upload error", error.message);
      return false;
    }
    // Bucket is private → store the storage path; a signed URL is created on read.
    const { error: updErr } = await supabase
      .from("voice_protection_recordings")
      .update({
        uploaded: true,
        uploaded_at: new Date().toISOString(),
        media_url: path,
        unavailable: false,
      })
      .eq("id", rec.id);
    if (updErr) {
      console.log("[voiceProtection] upload row update error", updErr.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[voiceProtection] uploadRecording threw", e);
    return false;
  }
}

/**
 * Device-side: fetch recordings for this profile that an admin has requested be
 * uploaded but which haven't been uploaded yet (and aren't marked unavailable).
 */
export async function fetchPendingUploads(profileId: string): Promise<VoiceProtectionRecording[]> {
  if (!isSupabaseConfigured || !supabase || !profileId) return [];
  try {
    const { data, error } = await supabase
      .from("voice_protection_recordings")
      .select("*")
      .eq("profile_id", profileId)
      .eq("upload_requested", true)
      .eq("uploaded", false)
      .eq("unavailable", false);
    if (error) {
      console.log("[voiceProtection] fetchPendingUploads error", error.message);
      return [];
    }
    return (data as VoiceProtectionRecording[]) ?? [];
  } catch (e) {
    console.log("[voiceProtection] fetchPendingUploads threw", e);
    return [];
  }
}

/** Admin: list a profile's trip recordings, newest first. */
export async function fetchRecordingsForProfile(
  profileId: string
): Promise<VoiceProtectionRecording[]> {
  if (!isSupabaseConfigured || !supabase || !profileId) return [];
  try {
    const { data, error } = await supabase
      .from("voice_protection_recordings")
      .select("*")
      .eq("profile_id", profileId)
      .order("recorded_at", { ascending: false });
    if (error) {
      console.log("[voiceProtection] fetchRecordingsForProfile error", error.message);
      return [];
    }
    return (data as VoiceProtectionRecording[]) ?? [];
  } catch (e) {
    console.log("[voiceProtection] fetchRecordingsForProfile threw", e);
    return [];
  }
}

/**
 * Admin: request the device to upload a specific recording. The device picks
 * this up via realtime/poll and performs the actual upload.
 */
export async function requestUpload(input: {
  recordingId: string;
  adminId: string | null;
  ticketId?: string | null;
}): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase
      .from("voice_protection_recordings")
      .update({
        upload_requested: true,
        upload_requested_by: input.adminId,
        upload_requested_at: new Date().toISOString(),
        ticket_id: input.ticketId ?? null,
      })
      .eq("id", input.recordingId);
    if (error) {
      console.log("[voiceProtection] requestUpload error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[voiceProtection] requestUpload threw", e);
    return false;
  }
}

/** Admin: create a signed, time-limited URL for an uploaded recording. */
export async function getSignedUrl(mediaPath: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !mediaPath) return null;
  // Already a full URL (legacy / public) — return as-is.
  if (mediaPath.startsWith("http")) return mediaPath;
  try {
    const { data, error } = await supabase.storage
      .from(VOICE_PROTECTION_BUCKET)
      .createSignedUrl(mediaPath, 60 * 60);
    if (error) {
      console.log("[voiceProtection] getSignedUrl error", error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (e) {
    console.log("[voiceProtection] getSignedUrl threw", e);
    return null;
  }
}

/** Format a duration in seconds as m:ss. */
export function formatRecordingDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
