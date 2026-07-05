import type { RideRequest } from "@/utils/rideRequestsStore";

/**
 * A navigation target (expo-router pathname + string params) that resumes the
 * rider's in-progress experience after an app restart, so a cold launch lands
 * back on the correct screen instead of the home map "like nothing happened".
 */
export interface RestoreTarget {
  pathname: string;
  params: Record<string, string>;
}

function asStr(value: number | string | null | undefined, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/**
 * Maps an ongoing ride request to the screen that should be restored:
 * - accepted / arrived / on_trip → live tracking (a driver is already engaged)
 * - open                          → ride-confirm, resuming the active search
 * Returns null for any non-restorable status.
 */
export function buildRestoreTarget(req: RideRequest): RestoreTarget | null {
  const pickup = req.pickup_name ?? req.pickup_address ?? "Current Location";
  const destination = req.drop_name ?? req.drop_address ?? "Destination";
  const common: Record<string, string> = {
    pickup,
    destination,
    pickupLat: asStr(req.pickup_lat),
    pickupLng: asStr(req.pickup_lng),
    destLat: asStr(req.drop_lat),
    destLng: asStr(req.drop_lng),
  };

  if (
    req.status === "accepted" ||
    req.status === "arrived" ||
    req.status === "on_trip"
  ) {
    return {
      pathname: "/ride-tracking",
      params: {
        ...common,
        requestId: req.id,
        restoreStatus: req.status,
        price: asStr(req.offered_fare ?? req.fare, "0"),
        driverName: req.partner_name ?? "Driver",
        driverPhoto: req.partner_photo ?? "",
        driverRating: asStr(req.partner_rating, "5"),
        driverVehicle: req.partner_vehicle ?? "",
      },
    };
  }

  if (req.status === "open") {
    return {
      pathname: "/ride-confirm",
      params: {
        ...common,
        restoreRequestId: req.id,
        restoreCreatedAt: req.created_at ?? "",
        fare: asStr(req.fare, "0"),
      },
    };
  }

  return null;
}

/**
 * Maps a partner's ongoing trip to the ride-running screen so a cold launch
 * drops the driver back into their active ride:
 * - accepted / arrived → resume heading to the pickup
 * - on_trip            → resume heading to the destination
 * Returns null for any non-restorable status.
 */
export function buildPartnerRestoreTarget(req: RideRequest): RestoreTarget | null {
  if (
    req.status !== "accepted" &&
    req.status !== "arrived" &&
    req.status !== "on_trip"
  ) {
    return null;
  }

  // Best-known driver position: where they accepted, falling back to the
  // pickup point so the toPickup phase always has valid coordinates.
  const driverLat = req.partner_accept_lat ?? req.pickup_lat;
  const driverLng = req.partner_accept_lng ?? req.pickup_lng;

  let distanceToPickupKm = 0.5;
  if (
    driverLat !== null &&
    driverLng !== null &&
    req.pickup_lat !== null &&
    req.pickup_lng !== null
  ) {
    const dx = (req.pickup_lat - driverLat) * 111;
    const dy =
      (req.pickup_lng - driverLng) *
      111 *
      Math.cos((req.pickup_lat * Math.PI) / 180);
    distanceToPickupKm = Math.max(
      0.1,
      Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10
    );
  }

  return {
    pathname: "/ride-running",
    params: {
      driverMode: "eHailing",
      requestId: req.id,
      dropName: req.drop_name ?? "Destination",
      dropAddress: req.drop_address ?? "",
      dropLat: asStr(req.drop_lat),
      dropLng: asStr(req.drop_lng),
      pickupLat: asStr(req.pickup_lat),
      pickupLng: asStr(req.pickup_lng),
      pickupName: req.pickup_name ?? "Pickup",
      pickupAddress: req.pickup_address ?? "",
      fare: asStr(req.offered_fare ?? req.fare, "0"),
      distance: asStr(req.distance_km, "1"),
      eta: asStr(req.duration_min, "5"),
      passengerName: req.rider_name ?? "Passenger",
      driverLat: asStr(driverLat),
      driverLng: asStr(driverLng),
      distanceToPickup: String(distanceToPickupKm),
      initialPhase: req.status === "on_trip" ? "toDestination" : "toPickup",
    },
  };
}
