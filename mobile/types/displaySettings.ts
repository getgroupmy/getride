/**
 * Admin-controlled display preferences.
 *
 * Extracted from the legacy `contexts/DisplaySettingsContext.tsx` so the
 * pure store layer (`utils/displaySettingsStore.ts`) can name the shape it
 * reads and writes without importing a React context.
 */

export type SideMenuKey = "user" | "partner";

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
  /**
   * In-app path the tile opens, e.g. "/wallet". Without one the tile raises the
   * coming-soon notice rather than doing nothing — see utils/serviceBoxAction.
   */
  route?: string;
  /** Mark the tile as not launched yet: always raises the coming-soon notice. */
  comingSoon?: boolean;
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
  /** Show the "Connected" popup on launch when Supabase is reachable. */
  connectedPopupEnabled: boolean;
  /** Show the "Not Connected to server" popup on launch when Supabase is unreachable. */
  connectionFailedPopupEnabled: boolean;
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
