import {
  buildRestoreTarget,
  buildPartnerRestoreTarget,
} from "@/utils/ongoingRequestRestore";
import type { RideRequest, RideRequestStatus } from "@/utils/rideRequestsStore";

function makeRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    id: "req-1",
    rider_id: "rider-1",
    rider_name: "Alice",
    rider_phone: null,
    rider_photo: null,
    rider_rating: 5,
    service: "eHailing",
    payment_mode: "cash",
    pickup_name: "Suria KLCC",
    pickup_address: "Jalan Ampang, KL",
    pickup_lat: 3.158,
    pickup_lng: 101.712,
    drop_name: "Mid Valley",
    drop_address: "Lingkaran Syed Putra, KL",
    drop_lat: 3.117,
    drop_lng: 101.677,
    distance_km: 8.4,
    duration_min: 22,
    fare: 18.5,
    currency: "RM",
    passengers: 1,
    luggage: 0,
    note: null,
    offer_me: false,
    offered_fare: null,
    ride_fare: null,
    toll_charges: null,
    other_charges: null,
    partner_accept_lat: null,
    partner_accept_lng: null,
    partner_arrive_lat: null,
    partner_arrive_lng: null,
    partner_drop_lat: null,
    partner_drop_lng: null,
    user_accept_lat: null,
    user_accept_lng: null,
    user_arrive_lat: null,
    user_arrive_lng: null,
    user_drop_lat: null,
    user_drop_lng: null,
    partner_live_lat: null,
    partner_live_lng: null,
    partner_live_heading: null,
    partner_live_at: null,
    user_live_lat: null,
    user_live_lng: null,
    user_live_at: null,
    otp: null,
    vehicle_id: null,
    full_address: null,
    country: "Malaysia",
    state: "Kuala Lumpur",
    city: "Kuala Lumpur",
    suburb: null,
    device_os: null,
    ip_address: null,
    gender: null,
    status: "open",
    partner_id: null,
    partner_name: null,
    partner_phone: null,
    partner_photo: null,
    partner_vehicle: null,
    partner_plate: null,
    partner_rating: null,
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    accepted_at: null,
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancel_reason: null,
    ...overrides,
  };
}

describe("buildRestoreTarget (rider)", () => {
  it.each<RideRequestStatus>(["accepted", "arrived", "on_trip"])(
    "restores a %s request to the live tracking screen",
    (status) => {
      const target = buildRestoreTarget(
        makeRequest({
          status,
          partner_name: "Bob",
          partner_vehicle: "Perodua Myvi",
          partner_rating: 4.7,
        })
      );
      expect(target).not.toBeNull();
      expect(target!.pathname).toBe("/ride-tracking");
      expect(target!.params).toMatchObject({
        requestId: "req-1",
        restoreStatus: status,
        driverName: "Bob",
        driverVehicle: "Perodua Myvi",
        driverRating: "4.7",
        pickup: "Suria KLCC",
        destination: "Mid Valley",
      });
    }
  );

  it("restores an open request to the ride-confirm search screen", () => {
    const target = buildRestoreTarget(makeRequest({ status: "open" }));
    expect(target).not.toBeNull();
    expect(target!.pathname).toBe("/ride-confirm");
    expect(target!.params).toMatchObject({
      restoreRequestId: "req-1",
      restoreCreatedAt: "2026-07-01T10:00:00.000Z",
      fare: "18.5",
    });
  });

  it.each<RideRequestStatus>(["completed", "cancelled", "expired"])(
    "does not restore a %s request",
    (status) => {
      expect(buildRestoreTarget(makeRequest({ status }))).toBeNull();
    }
  );

  it("prefers the accepted offer over the original fare for the price", () => {
    const target = buildRestoreTarget(
      makeRequest({ status: "accepted", fare: 18.5, offered_fare: 25 })
    );
    expect(target!.params.price).toBe("25");
  });

  it("falls back through pickup_name → pickup_address → default label", () => {
    const noName = buildRestoreTarget(
      makeRequest({ status: "open", pickup_name: null })
    );
    expect(noName!.params.pickup).toBe("Jalan Ampang, KL");

    const nothing = buildRestoreTarget(
      makeRequest({
        status: "open",
        pickup_name: null,
        pickup_address: null,
        drop_name: null,
        drop_address: null,
      })
    );
    expect(nothing!.params.pickup).toBe("Current Location");
    expect(nothing!.params.destination).toBe("Destination");
  });

  it("uses safe driver defaults when partner details are missing", () => {
    const target = buildRestoreTarget(makeRequest({ status: "accepted" }));
    expect(target!.params.driverName).toBe("Driver");
    expect(target!.params.driverRating).toBe("5");
    expect(target!.params.driverVehicle).toBe("");
  });
});

describe("buildPartnerRestoreTarget (driver)", () => {
  it.each<RideRequestStatus>(["open", "completed", "cancelled", "expired"])(
    "does not restore a %s request",
    (status) => {
      expect(buildPartnerRestoreTarget(makeRequest({ status }))).toBeNull();
    }
  );

  it("resumes toPickup before the trip starts and toDestination once on_trip", () => {
    expect(
      buildPartnerRestoreTarget(makeRequest({ status: "accepted" }))!.params.initialPhase
    ).toBe("toPickup");
    expect(
      buildPartnerRestoreTarget(makeRequest({ status: "arrived" }))!.params.initialPhase
    ).toBe("toPickup");
    expect(
      buildPartnerRestoreTarget(makeRequest({ status: "on_trip" }))!.params.initialPhase
    ).toBe("toDestination");
  });

  it("targets the ride-running screen with the trip details", () => {
    const target = buildPartnerRestoreTarget(
      makeRequest({ status: "accepted", offered_fare: 30 })
    );
    expect(target!.pathname).toBe("/ride-running");
    expect(target!.params).toMatchObject({
      driverMode: "eHailing",
      requestId: "req-1",
      passengerName: "Alice",
      fare: "30",
      distance: "8.4",
      eta: "22",
    });
  });

  it("computes the distance to pickup from the accept checkpoint", () => {
    // Driver accepted ~0.1° of latitude south of the pickup → ~11.1 km.
    const target = buildPartnerRestoreTarget(
      makeRequest({
        status: "accepted",
        partner_accept_lat: 3.058,
        partner_accept_lng: 101.712,
      })
    );
    expect(target!.params.distanceToPickup).toBe("11.1");
    expect(target!.params.driverLat).toBe("3.058");
  });

  it("falls back to the pickup point (0.1 km floor) when there is no accept checkpoint", () => {
    const target = buildPartnerRestoreTarget(makeRequest({ status: "accepted" }));
    // Driver position defaults to the pickup itself → distance clamps to 0.1.
    expect(target!.params.driverLat).toBe("3.158");
    expect(target!.params.distanceToPickup).toBe("0.1");
  });

  it("uses the 0.5 km default when no coordinates are known at all", () => {
    const target = buildPartnerRestoreTarget(
      makeRequest({
        status: "accepted",
        pickup_lat: null,
        pickup_lng: null,
      })
    );
    expect(target!.params.distanceToPickup).toBe("0.5");
    expect(target!.params.driverLat).toBe("");
  });
});
