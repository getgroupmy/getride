/**
 * Leaving the meter — what the console's two exit keys do.
 *
 * A back press on the meter panel is not a step back but a *mode change*
 * (`resolveMeterBack`), so the console asks which mode: passenger, e-hailing, or
 * stay. Which is right depends entirely on the operator, and two fleets want
 * different things out of the same two keys:
 *
 *   * **Passenger mode** is meaningless to a fleet whose drivers never ride as
 *     passengers on the shift phone. Those operators want the key to *close the
 *     app* instead — without signing the driver out, so the next shift opens
 *     straight back onto the meter rather than through the PIN.
 *   * **E-hailing** is in-app for a GET.ride fleet, but a taxi company that
 *     dispatches through somebody else's driver app wants the key to open *that*
 *     app instead of a screen this one doesn't use.
 *
 * So both keys are configured on the rate card (Admin → Settings → Meter Digital
 * Setting → Leave the meter) and resolved here. Everything in this file is pure
 * and tested (`utils/__tests__/meterLeave.test.ts`); the screen owns only the
 * pressing.
 *
 * The promise it keeps is the rest of the meter's: a configured value is used
 * only when it is usable. A key configured to open an app but carrying no link
 * the device could ever open falls back to the in-app screen rather than being
 * drawn as a button that does nothing.
 */

import {
  meterLeaveAppById,
  meterLeaveAppLink,
  meterLeaveAppStore,
  type StorePlatform,
} from "@/utils/meterLeaveApps";

/** What the passenger key does. */
export type MeterLeavePassengerAction = "passenger" | "exit";

/** What the e-hailing key does. */
export type MeterLeaveEhailingAction = "app" | "link";

/** The leave-the-meter half of a rate card. */
export interface MeterLeaveConfig {
  passenger: MeterLeavePassengerAction;
  ehailing: MeterLeaveEhailingAction;
  /** The app link the e-hailing key opens under `link`, e.g. `partnerapp://`. */
  ehailingUrl: string | null;
  /** What that key is called on the console. Defaults to E-HAILING. */
  ehailingLabel: string | null;
  /**
   * A catalogue app the operator picked (`utils/meterLeaveApps.ts`), or null
   * for a hand-entered link.
   *
   * Stored beside the link rather than instead of it, because the two answer
   * different questions: the id is what lets each platform be given its own
   * way in (an Android package launches by intent, an iPhone needs the app's
   * scheme), while the link stays the operator's own override and the only
   * thing a card needs when the app is not in the catalogue at all.
   */
  ehailingAppId: string | null;
  /**
   * Where to send a driver whose phone does not have the app — one store page
   * per platform, since none of them can be derived from another.
   */
  ehailingStores: { ios: string | null; android: string | null; huawei: string | null };
}

/** Both keys in-app: the console as it behaved before the card could say. */
export const DEFAULT_METER_LEAVE: MeterLeaveConfig = {
  passenger: "passenger",
  ehailing: "app",
  ehailingUrl: null,
  ehailingLabel: null,
  ehailingAppId: null,
  ehailingStores: { ios: null, android: null, huawei: null },
};

/** How a key is pressed: go somewhere in-app, close the app, or open another. */
export type MeterLeaveAction = "route" | "exit" | "link";

/** One key of the leave popup, resolved for the device it is drawn on. */
export interface MeterLeaveOption {
  /** Which key this is — the popup draws them in this order. */
  key: "passenger" | "ehailing";
  action: MeterLeaveAction;
  /** Where a `route` press goes. Null for the other two. */
  route: "/" | "/partner-ehailing" | null;
  /** What a `link` press opens. Null for the other two. */
  url: string | null;
  /**
   * Where to send a driver whose phone does not have that app.
   *
   * Set on a `link` key when the card carries a store page for this platform —
   * used when the open fails, and used *instead* of the open where the
   * catalogue has no way in on this platform (an Android package tells us
   * nothing about the iPhone build).
   */
  store: string | null;
  /** The key's caption, already in the console's upper case. */
  label: string;
  /** One line under it, so a driver knows what the key will do before it does it. */
  hint: string;
}

export interface MeterLeaveOptions {
  passenger: MeterLeaveOption;
  ehailing: MeterLeaveOption;
}

/**
 * Schemes a rate card may never send a driver to.
 *
 * `Linking.openURL` is a browser on the web build, where these are script
 * execution and local-file reads rather than "open an app" — an admin-entered
 * string is not a reason to run either.
 */
const BLOCKED_SCHEMES = ["javascript", "data", "file", "blob", "vbscript", "about"];

/** Longest link accepted. Deep links are short; anything longer is a mistake. */
const MAX_URL_LENGTH = 512;

/** Longest key caption. The console shrinks text to fit, but not forever. */
const MAX_LABEL_LENGTH = 22;

/**
 * The link as the console would open it, or null when it could not.
 *
 * A link has to *name the app it opens* — a scheme — because that is the whole
 * mechanism: `grabdriver://`, `myfleet://jobs`, `https://…` for an app that
 * claims a universal link. A bare "grabdriver" or "open the driver app" is a
 * note to a human, not something a device can act on, so it is refused here
 * rather than drawn as a key that fails on every press.
 */
export function normalizeMeterLeaveUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  // Whitespace inside a link is always a typo — a real one percent-encodes it.
  if (/\s/.test(url)) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (BLOCKED_SCHEMES.includes(scheme)) return null;
  return url;
}

/** A key caption as the console prints it, or null when none was entered. */
export function normalizeMeterLeaveLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim().replace(/\s+/g, " ");
  if (label.length === 0) return null;
  return label.slice(0, MAX_LABEL_LENGTH);
}

/** Narrow a stored value down to a passenger action, defaulting to in-app. */
export function normalizeMeterLeavePassenger(raw: unknown): MeterLeavePassengerAction {
  return typeof raw === "string" && raw.trim().toLowerCase() === "exit"
    ? "exit"
    : "passenger";
}

/** Narrow a stored value down to an e-hailing action, defaulting to in-app. */
export function normalizeMeterLeaveEhailing(raw: unknown): MeterLeaveEhailingAction {
  return typeof raw === "string" && raw.trim().toLowerCase() === "link" ? "link" : "app";
}

/**
 * Narrow anything that claims to be a leave configuration down to one.
 *
 * Takes the whole thing missing, because it can be: a rate card cached on the
 * device by a build older than this feature has no leave half at all, and the
 * meter reads that cache when it has no signal. A console that crashed on the
 * back key rather than offering last year's two options would be a poor trade.
 */
export function normalizeMeterLeave(raw: unknown): MeterLeaveConfig {
  const c = (raw ?? {}) as Partial<MeterLeaveConfig>;
  const stores = (c.ehailingStores ?? {}) as Partial<MeterLeaveConfig["ehailingStores"]>;
  return {
    passenger: normalizeMeterLeavePassenger(c.passenger),
    ehailing: normalizeMeterLeaveEhailing(c.ehailing),
    ehailingUrl: normalizeMeterLeaveUrl(c.ehailingUrl),
    ehailingLabel: normalizeMeterLeaveLabel(c.ehailingLabel),
    // An id that names nothing in the catalogue is dropped rather than kept:
    // it would show as a picked app the editor could not name.
    ehailingAppId: meterLeaveAppById(c.ehailingAppId)?.id ?? null,
    ehailingStores: {
      ios: normalizeMeterLeaveUrl(stores.ios),
      android: normalizeMeterLeaveUrl(stores.android),
      huawei: normalizeMeterLeaveUrl(stores.huawei),
    },
  };
}

/**
 * The two keys of the leave popup for this card.
 *
 * The one rule worth stating: an e-hailing key set to open another app but
 * carrying no usable link falls back to the in-app screen. A card can be saved
 * only with a link that parses (`validateMeterLeave`), but a row written by hand
 * or by an older build can still say `link` and mean nothing — and a dead key on
 * a console is worse than the screen the driver didn't want.
 */
export function resolveMeterLeave(
  raw: MeterLeaveConfig | null | undefined,
  /**
   * The device the keys are being drawn for. A card names one app but each
   * platform reaches it differently — an Android package launches by intent, an
   * iPhone needs that app's own scheme — so the same card resolves to different
   * links on different phones. Omitted (the admin previewing a card, a test)
   * only the operator's own typed link is considered.
   */
  platform?: StorePlatform,
): MeterLeaveOptions {
  const config = normalizeMeterLeave(raw);
  const passenger: MeterLeaveOption =
    config.passenger === "exit"
      ? {
          key: "passenger",
          action: "exit",
          route: null,
          url: null,
          store: null,
          label: "EXIT",
          hint: "Close the app — you stay signed in",
        }
      : {
          key: "passenger",
          action: "route",
          route: "/",
          url: null,
          store: null,
          label: "PASSENGER MODE",
          hint: "Book a ride as a passenger",
        };

  const app = meterLeaveAppById(config.ehailingAppId);
  const named = normalizeMeterLeaveLabel(config.ehailingLabel) ?? app?.name ?? null;

  let url: string | null = null;
  let store: string | null = null;
  if (config.ehailing === "link") {
    // The catalogue's own way in wins where it has one for this platform, since
    // it is the entry the operator actually picked; the typed link is the
    // override and the only answer for an app the catalogue does not carry.
    url =
      (platform ? meterLeaveAppLink(app, platform) : null) ??
      normalizeMeterLeaveUrl(config.ehailingUrl);
    store = platform
      ? (config.ehailingStores[platform] ?? meterLeaveAppStore(app, platform))
      : null;
  }

  // A key with neither a way into the app nor a way to install it is a dead
  // key, and the in-app screen the operator didn't pick still beats that.
  const ehailing: MeterLeaveOption =
    url || store
      ? {
          key: "ehailing",
          action: "link",
          route: null,
          url,
          store,
          label: (named ?? "E-HAILING APP").toUpperCase(),
          hint: url
            ? "Open the dispatch app — the meter stays open behind it"
            : `Install ${named ?? "the dispatch app"} to take jobs`,
        }
      : {
          key: "ehailing",
          action: "route",
          route: "/partner-ehailing",
          url: null,
          store: null,
          label: (named ?? "E-HAILING").toUpperCase(),
          hint: "Take e-hailing jobs in this app",
        };

  return { passenger, ehailing };
}

/**
 * Whether the driver can be put back on the home screen from here, and what to
 * tell them when they cannot.
 *
 * Android always can (`BackHandler.exitApp`). iOS has no public API for it, so
 * it depends on whether the native exit module was compiled into *this* binary
 * — `canLeaveApp()` in `utils/appExit.ts` answers that, and it is passed in
 * rather than guessed at here so this stays pure and testable. A browser tab
 * cannot close one it did not open, ever.
 *
 * Where it cannot happen the console says so plainly instead of drawing a key
 * that silently does nothing: the driver leaves the app the way the platform
 * expects, and the point of the setting — not being signed out — holds either
 * way.
 */
export function describeMeterExit(
  os: string,
  /** Does this build have a way to close itself? See `canLeaveApp()`. */
  canExit: boolean = os === "android",
): { supported: boolean; note: string } {
  if (canExit && os !== "web") {
    return {
      supported: true,
      note: "The app closes and you are back on the home screen. You stay signed in — reopening comes straight back here.",
    };
  }
  if (os === "web") {
    return {
      supported: false,
      note: "A browser tab cannot close itself. Close this tab to leave — you stay signed in, so reopening comes straight back here.",
    };
  }
  if (os === "ios") {
    // The capability is compiled in, so an iOS build that says no is one made
    // before it shipped — the same shape of answer the CANBus transports give
    // for a missing driver: an update, not a setting.
    return {
      supported: false,
      note: "This build cannot close itself — it was made before that was possible, and a newer build will do it. For now, swipe up from the bottom of the screen to leave: you stay signed in, so reopening comes straight back here.",
    };
  }
  return {
    supported: false,
    note: "This platform does not let an app close itself. Leave the app the usual way — you stay signed in, so reopening comes straight back here.",
  };
}

/** What the console could not do, when a link refuses to open. */
export function describeMeterLinkFailure(url: string): string {
  return `The meter could not open ${url}. Check that app is installed on this device, or ask an administrator to check the link on the rate card.`;
}

/**
 * Whether this leave configuration can be saved, and what is wrong when it
 * cannot.
 *
 * Only the thing the database cannot express: a key set to open another app has
 * to carry a link that could open one.
 */
export function validateMeterLeave(config: MeterLeaveConfig | null | undefined): string | null {
  if (normalizeMeterLeaveEhailing(config?.ehailing) !== "link") return null;
  // Either way of naming the app will do: one picked from the list, or a link
  // typed in. A card carrying neither would draw a key that does nothing.
  if (meterLeaveAppById(config?.ehailingAppId)) return null;
  if (!normalizeMeterLeaveUrl(config?.ehailingUrl)) {
    return "Choose the dispatch app from the list, or enter its app link — it has to start with a scheme, e.g. driverapp:// or https://.";
  }
  return null;
}

/**
 * What is worth saying about this card's leave keys, for the admin card list.
 *
 * Only the answers that differ from the console's own: a card whose popup
 * offers passenger mode and the in-app e-hailing screen is every card, and
 * printing that on all of them would bury the one that closes the app.
 */
export function describeMeterLeave(config: MeterLeaveConfig | null | undefined): string[] {
  const normalized = normalizeMeterLeave(config);
  const app = meterLeaveAppById(normalized.ehailingAppId);
  const lines: string[] = [];
  if (normalized.passenger === "exit") lines.push("Leave key closes the app");
  if (normalized.ehailing === "link") {
    // Named by app where the operator picked one — an admin scanning a list of
    // cards wants "Grab Driver", not an intent URL.
    const target = app?.name ?? normalized.ehailingUrl;
    if (target) lines.push(`E-hailing opens ${target}`);
  }
  return lines;
}
