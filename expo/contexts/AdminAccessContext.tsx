import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import { isSupabaseConfigured, supabase } from "@/utils/supabase";

/**
 * One row from `public.admin_access`.
 * `page = '*'` is a wildcard that grants the given access level on every
 * admin page.
 */
export interface AdminAccessRow {
  id: string;
  profile_id: string;
  page: string;
  access_level: "read" | "edit";
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * AsyncStorage key flipped to "1" by `admin-login` when the user authenticates
 * via the hardcoded super-admin PIN / credentials. Acts as a god-mode flag so
 * the legacy non-Supabase admin session continues to work while we transition
 * to Supabase-backed per-profile permissions.
 */
export const ADMIN_SUPER_KEY = "@admin_super_session";

export const [AdminAccessProvider, useAdminAccess] = createContextHook(() => {
  const [rows, setRows] = useState<AdminAccessRow[]>([]);
  const [isSuper, setIsSuper] = useState<boolean>(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadFromSupabase = useCallback(async (uid: string | null) => {
    if (!uid || !isSupabaseConfigured || !supabase) {
      setRows([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("admin_access")
        .select("id, profile_id, page, access_level, notes, created_at, updated_at")
        .eq("profile_id", uid);
      if (error) {
        console.log("[adminAccess] load error", error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as AdminAccessRow[]);
    } catch (e) {
      console.log("[adminAccess] load threw", e);
      setRows([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const flag = await AsyncStorage.getItem(ADMIN_SUPER_KEY);
      const superNow = flag === "1";
      setIsSuper(superNow);

      let uid: string | null = null;
      if (isSupabaseConfigured && supabase) {
        try {
          const { data } = await supabase.auth.getUser();
          uid = data.user?.id ?? null;
        } catch (e) {
          console.log("[adminAccess] getUser threw", e);
        }
      }
      setProfileId(uid);
      await loadFromSupabase(uid);
    } finally {
      setIsLoading(false);
    }
  }, [loadFromSupabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canEdit = useCallback(
    (page: string): boolean => {
      if (isSuper) return true;
      return rows.some(
        (r) =>
          (r.page === page || r.page === "*") && r.access_level === "edit"
      );
    },
    [isSuper, rows]
  );

  const canRead = useCallback(
    (page: string): boolean => {
      if (isSuper) return true;
      return rows.some((r) => r.page === page || r.page === "*");
    },
    [isSuper, rows]
  );

  return {
    rows,
    isSuper,
    profileId,
    isLoading,
    canEdit,
    canRead,
    refresh,
  };
});

/**
 * Mark the current session as the hardcoded super-admin. Called from
 * `admin-login` after a successful PIN / credentials match.
 */
export async function markSuperAdminSession(): Promise<void> {
  try {
    await AsyncStorage.setItem(ADMIN_SUPER_KEY, "1");
  } catch (e) {
    console.log("[adminAccess] markSuperAdminSession error", e);
  }
}

/**
 * Clear the super-admin flag. Call on admin logout.
 */
export async function clearSuperAdminSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ADMIN_SUPER_KEY);
  } catch (e) {
    console.log("[adminAccess] clearSuperAdminSession error", e);
  }
}

/**
 * Whether the legacy hardcoded PIN / credentials / IP-whitelist bypass on
 * `admin-login` are still allowed to grant a super-admin session (migration
 * 0068). Once a real `admin_access` row exists — the only way anyone
 * reaches the admin panel at all before that is this same legacy flow, so
 * seeding one is always a deliberate, out-of-band step — the hardcoded
 * login is retired and operators must sign in with their own
 * admin_access-scoped Supabase session.
 *
 * Fails open (returns true) when Supabase isn't configured, the RPC is
 * missing (pre-0068 database), or the call errors — same graceful
 * degradation as the rest of the admin-settings stores.
 */
export async function isLegacyAdminLoginAvailable(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  try {
    const { data, error } = await supabase.rpc("admin_access_exists");
    if (error) {
      console.log("[adminAccess] admin_access_exists error", error.message);
      return true;
    }
    return data !== true;
  } catch (e) {
    console.log("[adminAccess] admin_access_exists threw", e);
    return true;
  }
}
