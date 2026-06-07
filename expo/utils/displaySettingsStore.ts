import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import type { DisplaySettings } from "@/contexts/DisplaySettingsContext";

export const DISPLAY_SETTINGS_TABLE = "admin_display_settings";
export const DISPLAY_SETTINGS_ROW_ID = "global";

/**
 * Fetches the global display settings JSON blob from Supabase. Returns null if
 * the table is unreachable / Supabase is not configured.
 */
export async function fetchRemoteDisplaySettings(): Promise<Partial<DisplaySettings> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from(DISPLAY_SETTINGS_TABLE)
      .select("settings")
      .eq("id", DISPLAY_SETTINGS_ROW_ID)
      .maybeSingle();
    if (error) {
      console.log("[displaySettings] fetch error", error.message);
      return null;
    }
    if (!data) return null;
    const raw = (data as { settings?: unknown }).settings;
    if (!raw || typeof raw !== "object") return {};
    return raw as Partial<DisplayShape>;
  } catch (e) {
    console.log("[displaySettings] fetch threw", e);
    return null;
  }
}

type DisplayShape = DisplaySettings;

/**
 * Upserts the full settings JSON to the singleton row. Returns true on success.
 */
export async function updateRemoteDisplaySettings(
  settings: DisplaySettings
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase
      .from(DISPLAY_SETTINGS_TABLE)
      .upsert(
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
