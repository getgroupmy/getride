export { default as MapView, Marker, MarkerAnimated, AnimatedRegion, Polyline, Polygon } from "react-native-maps";

function decodePolyline(encoded: string, precision: number = 5): { latitude: number; longitude: number }[] {
  const coordinates: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push({
      latitude: lat / factor,
      longitude: lng / factor,
    });
  }

  return coordinates;
}

import { GOOGLE_DIRECTIONS_KEY } from "@/constants/googleKeys";
import { runWithMappingRotation } from "./mappingClient";

type RouteResult = { distance: number; duration: number; coordinates: { latitude: number; longitude: number }[]; legDurations?: number[] };

/**
 * Compute a driving route using OpenStreetMap's OSRM routing service.
 * Returns null on any failure so the caller can fall back to Google.
 */
async function calculateRouteOSRM(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  waypoints?: { latitude: number; longitude: number }[]
): Promise<RouteResult | null> {
  try {
    const points = [origin, ...(waypoints ?? []), destination];
    const coordStr = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=polyline&steps=false&annotations=duration`;
    console.log("OSRM (OpenStreetMap) Directions request");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data: any = await response.json();
    if (data?.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
      console.warn("OSRM routing failed:", data?.code, data?.message);
      return null;
    }
    const route = data.routes[0];
    const distanceInKm = (route.distance || 0) / 1000;
    const durationInMinutes = Math.ceil((route.duration || 0) / 60);
    const legDurations = Array.isArray(route.legs)
      ? route.legs.map((leg: any) => Math.ceil((leg.duration || 0) / 60))
      : undefined;
    const coordinates = typeof route.geometry === "string" ? decodePolyline(route.geometry, 5) : [];
    if (coordinates.length === 0) {
      console.warn("OSRM returned empty geometry");
      return null;
    }
    console.log("OSRM route calculated:", distanceInKm, "km,", durationInMinutes, "min,", coordinates.length, "points");
    return {
      distance: parseFloat(distanceInKm.toFixed(1)),
      duration: durationInMinutes,
      coordinates,
      legDurations,
    };
  } catch (error) {
    console.warn("OSRM routing error:", error);
    return null;
  }
}

export async function calculateRoute(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  waypoints?: { latitude: number; longitude: number }[],
  pageId: string = "rider-home"
): Promise<RouteResult | null> {
  // Primary: OpenStreetMap (OSRM)
  const osrmResult = await calculateRouteOSRM(origin, destination, waypoints);
  if (osrmResult) {
    return osrmResult;
  }
  console.log("OSRM unavailable, falling back to Google Directions");

  const originStr = `${origin.latitude},${origin.longitude}`;
  const destStr = `${destination.latitude},${destination.longitude}`;
  const waypointsStr = waypoints && waypoints.length > 0
    ? `&waypoints=${waypoints.map(w => `${w.latitude},${w.longitude}`).join('|')}`
    : '';
  const doFetch = async (key: string) => {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}${waypointsStr}&mode=driving&alternatives=false&key=${key}`;
    console.log("Google Directions request");
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    return response.json();
  };
  try {
    const data = await runWithMappingRotation<any>(
      pageId,
      "directions",
      async (ctx) => {
        const k = ctx.key || GOOGLE_DIRECTIONS_KEY;
        const json = await doFetch(k);
        return { ok: json?.status === "OK", value: json };
      },
      async () => doFetch(GOOGLE_DIRECTIONS_KEY)
    );
    console.log("Google Directions response status:", data?.status);

    if (data?.status === "OK" && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const legs = route.legs || [];
      const totalDistance = legs.reduce((sum: number, leg: any) => sum + (leg.distance?.value || 0), 0);
      const totalDuration = legs.reduce((sum: number, leg: any) => sum + (leg.duration?.value || 0), 0);
      
      const distanceInKm = totalDistance / 1000;
      const durationInMinutes = Math.ceil(totalDuration / 60);
      const legDurations = legs.map((leg: any) => Math.ceil((leg.duration?.value || 0) / 60));
      
      let coordinates: { latitude: number; longitude: number }[] = [];
      for (const leg of legs) {
        const steps = leg.steps || [];
        for (const step of steps) {
          if (step.polyline?.points) {
            const stepCoords = decodePolyline(step.polyline.points, 5);
            if (coordinates.length > 0 && stepCoords.length > 0) {
              const last = coordinates[coordinates.length - 1];
              const first = stepCoords[0];
              if (
                Math.abs(last.latitude - first.latitude) < 1e-6 &&
                Math.abs(last.longitude - first.longitude) < 1e-6
              ) {
                coordinates.push(...stepCoords.slice(1));
              } else {
                coordinates.push(...stepCoords);
              }
            } else {
              coordinates.push(...stepCoords);
            }
          }
        }
      }
      if (coordinates.length === 0 && route.overview_polyline?.points) {
        coordinates = decodePolyline(route.overview_polyline.points, 5);
      }
      console.log("Route polyline decoded (steps):", coordinates.length, "points");
      
      console.log("Route calculated:", distanceInKm, "km,", durationInMinutes, "min");
      
      return {
        distance: parseFloat(distanceInKm.toFixed(1)),
        duration: durationInMinutes,
        coordinates,
        legDurations,
      };
    } else {
      console.warn("Google Directions routing failed:", data.status, data.error_message);
      return null;
    }
  } catch (error) {
    console.warn("Error calculating route:", error);
    return null;
  }
}

export type TariffType = "new" | "old";

/**
 * TEKSI Malaysia tariff:
 *  - "old":
 *      a) RM4.00 per KM or part (flag fall covers the first KM)
 *      b) RM0.35 per 200 meters, or
 *      c) RM0.35 per 36 seconds
 *      After the first KM, each subsequent increment is charged whenever
 *      200m is covered OR 36s elapses (whichever comes first).
 *  - "new":
 *      RM4.00 base fare + RM1.00 per KM + RM0.30 per minute.
 */
export function calculateFare(
  distanceKm: number,
  durationMin: number,
  multiplier: number = 1,
  tariff: TariffType = "old"
): number {
  const safeDistance = Math.max(0, distanceKm);
  const safeDuration = Math.max(0, durationMin);

  if (tariff === "new") {
    const BASE = 4.0;
    const PER_KM = 1.0;
    const PER_MIN = 0.3;
    const fare = (BASE + safeDistance * PER_KM + safeDuration * PER_MIN) * multiplier;
    return parseFloat(fare.toFixed(2));
  }

  const FLAG_FALL = 4.0;
  const INCREMENT = 0.35;

  if (safeDistance <= 1) {
    return parseFloat((FLAG_FALL * multiplier).toFixed(2));
  }

  const extraMeters = (safeDistance - 1) * 1000;
  // Time portion attributable to the segment after the first KM (proportional approximation)
  const extraSeconds = safeDuration * 60 * (1 - 1 / safeDistance);

  const distanceUnits = Math.ceil(extraMeters / 200);
  const timeUnits = Math.ceil(extraSeconds / 36);
  const units = Math.max(distanceUnits, timeUnits);

  const fare = (FLAG_FALL + units * INCREMENT) * multiplier;
  return parseFloat(fare.toFixed(2));
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  pageId: string = "rider-home"
): Promise<{ name: string; address: string } | null> {
  const FALLBACK_KEY = "AIzaSyBj89Dt9v6SiDMvA3XUsoRm6ey6L-nKMfI";
  const GOOGLE_API_KEY = await (async () => {
    try {
      const { getMappingKey } = await import("./mappingClient");
      const k = await getMappingKey(pageId, "geocoding");
      return k?.key && k.key.trim().length > 0 ? k.key : FALLBACK_KEY;
    } catch {
      return FALLBACK_KEY;
    }
  })();

  try {
    // Use high precision geocoding - request all address types and find closest match
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&location_type=ROOFTOP|RANGE_INTERPOLATED&key=${GOOGLE_API_KEY}`;
    
    console.log("Google Geocoding precise request");
    
    const geocodeResponse = await fetch(geocodeUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    const geocodeText = await geocodeResponse.text();
    let geocodeData;
    try {
      geocodeData = JSON.parse(geocodeText);
    } catch {
      console.warn("Failed to parse geocode response:", geocodeText.substring(0, 100));
      geocodeData = { status: "PARSE_ERROR" };
    }
    console.log("Google Geocoding precise response status:", geocodeData.status);
    
    let preciseAddress = "";
    let fullAddressDetails = "";
    
    if (geocodeData.status === "OK" && geocodeData.results && geocodeData.results.length > 0) {
      // Find the most precise result by checking location_type and distance
      let bestResult = geocodeData.results[0];
      let bestDistance = Infinity;
      
      for (const result of geocodeData.results) {
        if (result.geometry?.location) {
          const dist = calculateHaversineDistance(
            latitude, 
            longitude, 
            result.geometry.location.lat, 
            result.geometry.location.lng
          );
          // Prefer ROOFTOP results, then closest match
          const isRooftop = result.geometry.location_type === "ROOFTOP";
          if (isRooftop && dist < bestDistance) {
            bestResult = result;
            bestDistance = dist;
          } else if (!bestResult.geometry?.location_type?.includes("ROOFTOP") && dist < bestDistance) {
            bestResult = result;
            bestDistance = dist;
          }
        }
      }
      
      console.log("Best geocode result distance:", bestDistance, "meters, type:", bestResult.geometry?.location_type);
      const result = bestResult;
      const addressComponents = result.address_components || [];
      
      // Extract precise components
      const subpremise = addressComponents.find((c: any) => c.types.includes("subpremise"));
      const premise = addressComponents.find((c: any) => c.types.includes("premise"));
      const streetNumber = addressComponents.find((c: any) => c.types.includes("street_number"));
      const route = addressComponents.find((c: any) => c.types.includes("route"));
      const sublocality2 = addressComponents.find((c: any) => c.types.includes("sublocality_level_2"));
      const sublocality1 = addressComponents.find((c: any) => c.types.includes("sublocality_level_1") || c.types.includes("sublocality"));
      const locality = addressComponents.find((c: any) => c.types.includes("locality"));
      const postalCode = addressComponents.find((c: any) => c.types.includes("postal_code"));
      
      // Build precise primary address (most specific first)
      const primaryParts: string[] = [];
      if (subpremise) primaryParts.push(subpremise.long_name);
      if (premise) primaryParts.push(premise.long_name);
      if (streetNumber && route) {
        primaryParts.push(`${streetNumber.long_name} ${route.long_name}`);
      } else if (route) {
        primaryParts.push(route.long_name);
      }
      
      preciseAddress = primaryParts.length > 0 ? primaryParts.join(", ") : result.formatted_address.split(",")[0];
      
      // Build secondary address details
      const secondaryParts: string[] = [];
      if (sublocality2 && !preciseAddress.includes(sublocality2.long_name)) {
        secondaryParts.push(sublocality2.long_name);
      }
      if (sublocality1 && !preciseAddress.includes(sublocality1.long_name)) {
        secondaryParts.push(sublocality1.long_name);
      }
      if (locality && !preciseAddress.includes(locality.long_name)) {
        secondaryParts.push(locality.long_name);
      }
      if (postalCode) {
        secondaryParts.push(postalCode.long_name);
      }
      
      fullAddressDetails = secondaryParts.slice(0, 2).join(", ");
    }
    
    // If geocoding didn't return precise result, try additional geocoding without filters
    if (!preciseAddress || preciseAddress.split(" ")[0] === "Jalan" || !preciseAddress.match(/^\d+/)) {
      const preciseGeoUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_API_KEY}`;
      
      console.log("Trying additional precise geocoding");
      
      const preciseGeoResponse = await fetch(preciseGeoUrl, {
        headers: { 'Accept': 'application/json' },
      });
      
      const preciseGeoText = await preciseGeoResponse.text();
      let preciseGeoData;
      try {
        preciseGeoData = JSON.parse(preciseGeoText);
      } catch {
        preciseGeoData = { status: "PARSE_ERROR" };
      }
      
      if (preciseGeoData.status === "OK" && preciseGeoData.results) {
        // Find the result with street_number that's closest to our coordinates
        for (const res of preciseGeoData.results) {
          const comps = res.address_components || [];
          const hasStreetNumber = comps.some((c: any) => c.types.includes("street_number"));
          
          if (hasStreetNumber && res.geometry?.location) {
            const dist = calculateHaversineDistance(
              latitude, longitude,
              res.geometry.location.lat, res.geometry.location.lng
            );
            
            if (dist < 50) { // Within 50 meters
              const streetNum = comps.find((c: any) => c.types.includes("street_number"));
              const route = comps.find((c: any) => c.types.includes("route"));
              if (streetNum && route) {
                preciseAddress = `${streetNum.long_name} ${route.long_name}`;
                console.log("Found more precise address:", preciseAddress, "at", dist, "meters");
                break;
              }
            }
          }
        }
      }
    }
    
    // Try Google Places Nearby Search for precise place names (rankby distance for closest match)
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&rankby=distance&type=point_of_interest|establishment|premise&key=${GOOGLE_API_KEY}`;
    
    console.log("Google Places Nearby Search (rankby distance)");
    
    const nearbyResponse = await fetch(nearbyUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    const nearbyText = await nearbyResponse.text();
    let nearbyData;
    try {
      nearbyData = JSON.parse(nearbyText);
    } catch {
      console.warn("Failed to parse nearby response:", nearbyText.substring(0, 100));
      nearbyData = { status: "PARSE_ERROR" };
    }
    console.log("Google Places Nearby response status:", nearbyData.status);
    
    // Check if we found a very close place (within ~20m based on geometry)
    if (nearbyData.status === "OK" && nearbyData.results && nearbyData.results.length > 0) {
      const closestPlace = nearbyData.results[0];
      
      // Calculate approximate distance to the place
      const placeLat = closestPlace.geometry?.location?.lat;
      const placeLng = closestPlace.geometry?.location?.lng;
      
      if (placeLat && placeLng) {
        const distance = calculateHaversineDistance(latitude, longitude, placeLat, placeLng);
        console.log("Distance to closest place:", distance, "meters");
        
        // Only use place name if within 15 meters (very close match)
        if (distance <= 15) {
          const placeName = closestPlace.name;
          const vicinity = closestPlace.vicinity || fullAddressDetails;
          
          console.log("Using precise nearby place:", placeName, "-", vicinity);
          return { name: placeName, address: vicinity };
        }
      }
    }
    
    // Return precise geocoded address if no nearby place found
    if (preciseAddress) {
      console.log("Using precise geocoded address:", preciseAddress, "-", fullAddressDetails);
      return { name: preciseAddress, address: fullAddressDetails };
    }
    
    // Final fallback to general geocoding
    const fallbackUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_API_KEY}`;
    
    console.log("Fallback to general geocoding");
    
    const fallbackResponse = await fetch(fallbackUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });
    
    const fallbackText = await fallbackResponse.text();
    let fallbackData;
    try {
      fallbackData = JSON.parse(fallbackText);
    } catch {
      console.warn("Failed to parse fallback response:", fallbackText.substring(0, 100));
      fallbackData = { status: "PARSE_ERROR" };
    }
    
    if (fallbackData.status === "OK" && fallbackData.results && fallbackData.results.length > 0) {
      const result = fallbackData.results[0];
      const addressComponents = result.address_components || [];
      
      const streetNumber = addressComponents.find((c: any) => c.types.includes("street_number"));
      const route = addressComponents.find((c: any) => c.types.includes("route"));
      const sublocality = addressComponents.find((c: any) => c.types.includes("sublocality") || c.types.includes("sublocality_level_1"));
      const locality = addressComponents.find((c: any) => c.types.includes("locality"));
      
      let name = "";
      if (streetNumber && route) {
        name = `${streetNumber.long_name} ${route.long_name}`;
      } else if (route) {
        name = route.long_name;
      } else if (sublocality) {
        name = sublocality.long_name;
      } else {
        name = result.formatted_address.split(",")[0];
      }
      
      const address = locality?.long_name || "";
      
      console.log("Fallback geocoding result:", name, "-", address);
      return { name, address };
    }
    
    console.warn("All geocoding attempts failed");
    return null;
  } catch (error) {
    console.warn("Error reverse geocoding:", error);
    return null;
  }
}

export interface TollBooth {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
}

export async function fetchTollBooths(
  routeCoords: { latitude: number; longitude: number }[]
): Promise<TollBooth[]> {
  if (routeCoords.length === 0) return [];
  
  try {
    const lats = routeCoords.map(c => c.latitude);
    const lngs = routeCoords.map(c => c.longitude);
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;
    const minLng = Math.min(...lngs) - 0.01;
    const maxLng = Math.max(...lngs) + 0.01;
    
    const query = `
      [out:json][timeout:10];
      (
        node["barrier"="toll_booth"](${minLat},${minLng},${maxLat},${maxLng});
        node["highway"="toll_gantry"](${minLat},${minLng},${maxLat},${maxLng});
        way["barrier"="toll_booth"](${minLat},${minLng},${maxLat},${maxLng});
      );
      out center;
    `;
    
    console.log("Fetching toll booths from Overpass API");
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    
    const data = await response.json();
    console.log("Overpass response elements:", data.elements?.length || 0);
    
    const tollBooths: TollBooth[] = [];
    
    if (data.elements) {
      for (const element of data.elements) {
        const lat = element.lat || element.center?.lat;
        const lng = element.lon || element.center?.lon;
        
        if (lat && lng) {
          // Check if toll booth is actually on the polyline (within 50m threshold)
          let minDistanceToRoute = Infinity;
          for (let i = 0; i < routeCoords.length - 1; i++) {
            const dist = pointToSegmentDistance(
              lat, lng,
              routeCoords[i].latitude, routeCoords[i].longitude,
              routeCoords[i + 1].latitude, routeCoords[i + 1].longitude
            );
            minDistanceToRoute = Math.min(minDistanceToRoute, dist);
          }
          
          // Only include toll booths within 25 meters of the actual route polyline (stricter filter)
          if (minDistanceToRoute < 25) {
            console.log(`Toll booth ${element.tags?.name || element.id} is ${minDistanceToRoute.toFixed(0)}m from route - including`);
            tollBooths.push({
              id: String(element.id),
              latitude: lat,
              longitude: lng,
              name: element.tags?.name || 'Toll Booth',
            });
          } else {
            console.log(`Toll booth ${element.tags?.name || element.id} is ${minDistanceToRoute.toFixed(0)}m from route - excluding`);
          }
        }
      }
    }
    
    console.log("Toll booths found on route:", tollBooths.length);
    return tollBooths;
  } catch (error) {
    console.warn("Error fetching toll booths:", error);
    return [];
  }
}

// Calculate perpendicular distance from a point to a line segment
function pointToSegmentDistance(
  pointLat: number,
  pointLng: number,
  segStartLat: number,
  segStartLng: number,
  segEndLat: number,
  segEndLng: number
): number {
  const A = pointLat - segStartLat;
  const B = pointLng - segStartLng;
  const C = segEndLat - segStartLat;
  const D = segEndLng - segStartLng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let closestLat: number;
  let closestLng: number;

  if (param < 0) {
    closestLat = segStartLat;
    closestLng = segStartLng;
  } else if (param > 1) {
    closestLat = segEndLat;
    closestLng = segEndLng;
  } else {
    closestLat = segStartLat + param * C;
    closestLng = segStartLng + param * D;
  }

  return calculateHaversineDistance(pointLat, pointLng, closestLat, closestLng);
}

function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
