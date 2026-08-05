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
/**
 * Driving partner modes that require a vehicle BY DEFAULT when the admin
 * partner-type entry does not carry an explicit `vehicleRequired` flag.
 * Admins can still turn the requirement off per type in
 * Admin → Settings → Partner Type (an explicit false wins over this default).
 */
const DEFAULT_VEHICLE_REQUIRED_MODES = new Set<string>([
  "teksi",
  "ehailing",
  "phailing",
]);

type VehicleFlagMatch = {
  found: boolean;
  /** True when the entry explicitly carries a vehicleRequired key. */
  hasFlag: boolean;
  required: boolean;
};

export async function isVehicleRequiredForMode(
  mode: string,
  getEntries: GetEntries
): Promise<boolean> {
  const normalized = mode.trim().toLowerCase();
  const fallbackDefault = DEFAULT_VEHICLE_REQUIRED_MODES.has(normalized);

  const findMatch = (entries: SettingEntry[]): VehicleFlagMatch => {
    const match = entries.find(
      (e) => String(e.values?.name ?? "").trim().toLowerCase() === normalized
    );
    const hasFlag =
      Boolean(match?.values) &&
      Object.prototype.hasOwnProperty.call(match?.values ?? {}, "vehicleRequired");
    return {
      found: Boolean(match),
      hasFlag,
      required: Boolean(match?.values?.vehicleRequired),
    };
  };

  const resolve = (m: VehicleFlagMatch, source: string): boolean => {
    // Explicit admin choice always wins; missing flag falls back to the
    // driving-mode default so the vehicle picker is never silently skipped
    // for Teksi / eHailing / pHailing.
    const result = m.hasFlag ? m.required : fallbackDefault;
    console.log(
      `[partnerModeOptions] vehicleRequired (${source})`,
      normalized,
      result,
      m.hasFlag ? "(explicit)" : "(default)"
    );
    return result;
  };

  const localEntries = getEntries("partner-type");
  const local = findMatch(localEntries);
  if (local.found) return resolve(local, "cache");

  console.log(
    "[partnerModeOptions] partner-type cache miss (entries:",
    localEntries.length,
    ") — falling back to Supabase for",
    normalized
  );
  if (!isSupabaseConfigured || !supabase) return fallbackDefault;
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
      return fallbackDefault;
    }
    const remote = findMatch((data ?? []) as SettingEntry[]);
    return resolve(remote, "supabase");
  } catch (e) {
    console.log("[partnerModeOptions] vehicleRequired fallback threw", e);
    return fallbackDefault;
  }
}

/**
 * Fetch partner-type entries straight from Supabase. Used as a fallback
 * when the in-memory admin-data cache hasn't synced yet, so custom icons
 * and descriptions are never silently dropped on a cold start.
 */
async function fetchPartnerTypeEntriesRemote(): Promise<SettingEntry[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("settings_entries")
      .select("id, values")
      .eq("category", "partner-type");
    if (error) {
      console.log("[partnerModeOptions] remote partner-type fetch error", error.message);
      return [];
    }
    return (data ?? []) as SettingEntry[];
  } catch (e) {
    console.log("[partnerModeOptions] remote partner-type fetch threw", e);
    return [];
  }
}

type PartnerTypeMeta = {
  description?: string;
  iconUrl?: string;
  enabled: boolean;
  priority: number;
};

/** Index the admin `partner-type` catalog by lowercased name. */
function indexPartnerTypes(entries: readonly SettingEntry[]): Map<string, PartnerTypeMeta> {
  const byName = new Map<string, PartnerTypeMeta>();
  for (const e of entries) {
    const n = String(e.values?.name ?? "").trim();
    if (!n) continue;
    const shortInfo =
      typeof e.values?.shortInfo === "string" ? (e.values.shortInfo as string).trim() : "";
    const desc =
      typeof e.values?.description === "string" ? (e.values.description as string).trim() : "";
    const iconUrl =
      typeof e.values?.iconUrl === "string" ? (e.values.iconUrl as string).trim() : "";
    const rawPriority = Number(e.values?.displayPriority);
    byName.set(n.toLowerCase(), {
      description: shortInfo.length > 0 ? shortInfo : desc.length > 0 ? desc : undefined,
      iconUrl: iconUrl.length > 0 ? iconUrl : undefined,
      // Matches PartnerTypePicker / admin-settings-partner-type: absent means on.
      enabled: Boolean(e.values?.enabled ?? true),
      priority: Number.isFinite(rawPriority) ? rawPriority : Number.POSITIVE_INFINITY,
    });
  }
  return byName;
}

/**
 * Shape the partner's assigned `partner_types` into service-mode options,
 * following the admin `partner-type` catalog: a type the admin has switched
 * off is dropped, and the list is ordered by the admin's `displayPriority`
 * rather than by whatever order the names happen to sit in on the partner row.
 *
 * A name with no matching catalog entry is kept (sorted last): the catalog may
 * simply not have synced, and dropping it could empty the list and send the
 * modal back to its legacy TEKSI + eHailing default — a worse lie than showing
 * a type whose entry has since been renamed. Only an explicit `enabled: false`
 * removes a mode. Duplicates are collapsed case-insensitively.
 */
export function buildPartnerModeOptions(
  assigned: readonly unknown[],
  entries: readonly SettingEntry[]
): PartnerModeOption[] {
  const byName = indexPartnerTypes(entries);
  const seen = new Set<string>();
  const options: { option: PartnerModeOption; priority: number; order: number }[] = [];

  for (const raw of assigned) {
    const name = String(raw ?? "").trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = byName.get(key);
    if (meta && !meta.enabled) continue;
    options.push({
      option: {
        id: name,
        name,
        description: meta?.description,
        iconUrl: meta?.iconUrl,
      },
      priority: meta?.priority ?? Number.POSITIVE_INFINITY,
      order: options.length,
    });
  }

  return options
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.order - b.order;
    })
    .map((o) => o.option);
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
    let entries = getEntries("partner-type");
    if (entries.length === 0) {
      console.log("[partnerModeOptions] cache empty — fetching partner-type entries from Supabase");
      entries = await fetchPartnerTypeEntriesRemote();
    }
    return buildPartnerModeOptions(assigned, entries);
  } catch (e) {
    console.log("[partnerModeOptions] load failed", e);
    return [];
  }
}
