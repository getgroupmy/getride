import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the back office.
 *
 * The back office is written against the *existing* project — the same schema,
 * migrations and RLS policies the app uses. It holds no service-role key: an
 * admin is an ordinary authenticated user who happens to have an `admin_access`
 * row, and `caller_is_admin()` is what actually grants the wider read/write.
 * Putting a service key in a browser bundle would hand every visitor full
 * database access.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!)
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }
  return supabase;
}
