import type { PartnerModeOption } from "@/components/PartnerModeSelectModal";
import { fetchUserProfile, findOrCreatePartner } from "@/utils/partnerOnboardingStore";

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
