import type { PartnerModeOption } from "@/components/PartnerModeSelectModal";
import { fetchUserProfile, findOrCreatePartner } from "@/utils/partnerOnboardingStore";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

type SettingEntry = {
  id: string;
  values?: Record<string, unknown> & { name?: unknown; shortInfo?: unknown; description?: unknown; iconUrl?: unknown };
};

type GetEntries = (key: string) => SettingEntry[];

/**
 * Build PartnerModeSelectModal options for the given user, mirroring the
 * exact logic used by `MenuSideSheet` so all surfaces ("Partner mode" in
 * the side menu, and the in-screen "switch service" actions on
 * partner-teksi / partner-ehailing) show the same list.
 *
 * Returns the partner's assigned partner_types decorated with
 * `description` (shortInfo → description fallback) and `iconUrl` from the
 * matching admin `partner-type` settings entry.
 *
 * Falls back to an empty array when the user has no partner record or
 * partner_types — callers can treat that as "show the default modal".
 */
/**
 * Resolve whether the given partner mode requires a vehicle (admin
 * partner-type "Vehicle required" toggle).
 *
 * Tries the in-memory admin-data cache first via `getEntries`; when the
 * cache is empty or has no matching entry (e.g. right after app launch
 * before the settings sync finishes), falls back to a direct Supabase
 * lookup so the vehicle picker is never silently skipped.
 */
export async function isVehicleRequiredForMode(
  mode: string,
  getEntries: GetEntries
): Promise<boolean> {
  const normalized = mode.trim().toLowerCase();

  const findMatch = (
    entries: SettingEntry[]
  ): { found: boolean; required: boolean } => {
    const match = entries.find(
      (e) => String(e.values?.name ?? "").trim().toLowerCase() === normalized
    );
    return {
      found: Boolean(match),
      required: Boolean(match?.values?.vehicleRequired),
    };
  };

  const localEntries = getEntries("partner-type");
  const local = findMatch(localEntries);
  if (local.found) {
    console.log(
      "[partnerModeOptions] vehicleRequired (cache)",
      normalized,
      local.required
    );
    return local.required;
  }

  console.log(
    "[partnerModeOptions] partner-type cache miss (entries:",
    localEntries.length,
    ") — falling back to Supabase for",
    normalized
  );
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data, error } = await supabase
      .from("settings_entries")
      .select("id, values")
      .eq("category", "partner-type");
    if (error) {
      console.log(
        "[partnerModeOptions] vehicleRequired fallback error",
        error.message
      );
      return false;
    }
    const remote = findMatch((data ?? []) as SettingEntry[]);
    console.log(
      "[partnerModeOptions] vehicleRequired (supabase)",
      normalized,
      remote.found ? remote.required : "(no matching partner-type)"
    );
    return remote.required;
  } catch (e) {
    console.log("[partnerModeOptions] vehicleRequired fallback threw", e);
    return false;
  }
}

export async function loadAssignedPartnerModeOptions(
  userId: string | null | undefined,
  getEntries: GetEntries
): Promise<PartnerModeOption[]> {
  if (!userId) return [];
  try {
    const prof = await fetchUserProfile(userId);
    const part = await findOrCreatePartner(userId, prof);
    const assigned = part?.partner_types ?? [];
    const entries = getEntries("partner-type");
    const byName = new Map<string, { description?: string; iconUrl?: string }>();
    for (const e of entries) {
      const n = String(e.values?.name ?? "").trim();
      if (!n) continue;
      const shortInfo =
        typeof e.values?.shortInfo === "string"
          ? (e.values.shortInfo as string).trim()
          : "";
      const desc =
        typeof e.values?.description === "string"
          ? (e.values.description as string).trim()
          : "";
      const iconUrl =
        typeof e.values?.iconUrl === "string"
          ? (e.values.iconUrl as string).trim()
          : "";
      byName.set(n.toLowerCase(), {
        description:
          shortInfo.length > 0 ? shortInfo : desc.length > 0 ? desc : undefined,
        iconUrl: iconUrl.length > 0 ? iconUrl : undefined,
      });
    }
    return assigned
      .map((name) => String(name).trim())
      .filter((name) => name.length > 0)
      .map((name) => ({
        id: name,
        name,
        description: byName.get(name.toLowerCase())?.description,
        iconUrl: byName.get(name.toLowerCase())?.iconUrl,
      }));
  } catch (e) {
    console.log("[partnerModeOptions] load failed", e);
    return [];
  }
}
