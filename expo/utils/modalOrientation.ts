/**
 * The orientations a React Native `Modal` must declare on iOS.
 *
 * `Modal.supportedOrientations` defaults to `["portrait"]`, and it is not a
 * hint: iOS asks the modal's view controller which orientations it supports
 * and raises `UIApplicationInvalidInterfaceOrientationException` when the
 * interface orientation it is being presented into is not one of them. So a
 * modal raised while the device is held (or pinned) sideways does not render
 * sideways — it *crashes the app*, which is what a driver pressing back on the
 * landscape-locked Meter Digital console used to see instead of the "leave the
 * meter" popup.
 *
 * The app itself declares `orientation: "default"` (`app.json`), so any screen
 * can be landscape — on a tablet simply by being held that way, and on Meter
 * Digital because `useLandscapeLock` pins it there. A modal that can appear on
 * such a screen therefore has to accept every orientation the app does; there
 * is no case in this app where refusing one is worth an exception.
 *
 * Android and web ignore the prop.
 */

/** Every orientation an iOS modal can declare. */
export type ModalOrientation =
  | "portrait"
  | "portrait-upside-down"
  | "landscape"
  | "landscape-left"
  | "landscape-right";

/**
 * Pass to every `<Modal>` that can be raised on a screen the device may be
 * holding sideways — which, with `orientation: "default"`, is all of them.
 *
 * Typed mutable rather than `readonly` only because that is the shape React
 * Native's `ModalProps` asks for; treat it as a constant.
 */
export const MODAL_SUPPORTED_ORIENTATIONS: ModalOrientation[] = [
  "portrait",
  "portrait-upside-down",
  "landscape",
  "landscape-left",
  "landscape-right",
];

/**
 * Whether a modal declaring these orientations can be presented into a
 * landscape interface without iOS throwing.
 *
 * `"landscape"` covers both directions; the two one-sided values each cover
 * their own. Pure so the rule can be asserted in tests rather than discovered
 * on a device.
 */
export function supportsLandscape(
  orientations: readonly ModalOrientation[] | undefined,
): boolean {
  if (!orientations) return false;
  return orientations.some(
    (o) => o === "landscape" || o === "landscape-left" || o === "landscape-right",
  );
}

export default MODAL_SUPPORTED_ORIENTATIONS;
