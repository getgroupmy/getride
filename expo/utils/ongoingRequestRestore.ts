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
