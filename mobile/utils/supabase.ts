import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

/**
 * Centralised Supabase client for the Expo app.
 *
 * The client is created lazily so that bundling does not fail when the
 * environment variables are missing (e.g. before a user has connected a
 * Supabase project). Callers should always check `isSupabaseConfigured`
 * before using `supabase` to avoid runtime errors.
 */

const HARDCODED_SUPABASE_URL = "https://rqlavogkgywxspuxgiwk.supabase.co";
const HARDCODED_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbGF2b2drZ3l3eHNwdXhnaXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NTk5NzQsImV4cCI6MjA5NDAzNTk3NH0.xzx_EdvoOeTLxNQTIzG0EiF9H34OlHirHAdSVA4_aG0";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || HARDCODED_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || HARDCODED_SUPABASE_ANON_KEY;

export const isSupabaseConfigured: boolean = !!(
  SUPABASE_URL && SUPABASE_ANON_KEY
);

export const SUPABASE_URL_RESOLVED: string = SUPABASE_URL;
export const SUPABASE_ANON_KEY_RESOLVED: string = SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

function buildClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (_client) return _client;
  try {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    });
    return _client;
  } catch (e) {
    console.log("[supabase] failed to create client", e);
    return null;
  }
}

export const supabase: SupabaseClient | null = buildClient();

/**
 * Lightweight UUID v4 generator that works in React Native + web without
 * additional dependencies. Used so the client can pre-generate the primary
 * key it sends to Supabase, keeping local optimistic IDs aligned with the
 * canonical row id once the insert completes.
 */
export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array };
  };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push(bytes[i].toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

/** Optional helper for callers that want to throw early when not configured. */
export function getSupabaseOrThrow(): SupabaseClient {
  const c = buildClient();
  if (!c) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return c;
}
