import { useCallback, useEffect, useState } from "react";

import { supabase } from "./supabase";

/**
 * Who is signed in, and may they use this tool?
 *
 * Two separate questions, deliberately kept apart. A Supabase session says the
 * person is authenticated; an `admin_access` row says they are staff. Since
 * migration 0069 the database enforces the second through `caller_is_admin()`,
 * so this check is a *courtesy* — it decides what to render, never what is
 * permitted. A user who edits it in the console still gets nothing back.
 */

export interface AdminSession {
  loading: boolean;
  userId: string | null;
  email: string | null;
  /** An `admin_access` row exists for this account. */
  isAdmin: boolean;
  /** Set when the admin check itself failed, rather than returning "no". */
  checkError: string | null;
}

const EMPTY: AdminSession = {
  loading: true,
  userId: null,
  email: null,
  isAdmin: false,
  checkError: null,
};

export function useAdminSession() {
  const [session, setSession] = useState<AdminSession>(EMPTY);

  const check = useCallback(async (userId: string, email: string | null) => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("admin_access")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        // A failed check is not a denial — say so rather than showing an
        // ordinary user a "you are not staff" screen because a query broke.
        setSession({
          loading: false,
          userId,
          email,
          isAdmin: false,
          checkError: error.message,
        });
        return;
      }
      setSession({ loading: false, userId, email, isAdmin: !!data, checkError: null });
    } catch (e) {
      setSession({
        loading: false,
        userId,
        email,
        isAdmin: false,
        checkError: e instanceof Error ? e.message : "Could not check access.",
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSession({ ...EMPTY, loading: false });
      return;
    }
    const client = supabase;
    let cancelled = false;

    void (async () => {
      const { data } = await client.auth.getSession();
      const user = data.session?.user;
      if (cancelled) return;
      if (!user) {
        setSession({ ...EMPTY, loading: false });
        return;
      }
      await check(user.id, user.email ?? null);
    })();

    const { data: sub } = client.auth.onAuthStateChange((_e, s) => {
      if (cancelled) return;
      const user = s?.user;
      if (!user) setSession({ ...EMPTY, loading: false });
      else void check(user.id, user.email ?? null);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [check]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return { session, signOut };
}

/** Email + password sign-in. Staff sign in at a desk, not by SMS. */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return "Supabase is not configured.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
