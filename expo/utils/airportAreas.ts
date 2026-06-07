import { useMemo } from "react";
import { useAdminData, SettingEntry } from "@/contexts/AdminDataContext";

const AIRPORT_KEY = "airport-areas" as const;

export interface LatLng { latitude: number; longitude: number }
export interface BBox { north: number; south: number; east: number; west: number }
export interface BoundaryShape {
  coords: LatLng[];
  polygons?: LatLng[][];
  bbox: BBox;
  source?: string;
}

export interface AirportArea {
  entry: SettingEntry;
  boundary: BoundaryShape;
  name: string;
  code: string;
  centroid: LatLng;
  /** Cached array of polygon rings used for hit-testing. */
  rings: LatLng[][];
}

/** Default buffer in meters around the geofenced polygon to also count as "inside". */
export const AIRPORT_AREA_BUFFER_METERS = 300;

const M_PER_DEG = 111320;

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

function distMetersPointToRing(pt: LatLng, ring: LatLng[]): number {
  if (ring.length === 0) return Number.POSITIVE_INFINITY;
  const cosL = Math.cos((pt.latitude * Math.PI) / 180);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ax = (a.longitude - pt.longitude) * cosL * M_PER_DEG;
    const ay = (a.latitude - pt.latitude) * M_PER_DEG;
    const bx = (b.longitude - pt.longitude) * cosL * M_PER_DEG;
    const by = (b.latitude - pt.latitude) * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d < min) min = d;
  }
  return min;
}

/** Returns true when the lat/lon falls inside the polygon, or within `bufferMeters` of an edge. */
export function isPointInsideOrNearArea(
  lat: number,
  lon: number,
  area: AirportArea,
  bufferMeters: number = AIRPORT_AREA_BUFFER_METERS,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  // Quick reject using an expanded bbox.
  const b = area.boundary.bbox;
  const latBuf = bufferMeters / M_PER_DEG;
  const cosL = Math.cos((lat * Math.PI) / 180) || 1;
  const lngBuf = bufferMeters / (M_PER_DEG * cosL);
  if (lat > b.north + latBuf || lat < b.south - latBuf) return false;
  if (lon > b.east + lngBuf || lon < b.west - lngBuf) return false;
  const pt: LatLng = { latitude: lat, longitude: lon };
  for (const ring of area.rings) {
    if (ring.length < 3) continue;
    if (pointInRing(pt, ring)) return true;
    if (distMetersPointToRing(pt, ring) <= bufferMeters) return true;
  }
  return false;
}

/** Returns the first airport area that contains (or is within buffer of) the given coordinate. */
export function findContainingAirport(
  lat: number,
  lon: number,
  areas: AirportArea[],
  bufferMeters: number = AIRPORT_AREA_BUFFER_METERS,
): AirportArea | null {
  for (const a of areas) {
    if (isPointInsideOrNearArea(lat, lon, a, bufferMeters)) return a;
  }
  return null;
}

/** Returns every airport area that contains (or is within buffer of) the given coordinate. */
export function findContainingAirports(
  lat: number,
  lon: number,
  areas: AirportArea[],
  bufferMeters: number = AIRPORT_AREA_BUFFER_METERS,
): AirportArea[] {
  const out: AirportArea[] = [];
  for (const a of areas) {
    if (isPointInsideOrNearArea(lat, lon, a, bufferMeters)) out.push(a);
  }
  return out;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Returns true when the result name relates to an airport (matches name, code, or assigned place name). */
export function areaNameMatches(area: AirportArea, resultName: string): boolean {
  const r = normalizeName(resultName);
  if (!r) return false;
  const v = (area.entry.values ?? {}) as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["name", "code", "placeName"]) {
    const c = normalizeName(String(v[key] ?? ""));
    if (c.length >= 3) candidates.push(c);
  }
  for (const c of candidates) {
    if (r === c) return true;
    if (r.includes(c) || c.includes(r)) return true;
  }
  return false;
}

/** Returns every airport area that matches the given result by name. */
export function findAirportsByName(
  resultName: string,
  areas: AirportArea[],
): AirportArea[] {
  const out: AirportArea[] = [];
  for (const a of areas) {
    if (areaNameMatches(a, resultName)) out.push(a);
  }
  return out;
}

/** Hook returning every airport-area entry that has a valid saved boundary. */
export function useAirportAreas(): AirportArea[] {
  const { getEntries } = useAdminData();
  const entries = getEntries(AIRPORT_KEY);
  return useMemo<AirportArea[]>(() => {
    const out: AirportArea[] = [];
    for (const entry of entries) {
      const boundary = parseBoundary(entry.values?.boundary);
      if (!boundary) continue;
      const rings: LatLng[][] =
        boundary.polygons && boundary.polygons.length > 0
          ? boundary.polygons
          : boundary.coords.length >= 3
          ? [boundary.coords]
          : [ringFromBBox(boundary.bbox)];
      const centroid: LatLng = {
        latitude: (boundary.bbox.north + boundary.bbox.south) / 2,
        longitude: (boundary.bbox.east + boundary.bbox.west) / 2,
      };
      out.push({
        entry,
        boundary,
        name: String(entry.values?.name ?? "Airport"),
        code: String(entry.values?.code ?? ""),
        centroid,
        rings,
      });
    }
    return out;
  }, [entries]);
}

/**
 * Replace any result whose coordinate falls inside (or within buffer of) an airport
 * geofence with a single synthesized airport item. Results outside any airport are
 * passed through. Each airport appears at most once (in the position of the first
 * matching original result).
 */
export function applyAirportAreaFilter<T>(
  results: T[],
  areas: AirportArea[],
  getCoord: (item: T) => { lat: number; lon: number } | null,
  makeAirportItem: (area: AirportArea) => T,
  bufferMeters: number = AIRPORT_AREA_BUFFER_METERS,
  getName?: (item: T) => string,
): T[] {
  if (areas.length === 0) return results;
  const out: T[] = [];
  const seen = new Set<string>();
  const pushArea = (a: AirportArea) => {
    if (seen.has(a.entry.id)) return;
    seen.add(a.entry.id);
    out.push(makeAirportItem(a));
  };
  for (const item of results) {
    const matched: AirportArea[] = [];
    const c = getCoord(item);
    if (c) {
      for (const a of findContainingAirports(c.lat, c.lon, areas, bufferMeters)) {
        matched.push(a);
      }
    }
    if (getName) {
      const nm = getName(item);
      if (nm) {
        for (const a of findAirportsByName(nm, areas)) {
          if (!matched.includes(a)) matched.push(a);
        }
      }
    }
    if (matched.length > 0) {
      for (const a of matched) pushArea(a);
    } else {
      out.push(item);
    }
  }
  return out;
}
