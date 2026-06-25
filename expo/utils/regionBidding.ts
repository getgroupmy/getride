import { useCallback, useMemo } from "react";
import { useAdminData } from "@/contexts/AdminDataContext";

/**
 * Boundary-based "Bidding (OfferMe)" lookup.
 *
 * Regions are configured in admin-settings-country-states-cities. Each region
 * entry can store a mapped geofence boundary (values.boundary) and a
 * `biddingEnabled` flag. When a pickup coordinate falls inside a region whose
 * bidding is turned off, the rider/driver fare cannot be adjusted (no +/-).
 *
 * Default behaviour is bidding ENABLED — it is only disabled when the point
 * falls inside a region that has a mapped boundary AND biddingEnabled === false.
 */

const CSC_KEY = "country-states-cities" as const;

interface LatLng {
  latitude: number;
  longitude: number;
}
interface BBox {
  north: number;
  south: number;
  east: number;
  west: number;
}
interface BoundaryShape {
  coords: LatLng[];
  polygons?: LatLng[][];
  bbox: BBox;
  source?: string;
}

interface BiddingRegion {
  id: string;
  biddingEnabled: boolean;
  bbox: BBox;
  rings: LatLng[][];
}

function parseBoundary(raw: unknown): BoundaryShape | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const j = JSON.parse(raw) as BoundaryShape;
    if (!j || !Array.isArray(j.coords) || !j.bbox) return null;
    return j;
  } catch {
    return null;
  }
}

function ringFromBBox(b: BBox): LatLng[] {
  return [
    { latitude: b.north, longitude: b.west },
    { latitude: b.north, longitude: b.east },
    { latitude: b.south, longitude: b.east },
    { latitude: b.south, longitude: b.west },
  ];
}

function pointInRing(pt: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude;
    const yi = ring[i].latitude;
    const xj = ring[j].longitude;
    const yj = ring[j].latitude;
    const intersect =
      yi > pt.latitude !== yj > pt.latitude &&
      pt.longitude < ((xj - xi) * (pt.latitude - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface RegionBidding {
  /**
   * Returns true when bidding (fare +/- adjustment) is allowed at the given
   * coordinate. Returns true when coordinates are missing or no region with a
   * mapped boundary contains the point.
   */
  isBiddingEnabledAt: (lat?: number, lng?: number) => boolean;
}

/** Hook providing boundary-based bidding lookup for region settings. */
export function useRegionBidding(): RegionBidding {
  const { getEntries } = useAdminData();
  const entries = getEntries(CSC_KEY);

  const regions = useMemo<BiddingRegion[]>(() => {
    const out: BiddingRegion[] = [];
    for (const entry of entries) {
      const boundary = parseBoundary(entry.values?.boundary);
      if (!boundary) continue;
      const rings: LatLng[][] =
        boundary.polygons && boundary.polygons.length > 0
          ? boundary.polygons
          : boundary.coords.length >= 3
          ? [boundary.coords]
          : [ringFromBBox(boundary.bbox)];
      out.push({
        id: entry.id,
        // Treat missing flag as enabled so existing regions are unaffected.
        biddingEnabled: entry.values?.biddingEnabled !== false,
        bbox: boundary.bbox,
        rings,
      });
    }
    return out;
  }, [entries]);

  const isBiddingEnabledAt = useCallback(
    (lat?: number, lng?: number): boolean => {
      if (typeof lat !== "number" || typeof lng !== "number") return true;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
      const pt: LatLng = { latitude: lat, longitude: lng };
      for (const r of regions) {
        const b = r.bbox;
        if (lat > b.north || lat < b.south || lng > b.east || lng < b.west) continue;
        let contained = false;
        for (const ring of r.rings) {
          if (ring.length < 3) continue;
          if (pointInRing(pt, ring)) {
            contained = true;
            break;
          }
        }
        // A mapped region with bidding off disables bidding for the point.
        if (contained && !r.biddingEnabled) return false;
      }
      return true;
    },
    [regions]
  );

  return { isBiddingEnabledAt };
}
