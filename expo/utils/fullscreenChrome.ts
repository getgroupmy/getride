/**
 * "Take the whole glass, sideways" — the chrome a dash instrument asks for.
 *
 * Meter Digital is read at a glance from a windscreen mount, so it wants two
 * things from the OS that an ordinary screen does not: the device pinned to
 * landscape, and every system bar out of the way. `useLandscapeLock` /
 * `expo-screen-orientation` is one way to ask for the first, but it is the
 * weaker one — it is imperative, it runs a frame or two after the screen is
 * already on the glass, and its native side only exists in a binary prebuilt
 * since the dependency landed. The stronger way is to declare it on the route
 * itself: the app's navigator is a **native stack**, so `react-native-screens`
 * carries these options into the platform's own view controller / activity
 * before the screen appears, on every build that has ever shipped this app
 * (`react-native-screens` has been a dependency since the beginning).
 *
 * That is what this module holds. The two mechanisms are deliberately kept
 * together rather than one replacing the other:
 *
 *  - the route options below are the **pin** — they rotate the device and hide
 *    the bars, on iPhone, iPad and Android alike, and they are undone for free
 *    the moment another screen is on top, because they belong to the route;
 *  - `useLandscapeLock` stays the **fallback** for anywhere the native stack
 *    does not reach (a web build has no view controller to ask), and its state
 *    is what still decides whether the rotate notice is shown.
 *
 * Per platform, what each option buys:
 *
 *  - `orientation: "landscape"` — both landscape directions, so a cradle works
 *    whichever way round it holds the device, portrait refused. On **iPad** this
 *    is only honoured because the app also ships `ios.requireFullScreen`
 *    (`app.json` → `UIRequiresFullScreen`): a multitasking-capable iPad app is
 *    resizable, and a resizable app's orientation preferences are ignored — it
 *    would sit in portrait no matter how loudly either mechanism asked. That
 *    key is the "force full screen" half of this on tablets, and it is why the
 *    meter fills an iPad instead of running in a Split View slice.
 *  - `statusBarHidden` / `navigationBarHidden` / `autoHideHomeIndicator` — the
 *    clock, the signal bars, the Android nav bar and the home indicator are all
 *    chrome the meter redraws itself (its own status cluster) or does not want
 *    at all. Hiding them per route means they come back on their own when the
 *    driver leaves; nothing has to remember to restore them. Android's nav bar
 *    is hidden transiently, so an edge swipe still brings it back for as long
 *    as it is needed.
 *
 * A `<Modal>` raised over the console needs the same treatment for a different
 * reason: a modal is its own window, and on Android it re-inserts the system
 * bars underneath itself unless it is told to draw under them — so the console
 * behind it would visibly jump as the bars came back. `FULLSCREEN_MODAL_PROPS`
 * carries that, plus the landscape declaration from `utils/modalOrientation.ts`
 * that iOS raises an exception without.
 *
 * Everything here is a plain object so the shape can be asserted in a test
 * rather than discovered on a device — dropping one of these fields degrades
 * silently into "the meter looks slightly wrong on one platform", which is
 * exactly the kind of regression nobody notices until a driver is squinting at
 * a windscreen.
 */

import { MODAL_SUPPORTED_ORIENTATIONS, type ModalOrientation } from "@/utils/modalOrientation";

/**
 * The native-stack route options that make a screen a full-screen landscape
 * instrument. Structurally typed rather than importing React Navigation's
 * option type, so this stays a plain data module; the call site is where it is
 * checked against `Stack.Screen`.
 */
export interface LandscapeFullscreenOptions {
  /** Both landscape directions; portrait refused. */
  orientation: "landscape";
  /** iOS + Android: no status bar over the console. */
  statusBarHidden: true;
  /** Android: no navigation bar (transient — an edge swipe still reveals it). */
  navigationBarHidden: true;
  /** iOS: let the home indicator fade out over the instrument. */
  autoHideHomeIndicator: true;
}

/** @see LandscapeFullscreenOptions */
export const LANDSCAPE_FULLSCREEN_OPTIONS: LandscapeFullscreenOptions = {
  orientation: "landscape",
  statusBarHidden: true,
  navigationBarHidden: true,
  autoHideHomeIndicator: true,
};

/**
 * Merge the full-screen landscape options onto a route's own options.
 *
 * The chrome always wins: a route may pick its animation and whether the back
 * gesture is live, but it does not get to be half full-screen. Written as a
 * function so `_layout.tsx` reads as "this screen, plus the instrument
 * chrome" instead of a spread whose precedence has to be re-read.
 */
export function landscapeFullscreen<const T extends object>(
  base?: T,
): T & LandscapeFullscreenOptions {
  // `const T` so a caller's `animation: "slide_from_right"` stays that literal
  // rather than widening to `string`, which the navigator's option type — a
  // union of animation names — would then refuse.
  return { ...(base ?? ({} as T)), ...LANDSCAPE_FULLSCREEN_OPTIONS };
}

/** The chrome props a `<Modal>` raised over a full-screen instrument needs. */
export interface FullscreenModalProps {
  /**
   * iOS refuses to present a modal into an interface orientation it has not
   * declared — it throws rather than rotating. See `utils/modalOrientation.ts`.
   */
  supportedOrientations: ModalOrientation[];
  /** Android: draw under the status bar instead of pushing it back on screen. */
  statusBarTranslucent: true;
  /** Android: same for the navigation bar (needs `statusBarTranslucent` too). */
  navigationBarTranslucent: true;
}

/** @see FullscreenModalProps */
export const FULLSCREEN_MODAL_PROPS: FullscreenModalProps = {
  supportedOrientations: MODAL_SUPPORTED_ORIENTATIONS,
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
};

export default LANDSCAPE_FULLSCREEN_OPTIONS;
