/**
 * Forward place search.
 *
 * The legacy app had `reverseGeocode` (a fix → an address) but no way to go the
 * other way, so the search screen resolved places ad hoc. This is that missing
 * half: a query string → a list of pickable places.
 *
 * Nominatim (OpenStreetMap) rather than Google Places, for the same reason
 * `calculateRoute` tries OSRM first — it needs no key, so search keeps working
 * on a build with no Maps key configured. The response parsing is pure and
 * tested; only `searchPlaces` touches the network.
 */

export interface PlaceResult {
  /** Stable id for list keys — Nominatim's osm id, or a composed fallback. */
  id: string;
  /** Short label: the venue or street, what the rider recognises. */
  name: string;
  /** Full address line shown under the name. */
  address: string;
  latitude: number;
  longitude: number;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/** Nominatim asks that clients identify themselves. */
const USER_AGENT = "GET.ride/1.0 (ride-hailing app)";

/**
 * Split a Nominatim `display_name` into a short leading label and the rest.
 *
 * `display_name` is a comma-separated cascade from most to least specific, so
 * the first part is the name a rider would recognise ("KLCC", "Jalan Ampang")
 * and the remainder is the address beneath it.
 */
export function splitDisplayName(displayName: string): { name: string; address: string } {
  const parts = displayName
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return { name: "", address: "" };
  if (parts.length === 1) return { name: parts[0], address: parts[0] };
  return { name: parts[0], address: parts.slice(1).join(", ") };
}

/**
 * Turn a raw Nominatim payload into results.
 *
 * Tolerant by design: the endpoint is third-party and unversioned, so a row
 * missing coordinates is dropped rather than becoming a place that cannot be
 * navigated to. Latitude/longitude arrive as strings.
 */
export function parsePlaceResults(raw: unknown): PlaceResult[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;

    const displayName = typeof row.display_name === "string" ? row.display_name : "";
    const { name, address } = splitDisplayName(displayName);
    if (!name) continue;

    const osmId = row.osm_id != null ? String(row.osm_id) : "";
    const osmType = typeof row.osm_type === "string" ? row.osm_type : "";
    const id = osmId ? `${osmType}:${osmId}` : `${latitude},${longitude}`;

    out.push({ id, name, address, latitude, longitude });
  }
  return out;
}

export interface SearchPlacesOptions {
  /** Bias results near the rider. Nominatim treats this as a soft preference. */
  near?: { latitude: number; longitude: number } | null;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Look up places matching `query`.
 *
 * Returns an empty list rather than throwing: search sits in front of a text
 * input, and a network blip should read as "no matches yet", not an error the
 * rider has to dismiss before typing the next character.
 */
export async function searchPlaces(
  query: string,
  opts: SearchPlacesOptions = {}
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: "json",
    addressdetails: "0",
    limit: String(opts.limit ?? 8),
  });
  if (opts.near) {
    // A ~1 degree box around the rider, as a preference rather than a filter.
    const { latitude, longitude } = opts.near;
    params.set(
      "viewbox",
      `${longitude - 1},${latitude + 1},${longitude + 1},${latitude - 1}`
    );
  }

  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: opts.signal,
    });
    if (!res.ok) return [];
    return parsePlaceResults(await res.json());
  } catch {
    return [];
  }
}
