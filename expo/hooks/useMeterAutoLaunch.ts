/**
 * useMeterAutoLaunch — open a TEKSI driver straight into the taxi meter.
 *
 * When the operator's rate card asks for it (`autoLaunch`, Admin → Settings →
 * Meter Digital Setting), a partner carrying the TEKSI partner type lands on
 * `/meter-digital` instead of the passenger map — on sign-in and on every
 * relaunch, since to a driver those are the same event: the app opening at the
 * start of a shift.
 *
 * Three properties this hook owns, none of which belong in a screen:
 *
 *   * **Once per app session.** The redirect is a *launch* behaviour, not a
 *     rule about where the driver may be. A driver who leaves the console for
 *     the map is not dragged back into it, and the flag is set by the first
 *     screen that evaluates the question — whether or not it redirected — so a
 *     later screen cannot re-run it (`markMeterAutoLaunchHandled` is how a
 *     caller that wins the launch for something else, an in-progress ride, says
 *     so).
 *   * **It never wins over a ride in progress.** The caller passes `enabled`
 *     only once it knows there is nothing to restore: a hire the driver is in
 *     the middle of outranks the screen they start the next one from.
 *   * **It never blocks the launch.** Everything it reads is cached
 *     (AsyncStorage rate cards, the last meter geography) or a single row; if
 *     any of it is slow or fails, the app simply stays where it landed. Reading
 *     the partner row needs a real Supabase session, so a legacy local-PIN
 *     session simply lands on the map — the same way it sees no other
 *     partner-only row.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { resolveMeterAutoLaunch } from "@/utils/meterAutoLaunch";
import { fetchMeterProfiles, readMeterGeo } from "@/utils/meterSettingsStore";
import { fetchPartnerForUser } from "@/utils/partnerOnboardingStore";

/**
 * Module-level, so it survives remounts of any one screen but not a cold start
 * — which is exactly the life of an "app launch".
 */
let autoLaunchHandled = false;

/**
 * Consume the launch without redirecting.
 *
 * Called by whatever claimed the launch for something more urgent (an ongoing
 * ride being restored), so that a screen mounted later in the same session does
 * not decide the meter's turn has come after all.
 */
export function markMeterAutoLaunchHandled(): void {
  autoLaunchHandled = true;
}

export interface UseMeterAutoLaunchOptions {
  /**
   * Run the check. Callers hold this false until they know nothing more urgent
   * is claiming the launch (see `app/index.tsx`).
   */
  enabled: boolean;
}

export function useMeterAutoLaunch({ enabled }: UseMeterAutoLaunchOptions): void {
  const { authState } = useAuth();
  const router = useRouter();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || autoLaunchHandled || runningRef.current) return;
    if (!authState.isAuthenticated || !authState.userId) return;

    // Claimed up front rather than after the awaits: the question is answered
    // once per launch even if answering it takes a moment, so a second screen
    // mounting meanwhile cannot start the same lookups again.
    autoLaunchHandled = true;
    runningRef.current = true;

    const userId = authState.userId;
    let cancelled = false;

    void (async () => {
      try {
        const [partner, { profiles }, geo] = await Promise.all([
          fetchPartnerForUser(userId),
          fetchMeterProfiles(),
          readMeterGeo(),
        ]);
        if (cancelled) return;

        const decision = resolveMeterAutoLaunch({
          profiles,
          partnerTypes: partner?.partner_types ?? null,
          geo,
        });
        console.log(
          "[meter-auto-launch]",
          decision.reason,
          "card:",
          decision.card.scope,
        );
        if (!decision.launch) return;
        router.replace("/meter-digital" as never);
      } catch (e) {
        // A launch is never held up by this: the driver stays where they landed
        // and the Meter Digital button is one tap away.
        console.log("[meter-auto-launch] check failed", e);
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, authState.isAuthenticated, authState.userId, router]);
}
