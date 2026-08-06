/**
 * The launch buffer's memory for one run of the app.
 *
 * `/welcome-back` is a turnstile: it is entered once per app launch, decides
 * where the launch lands (`resolveLaunchDestination`) and replaces itself with
 * that destination. "Once per launch" used to be a `useRef` inside
 * `RootLayoutNav`, which is only "once per mount of that component" — and the
 * navigator is mounted *below* it, so anything that remounts the tree (the
 * root error boundary recovering from a content-less render throw, a fast
 * refresh, a provider re-keying) took two things with it at the same time:
 *
 *   * the navigation state, which resets to the stack's initial route — the
 *     passenger map — however far into the app the user was, and
 *   * the "already launched" ref, so the map was read as a cold launch and the
 *     buffer was entered *again*.
 *
 * For a TEKSI driver whose card opens the meter that is a loop: meter →
 * remount → root → buffer → meter → remount, and what the driver sees is the
 * app sitting on the "Welcome back" screen. Keeping the flag in the module
 * rather than in a component breaks it: the buffer is entered once per JS
 * session, whatever remounts underneath it.
 *
 * The second half is the destination. A navigation-state reset drops the
 * driver on the map, which for a console that is meant to *be* the shift is a
 * silent demotion. So the buffer records where it sent the launch, and a later
 * arrival back at root restores it — for the meter only (`RESTORABLE_ROUTES`),
 * since that is the one destination that is a mode rather than a page. Leaving
 * the console deliberately clears it (`clearLaunchDestination`), so the restore
 * can never fight the driver's own choice to go and drive as a passenger.
 *
 * The decision itself is pure (`resolveRootRedirect`); the module state is a
 * handful of setters, resettable for tests and cleared on sign-out.
 */

/** What the app remembers about this launch. */
export interface LaunchSession {
  /** True once the launch buffer has been entered for this run of the app. */
  handled: boolean;
  /** The route the buffer resolved to, once it has resolved one. */
  destination: string | null;
}

/**
 * Destinations worth putting the user back on after a navigation-state reset.
 *
 * Only the meter. Every other launch destination is a page the user can walk
 * away from by ordinary navigation, and re-asserting it would mean root became
 * a place they could never stay. The console is different: it is the screen the
 * shift is spent on, it is reached without a tap, and the deliberate ways out
 * of it clear this first.
 */
const RESTORABLE_ROUTES = new Set<string>(["/meter-digital"]);

/** The route the launch buffer lives at. */
export const LAUNCH_BUFFER_ROUTE = "/welcome-back";

let session: LaunchSession = { handled: false, destination: null };

/** The launch state as it stands. Returned by value — callers cannot mutate it. */
export function readLaunchSession(): LaunchSession {
  return { ...session };
}

/**
 * Record that the launch buffer has been entered.
 *
 * Called by whoever sends the app there — `_layout`'s two diverts and the
 * buffer itself, since the sign-in screens `replace` into it directly and
 * would otherwise leave the flag unset and the buffer re-entered on arrival
 * at home.
 */
export function markLaunchHandled(): void {
  session = { ...session, handled: true };
}

/** Record where the buffer sent this launch. */
export function markLaunchDestination(destination: string): void {
  session = { handled: true, destination };
}

/**
 * Forget the recorded destination, without re-opening the buffer.
 *
 * Pressed by a screen the launch put the user on when they leave it on purpose:
 * from that moment on, arriving at root is where they asked to be.
 */
export function clearLaunchDestination(): void {
  session = { ...session, destination: null };
}

/** Forget the launch entirely — sign-out, and tests. */
export function resetLaunchSession(): void {
  session = { handled: false, destination: null };
}

/**
 * What an authenticated arrival at the app's root route should do.
 *
 * Returns a path to `replace` with, or null to leave root alone.
 *
 *   * launch not handled yet → the buffer, which is the cold-start divert;
 *   * handled, and the launch had put the user on a restorable screen → back
 *     onto it: root was reached by a state reset, not by them;
 *   * handled otherwise → null. A later "go home" from the menu is theirs, and
 *     the buffer is never entered twice in one run of the app.
 */
export function resolveRootRedirect(state: LaunchSession): string | null {
  if (!state.handled) return LAUNCH_BUFFER_ROUTE;
  if (state.destination && RESTORABLE_ROUTES.has(state.destination)) {
    return state.destination;
  }
  return null;
}
