import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Abstract mapping service categories that a page can rely on.
 * These are independent from any specific provider's service id;
 * the user assigns a provider+service to each capability per page.
 */
export type MappingCapability =
  | "maps"
  | "geocoding"
  | "places"
  | "autocomplete"
  | "directions"
  | "distance_matrix"
  | "boundaries"
  | "tiles"
  | "ip_geolocation";

export interface MappingPageDef {
  id: string;
  label: string;
  description: string;
  route: string;
  capabilities: MappingCapability[];
}

export const MAPPING_PAGES: MappingPageDef[] = [
  {
    id: "map-picker",
    label: "Map Picker",
    description: "Pick locations on map",
    route: "/map-picker",
    capabilities: ["maps", "geocoding", "places", "autocomplete"],
  },
  {
    id: "navigation",
    label: "Navigation",
    description: "Turn-by-turn routing",
    route: "/navigation",
    capabilities: ["maps", "directions", "distance_matrix"],
  },
  {
    id: "distances",
    label: "Distances",
    description: "Distance & ETA calculations",
    route: "/distances",
    capabilities: ["distance_matrix", "directions"],
  },
  {
    id: "rider-home",
    label: "Rider Home",
    description: "Main rider map screen",
    route: "/",
    capabilities: ["maps", "places", "autocomplete", "geocoding", "directions"],
  },
  {
    id: "partner-ehailing",
    label: "Driver E-Hailing",
    description: "E-hailing driver map",
    route: "/partner-ehailing",
    capabilities: ["maps", "directions", "geocoding"],
  },
  {
    id: "partner-teksi",
    label: "Driver Teksi",
    description: "Street-hail driver map",
    route: "/partner-teksi",
    capabilities: ["maps", "directions", "geocoding"],
  },
  {
    id: "offer-fare",
    label: "Offer Fare",
    description: "Fare offer & route preview",
    route: "/offer-fare",
    capabilities: ["directions", "distance_matrix"],
  },
  {
    id: "country-states-cities",
    label: "Country / States / Cities",
    description: "Region hierarchy & boundaries",
    route: "/admin-settings-country-states-cities",
    capabilities: ["geocoding", "boundaries", "places"],
  },
  {
    id: "geo-fencing",
    label: "Geo Fencing",
    description: "Operating zone polygons",
    route: "/admin-settings-geo-fencing",
    capabilities: ["maps", "boundaries"],
  },
  {
    id: "multi-gate-places",
    label: "Multi-Gate Places",
    description: "Multi-gate venues",
    route: "/admin-settings-multi-gate-places",
    capabilities: ["maps", "places"],
  },
  {
    id: "airport-areas",
    label: "Airport Areas",
    description: "Airport pickup zones",
    route: "/admin-settings-airport-areas",
    capabilities: ["maps", "places", "boundaries"],
  },
  {
    id: "multi-gate-place-gates",
    label: "Multi-Gate Place Gates",
    description: "Gates within a multi-gate place",
    route: "/admin-settings-multi-gate-place-gates",
    capabilities: ["maps", "places", "geocoding"],
  },
  {
    id: "search",
    label: "Search",
    description: "Rider destination search",
    route: "/search",
    capabilities: ["places", "autocomplete", "geocoding"],
  },
  {
    id: "ride-confirm",
    label: "Ride Confirm",
    description: "Ride confirmation & route preview",
    route: "/ride-confirm",
    capabilities: ["maps", "directions", "distance_matrix"],
  },
  {
    id: "ride-running",
    label: "Ride Running",
    description: "Live ride tracking",
    route: "/ride-running",
    capabilities: ["maps", "directions", "geocoding"],
  },
  {
    id: "ride-detail",
    label: "Ride Detail",
    description: "Ride detail static map preview",
    route: "/ride-detail",
    capabilities: ["maps", "tiles"],
  },
];

export const CAPABILITY_LABELS: Record<MappingCapability, string> = {
  maps: "Maps SDK / Tiles",
  geocoding: "Geocoding",
  places: "Places",
  autocomplete: "Autocomplete",
  directions: "Directions / Routing",
  distance_matrix: "Distance Matrix",
  boundaries: "Boundaries / Polygons",
  tiles: "Tiles",
  ip_geolocation: "IP Geolocation",
};

export interface ServiceAssignment {
  providerId: string;
  serviceId: string;
}

/** pageId -> capability -> assignment */
export type ServiceAssignmentsMap = Record<string, Partial<Record<MappingCapability, ServiceAssignment>>>;

export const SERVICE_ASSIGNMENTS_KEY = "admin-settings:service-assignments-v1";

/**
 * Map of legacy pageId -> current pageId. Used to migrate existing stored
 * assignments after we renamed driver-* page ids to partner-*.
 */
const LEGACY_PAGE_ID_MAP: Record<string, string> = {
  "driver-ehailing": "partner-ehailing",
  "driver-teksi": "partner-teksi",
};

function migrateLegacyPageIds(map: ServiceAssignmentsMap): {
  next: ServiceAssignmentsMap;
  changed: boolean;
} {
  let changed = false;
  const next: ServiceAssignmentsMap = { ...map };
  for (const [oldId, newId] of Object.entries(LEGACY_PAGE_ID_MAP)) {
    if (next[oldId] && !next[newId]) {
      next[newId] = next[oldId];
      delete next[oldId];
      changed = true;
    } else if (next[oldId] && next[newId]) {
      delete next[oldId];
      changed = true;
    }
  }
  return { next, changed };
}

export async function loadAssignments(): Promise<ServiceAssignmentsMap> {
  try {
    const raw = await AsyncStorage.getItem(SERVICE_ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ServiceAssignmentsMap;
    if (!parsed || typeof parsed !== "object") return {};
    const { next, changed } = migrateLegacyPageIds(parsed);
    if (changed) {
      try {
        await AsyncStorage.setItem(SERVICE_ASSIGNMENTS_KEY, JSON.stringify(next));
      } catch (e) {
        console.log("[serviceAssignmentsStore] migrate persist error", e);
      }
    }
    return next;
  } catch (e) {
    console.log("[serviceAssignmentsStore] load error", e);
    return {};
  }
}

export async function saveAssignments(map: ServiceAssignmentsMap): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVICE_ASSIGNMENTS_KEY, JSON.stringify(map));
  } catch (e) {
    console.log("[serviceAssignmentsStore] save error", e);
  }
}

export async function setAssignment(
  pageId: string,
  capability: MappingCapability,
  assignment: ServiceAssignment | null
): Promise<ServiceAssignmentsMap> {
  const map = await loadAssignments();
  const pageMap = { ...(map[pageId] ?? {}) };
  if (assignment === null) {
    delete pageMap[capability];
  } else {
    pageMap[capability] = assignment;
  }
  const next: ServiceAssignmentsMap = { ...map, [pageId]: pageMap };
  await saveAssignments(next);
  return next;
}

/**
 * Standalone (non-capability) document-source assignments used by the
 * Assign Service screen. Maps a feature id (e.g. "driver-permit") to the
 * id of a required-document entry whose uploaded image should be used as
 * the data/image source for that feature.
 */
export const DOCUMENT_SOURCE_ASSIGNMENTS_KEY =
  "admin-settings:document-source-assignments-v1";

export type DocumentSourceAssignmentsMap = Record<string, string>;

export async function loadDocumentSourceAssignments(): Promise<DocumentSourceAssignmentsMap> {
  try {
    const raw = await AsyncStorage.getItem(DOCUMENT_SOURCE_ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DocumentSourceAssignmentsMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (e) {
    console.log("[serviceAssignmentsStore] loadDocumentSource error", e);
    return {};
  }
}

export async function setDocumentSourceAssignment(
  featureId: string,
  requiredDocumentId: string | null
): Promise<DocumentSourceAssignmentsMap> {
  const map = await loadDocumentSourceAssignments();
  const next: DocumentSourceAssignmentsMap = { ...map };
  if (requiredDocumentId === null) {
    delete next[featureId];
  } else {
    next[featureId] = requiredDocumentId;
  }
  try {
    await AsyncStorage.setItem(
      DOCUMENT_SOURCE_ASSIGNMENTS_KEY,
      JSON.stringify(next)
    );
  } catch (e) {
    console.log("[serviceAssignmentsStore] saveDocumentSource error", e);
  }
  return next;
}

export interface DocumentSourceFeatureDef {
  id: string;
  label: string;
  description: string;
}

export const DOCUMENT_SOURCE_FEATURES: DocumentSourceFeatureDef[] = [
  {
    id: "driver-permit",
    label: "Driver Permit",
    description:
      "Choose which required document's uploaded image is used as the driver permit source.",
  },
];
