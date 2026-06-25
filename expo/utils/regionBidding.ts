import { useCallback, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { useAdminData } from "@/contexts/AdminDataContext";

/**
 * "Bidding (OfferMe)" lookup for region settings.
 *
 * Regions are configured in admin-settings-country-states-cities. Each region
 * entry stores its country/state/city/suburb names, an optional mapped geofence
 * boundary (values.boundary) and a `biddingEnabled` flag.
 *
 * Resolution order for a pickup coordinate (most specific wins in each pass):
 *   1. Boundary match — if the point falls inside any mapped boundary, the most
 *      specific containing region's flag wins.
 *   2. Name fallback — when no boundary contains the point, the coordinate is
 *      reverse-geocoded to country/state/city names and matched against region
 *      entries by name. Bidding off on a country therefore applies to every
 *      pickup in that country (and its states/cities) even without a drawn
 *      boundary. The most specific matching name level wins.
 *
 * Default behaviour is bidding ENABLED — it is only disabled when a matching
 * region (by boundary or name) has biddingEnabled === false.
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

interface NamedRegion {
  id: string;
  biddingEnabled: boolean;
  country: string;
  state: string;
  city: string;
  suburb: string;
  /** 0 = country, 1 = state, 2 = city, 3 = suburb. Higher = more specific. */
  specificity: number;
}

interface BoundaryRegion extends NamedRegion {
  bbox: BBox;
  rings: LatLng[][];
}

interface GeoNames {
  country: string;
  state: string;
  city: string;
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

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function specificityOf(state: string, city: string, suburb: string): number {
  if (suburb) return 3;
  if (city) return 2;
  if (state) return 1;
  return 0;
}

function coordKey(lat: number, lng: number): string {
  // Round to ~100m so nearby lookups reuse the same cached geocode result.
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export interface RegionBidding {
  /**
   * Returns true when bidding (fare +/- adjustment) is allowed at the given
   * coordinate. Returns true when coordinates are missing, or no region matches
   * by boundary or name. Falls back to reverse-geocoded name matching when no
   * mapped boundary contains the point.
   */
  isBiddingEnabledAt: (lat?: number, lng?: number) => boolean;
}

/** Hook providing boundary + name-based bidding lookup for region settings. */
export function useRegionBidding(): RegionBidding {
  const { getEntries } = useAdminData();
  const entries = getEntries(CSC_KEY);

  // Cache of reverse-geocoded region names keyed by rounded coordinate. The
  // version counter bumps to re-render once an async lookup resolves.
  const geoCache = useRef<Map<string, GeoNames | null>>(new Map());
  const pending = useRef<Set<string>>(new Set());
  const [, setGeoVersion] = useState<number>(0);

  const { boundaryRegions, namedRegions } = useMemo(() => {
    const boundary: BoundaryRegion[] = [];
    const named: NamedRegion[] = [];
    for (const entry of entries) {
      const country = String(entry.values?.country ?? "");
      const state = String(entry.values?.state ?? "");
      const city = String(entry.values?.city ?? "");
      const suburb = String(entry.values?.suburb ?? "");
      if (!country) continue;
      // Treat missing flag as enabled so existing regions are unaffected.
      const biddingEnabled = entry.values?.biddingEnabled !== false;
      const specificity = specificityOf(state, city, suburb);
      const base: NamedRegion = {
        id: entry.id,
        biddingEnabled,
        country,
        state,
        city,
        suburb,
        specificity,
      };
      named.push(base);

      const shape = parseBoundary(entry.values?.boundary);
      if (shape) {
        const rings: LatLng[][] =
          shape.polygons && shape.polygons.length > 0
            ? shape.polygons
            : shape.coords.length >= 3
            ? [shape.coords]
            : [ringFromBBox(shape.bbox)];
        boundary.push({ ...base, bbox: shape.bbox, rings });
      }
    }
    return { boundaryRegions: boundary, namedRegions: named };
  }, [entries]);

  const resolveGeoNames = useCallback(
    (lat: number, lng: number): GeoNames | null => {
      const key = coordKey(lat, lng);
      if (geoCache.current.has(key)) return geoCache.current.get(key) ?? null;
      if (!pending.current.has(key)) {
        pending.current.add(key);
        (async () => {
          try {
            const [res] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            geoCache.current.set(key, res
              ? {
                  country: res.country ?? "",
                  state: res.region ?? res.subregion ?? "",
                  city: res.city ?? res.subregion ?? res.district ?? "",
                }
              : null);
          } catch {
            geoCache.current.set(key, null);
          } finally {
            pending.current.delete(key);
            setGeoVersion((v) => v + 1);
          }
        })();
      }
      return null;
    },
    []
  );

  const isBiddingEnabledAt = useCallback(
    (lat?: number, lng?: number): boolean => {
      if (typeof lat !== "number" || typeof lng !== "number") return true;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
      const pt: LatLng = { latitude: lat, longitude: lng };

      // Pass 1: boundary match — most specific containing region wins.
      let bestBoundary: BoundaryRegion | null = null;
      for (const r of boundaryRegions) {
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
        if (contained && (!bestBoundary || r.specificity > bestBoundary.specificity)) {
          bestBoundary = r;
        }
      }
      if (bestBoundary) return bestBoundary.biddingEnabled;

      // Pass 2: name fallback — reverse-geocode and match by name hierarchy.
      const geo = resolveGeoNames(lat, lng);
      if (!geo) return true;
      const gCountry = norm(geo.country);
      const gState = norm(geo.state);
      const gCity = norm(geo.city);
      if (!gCountry) return true;

      let bestNamed: NamedRegion | null = null;
      for (const r of namedRegions) {
        if (norm(r.country) !== gCountry) continue;
        // Each filled level must match the geocoded names; empty levels are wildcards.
        if (r.state && norm(r.state) !== gState) continue;
        if (r.city && norm(r.city) !== gCity) continue;
        // Suburb can't be resolved from geocoding reliably — skip suburb-scoped rules.
        if (r.suburb) continue;
        if (!bestNamed || r.specificity > bestNamed.specificity) {
          bestNamed = r;
        }
      }
      if (bestNamed) return bestNamed.biddingEnabled;
      return true;
    },
    [boundaryRegions, namedRegions, resolveGeoNames]
  );

  return { isBiddingEnabledAt };
}
