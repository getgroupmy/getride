import {
  isSupabaseConfigured,
  SUPABASE_URL_RESOLVED,
  SUPABASE_ANON_KEY_RESOLVED,
} from "@/utils/supabase";
import type { DisplaySettings } from "@/contexts/DisplaySettingsContext";

export const DISPLAY_SETTINGS_TABLE = "admin_display_settings";
export const DISPLAY_SETTINGS_ROW_ID = "global";

type DisplayShape = DisplaySettings;

/**
 * REST endpoint for the singleton settings row.
 *
 * IMPORTANT: global display settings are read/written with a RAW fetch that
 * sends the project ANON key explicitly (both `apikey` and `Authorization`).
 * We do NOT route these through the shared Supabase SDK client, because that
 * client has `persistSession: true` — so once a regular user logs in via phone
 * auth, every SDK query carries the user's *authenticated* JWT. On this
 * database the global-settings policies effectively only serve the `anon`
 * role, which means logged-in (non-admin) users would silently get zero rows
 * back and fall through to defaults — i.e. the admin's changes never reach
 * them. Forcing the anon role here makes the settings truly global for every
 * device regardless of who is signed in.
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
 * Upserts the full settings JSON to the singleton row using the anon role.
 * Returns true on success.
 */
export async function updateRemoteDisplaySettings(
  settings: DisplaySettings
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const res = await fetch(`${REST_BASE}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...anonHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: DISPLAY_SETTINGS_ROW_ID,
        settings,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log("[displaySettings] update http", res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.log("[displaySettings] update threw", e);
    return false;
  }
}
