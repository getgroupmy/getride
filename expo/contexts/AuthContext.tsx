import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  isSupabaseConfigured,
  SUPABASE_URL_RESOLVED,
  SUPABASE_ANON_KEY_RESOLVED,
} from "@/utils/supabase";

const AUTH_KEY = "@app_auth_state";
const REGISTERED_USERS_KEY = "@registered_users";
/**
 * AsyncStorage key holding the full cached row from public.profiles for the
 * currently signed-in user. Mirrors every selectable column so the app can
 * render profile data offline; refreshed from Supabase whenever a session is
 * available (startup + on demand via refreshProfile).
 */
const PROFILE_CACHE_KEY = "@app_profile_cache";

const TEST_ACCOUNT = {
  phoneNumber: "+60182000004",
  pin: "111111",
  /**
   * Deterministic Supabase auth credentials used to give the test account a
   * REAL supabase session so RLS-protected writes (profile edits, etc.) sync.
   * Create this user once in Supabase Auth (Dashboard → Authentication → Add
   * user) with email confirmations disabled, or let the app sign it up the
   * first time (requires "Confirm email" to be off in Supabase Auth settings).
   */
  email: "test+60182000004@teksi.local",
  password: "teksi-test-60182000004",
};

interface RegisteredUser {
  phoneNumber: string;
  pin: string;
  firstName?: string;
}

/**
 * Full snapshot of a public.profiles row. Kept loose (all nullable) so we can
 * cache partial fetches and survive schema additions without crashing on read.
 */
export interface ProfileRecord {
  id: string;
  display_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  ic?: string | null;
  address?: string | null;
  profile_image?: string | null;
  avatar_url?: string | null;
  id_image?: string | null;
  nationality?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  referral_code?: string | null;
  pin?: string | null;
  status?: string | null;
  documents_ok?: boolean | null;
  total_rides?: number | null;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Local-only: timestamp of last successful sync from Supabase. */
  _cachedAt?: string;
}

/** Columns mirrored from public.profiles into the AsyncStorage cache. */
const PROFILE_COLUMNS =
  "id, display_id, name, phone, email, ic, address, profile_image, avatar_url, id_image, nationality, gender, birth_date, referral_code, pin, status, documents_ok, total_rides, joined_at, created_at, updated_at";

interface AuthState {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  userId?: string | null;
  profileName?: string | null;
  profileAvatar?: string | null;
  /**
   * Server-synced sign-in PIN, mirrored from public.profiles.pin. Cached
   * in-memory so the PIN status (set/unset) is consistent across devices.
   * Never persisted to AsyncStorage.
   */
  profilePin?: string | null;
  /**
   * True only when the current session is backed by a real Supabase auth
   * session (i.e. supabase.auth.getSession() returned a session). When false,
   * the user is signed in via the legacy local PIN / test-account path and
   * any RLS-protected Supabase calls (`auth.uid()`-based policies) will fail.
   */
  isSupabaseSession: boolean;
}

interface SendOtpResult {
  ok: boolean;
  error?: string;
}

interface VerifyOtpResult {
  ok: boolean;
  isNewUser: boolean;
  error?: string;
  userId?: string;
  hasName?: boolean;
  name?: string | null;
}

/**
 * Normalize a phone number to E.164-ish form Supabase expects (e.g. +60182000004).
 * Supabase requires a leading "+" and digits only.
 */
function normalizeE164(input: string): string {
  const trimmed = (input ?? "").trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

/**
 * Deterministic password derived from the user's PIN. Used to mint a real
 * Supabase auth session via phone+password sign-in when the user logs in
 * with PIN (skipping OTP). The password is synced server-side every time
 * the PIN is set/changed in `registerUser`. Anyone who knows the PIN can
 * obtain a session — same security model as the PIN itself.
 */
function derivePinPassword(pin: string): string {
  return `teksi-pin-v1-${pin}`;
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    phoneNumber: null,
    userId: null,
    profileName: null,
    profileAvatar: null,
    profilePin: null,
    isSupabaseSession: false,
  });
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDetails, setServerDetails] = useState<{
    url: string;
    hasUrl: boolean;
    hasAnonKey: boolean;
    httpStatus?: number;
    errorName?: string;
    errorMessage?: string;
    durationMs?: number;
  } | null>(null);

  const supaEnabled: boolean = isSupabaseConfigured && !!supabase;

  const applySession = useCallback(async (session: Session | null) => {
    if (session?.user) {
      const phone = session.user.phone
        ? `+${session.user.phone.replace(/[^\d]/g, "")}`
        : null;
      // Preserve cached name/avatar/pin so the UI doesn't flash empty values
      // while refreshProfile runs in the background.
      setAuthState((prev) => {
        const same = prev.userId === session.user.id;
        const next: AuthState = {
          isAuthenticated: true,
          phoneNumber: phone ?? prev.phoneNumber ?? null,
          userId: session.user.id,
          profileName: same ? prev.profileName ?? null : prev.profileName ?? null,
          profileAvatar: same ? prev.profileAvatar ?? null : prev.profileAvatar ?? null,
          profilePin: same ? prev.profilePin ?? null : null,
          isSupabaseSession: true,
        };
        AsyncStorage.setItem(
          AUTH_KEY,
          JSON.stringify({ ...next, profilePin: null })
        ).catch((e) => console.log("[auth] persist session failed", e));
        return next;
      });
    } else {
      const next: AuthState = {
        isAuthenticated: false,
        phoneNumber: null,
        userId: null,
        profileName: null,
        profileAvatar: null,
        profilePin: null,
        isSupabaseSession: false,
      };
      setAuthState(next);
      try {
        await AsyncStorage.removeItem(AUTH_KEY);
      } catch (e) {
        console.log("[auth] clear session failed", e);
      }
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    const init = async () => {
      try {
        const [storedAuth, storedUsers, storedProfile] = await Promise.all([
          AsyncStorage.getItem(AUTH_KEY),
          AsyncStorage.getItem(REGISTERED_USERS_KEY),
          AsyncStorage.getItem(PROFILE_CACHE_KEY),
        ]);

        let cachedProfile: ProfileRecord | null = null;
        if (storedProfile) {
          try {
            cachedProfile = JSON.parse(storedProfile) as ProfileRecord;
            setProfile(cachedProfile);
          } catch {}
        }
        // Seed authState from the cached profile so name/avatar render
        // immediately on boot regardless of which login path the user took.
        if (cachedProfile) {
          const seeded = cachedProfile;
          setAuthState((prev) => ({
            ...prev,
            profileName: prev.profileName ?? seeded.name ?? null,
            profileAvatar:
              prev.profileAvatar ??
              seeded.avatar_url ??
              seeded.profile_image ??
              null,
            userId: prev.userId ?? seeded.id ?? null,
          }));
        }

        if (storedUsers) {
          try {
            setRegisteredUsers(JSON.parse(storedUsers) as RegisteredUser[]);
          } catch {}
        }

        if (supaEnabled && supabase) {
          // Connectivity probe: short health ping so the splash can show a
          // "Not Connected to server" popup and proceed in local mode if the
          // device is offline or the project is unreachable.
          let online = false;
          const baseUrl = SUPABASE_URL_RESOLVED;
          const hasUrl = !!baseUrl;
          const hasAnonKey = !!SUPABASE_ANON_KEY_RESOLVED;
          let httpStatus: number | undefined;
          let errorName: string | undefined;
          let errorMessage: string | undefined;
          const t0 = Date.now();
          try {
            const url = `${baseUrl}/auth/v1/health`;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(url, {
              signal: ctrl.signal,
              headers: {
                apikey: SUPABASE_ANON_KEY_RESOLVED,
                Authorization: `Bearer ${SUPABASE_ANON_KEY_RESOLVED}`,
              },
            });
            clearTimeout(timer);
            httpStatus = res.status;
            online = res.ok;
            if (!online) {
              try {
                errorMessage = await res.text();
              } catch {}
            }
          } catch (e) {
            console.log("[auth] supabase health ping failed", e);
            online = false;
            if (e instanceof Error) {
              errorName = e.name;
              errorMessage = e.message;
            } else {
              errorMessage = String(e);
            }
          }
          const durationMs = Date.now() - t0;
          setServerReachable(online);
          setServerDetails({
            url: baseUrl,
            hasUrl,
            hasAnonKey,
            httpStatus,
            errorName,
            errorMessage,
            durationMs,
          });
          if (!online) {
            setServerError(
              errorMessage ||
                (httpStatus ? `HTTP ${httpStatus}` : "Unable to reach Supabase")
            );
          } else {
            setServerError(null);
          }
          if (!online) {
            console.log("[auth] server unreachable, falling back to local mode");
            if (storedAuth) {
              try {
                const parsed = JSON.parse(storedAuth) as AuthState;
                setAuthState({ ...parsed, isSupabaseSession: false });
              } catch {}
            }
            return;
          }
          // Real-time validation: confirm the cached session is still valid
          // server-side AND the matching profile row exists. If anything is
          // off, force the user back through the auth flow.
          const { data: sessionData } = await supabase.auth.getSession();
          const session = sessionData.session ?? null;
          let validated: Session | null = null;
          if (session) {
            try {
              const { data: userData, error: userErr } =
                await supabase.auth.getUser();
              if (userErr || !userData?.user) {
                console.log(
                  "[auth] startup validation: user invalid, signing out",
                  userErr?.message
                );
                await supabase.auth.signOut();
              } else {
                const { data: profile, error: profErr } = await supabase
                  .from("profiles")
                  .select("id")
                  .eq("id", userData.user.id)
                  .maybeSingle();
                if (profErr) {
                  console.log(
                    "[auth] startup validation: profile lookup failed",
                    profErr.message
                  );
                  await supabase.auth.signOut();
                } else if (!profile) {
                  console.log(
                    "[auth] startup validation: no profile row, signing out"
                  );
                  await supabase.auth.signOut();
                } else {
                  validated = session;
                }
              }
            } catch (e) {
              console.log("[auth] startup validation threw", e);
              try {
                await supabase.auth.signOut();
              } catch {}
            }
          }
          await applySession(validated);
          const sub = supabase.auth.onAuthStateChange((_event, nextSession) => {
            console.log("[auth] supabase state change:", _event);
            applySession(nextSession ?? null);
          });
          unsub = () => sub.data.subscription.unsubscribe();
        } else if (storedAuth) {
          try {
            const parsed = JSON.parse(storedAuth) as AuthState;
            // Restored from local storage cannot be a real Supabase session.
            setAuthState({ ...parsed, isSupabaseSession: false });
          } catch {}
          setServerReachable(false);
        } else {
          setServerReachable(false);
        }
      } catch (e) {
        console.error("[auth] init error", e);
      } finally {
        setIsLoading(false);
      }
    };

    init();
    return () => {
      if (unsub) unsub();
    };
  }, [supaEnabled, applySession]);

  // -------- Legacy local PIN flow (used only when Supabase isn't configured) --------

  const isUserRegistered = (phoneNumber: string): boolean => {
    const normalized = phoneNumber.replace(/[\s\-\(\)]/g, "").trim();
    const testPhone = TEST_ACCOUNT.phoneNumber.replace(/[\s\-\(\)]/g, "").trim();
    if (normalized === testPhone) return true;
    if (normalized.endsWith("182000004") && normalized.includes("+60")) return true;
    return registeredUsers.some(
      (u) => u.phoneNumber.replace(/[\s\-\(\)]/g, "").trim() === normalized
    );
  };

  /**
   * True if a sign-in PIN has already been set for this phone. Prefers the
   * server-synced value from public.profiles.pin (cached in authState) so
   * status is consistent across devices, and falls back to the locally
   * registered users list / built-in test account when offline or before
   * the profile has loaded.
   */
  const hasPinSet = (phoneNumber: string): boolean => {
    const normalized = (phoneNumber ?? "").replace(/[\s\-\(\)]/g, "").trim();
    if (!normalized) return false;
    const authPhone = (authState.phoneNumber ?? "").replace(/[\s\-\(\)]/g, "").trim();
    if (
      authState.isSupabaseSession &&
      authPhone === normalized &&
      !!authState.profilePin
    ) {
      return true;
    }
    const testPhone = TEST_ACCOUNT.phoneNumber.replace(/[\s\-\(\)]/g, "").trim();
    if (normalized === testPhone) return true;
    return registeredUsers.some(
      (u) =>
        u.phoneNumber.replace(/[\s\-\(\)]/g, "").trim() === normalized &&
        !!u.pin
    );
  };

  const verifyPin = (phoneNumber: string, pin: string): boolean => {
    const normalized = phoneNumber.replace(/\s/g, "");
    const authPhone = (authState.phoneNumber ?? "").replace(/\s/g, "");
    if (
      authState.isSupabaseSession &&
      authPhone === normalized &&
      authState.profilePin
    ) {
      return pin === authState.profilePin;
    }
    if (normalized === TEST_ACCOUNT.phoneNumber.replace(/\s/g, "")) {
      return pin === TEST_ACCOUNT.pin;
    }
    const user = registeredUsers.find(
      (u) => u.phoneNumber.replace(/\s/g, "") === normalized
    );
    return user?.pin === pin;
  };

  const registerUser = async (
    phoneNumber: string,
    pin: string,
    firstName?: string
  ): Promise<{ loginPinSaved: boolean }> => {
    let loginPinSaved = false;
    try {
      const normalized = phoneNumber.replace(/\s/g, "");
      const idx = registeredUsers.findIndex(
        (u) => u.phoneNumber.replace(/\s/g, "") === normalized
      );
      const updated: RegisteredUser[] =
        idx >= 0
          ? registeredUsers.map((u, i) =>
              i === idx ? { phoneNumber, pin, firstName } : u
            )
          : [...registeredUsers, { phoneNumber, pin, firstName }];
      await AsyncStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(updated));
      setRegisteredUsers(updated);

      // Mirror the PIN to the server so it syncs across devices. We try to
      // resolve the user id directly from supabase.auth.getUser() so the write
      // succeeds even when authState.isSupabaseSession hasn't been flipped yet
      // (race during signup → pin-setup) or when authState.userId is stale.
      if (supaEnabled && supabase) {
        try {
          let uid: string | null = authState.userId ?? null;
          try {
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) uid = data.user.id;
          } catch (e) {
            console.log("[auth] registerUser getUser threw", e);
          }
          if (uid) {
            // Mirror to both legacy `pin` and the new `login_pin` column so the
            // PIN is accessible from other devices for profile access.
            const update: { pin: string; login_pin: string; name?: string } = {
              pin,
              login_pin: pin,
            };
            if (firstName && firstName.trim()) update.name = firstName.trim();
            console.log("[auth] registerUser writing pin/login_pin for uid", uid);
            let { data: updated, error } = await supabase
              .from("profiles")
              .update(update)
              .eq("id", uid)
              .select("id, pin, login_pin")
              .maybeSingle();

            // Resilience: if the new `login_pin` column hasn't been migrated
            // into the live database yet, the combined update above fails
            // atomically — meaning even `pin` doesn't land. Detect that case
            // and retry without `login_pin` so at least `pin` is captured,
            // and surface a loud log so the operator runs the migration.
            const isSchemaMissing = (msg: string, col: string) =>
              new RegExp(`'${col}' column|column \"?${col}\"?|${col}.*schema cache`, "i").test(msg);
            if (error && isSchemaMissing(error.message, "login_pin") && !isSchemaMissing(error.message, "pin")) {
              console.log(
                "[auth] registerUser login_pin column missing — apply supabase/migrations/0003_profiles_status_idverified_pin_devices.sql. Falling back to pin-only update."
              );
              const fallback: { pin: string; name?: string } = { pin };
              if (firstName && firstName.trim()) fallback.name = firstName.trim();
              const retry = await supabase
                .from("profiles")
                .update(fallback)
                .eq("id", uid)
                .select("id, pin")
                .maybeSingle();
              updated = retry.data
                ? { id: retry.data.id, pin: retry.data.pin, login_pin: null }
                : null;
              error = retry.error;
            }
            // Same resilience for the legacy `pin` column: if it's missing in
            // the live DB (migration 0002 not applied / PostgREST cache stale),
            // retry writing only `login_pin` so the PIN is captured at least
            // in the new column.
            if (error && isSchemaMissing(error.message, "pin")) {
              console.log(
                "[auth] registerUser pin column missing in schema cache — apply supabase/migrations/0002_add_profiles_pin.sql or run `NOTIFY pgrst, 'reload schema'`. Falling back to login_pin-only update."
              );
              const fallback: { login_pin: string; name?: string } = { login_pin: pin };
              if (firstName && firstName.trim()) fallback.name = firstName.trim();
              const retry = await supabase
                .from("profiles")
                .update(fallback)
                .eq("id", uid)
                .select("id, login_pin")
                .maybeSingle();
              updated = retry.data
                ? { id: retry.data.id, pin: null, login_pin: retry.data.login_pin }
                : null;
              error = retry.error;
            }

            if (error) {
              console.log("[auth] registerUser server pin save error", error.message);
            } else if (!updated) {
              // No row matched — the profile row may not exist yet (trigger
              // missed). Insert it so the PIN is captured on first run.
              console.log("[auth] registerUser no profile row for uid, inserting", uid);
              let { error: insertErr } = await supabase
                .from("profiles")
                .insert({ id: uid, ...update });
              if (insertErr && isSchemaMissing(insertErr.message, "login_pin")) {
                const r = await supabase.from("profiles").insert({ id: uid, pin, ...(update.name ? { name: update.name } : {}) });
                insertErr = r.error;
              }
              if (insertErr && isSchemaMissing(insertErr.message, "pin")) {
                const r = await supabase.from("profiles").insert({ id: uid, login_pin: pin, ...(update.name ? { name: update.name } : {}) });
                insertErr = r.error;
              }
              if (insertErr) {
                console.log("[auth] registerUser insert pin error", insertErr.message);
              } else {
                setAuthState((prev) => {
                  const next: AuthState = { ...prev, profilePin: pin, userId: uid };
                  AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ ...next, profilePin: null })).catch(() => {});
                  return next;
                });
              }
            } else {
              console.log("[auth] registerUser pin saved", { id: updated.id, hasPin: !!updated.pin, hasLoginPin: !!updated.login_pin });
              if (updated.login_pin === pin) loginPinSaved = true;
              // Mirror the PIN as the user's Supabase auth password so the
              // PIN-only login screen can mint a real session via
              // signInWithPassword. Requires an active session here (we have
              // one — registerUser runs after OTP verify / while signed in).
              try {
                const { error: pwErr } = await supabase.auth.updateUser({
                  password: derivePinPassword(pin),
                });
                if (pwErr) {
                  console.log("[auth] registerUser sync auth password error", pwErr.message);
                } else {
                  console.log("[auth] registerUser auth password synced for pin login");
                }
              } catch (e) {
                console.log("[auth] registerUser updateUser password threw", e);
              }
              // Self-healing: if the combined update succeeded but the
              // returned row shows `login_pin` is still null (e.g. PostgREST
              // schema cache hadn't picked up the new column at the time of
              // the write, so it silently dropped that field), force a
              // dedicated UPDATE just for `login_pin` and re-verify.
              if (!updated.login_pin) {
                console.log("[auth] registerUser login_pin missing on row, retrying dedicated update", uid);
                const { data: forced, error: forceErr } = await supabase
                  .from("profiles")
                  .update({ login_pin: pin })
                  .eq("id", uid)
                  .select("id, login_pin")
                  .maybeSingle();
                if (forceErr) {
                  console.log("[auth] registerUser dedicated login_pin update error", forceErr.message);
                } else {
                  console.log("[auth] registerUser dedicated login_pin update result", { id: forced?.id, hasLoginPin: !!forced?.login_pin });
                  if (forced?.login_pin === pin) loginPinSaved = true;
                }
              }
              setAuthState((prev) => {
                const next: AuthState = { ...prev, profilePin: pin, userId: uid };
                AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ ...next, profilePin: null })).catch(() => {});
                return next;
              });
            }
          } else {
            console.log("[auth] registerUser skipped server pin save — no supabase user id");
          }
        } catch (e) {
          console.log("[auth] registerUser server pin save threw", e);
        }
      }
    } catch (error) {
      console.error("[auth] registerUser error", error);
    }
    return { loginPinSaved };
  };

  const login = async (phoneNumber: string, name?: string) => {
    try {
      const normalized = phoneNumber.replace(/\s/g, "");
      const registered = registeredUsers.find(
        (u) => u.phoneNumber.replace(/\s/g, "") === normalized
      );
      const resolvedName =
        (name && name.trim()) ||
        authState.profileName ||
        registered?.firstName ||
        null;
      const next: AuthState = {
        isAuthenticated: true,
        phoneNumber,
        userId: authState.userId ?? null,
        profileName: resolvedName,
        profileAvatar: authState.profileAvatar ?? null,
        // Legacy/test login is not a real Supabase session.
        isSupabaseSession: authState.isSupabaseSession,
      };
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
      setAuthState(next);
    } catch (e) {
      console.error("[auth] login error", e);
    }
  };

  /**
   * Sign the local test account into Supabase using its deterministic
   * email/password — sign-in ONLY. We deliberately do NOT sign the user up
   * or upsert a profile row here: the test account must already exist in
   * Supabase (auth user + matching `profiles` row with `phone` set), exactly
   * like any other user. If it doesn't, we return false so the caller can
   * route the user through the registration flow.
   */
  const signInTestAccountToSupabase = useCallback(async (): Promise<boolean> => {
    if (!supaEnabled || !supabase) return false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: TEST_ACCOUNT.email,
        password: TEST_ACCOUNT.password,
      });
      if (error || !data.session) {
        console.log(
          "[auth] test account has no Supabase record yet — registration required",
          error?.message
        );
        return false;
      }
      const userId = data.session.user.id;
      // Verify a matching profile row exists. No row → treat as unregistered.
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, phone")
          .eq("id", userId)
          .maybeSingle();
        if (!profile) {
          console.log("[auth] test account auth exists but no profile row — registration required");
          await supabase.auth.signOut();
          return false;
        }
      } catch (e) {
        console.log("[auth] test profile lookup error", e);
      }
      return true;
    } catch (e) {
      console.log("[auth] signInTestAccountToSupabase threw", e);
      return false;
    }
  }, [supaEnabled]);

  const logout = async () => {
    try {
      if (supaEnabled && supabase) {
        await supabase.auth.signOut();
      }
      await AsyncStorage.multiRemove([AUTH_KEY, PROFILE_CACHE_KEY]);
      setProfile(null);
      setAuthState({ isAuthenticated: false, phoneNumber: null, userId: null, profileName: null, profileAvatar: null, profilePin: null, isSupabaseSession: false });
    } catch (e) {
      console.error("[auth] logout error", e);
    }
  };

  // -------- Supabase phone-OTP flow --------

  const sendOtp = useCallback(
    async (
      phoneNumber: string,
      options?: { shouldCreateUser?: boolean }
    ): Promise<SendOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      // Default to false: only existing users can request a sign-in OTP.
      // Pass shouldCreateUser:true explicitly from the dedicated signup flow.
      const shouldCreateUser = options?.shouldCreateUser ?? false;
      const reqId = Math.random().toString(36).slice(2, 8);
      try {
        console.log(
          `[auth][${reqId}] sendOtp BEGIN phone=${phone} shouldCreateUser=${shouldCreateUser}`
        );
        const t0 = Date.now();
        const { error } = await supabase.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser },
        });
        console.log(`[auth][${reqId}] sendOtp END in ${Date.now() - t0}ms`);
        if (error) {
          console.log(`[auth][${reqId}] sendOtp error summary`, {
            name: error.name,
            status: (error as unknown as { status?: number }).status,
            code: (error as unknown as { code?: string }).code,
            message: error.message,
          });
          try {
            console.log(
              `[auth][${reqId}] sendOtp error raw`,
              JSON.stringify(error, Object.getOwnPropertyNames(error))
            );
          } catch {
            console.log(`[auth][${reqId}] sendOtp error raw (unstringifiable)`, error);
          }
          // Supabase returns this when shouldCreateUser=false and no user exists.
          const msg = /signups? not allowed|user not found|otp_disabled/i.test(
            error.message
          )
            ? "No account found for this number. Please sign up first."
            : error.message;
          return { ok: false, error: msg };
        }
        console.log(`[auth][${reqId}] sendOtp ok`);
        return { ok: true };
      } catch (e) {
        console.log(`[auth][${reqId}] sendOtp threw`, e);
        try {
          console.log(
            `[auth][${reqId}] sendOtp threw raw`,
            JSON.stringify(e, Object.getOwnPropertyNames(e as object))
          );
        } catch {}
        const msg = e instanceof Error ? e.message : "Failed to send code";
        return { ok: false, error: msg };
      }
    },
    [supaEnabled]
  );

  const verifyOtp = useCallback(
    async (
      phoneNumber: string,
      code: string,
      options?: { type?: "sms" | "phone_change" }
    ): Promise<VerifyOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, isNewUser: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      const type = options?.type ?? "sms";
      const reqId = Math.random().toString(36).slice(2, 8);
      try {
        console.log(
          `[auth][${reqId}] verifyOtp BEGIN phone=${phone} type=${type} codeLen=${code?.length ?? 0}`
        );
        const t0 = Date.now();
        const { data, error } = await supabase.auth.verifyOtp({
          phone,
          token: code,
          type,
        });
        console.log(`[auth][${reqId}] verifyOtp END in ${Date.now() - t0}ms`);
        if (error || !data.session) {
          if (error) {
            console.log(`[auth][${reqId}] verifyOtp error summary`, {
              name: error.name,
              status: (error as unknown as { status?: number }).status,
              code: (error as unknown as { code?: string }).code,
              message: error.message,
            });
            try {
              console.log(
                `[auth][${reqId}] verifyOtp error raw`,
                JSON.stringify(error, Object.getOwnPropertyNames(error))
              );
            } catch {
              console.log(
                `[auth][${reqId}] verifyOtp error raw (unstringifiable)`,
                error
              );
            }
          } else {
            console.log(`[auth][${reqId}] verifyOtp no session returned`);
          }
          return {
            ok: false,
            isNewUser: false,
            error: error?.message ?? "Invalid code",
          };
        }
        const userId = data.user?.id ?? data.session.user.id;
        // The DB trigger handle_new_auth_user inserts a profile row on signup.
        // Fetch it so we can decide if the user still needs to enter their name.
        let hasName = false;
        let isNewUser = true;
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id, name, phone")
            .eq("id", userId)
            .maybeSingle();
          if (profile) {
            isNewUser = !profile.name;
            hasName = !!profile.name;
            (data as unknown as { _name?: string })._name = profile.name ?? undefined;
            // Make sure phone column is populated (trigger may have skipped it).
            if (!profile.phone) {
              await supabase
                .from("profiles")
                .update({ phone })
                .eq("id", userId);
            }
          } else {
            await supabase
              .from("profiles")
              .insert({ id: userId, phone })
              .select()
              .maybeSingle();
          }
        } catch (e) {
          console.log("[auth] profile lookup failed", e);
        }
        const resolvedName =
          (data as unknown as { _name?: string })._name ?? null;
        console.log(`[auth][${reqId}] verifyOtp ok userId=${userId} isNewUser=${isNewUser}`);
        return { ok: true, isNewUser, hasName, userId, name: resolvedName };
      } catch (e) {
        console.log(`[auth][${reqId}] verifyOtp threw`, e);
        try {
          console.log(
            `[auth][${reqId}] verifyOtp threw raw`,
            JSON.stringify(e, Object.getOwnPropertyNames(e as object))
          );
        } catch {}
        const msg = e instanceof Error ? e.message : "Verification failed";
        return { ok: false, isNewUser: false, error: msg };
      }
    },
    [supaEnabled]
  );

  /**
   * Send a phone-change OTP to a NEW phone number for the currently
   * authenticated user. Uses supabase.auth.updateUser({ phone }) which
   * triggers an SMS to the new number. Verify with verifyOtp(..., { type:
   * "phone_change" }).
   */
  const sendPhoneChangeOtp = useCallback(
    async (newPhoneNumber: string): Promise<SendOtpResult> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(newPhoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      try {
        console.log("[auth] sending phone-change OTP to", phone);
        const { error } = await supabase.auth.updateUser({ phone });
        if (error) {
          console.log("[auth] sendPhoneChangeOtp error", error.message);
          return { ok: false, error: error.message };
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to send code";
        return { ok: false, error: msg };
      }
    },
    [supaEnabled]
  );

  /**
   * Persist profile updates (e.g. user's first name) into public.profiles.
   * No-op if Supabase isn't configured.
   */
  const updateProfile = useCallback(
    async (patch: { name?: string; firstName?: string; phone?: string }): Promise<boolean> => {
      if (!supaEnabled || !supabase) return false;
      const userId = authState.userId;
      if (!userId) return false;
      // RLS policies require auth.uid() to match; bail early on test/legacy sessions.
      if (!authState.isSupabaseSession) {
        console.log("[auth] updateProfile skipped: not a Supabase session");
        return false;
      }
      const name = patch.name ?? patch.firstName;
      const phone = patch.phone ? normalizeE164(patch.phone) : undefined;
      const update: { name?: string; phone?: string } = {};
      if (name) update.name = name;
      if (phone) update.phone = phone;
      if (Object.keys(update).length === 0) return false;
      try {
        const { error } = await supabase
          .from("profiles")
          .update(update)
          .eq("id", userId);
        if (error) {
          console.log("[auth] updateProfile error", error.message);
          return false;
        }
        setAuthState((prev) => {
          const next: AuthState = {
            ...prev,
            ...(phone ? { phoneNumber: phone } : {}),
            ...(name ? { profileName: name } : {}),
          };
          AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        return true;
      } catch (e) {
        console.log("[auth] updateProfile threw", e);
        return false;
      }
    },
    [supaEnabled, authState.userId, authState.isSupabaseSession]
  );

  /**
   * Forgot-PIN reset. Clears `profiles.pin` server-side so the user is routed
   * to Set PIN, and updates the in-memory `profilePin` so `hasPinSet` flips to
   * false immediately. Requires a real Supabase session (RLS auth.uid() = id).
   */
  const forgotPin = useCallback(async (): Promise<boolean> => {
    const userId = authState.userId;
    const phone = authState.phoneNumber ?? "";
    let serverOk = false;
    if (supaEnabled && supabase && authState.isSupabaseSession && userId) {
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ pin: null, login_pin: null })
          .eq("id", userId);
        if (error) {
          console.log("[auth] forgotPin server clear error", error.message);
        } else {
          serverOk = true;
        }
      } catch (e) {
        console.log("[auth] forgotPin threw", e);
      }
    }
    // Also clear the local registered-users cache so the offline path agrees.
    try {
      const normalized = phone.replace(/\s/g, "");
      const updated = registeredUsers.map((u) =>
        u.phoneNumber.replace(/\s/g, "") === normalized ? { ...u, pin: "" } : u
      );
      await AsyncStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(updated));
      setRegisteredUsers(updated);
    } catch (e) {
      console.log("[auth] forgotPin local clear error", e);
    }
    setAuthState((prev) => {
      const next: AuthState = { ...prev, profilePin: null };
      AsyncStorage.setItem(
        AUTH_KEY,
        JSON.stringify({ ...next, profilePin: null })
      ).catch(() => {});
      return next;
    });
    return serverOk || !supaEnabled;
  }, [supaEnabled, authState.userId, authState.isSupabaseSession, authState.phoneNumber, registeredUsers]);

  /**
   * Re-fetch the user's name + avatar from public.profiles. Call after any external
   * update path so shared UI (side sheets, menus) reflects the latest values.
   */
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!supaEnabled || !supabase) return;
    const userId = authState.userId;
    if (!userId) return;
    // No isSupabaseSession gate: legacy/PIN sessions can still hit the anon
    // endpoint to refresh the cached row when RLS allows it. If the read is
    // blocked we just keep the existing cache.
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.log("[auth] refreshProfile fetch error", error.message);
        return;
      }
      if (!data) return;
      const record: ProfileRecord = {
        ...(data as ProfileRecord),
        _cachedAt: new Date().toISOString(),
      };
      setProfile(record);
      // Persist the full row to AsyncStorage minus the PIN (kept in memory only).
      const { pin: _pin, ...persisted } = record;
      void _pin;
      AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(persisted)).catch(
        () => {}
      );
      setAuthState((prev) => {
        const next: AuthState = {
          ...prev,
          profileName: record.name ?? prev.profileName ?? null,
          profileAvatar:
            record.avatar_url ?? record.profile_image ?? prev.profileAvatar ?? null,
          profilePin: record.pin ?? prev.profilePin ?? null,
        };
        AsyncStorage.setItem(
          AUTH_KEY,
          JSON.stringify({ ...next, profilePin: null })
        ).catch(() => {});
        return next;
      });
    } catch (e) {
      console.log("[auth] refreshProfile error", e);
    }
  }, [supaEnabled, authState.userId, authState.isSupabaseSession]);

  useEffect(() => {
    if (authState.userId) {
      refreshProfile();
    }
  }, [authState.userId, authState.isSupabaseSession, refreshProfile]);

  /**
   * Mint a real Supabase auth session from phone + PIN by signing in with
   * the deterministic password mirrored from the PIN. Used by /pin-verify so
   * the user is fully authenticated (RLS-protected reads/writes work) even
   * when OTP was skipped. Returns { ok, needsOtp, error } — `needsOtp:true`
   * means the user pre-dates password-sync and must do a one-time OTP login.
   */
  const signInWithPin = useCallback(
    async (
      phoneNumber: string,
      pin: string
    ): Promise<{
      ok: boolean;
      needsOtp?: boolean;
      profilePinMatched?: boolean;
      error?: string;
    }> => {
      if (!supaEnabled || !supabase) {
        return { ok: false, error: "Supabase is not configured" };
      }
      const phone = normalizeE164(phoneNumber);
      if (!phone) return { ok: false, error: "Invalid phone number" };
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          phone,
          password: derivePinPassword(pin),
        });
        if (error || !data.session) {
          const msg = error?.message ?? "Sign in failed";
          console.log("[auth] signInWithPin error", msg);
          // Supabase returns "Invalid login credentials" both for a wrong PIN
          // AND for a user whose Auth password has drifted from the PIN saved
          // in their profile (e.g. the PIN was changed without re-syncing the
          // password). In the latter case the user IS typing the correct PIN.
          if (/invalid login credentials/i.test(msg)) {
            // Fallback: check the entered PIN against the PIN saved in the
            // user's profile (kept in memory after a prior authenticated
            // read). A match proves the PIN is correct and the Auth password
            // is simply out of sync.
            const savedPin = authState.profilePin;
            if (savedPin && pin === savedPin) {
              console.log(
                "[auth] signInWithPin: entered PIN matches saved profile PIN — attempting password re-sync"
              );
              // Re-sync the Auth password to the PIN so future logins work.
              // updateUser only succeeds when a session already exists (e.g.
              // a re-auth / verifyOnly prompt while the user is signed in).
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData.session) {
                  const { error: pwErr } = await supabase.auth.updateUser({
                    password: derivePinPassword(pin),
                  });
                  if (!pwErr) {
                    console.log(
                      "[auth] signInWithPin: Auth password re-synced from profile PIN"
                    );
                    return { ok: true };
                  }
                  console.log(
                    "[auth] signInWithPin: password re-sync failed",
                    pwErr.message
                  );
                }
              } catch (e) {
                console.log("[auth] signInWithPin: re-sync threw", e);
              }
              // No active session to re-sync against — the PIN is verified
              // but we still need a one-time OTP to mint a session and sync
              // the password. Tell the caller the profile PIN matched so it
              // can accept the user locally instead of treating it as wrong.
              return { ok: false, needsOtp: true, profilePinMatched: true, error: msg };
            }
            return { ok: false, needsOtp: true, error: msg };
          }
          return { ok: false, error: msg };
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sign in failed";
        console.log("[auth] signInWithPin threw", e);
        return { ok: false, error: msg };
      }
    },
    [supaEnabled, authState.profilePin]
  );

  return {
    authState,
    /**
     * Full cached snapshot of public.profiles for the signed-in user.
     * Populated from AsyncStorage on boot and refreshed from Supabase
     * whenever a real session is available. May be null when logged out
     * or before the first successful sync.
     */
    profile,
    isLoading,
    serverReachable,
    isSupabaseAuth: supaEnabled,
    serverError,
    serverDetails,
    /**
     * True when the current session is a real Supabase auth session and
     * RLS-protected calls will work. False for the local PIN / test account.
     */
    isSupabaseSession: authState.isSupabaseSession,
    // legacy local PIN flow
    login,
    logout,
    isUserRegistered,
    hasPinSet,
    verifyPin,
    registerUser,
    // supabase phone-OTP flow
    sendOtp,
    verifyOtp,
    sendPhoneChangeOtp,
    updateProfile,
    refreshProfile,
    forgotPin,
    // test account → real supabase session bridge
    signInTestAccountToSupabase,
    /** Phone + PIN → real Supabase session (skips OTP). */
    signInWithPin,
    isTestAccountPhone: (phone: string) =>
      phone.replace(/\s/g, "") === TEST_ACCOUNT.phoneNumber.replace(/\s/g, ""),
  };
});
