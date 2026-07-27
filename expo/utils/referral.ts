import * as ExpoLinking from "expo-linking";

/**
 * Deterministic, human-friendly referral code derived from the user's id.
 * Strips non-alphanumerics and uppercases so the same user always shares
 * the same code (e.g. "K3F9A2QX").
 */
export function referralCodeForUser(userId: string): string {
  const cleaned = userId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, 8) || "GETRIDE";
}

/**
 * Deep link that opens the app (or web build) with the referral code
 * attached as a `ref` query param, e.g. rork-app:///?ref=K3F9A2QX.
 */
export function buildReferralLink(code: string): string {
  return ExpoLinking.createURL("/", { queryParams: { ref: code } });
}

/**
 * Share-sheet message inviting a friend, including the bonus-coin hook and
 * the deep link.
 */
export function buildReferralMessage(code: string, link: string): string {
  return (
    `Join me on GET.ride! 🚕\n\n` +
    `Sign up with my referral code ${code} and we both earn bonus GET.coin ` +
    `to spend on rides.\n\n${link}`
  );
}
