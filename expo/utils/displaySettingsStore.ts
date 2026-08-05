import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_URL_RESOLVED,
  SUPABASE_ANON_KEY_RESOLVED,
} from "@/utils/supabase";
import type { DisplaySettings } from "@/contexts/DisplaySettingsContext";

export const DISPLAY_SETTINGS_TABLE = "admin_display_settings";
export const DISPLAY_SETTINGS_ROW_ID = "global";

type DisplayShape = DisplaySettings;

/**
 * REST endpoint for the singleton settings row — used for READS only.
 *
 * IMPORTANT: global display settings are *read* with a RAW fetch that sends the
 * project ANON key explicitly (both `apikey` and `Authorization`). We do NOT
 * route the read through the shared Supabase SDK client, because that client
 * has `persistSession: true` — so once a user logs in via phone auth, every SDK
 * query carries the user's JWT. Forcing the anon role on the read makes the
 * settings truly global for every device regardless of who is signed in (the
 * SELECT policy serves `anon`+`authenticated` with `using (true)`).
 *
 * WRITES are the opposite: since migration 0069 the INSERT/UPDATE policies on
 * this table require `caller_is_admin()`, which is FALSE for an anon-key request
 * (`auth.uid()` is null). An anon write is therefore silently rejected by RLS —
 * so the write MUST go through the authenticated SDK client, whose JWT belongs
 * to the signed-in admin and passes `caller_is_admin()`. See
 * `updateRemoteDisplaySettings` below.
 */
const REST_BASE = `${SUPABASE_URL_RESOLVED}/rest/v1/${DISPLAY_SETTINGS_TABLE}`;

function anonHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY_RESOLVED,
    Authorization: `Bearer ${SUPABASE_ANON_KEY_RESOLVED}`,
    "Content-Type": "application/json",
  };
}

/**
 * Fetches the global display settings JSON blob from Supabase using the anon
 * role. Returns null if unreachable / Supabase is not configured.
 */
export async function fetchRemoteDisplaySettings(): Promise<Partial<DisplaySettings> | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const url = `${REST_BASE}?id=eq.${encodeURIComponent(
      DISPLAY_SETTINGS_ROW_ID
    )}&select=settings`;
    const res = await fetch(url, { headers: anonHeaders() });
    if (!res.ok) {
      console.log("[displaySettings] fetch http", res.status);
      return null;
    }
    const rows = (await res.json()) as { settings?: unknown }[] | null;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const raw = rows[0]?.settings;
    if (!raw || typeof raw !== "object") return {};
    return raw as Partial<DisplayShape>;
  } catch (e) {
    console.log("[displaySettings] fetch threw", e);
    return null;
  }
}

/**
 * Upserts the full settings JSON to the singleton row.
 *
 * The write goes through the authenticated Supabase SDK client (NOT the raw
 * anon fetch used for reads): the table's INSERT/UPDATE policies require
 * `caller_is_admin()`, which only passes when the request carries a signed-in
 * admin's JWT. An anon-key write has `auth.uid() = null` and is rejected by
 * RLS, which is why admin edits to the global settings never used to land.
 * Returns true on success.
 */
export async function updateRemoteDisplaySettings(
  settings: DisplaySettings
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from(DISPLAY_SETTINGS_TABLE).upsert(
      {
        id: DISPLAY_SETTINGS_ROW_ID,
        settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      console.log("[displaySettings] update error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[displaySettings] update threw", e);
    return false;
  }
}
