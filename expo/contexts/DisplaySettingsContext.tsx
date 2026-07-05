import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import {
  DISPLAY_SETTINGS_ROW_ID,
  DISPLAY_SETTINGS_TABLE,
  fetchRemoteDisplaySettings,
  updateRemoteDisplaySettings,
} from "@/utils/displaySettingsStore";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

/**
 * How often live sessions re-pull the global settings (ms). Kept short so the
 * config converges across ALL devices within a few seconds even when the
 * Supabase realtime publication was never enabled on the database (this
 * project has no automatic migration runner, so realtime may be off). The
 * poll is the authoritative cross-device delivery path; realtime is a bonus.
 */
const LIVE_REFETCH_INTERVAL = 5000;

const STORAGE_KEY = "@display_settings_v2";
const LEGACY_STORAGE_KEY = "@display_settings_v1";

export const SERVICE_BOX_COUNT = 5 as const;
export const RECENT_LOCATIONS_MIN = 0 as const;
export const RECENT_LOCATIONS_MAX = 8 as const;

export const RECENTER_BUTTON_BOTTOM_MIN = 100 as const;
export const RECENTER_BUTTON_BOTTOM_MAX = 700 as const;
export const RECENTER_BUTTON_BOTTOM_STEP = 10 as const;

export const MAP_HEIGHT_OFFSET_MIN = 0 as const;
export const MAP_HEIGHT_OFFSET_MAX = 800 as const;
export const MAP_HEIGHT_OFFSET_STEP = 25 as const;

export const DROP_PIN_OFFSET_MIN = -200 as const;
export const DROP_PIN_OFFSET_MAX = 200 as const;
export const DROP_PIN_OFFSET_STEP = 5 as const;

export const ADDRESS_BAR_TOP_OFFSET_MIN = -300 as const;
export const ADDRESS_BAR_TOP_OFFSET_MAX = 300 as const;
export const ADDRESS_BAR_TOP_OFFSET_STEP = 5 as const;

export const DISCOUNT_BAR_HEIGHT_OFFSET_MIN = -300 as const;
export const DISCOUNT_BAR_HEIGHT_OFFSET_MAX = 300 as const;
export const DISCOUNT_BAR_HEIGHT_OFFSET_STEP = 5 as const;

/** Shared range for ride-confirm element position offsets (vertical & horizontal). */
export const RIDE_CONFIRM_OFFSET_MIN = -300 as const;
export const RIDE_CONFIRM_OFFSET_MAX = 300 as const;
export const RIDE_CONFIRM_OFFSET_STEP = 5 as const;

/** Shared range for ride-tracking (user & partner) recenter button offsets. */
export const RIDE_TRACKING_OFFSET_MIN = -300 as const;
export const RIDE_TRACKING_OFFSET_MAX = 300 as const;
export const RIDE_TRACKING_OFFSET_STEP = 5 as const;

/** Side menu identifiers — used by admin display settings to customize MenuSideSheet & PartnerSideSheet. */
export type SideMenuKey = "user" | "partner";

/**
 * Stable id for the profile header that sits at the very top of both side
 * sheets. It isn't part of the default menu item lists, but admins can still
 * hide it or mark it "Coming Soon" via the same hidden/comingSoon sets.
 */
export const PROFILE_MENU_ITEM_ID = "profile" as const;

/**
 * Stable id for the "Partner mode" button pinned in the footer of the user side
 * sheet. Like the profile header it isn't part of the default menu item lists,
 * but admins can hide it, mark it "Coming Soon", or rename it via the same
 * hidden/comingSoon/renames sets.
 */
export const PARTNER_MODE_MENU_ITEM_ID = "partner-mode-button" as const;

/**
 * Stable id for the "Passenger Mode" button pinned in the footer of the partner
 * side sheet. Same hide/coming-soon/rename behavior as the partner-mode button.
 */
export const PASSENGER_MODE_MENU_ITEM_ID = "passenger-mode-button" as const;

/** Default labels for the footer mode buttons (used as rename fallbacks). */
export const PARTNER_MODE_DEFAULT_LABEL = "Partner mode" as const;
export const PASSENGER_MODE_DEFAULT_LABEL = "Passenger Mode" as const;

export const DEFAULT_USER_MENU_ITEMS: { id: string; label: string }[] = [
  { id: "teksi-ev", label: "Book TEKSI EV" },
  { id: "city", label: "City" },
  { id: "request-history", label: "Request history" },
  { id: "freight", label: "Freight" },
  { id: "notifications", label: "Notifications" },
  { id: "safety", label: "Safety" },
  { id: "settings", label: "Settings" },
  { id: "user-guide", label: "User Guide" },
  { id: "support", label: "Support" },
  { id: "logout", label: "Logout" },
];

export const DEFAULT_PARTNER_MENU_ITEMS: { id: string; label: string }[] = [
  { id: "teksi-ev", label: "Book TEKSI EV" },
  { id: "dashboard", label: "Dashboard" },
  { id: "earnings", label: "Earnings" },
  { id: "trip-history", label: "Trip history" },
  { id: "vehicle", label: "Vehicle" },
  { id: "documents", label: "Documents" },
  { id: "notifications", label: "Notifications" },
  { id: "support", label: "Support" },
  { id: "settings", label: "Settings" },
  { id: "sign-out", label: "Sign out" },
];

export interface CustomMenuItem {
  id: string;
  label: string;
  iconName: string;
  /** Optional in-app route to navigate to when tapped. */
  route?: string;
}

export interface MenuCustomization {
  /** Default item id -> renamed label. */
  renames: Record<string, string>;
  /** Default item id -> route override (in-app path). */
  routes: Record<string, string>;
  /** Extra items appended above the footer. */
  customItems: CustomMenuItem[];
  /** Item ids (default or custom) hidden from the side menu. */
  hidden: string[];
  /** Item ids (default or custom) marked "Coming Soon": tapping shows a popup instead of navigating. */
  comingSoon: string[];
  /** Explicit display order of item ids (default + custom). Missing ids fall back to natural order. */
  order: string[];
}

/**
 * Resolve the display order of a side menu, combining default items and custom
 * items and applying any saved order. Used by the admin manager and both side
 * sheets so what an admin sees matches what users see. Newly added default
 * items (future development) automatically appear because we always start from
 * the full default + custom set.
 */
export function getMenuItemOrder(
  defaults: { id: string; label: string }[],
  cfg: MenuCustomization
): { id: string; isCustom: boolean }[] {
  const all: { id: string; isCustom: boolean }[] = [
    ...defaults.map((d) => ({ id: d.id, isCustom: false })),
    ...cfg.customItems.map((c) => ({ id: c.id, isCustom: true })),
  ];
  const order = cfg.order ?? [];
  const rank = (id: string): number => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return all
    .map((item, naturalIndex) => ({ item, naturalIndex }))
    .sort((a, b) => {
      const ra = rank(a.item.id);
      const rb = rank(b.item.id);
      if (ra !== rb) return ra - rb;
      return a.naturalIndex - b.naturalIndex;
    })
    .map((x) => x.item);
}

/** Acronyms that should stay fully capitalized when humanizing a route path. */
const ROUTE_ACRONYMS = new Set(["api", "ev", "pin", "otp", "ui", "teksi", "id"]);

/** Friendly label overrides for a handful of routes where humanizing isn't ideal. */
const ROUTE_LABEL_OVERRIDES: Record<string, string> = {
  "/": "Home",
  "/teksi-ev": "Book TEKSI EV",
  "/partner-teksi": "Partner TEKSI",
  "/partner-ehailing": "Partner eHailing",
  "/rules-terms": "Rules & Terms",
  "/phone-auth": "Phone Login",
  "/admin-settings-api-elife": "Admin API \u2013 Elife",
};

/** Turn a route path into a Title Case label, keeping known acronyms uppercase. */
function humanizeRoute(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split("-")
    .map((w) => (ROUTE_ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Every navigable page under expo/app/ (system files like _layout / +not-found
 * are excluded). The admin "Link to Page" picker lists all of these so any
 * side-menu item can be wired to any screen in the app.
 */
export const ALL_APP_ROUTES: string[] = [
  "/",
  "/onboarding",
  "/role-selection",
  "/phone-auth",
  "/otp-verify",
  "/pin-setup",
  "/pin-verify",
  "/change-pin",
  "/change-number",
  "/name-entry",
  "/profile",
  "/edit-profile",
  "/profile-photo",
  "/settings",
  "/dark-mode",
  "/language",
  "/distances",
  "/navigation",
  "/user-guide",
  "/rules-terms",
  "/safety",
  "/emergency-contacts",
  "/emergency-contact-edit",
  "/search",
  "/map-picker",
  "/offer-fare",
  "/ride-detail",
  "/ride-confirm",
  "/ride-running",
  "/ride-tracking",
  "/teksi-ev",
  "/support",
  "/support-call",
  "/support-chat",
  "/partner-teksi",
  "/partner-ehailing",
  "/partner-onboarding",
  "/partner-documents",
  "/vehicle-onboarding",
  "/auth-diagnostics",
  "/admin-login",
  "/admin-dashboard",
  "/admin-orders",
  "/admin-session-history",
  "/admin-support",
  "/admin-support-chat",
  "/admin-support-pool",
  "/admin-partners",
  "/admin-partners-all",
  "/admin-partners-approved",
  "/admin-partners-blocked",
  "/admin-partners-rejected",
  "/admin-partners-unapproved",
  "/admin-partners-unapproved-docs",
  "/admin-partners-permit-pending",
  "/admin-partners-permit-verified",
  "/admin-partners-permit-non-verified",
  "/admin-partner-add",
  "/admin-partner-edit",
  "/admin-users",
  "/admin-users-all",
  "/admin-users-approved",
  "/admin-users-blocked",
  "/admin-users-rejected",
  "/admin-users-deleted",
  "/admin-users-unapproved",
  "/admin-users-unapproved-docs",
  "/admin-user-add",
  "/admin-user-edit",
  "/admin-vehicles",
  "/admin-vehicles-all",
  "/admin-vehicles-approved",
  "/admin-vehicles-blocked",
  "/admin-vehicles-rejected",
  "/admin-vehicles-unapproved",
  "/admin-vehicles-unapproved-docs",
  "/admin-vehicles-permit-pending",
  "/admin-vehicles-permit-verified",
  "/admin-vehicles-permit-non-verified",
  "/admin-vehicle-add",
  "/admin-vehicle-edit",
  "/admin-documents",
  "/admin-documents-users",
  "/admin-documents-partners",
  "/admin-documents-vehicles",
  "/admin-settings",
  "/admin-settings-display",
  "/admin-settings-mock",
  "/admin-settings-site",
  "/admin-settings-splash",
  "/admin-settings-app-icon",
  "/admin-settings-app-version",
  "/admin-settings-social-links",
  "/admin-settings-sub-admin",
  "/admin-settings-supabase",
  "/admin-settings-page-list",
  "/admin-settings-service",
  "/admin-settings-assign-service",
  "/admin-settings-assign-service-page",
  "/admin-settings-vehicle-services",
  "/admin-settings-vehicle-make-model",
  "/admin-settings-partner-type",
  "/admin-settings-payment-type",
  "/admin-settings-payment-gateway",
  "/admin-settings-world-currency",
  "/admin-settings-document-type",
  "/admin-settings-required-documents",
  "/admin-settings-country-states-cities",
  "/admin-settings-airport-areas",
  "/admin-settings-multi-gate-places",
  "/admin-settings-multi-gate-place-gates",
  "/admin-settings-geo-fencing",
  "/admin-settings-search-radius",
  "/admin-settings-fixed-price",
  "/admin-settings-free-ride",
  "/admin-settings-rides",
  "/admin-settings-promocode",
  "/admin-settings-referral",
  "/admin-settings-referral-tree",
  "/admin-settings-leaderboard",
  "/admin-settings-driver-incentive",
  "/admin-settings-subscription-plan",
  "/admin-settings-push-notification",
  "/admin-settings-email-templates",
  "/admin-settings-advertisement-banners",
  "/admin-settings-api-keys",
  "/admin-settings-api-keys-keys",
  "/admin-settings-api-keys-services",
  "/admin-settings-api-elife",
  "/admin-settings-insurance-providers",
  "/admin-settings-insurance-types",
  "/admin-settings-insurance-durations",
  "/admin-settings-insurance-premium",
  "/admin-settings-ev-vehicle-details",
  "/admin-settings-ev-vehicle-inventory",
  "/admin-settings-ev-finance-options",
  "/admin-settings-ev-order-fee",
  "/admin-settings-ev-delivery-advisors",
];

/** In-app pages a side menu item can be wired to (every page in expo/app/). */
export const AVAILABLE_MENU_ROUTES: { path: string; label: string }[] = ALL_APP_ROUTES.map(
  (path) => ({ path, label: ROUTE_LABEL_OVERRIDES[path] ?? humanizeRoute(path) })
);

/**
 * Where each built-in side-menu item navigates by default (before any admin
 * override). Used so the admin manager shows the *current* link instead of
 * "Not linked". Items that run an action (logout) or open a "coming soon"
 * placeholder have no default page.
 */
export const DEFAULT_MENU_ROUTES: Record<SideMenuKey, Record<string, string>> = {
  user: {
    "teksi-ev": "/teksi-ev",
    city: "/",
    "request-history": "/",
    freight: "/",
    notifications: "/",
    safety: "/safety",
    settings: "/settings",
    "user-guide": "/user-guide",
    support: "/support",
  },
  partner: {
    "teksi-ev": "/teksi-ev",
    documents: "/partner-documents",
    safety: "/safety",
    support: "/support",
  },
};

export const SIDE_MENU_ICONS: { name: string; label: string }[] = [
  { name: "Bell", label: "Bell" },
  { name: "BookOpen", label: "Book" },
  { name: "Car", label: "Car" },
  { name: "Clock", label: "Clock" },
  { name: "FileText", label: "Document" },
  { name: "Gift", label: "Gift" },
  { name: "HelpCircle", label: "Help" },
  { name: "Heart", label: "Heart" },
  { name: "Mail", label: "Mail" },
  { name: "MapPin", label: "Map" },
  { name: "MessageCircle", label: "Chat" },
  { name: "Phone", label: "Phone" },
  { name: "Settings", label: "Settings" },
  { name: "Shield", label: "Shield" },
  { name: "Star", label: "Star" },
  { name: "Tag", label: "Tag" },
  { name: "User", label: "User" },
  { name: "Wallet", label: "Wallet" },
];

/** Icon identifiers supported on home service boxes. Keep in sync with index.tsx ICON_MAP. */
export const SERVICE_BOX_ICONS: { name: string; label: string }[] = [
  { name: "ShoppingBag", label: "Shopping Bag" },
  { name: "Car", label: "Car" },
  { name: "Building2", label: "Building" },
  { name: "Package", label: "Package" },
  { name: "Truck", label: "Truck" },
  { name: "Bike", label: "Bike" },
  { name: "Bus", label: "Bus" },
  { name: "Plane", label: "Plane" },
  { name: "MapPin", label: "Map Pin" },
  { name: "Navigation", label: "Navigation" },
  { name: "Clock", label: "Clock" },
  { name: "Bell", label: "Bell" },
];

export interface ServiceBoxConfig {
  /** Stable index-based id, "box-0" .. "box-4" */
  id: string;
  /** Optional admin "service-settings" entry id used to derive the title */
  serviceId?: string;
  /** Custom override label. Falls back to linked service name, then default. */
  name?: string;
  /** Lucide icon name from SERVICE_BOX_ICONS */
  iconName?: string;
  /** Custom uploaded image URI (replaces icon when set) */
  imageUri?: string;
}

export interface DisplaySettings {
  rideTypes: boolean;
  searchBar: boolean;
  recentLocations: boolean;
  serviceCategories: boolean;
  recenterButton: boolean;
  addressBar: boolean;
  /** Show "NEW" badge on the large/featured service box */
  serviceBoxBadge: boolean;
  /** Master service switch. When false, any action that would open ride-confirm shows a "Coming Soon" popup instead. */
  serviceEnabled: boolean;
  /** When false, new phone numbers (not in the user list) are blocked at login with a "contact Administrator" popup. */
  registrationEnabled: boolean;
  /** When false, the passenger side stops showing demo/mock driver offers & viewers in ride-confirm. */
  userMockEnabled: boolean;
  /** When false, the partner (driver) side stops generating demo/mock incoming ride requests. */
  partnerMockEnabled: boolean;
  /** When false, the passenger ride-tracking screen stops simulating driver car movement and auto phase progress (arriving → arrived → on trip → completed); it follows the real ride status instead. */
  riderTripSimEnabled: boolean;
  /** When false, the partner ride screen stops simulating car movement and auto-arrival; the driver progresses the trip manually. */
  partnerDriveSimEnabled: boolean;
  /** Show AI-estimated toll booth count row in ride-confirm */
  showAiTollBooths: boolean;
  /** Show AI-estimated toll charges row in ride-confirm */
  showAiTollCharges: boolean;
  /** Number of recent locations shown on the home bottom sheet */
  recentLocationsCount: number;
  /** Per-box config for the 5 service boxes */
  serviceBoxes: ServiceBoxConfig[];
  /** Recenter button distance from the bottom of the screen (px) */
  recenterButtonBottom: number;
  /** Extra map height beyond the visible screen (px). Larger = map extends further upward. */
  mapHeightOffset: number;
  /** Vertical offset for the drop pin (px). Negative moves up, positive moves down. */
  dropPinTopOffset: number;
  /** Horizontal offset for the drop pin (px). Negative moves left, positive moves right. */
  dropPinHorizontalOffset: number;
  /** Vertical offset for the top address bar (px). Negative moves up, positive moves down. */
  addressBarTopOffset: number;
  /** Vertical offset for the discount/promo bar in ride-confirm (px). Negative moves up, positive moves down. */
  discountBarHeightOffset: number;
  /** When true, the discount/promo bar sits in front of the bottom sheet; when false it sits behind it. */
  discountBarInFront: boolean;
  /** Show the discount/promo bar in ride-confirm. */
  discountBar: boolean;
  /** Ride-confirm back button vertical offset (px). Negative moves up, positive moves down. */
  rcBackVertical: number;
  /** Ride-confirm back button horizontal offset (px). Negative moves left, positive moves right. */
  rcBackHorizontal: number;
  /** Ride-confirm recenter button vertical offset (px). Negative moves up, positive moves down. */
  rcRecenterVertical: number;
  /** Ride-confirm recenter button horizontal offset (px). Negative moves left, positive moves right. */
  rcRecenterHorizontal: number;
  /** Ride-confirm disclaimer box vertical offset (px). Negative moves up, positive moves down. */
  rcDisclaimerVertical: number;
  /** Ride-confirm disclaimer box horizontal offset (px). Negative moves left, positive moves right. */
  rcDisclaimerHorizontal: number;
  /** Ride-confirm address box vertical offset (px). Negative moves up, positive moves down. */
  rcAddressVertical: number;
  /** Ride-confirm address box horizontal offset (px). Negative moves left, positive moves right. */
  rcAddressHorizontal: number;
  /** User ride-tracking recenter button vertical offset (px). Negative moves up, positive moves down. */
  rtRecenterVertical: number;
  /** User ride-tracking recenter button horizontal offset (px). Negative moves left, positive moves right. */
  rtRecenterHorizontal: number;
  /** Partner ride screen recenter button vertical offset (px). Negative moves up, positive moves down. */
  prRecenterVertical: number;
  /** Partner ride screen recenter button horizontal offset (px). Negative moves left, positive moves right. */
  prRecenterHorizontal: number;
  /** Vehicle service entry IDs hidden from the home vehicle type bar. */
  hiddenVehicleServiceIds: string[];
  /** Show available vehicle icons/markers on the map. */
  showVehicleMarkers: boolean;
  /** Custom display order of vehicle entry IDs in the home bar (overrides displayPriority). */
  vehicleBarOrder: string[];
  /** User side menu customizations (renames + extra items). */
  userMenu: MenuCustomization;
  /** Partner side menu customizations (renames + extra items). */
  partnerMenu: MenuCustomization;
}

export const DEFAULT_SERVICE_BOXES: ServiceBoxConfig[] = [
  { id: "box-0", iconName: "ShoppingBag" },
  { id: "box-1", iconName: "Car" },
  { id: "box-2", iconName: "Building2" },
  { id: "box-3", iconName: "Package" },
  { id: "box-4", iconName: "Truck" },
];

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  rideTypes: true,
  searchBar: true,
  recentLocations: true,
  serviceCategories: false,
  recenterButton: true,
  addressBar: true,
  serviceBoxBadge: true,
  serviceEnabled: true,
  registrationEnabled: true,
  userMockEnabled: true,
  partnerMockEnabled: true,
  riderTripSimEnabled: true,
  partnerDriveSimEnabled: true,
  showAiTollBooths: true,
  showAiTollCharges: true,
  recentLocationsCount: 4,
  serviceBoxes: DEFAULT_SERVICE_BOXES,
  recenterButtonBottom: 459,
  mapHeightOffset: 365,
  dropPinTopOffset: 0,
  dropPinHorizontalOffset: 0,
  addressBarTopOffset: 0,
  discountBarHeightOffset: 0,
  discountBarInFront: false,
  discountBar: true,
  rcBackVertical: 0,
  rcBackHorizontal: 0,
  rcRecenterVertical: 0,
  rcRecenterHorizontal: 0,
  rcDisclaimerVertical: 0,
  rcDisclaimerHorizontal: 0,
  rcAddressVertical: 0,
  rcAddressHorizontal: 0,
  rtRecenterVertical: 0,
  rtRecenterHorizontal: 0,
  prRecenterVertical: 0,
  prRecenterHorizontal: 0,
  hiddenVehicleServiceIds: [],
  showVehicleMarkers: false,
  vehicleBarOrder: [],
  userMenu: { renames: {}, routes: {}, customItems: [], hidden: [], comingSoon: [], order: [] },
  partnerMenu: { renames: {}, routes: {}, customItems: [], hidden: [], comingSoon: [], order: [] },
};

export const DISPLAY_SETTINGS_META: {
  key: keyof DisplaySettings;
  label: string;
  description: string;
}[] = [
  { key: "rideTypes", label: "Vehicle Types Bar", description: "Top horizontal vehicle type selector" },
  { key: "searchBar", label: "Search Bar", description: "Where to & for how much? input" },
  { key: "recentLocations", label: "Recent Locations", description: "Recently visited places list" },
  { key: "serviceCategories", label: "Service Categories", description: "Popular nearby places (5 boxes)" },
  { key: "recenterButton", label: "Recenter Button", description: "Floating recenter map button" },
  { key: "addressBar", label: "Address Bar", description: "Top centered address pill" },
];

function mergeRemote(parsed: Partial<DisplaySettings> | null | undefined): DisplaySettings {
  if (!parsed) return DEFAULT_DISPLAY_SETTINGS;
  return {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...parsed,
    serviceBoxes: normalizeBoxes(parsed.serviceBoxes),
    hiddenVehicleServiceIds: Array.isArray(parsed.hiddenVehicleServiceIds)
      ? parsed.hiddenVehicleServiceIds.filter((x): x is string => typeof x === "string")
      : [],
    vehicleBarOrder: Array.isArray(parsed.vehicleBarOrder)
      ? parsed.vehicleBarOrder.filter((x): x is string => typeof x === "string")
      : [],
    userMenu: normalizeMenu(parsed.userMenu),
    partnerMenu: normalizeMenu(parsed.partnerMenu),
  };
}

export const [DisplaySettingsProvider, useDisplaySettings] = createContextHook(() => {
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [loaded, setLoaded] = useState<boolean>(false);
  const remoteWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSettings = useRef<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  /** Set briefly after a local write so an echoed realtime/refetch event doesn't clobber in-flight edits. */
  const localWriteUntil = useRef<number>(0);

  /**
   * Apply an incoming remote snapshot to local state + cache, but only if it
   * differs from what we already have and we're not mid local-edit. Keeps live
   * sessions in sync without flicker or fighting the admin who is editing.
   */
  const applyRemote = useCallback((remote: Partial<DisplaySettings> | null) => {
    if (!remote) return;
    if (Date.now() < localWriteUntil.current) return;
    const merged = mergeRemote(remote);
    const serialized = JSON.stringify(merged);
    if (serialized === JSON.stringify(latestSettings.current)) return;
    latestSettings.current = merged;
    setSettings(merged);
    AsyncStorage.setItem(STORAGE_KEY, serialized).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) Hydrate instantly from local cache so the UI doesn't flash defaults.
        let raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
        }
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
          const merged = mergeRemote(parsed);
          if (!cancelled) setSettings(merged);
          latestSettings.current = merged;
        }
      } catch (e) {
        console.log("[DisplaySettings] load error", e);
      }

      // 2) Pull the authoritative copy from Supabase at startup and apply.
      try {
        const remote = await fetchRemoteDisplaySettings();
        if (remote && !cancelled) {
          const merged = mergeRemote(remote);
          setSettings(merged);
          latestSettings.current = merged;
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => {});
        }
      } catch (e) {
        console.log("[DisplaySettings] remote load error", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep live sessions in sync: subscribe to realtime changes on the global
  // settings row, with a periodic refetch + app-foreground refetch as fallback
  // in case the realtime socket is unavailable.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const channel = supabase
      .channel("display-settings-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: DISPLAY_SETTINGS_TABLE,
          filter: `id=eq.${DISPLAY_SETTINGS_ROW_ID}`,
        },
        (payload) => {
          const row = payload.new as { settings?: Partial<DisplaySettings> } | null;
          if (row && row.settings && typeof row.settings === "object") {
            applyRemote(row.settings);
          } else {
            fetchRemoteDisplaySettings().then(applyRemote).catch(() => {});
          }
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      fetchRemoteDisplaySettings().then(applyRemote).catch(() => {});
    }, LIVE_REFETCH_INTERVAL);

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        fetchRemoteDisplaySettings().then(applyRemote).catch(() => {});
      }
    });

    return () => {
      clearInterval(interval);
      appStateSub.remove();
      supabase?.removeChannel(channel);
    };
  }, [applyRemote]);

  const persist = useCallback((next: DisplaySettings) => {
    latestSettings.current = next;
    // Guard window so the realtime echo / refetch of our own write doesn't
    // bounce back and overwrite further edits we make in quick succession.
    localWriteUntil.current = Date.now() + 2000;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((e) =>
      console.log("[DisplaySettings] save error", e)
    );
    // Debounce remote writes so stepper spam doesn't hammer Supabase.
    if (remoteWriteTimer.current) clearTimeout(remoteWriteTimer.current);
    remoteWriteTimer.current = setTimeout(() => {
      updateRemoteDisplaySettings(latestSettings.current).catch((e) =>
        console.log("[DisplaySettings] remote save error", e)
      );
    }, 400);
  }, []);

  const update = useCallback(
    async <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateServiceBox = useCallback(
    (index: number, patch: Partial<ServiceBoxConfig>) => {
      setSettings((prev) => {
        const boxes = [...prev.serviceBoxes];
        boxes[index] = { ...boxes[index], ...patch };
        const next = { ...prev, serviceBoxes: boxes };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setRecentLocationsCount = useCallback(
    (count: number) => {
      const clamped = Math.max(RECENT_LOCATIONS_MIN, Math.min(RECENT_LOCATIONS_MAX, Math.round(count)));
      setSettings((prev) => {
        const next = { ...prev, recentLocationsCount: clamped };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setNumeric = useCallback(
    (key: "recenterButtonBottom" | "mapHeightOffset" | "dropPinTopOffset" | "dropPinHorizontalOffset" | "addressBarTopOffset" | "discountBarHeightOffset" | "rcBackVertical" | "rcBackHorizontal" | "rcRecenterVertical" | "rcRecenterHorizontal" | "rcDisclaimerVertical" | "rcDisclaimerHorizontal" | "rcAddressVertical" | "rcAddressHorizontal" | "rtRecenterVertical" | "rtRecenterHorizontal" | "prRecenterVertical" | "prRecenterHorizontal", value: number, min: number, max: number) => {
      const clamped = Math.max(min, Math.min(max, Math.round(value)));
      setSettings((prev) => {
        const next = { ...prev, [key]: clamped } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setVehicleServiceVisibility = useCallback(
    (id: string, visible: boolean) => {
      setSettings((prev) => {
        const set = new Set(prev.hiddenVehicleServiceIds);
        if (visible) set.delete(id);
        else set.add(id);
        const next = { ...prev, hiddenVehicleServiceIds: Array.from(set) };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setVehicleBarOrder = useCallback(
    (ids: string[]) => {
      setSettings((prev) => {
        const next = { ...prev, vehicleBarOrder: ids };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const moveVehicleInBar = useCallback(
    (id: string, dir: -1 | 1, visibleIds: string[]) => {
      setSettings((prev) => {
        const order = visibleIds.slice();
        const from = order.indexOf(id);
        if (from === -1) return prev;
        const to = from + dir;
        if (to < 0 || to >= order.length) return prev;
        const [m] = order.splice(from, 1);
        order.splice(to, 0, m);
        const next = { ...prev, vehicleBarOrder: order };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const renameMenuItem = useCallback(
    (menu: SideMenuKey, itemId: string, label: string) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const defaults = menu === "user" ? DEFAULT_USER_MENU_ITEMS : DEFAULT_PARTNER_MENU_ITEMS;
        const def = defaults.find((d) => d.id === itemId);
        const trimmed = label.trim();
        const renames = { ...current.renames };
        if (!trimmed || (def && trimmed === def.label)) {
          delete renames[itemId];
        } else {
          renames[itemId] = trimmed;
        }
        // Also support renaming custom items in-place
        const customItems = current.customItems.map((c) =>
          c.id === itemId && trimmed ? { ...c, label: trimmed } : c
        );
        const next = { ...prev, [key]: { ...current, renames, customItems } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const addCustomMenuItem = useCallback(
    (menu: SideMenuKey, label: string, iconName: string, route?: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const item: CustomMenuItem = { id, label: trimmed, iconName };
        if (route && route.trim()) item.route = route.trim();
        const customItems = [...current.customItems, item];
        const next = { ...prev, [key]: { ...current, customItems } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setMenuItemRoute = useCallback(
    (menu: SideMenuKey, itemId: string, route: string | null) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const routes = { ...current.routes };
        const trimmed = (route ?? "").trim();
        const customItems = current.customItems.map((c) => {
          if (c.id !== itemId) return c;
          if (trimmed) return { ...c, route: trimmed };
          const { route: _omit, ...rest } = c;
          void _omit;
          return rest as CustomMenuItem;
        });
        if (trimmed) routes[itemId] = trimmed;
        else delete routes[itemId];
        const next = { ...prev, [key]: { ...current, routes, customItems } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setMenuItemComingSoon = useCallback(
    (menu: SideMenuKey, itemId: string, comingSoon: boolean) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const set = new Set(current.comingSoon ?? []);
        if (comingSoon) set.add(itemId);
        else set.delete(itemId);
        const next = { ...prev, [key]: { ...current, comingSoon: Array.from(set) } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setMenuItemVisibility = useCallback(
    (menu: SideMenuKey, itemId: string, visible: boolean) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const set = new Set(current.hidden ?? []);
        if (visible) set.delete(itemId);
        else set.add(itemId);
        const next = { ...prev, [key]: { ...current, hidden: Array.from(set) } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const moveMenuItem = useCallback(
    (menu: SideMenuKey, itemId: string, dir: -1 | 1, orderedIds: string[]) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const order = orderedIds.slice();
        const from = order.indexOf(itemId);
        if (from === -1) return prev;
        const to = from + dir;
        if (to < 0 || to >= order.length) return prev;
        const [m] = order.splice(from, 1);
        order.splice(to, 0, m);
        const next = { ...prev, [key]: { ...current, order } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const removeCustomMenuItem = useCallback(
    (menu: SideMenuKey, itemId: string) => {
      setSettings((prev) => {
        const key = menu === "user" ? "userMenu" : "partnerMenu";
        const current = prev[key];
        const customItems = current.customItems.filter((c) => c.id !== itemId);
        const hidden = (current.hidden ?? []).filter((id) => id !== itemId);
        const comingSoon = (current.comingSoon ?? []).filter((id) => id !== itemId);
        const order = (current.order ?? []).filter((id) => id !== itemId);
        const next = { ...prev, [key]: { ...current, customItems, hidden, comingSoon, order } } as DisplaySettings;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /**
   * Force-pull the authoritative settings from Supabase and apply them. Used
   * when a side menu opens so admin changes (e.g. "Coming Soon" toggles) take
   * effect immediately on the user side instead of waiting for the next poll.
   */
  const refresh = useCallback(async () => {
    try {
      const remote = await fetchRemoteDisplaySettings();
      applyRemote(remote);
    } catch (e) {
      console.log("[DisplaySettings] manual refresh error", e);
    }
  }, [applyRemote]);

  const reset = useCallback(async () => {
    setSettings(DEFAULT_DISPLAY_SETTINGS);
    latestSettings.current = DEFAULT_DISPLAY_SETTINGS;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      console.log("[DisplaySettings] reset error", e);
    }
    try {
      await updateRemoteDisplaySettings(DEFAULT_DISPLAY_SETTINGS);
    } catch (e) {
      console.log("[DisplaySettings] remote reset error", e);
    }
  }, []);

  return {
    settings,
    update,
    updateServiceBox,
    setRecentLocationsCount,
    setNumeric,
    setVehicleServiceVisibility,
    setVehicleBarOrder,
    moveVehicleInBar,
    renameMenuItem,
    addCustomMenuItem,
    setMenuItemRoute,
    setMenuItemVisibility,
    setMenuItemComingSoon,
    moveMenuItem,
    removeCustomMenuItem,
    refresh,
    reset,
    loaded,
  };
});

function normalizeMenu(m: MenuCustomization | undefined): MenuCustomization {
  if (!m || typeof m !== "object") return { renames: {}, routes: {}, customItems: [], hidden: [], comingSoon: [], order: [] };
  const renames: Record<string, string> = {};
  if (m.renames && typeof m.renames === "object") {
    for (const [k, v] of Object.entries(m.renames)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) renames[k] = v;
    }
  }
  const routes: Record<string, string> = {};
  if (m.routes && typeof m.routes === "object") {
    for (const [k, v] of Object.entries(m.routes)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) routes[k] = v;
    }
  }
  const customItems: CustomMenuItem[] = Array.isArray(m.customItems)
    ? m.customItems
        .filter(
          (c): c is CustomMenuItem =>
            !!c && typeof c === "object" && typeof c.id === "string" && typeof c.label === "string"
        )
        .map((c) => {
          const base: CustomMenuItem = {
            id: c.id,
            label: c.label,
            iconName: typeof c.iconName === "string" ? c.iconName : "Star",
          };
          if (typeof c.route === "string" && c.route.trim()) base.route = c.route.trim();
          return base;
        })
    : [];
  const hidden: string[] = Array.isArray(m.hidden)
    ? m.hidden.filter((x): x is string => typeof x === "string")
    : [];
  const comingSoon: string[] = Array.isArray(m.comingSoon)
    ? m.comingSoon.filter((x): x is string => typeof x === "string")
    : [];
  const order: string[] = Array.isArray(m.order)
    ? m.order.filter((x): x is string => typeof x === "string")
    : [];
  return { renames, routes, customItems, hidden, comingSoon, order };
}

function normalizeBoxes(boxes: ServiceBoxConfig[] | undefined): ServiceBoxConfig[] {
  const base = [...DEFAULT_SERVICE_BOXES];
  if (!boxes || !Array.isArray(boxes)) return base;
  return base.map((b, i) => ({ ...b, ...(boxes[i] ?? {}) }));
}
