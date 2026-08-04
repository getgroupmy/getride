/**
 * Meter Digital settings store — the IO half of `utils/meterSettings.ts`.
 *
 * Reads and writes the `meter_digital_settings` table (migration 0081) and
 * degrades the way the wallet and commission stores do: when the table is not
 * in the live database yet, admin edits and rate resolution keep working
 * against a device-local AsyncStorage copy and the caller is told the source
 * was `local` so it can say so.
 *
 * The last successful fetch is cached separately from the local-only copy,
 * because the meter has to resolve a rate card with no signal at all — a taxi
 * in a basement car park still opens hires.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import {
  METER_SETTINGS_COLUMNS,
  meterPanelsToRow,
  meterProfileToRow,
  normalizeMeterProfile,
  type MeterPanelAccess,
  type MeterPanelId,
  type MeterProfile,
} from "@/utils/meterSettings";

export type MeterSettingsSource = "supabase" | "local";

export interface MeterProfilesResult {
  profiles: MeterProfile[];
  source: MeterSettingsSource;
}

export interface MeterSettingsSaveResult {
  ok: boolean;
  error?: string;
  source?: MeterSettingsSource;
  /** The row the write landed on, so a card created by it can be adopted. */
  id?: string;
}

const TABLE = "meter_digital_settings";
const CACHE_KEY = "meter:settings:cache";
const LOCAL_KEY = "meter:settings:local";

/** True when the error says the table isn't in the database yet. */
function isMissingSchemaError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? `${String((err as { message?: string }).message ?? "")} ${String(
          (err as { code?: string }).code ?? "",
        )}`
      : String(err ?? "");
  const lower = msg.toLowerCase();
  return (
    msg.includes("42P01") ||
    msg.includes("PGRST205") ||
    msg.includes("PGRST202") ||
    lower.includes("could not find") ||
    lower.includes("does not exist") ||
    lower.includes("schema cache")
  );
}

/** True when RLS refused the write — the caller is not an admin. */
function isPermissionDeniedError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null
      ? `${String((err as { message?: string }).message ?? "")} ${String(
          (err as { code?: string }).code ?? "",
        )}`
      : String(err ?? "");
  return msg.includes("42501") || msg.toLowerCase().includes("row-level security");
}

async function readStored(key: string): Promise<MeterProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Stored profiles are already camelCase, so they round-trip as themselves;
    // anything that doesn't look like a profile is dropped rather than trusted.
    return parsed.filter(
      (p): p is MeterProfile =>
        !!p && typeof p === "object" && typeof (p as MeterProfile).id === "string",
    );
  } catch (e) {
    console.log("[meter-settings] stored read failed", key, e);
    return [];
  }
}

async function writeStored(key: string, profiles: MeterProfile[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(profiles));
  } catch (e) {
    console.log("[meter-settings] stored write failed", key, e);
  }
}

/**
 * Every configured rate card. Caches the result for offline resolution and
 * falls back to the device-local copy when the table isn't applied yet.
 */
export async function fetchMeterProfiles(): Promise<MeterProfilesResult> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select(METER_SETTINGS_COLUMNS)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const profiles = ((data ?? []) as unknown[])
        .map(normalizeMeterProfile)
        .filter((p): p is MeterProfile => p !== null);
      await writeStored(CACHE_KEY, profiles);
      return { profiles, source: "supabase" };
    } catch (e) {
      if (isMissingSchemaError(e)) {
        console.log("[meter-settings] table missing — using local profiles");
        return { profiles: await readStored(LOCAL_KEY), source: "local" };
      }
      console.log("[meter-settings] fetch failed — using cached profiles", e);
      return { profiles: await readStored(CACHE_KEY), source: "local" };
    }
  }
  return { profiles: await readStored(LOCAL_KEY), source: "local" };
}

/**
 * Create or update a rate card.
 *
 * A card with an id is updated; one without is inserted, except at `master`
 * level, where the single global row is updated in place if it already exists —
 * there is only ever one global card.
 */
export async function saveMeterProfile(
  profile: MeterProfile,
): Promise<MeterSettingsSaveResult> {
  const row = meterProfileToRow(profile);
  const id = profile.id.trim();

  if (isSupabaseConfigured && supabase) {
    try {
      if (id) {
        const { error } = await supabase.from(TABLE).update(row).eq("id", id);
        if (error) throw error;
      } else if (profile.level === "master") {
        const { data, error: selErr } = await supabase
          .from(TABLE)
          .select("id")
          .eq("level", "master")
          .limit(1);
        if (selErr) throw selErr;
        const existing = (data ?? [])[0] as { id: string } | undefined;
        const { error } = existing
          ? await supabase.from(TABLE).update(row).eq("id", existing.id)
          : await supabase.from(TABLE).insert(row);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(TABLE).insert(row);
        if (error) {
          if (String(error.code ?? "") === "23505") {
            return { ok: false, error: "A rate card for this exact scope already exists." };
          }
          throw error;
        }
      }
      return { ok: true, source: "supabase" };
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        return {
          ok: false,
          error:
            "The database refused the write. Rate cards are admin-only — sign in with an admin account and try again.",
        };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[meter-settings] save failed", e);
        return { ok: false, error: "Could not save. Please try again." };
      }
      console.log("[meter-settings] save falling back to local profiles");
    }
  }

  // Local fallback — the same rules, applied to the device copy.
  const profiles = await readStored(LOCAL_KEY);
  const stamped = (assignedId: string): MeterProfile => ({
    ...profile,
    id: assignedId,
    updatedAt: new Date().toISOString(),
  });

  let next: MeterProfile[];
  if (id) {
    next = profiles.map((p) => (p.id === id ? stamped(id) : p));
  } else if (profile.level === "master") {
    const existing = profiles.find((p) => p.level === "master");
    next = existing
      ? profiles.map((p) => (p.id === existing.id ? stamped(existing.id) : p))
      : [stamped(uuidv4()), ...profiles];
  } else {
    const duplicate = profiles.some(
      (p) =>
        p.level === profile.level &&
        eqi(p.country, profile.country) &&
        eqi(p.state, profile.state) &&
        eqi(p.city, profile.city) &&
        eqi(p.suburb, profile.suburb),
    );
    if (duplicate) {
      return { ok: false, error: "A rate card for this exact scope already exists." };
    }
    next = [stamped(uuidv4()), ...profiles];
  }
  await writeStored(LOCAL_KEY, next);
  return { ok: true, source: "local" };
}

/**
 * Write just the console panels of a card.
 *
 * The Show / Tap switches in the admin editor apply live — a driver's console
 * is not a fare, so there is nothing to hold back until a Save — and this is the
 * narrow write that makes that safe: only the ten panel columns are touched, so
 * a toggle can never carry a half-typed rate into the database with it, and a
 * second admin editing the fares at the same time is not clobbered.
 *
 * `profile` supplies the row to write and, where the single global card does
 * not exist yet, the card to create it from.
 */
export async function saveMeterPanelAccess(
  profile: MeterProfile,
  panels: Record<MeterPanelId, MeterPanelAccess>,
): Promise<MeterSettingsSaveResult> {
  const id = profile.id.trim();
  const panelRow = meterPanelsToRow(panels);

  if (isSupabaseConfigured && supabase) {
    try {
      if (id) {
        const { error } = await supabase.from(TABLE).update(panelRow).eq("id", id);
        if (error) throw error;
        return { ok: true, source: "supabase", id };
      }
      if (profile.level === "master") {
        const { data, error: selErr } = await supabase
          .from(TABLE)
          .select("id")
          .eq("level", "master")
          .limit(1);
        if (selErr) throw selErr;
        const existing = (data ?? [])[0] as { id: string } | undefined;
        if (existing) {
          const { error } = await supabase.from(TABLE).update(panelRow).eq("id", existing.id);
          if (error) throw error;
          return { ok: true, source: "supabase", id: existing.id };
        }
        // No global row yet: the toggle creates it, from the card the editor is
        // showing plus this change. Its seeded rates are the built-in tariff the
        // meter was already billing on, so nothing about a fare moves.
        const { data: inserted, error } = await supabase
          .from(TABLE)
          .insert(meterProfileToRow({ ...profile, panels }))
          .select("id")
          .limit(1);
        if (error) throw error;
        const row = (inserted ?? [])[0] as { id: string } | undefined;
        return { ok: true, source: "supabase", id: row?.id };
      }
      return {
        ok: false,
        error: "Create this rate card first — panel changes apply live once it exists.",
      };
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        return {
          ok: false,
          error:
            "The database refused the write. Rate cards are admin-only — sign in with an admin account and try again.",
        };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[meter-settings] panel save failed", e);
        return { ok: false, error: "Could not apply. Please try again." };
      }
      console.log("[meter-settings] panel save falling back to local profiles");
    }
  }

  // Local fallback — the device copy, same rules.
  const profiles = await readStored(LOCAL_KEY);
  const stored = id
    ? profiles.find((p) => p.id === id)
    : profile.level === "master"
      ? profiles.find((p) => p.level === "master")
      : undefined;

  if (!stored && !id && profile.level !== "master") {
    return {
      ok: false,
      error: "Create this rate card first — panel changes apply live once it exists.",
    };
  }

  const assignedId = stored?.id ?? uuidv4();
  const next: MeterProfile = {
    ...(stored ?? profile),
    id: assignedId,
    panels,
    updatedAt: new Date().toISOString(),
  };
  await writeStored(
    LOCAL_KEY,
    stored ? profiles.map((p) => (p.id === assignedId ? next : p)) : [next, ...profiles],
  );
  return { ok: true, source: "local", id: assignedId };
}

/**
 * Watch the rate cards for changes made elsewhere — an admin moving a panel
 * switch has to reach the drivers' consoles without them reopening the meter.
 *
 * Debounced, because one edit can land as several row events. Returns a no-op
 * unsubscribe when Supabase isn't configured (there is no external writer for a
 * device-local card) or when the channel cannot be opened at all; callers keep a
 * refetch-on-focus backstop for a database where the table is not published for
 * realtime.
 */
export function subscribeMeterSettings(onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 250);
  };

  try {
    const channel = supabase
      .channel("meter-settings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, notify)
      .subscribe((status) => {
        console.log("[meter-settings] realtime channel status", status);
      });

    return () => {
      if (timer) clearTimeout(timer);
      try {
        supabase?.removeChannel(channel);
      } catch (e) {
        console.log("[meter-settings] realtime unsubscribe failed", e);
      }
    };
  } catch (e) {
    console.log("[meter-settings] realtime subscribe failed", e);
    return () => {};
  }
}

/** Remove a rate card. Deleting the global one falls back to the built-in tariff. */
export async function deleteMeterProfile(id: string): Promise<MeterSettingsSaveResult> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      return { ok: true, source: "supabase" };
    } catch (e) {
      if (isPermissionDeniedError(e)) {
        return {
          ok: false,
          error: "The database refused the delete. Rate cards are admin-only.",
        };
      }
      if (!isMissingSchemaError(e)) {
        console.log("[meter-settings] delete failed", e);
        return { ok: false, error: "Could not delete. Please try again." };
      }
    }
  }
  const profiles = await readStored(LOCAL_KEY);
  await writeStored(
    LOCAL_KEY,
    profiles.filter((p) => p.id !== id),
  );
  return { ok: true, source: "local" };
}

function eqi(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}
