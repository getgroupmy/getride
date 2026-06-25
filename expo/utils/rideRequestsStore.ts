import { Platform } from "react-native";
import * as Location from "expo-location";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";

/**
 * Ride requests data layer.
 *
 * A passenger creates a real ride request when searching for a driver. Online
 * partners subscribe to `open` requests in realtime, accept one (claiming it),
 * then progress it through arrived → on_trip → completed. The passenger watches
 * their own request row for the partner's acceptance and live status.
 *
 * RLS is permissive (matches the rest of this project), so the anon/auth client
 * can read and write directly.
 */

export type RideRequestStatus =
  | "open"
  | "accepted"
  | "arrived"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "expired";

export interface RideRequest {
  id: string;
  rider_id: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  rider_photo: string | null;
  rider_rating: number;
  service: string | null;
  payment_mode: string;
  pickup_name: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_name: string | null;
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  distance_km: number | null;
  duration_min: number | null;
  fare: number | null;
  currency: string;
  passengers: number;
  luggage: number;
  note: string | null;

  // Bidding (OfferMe)
  offer_me: boolean;
  offered_fare: number | null;

  // Fare breakdown
  ride_fare: number | null;
  toll_charges: number | null;
  other_charges: number | null;

  // Partner location checkpoints
  partner_accept_lat: number | null;
  partner_accept_lng: number | null;
  partner_arrive_lat: number | null;
  partner_arrive_lng: number | null;
  partner_drop_lat: number | null;
  partner_drop_lng: number | null;

  // User location checkpoints
  user_accept_lat: number | null;
  user_accept_lng: number | null;
  user_arrive_lat: number | null;
  user_arrive_lng: number | null;
  user_drop_lat: number | null;
  user_drop_lng: number | null;

  // Trip OTP
  otp: string | null;

  // Vehicle + address geography
  vehicle_id: string | null;
  full_address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;

  // Device / identity metadata
  device_os: string | null;
  ip_address: string | null;
  gender: string | null;

  status: RideRequestStatus;
  partner_id: string | null;
  partner_name: string | null;
  partner_phone: string | null;
  partner_photo: string | null;
  partner_vehicle: string | null;
  partner_plate: string | null;
  partner_rating: number | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface CreateRideRequestInput {
  riderId?: string | null;
  riderName?: string | null;
  riderPhone?: string | null;
  riderPhoto?: string | null;
  riderRating?: number;
  service?: string | null;
  paymentMode?: string;
  pickupName?: string | null;
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropName?: string | null;
  dropAddress?: string | null;
  dropLat?: number | null;
  dropLng?: number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  fare?: number | null;
  currency?: string;
  passengers?: number;
  luggage?: number;
  note?: string | null;

  // Bidding (OfferMe)
  offerMe?: boolean;
  offeredFare?: number | null;

  // Fare breakdown
  rideFare?: number | null;
  tollCharges?: number | null;
  otherCharges?: number | null;

  // Vehicle + address geography
  vehicleId?: string | null;
  fullAddress?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  suburb?: string | null;

  // Device / identity metadata
  deviceOs?: string | null;
  ipAddress?: string | null;
  gender?: string | null;

  // OTP (optional; can be generated server/client side)
  otp?: string | null;

  // User accept checkpoint (where the rider was when creating/confirming)
  userAcceptLat?: number | null;
  userAcceptLng?: number | null;
}

export interface PartnerAcceptInfo {
  partnerId?: string | null;
  partnerName?: string | null;
  partnerPhone?: string | null;
  partnerPhoto?: string | null;
  partnerVehicle?: string | null;
  partnerPlate?: string | null;
  partnerRating?: number | null;
  vehicleId?: string | null;
  /** Where the partner was when they accepted the request. */
  acceptLat?: number | null;
  acceptLng?: number | null;
}

/** A partner's fare offer on an OfferMe request. */
export interface PartnerOfferInput {
  offeredFare: number;
  tollCharges?: number | null;
  otherCharges?: number | null;
}

const TABLE = "ride_requests";

/** Device / location / identity metadata captured at request-creation time. */
export interface RequestMetadata {
  deviceOs: string | null;
  ipAddress: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  fullAddress: string | null;
  gender: string | null;
}

/**
 * Gathers the contextual metadata for a new ride request that the creating
 * screen doesn't already have on hand:
 * - `deviceOs`   — from React Native's `Platform`
 * - `ipAddress`  — public IP via ipify (best-effort)
 * - geography    — reverse-geocoded from the pickup coordinates
 * - `gender`     — read from the rider's `profiles` row
 *
 * Every lookup is independent and best-effort: a failure in one leaves that
 * field `null` rather than aborting the others, so request creation is never
 * blocked by metadata.
 */
export async function gatherRequestMetadata(opts: {
  lat?: number | null;
  lng?: number | null;
  userId?: string | null;
}): Promise<RequestMetadata> {
  const meta: RequestMetadata = {
    deviceOs: `${Platform.OS} ${String(Platform.Version)}`,
    ipAddress: null,
    country: null,
    state: null,
    city: null,
    suburb: null,
    fullAddress: null,
    gender: null,
  };

  const [ipResult, geoResult, genderResult] = await Promise.allSettled([
    fetchPublicIp(),
    reverseGeocode(opts.lat, opts.lng),
    fetchRiderGender(opts.userId),
  ]);

  if (ipResult.status === "fulfilled") meta.ipAddress = ipResult.value;
  if (geoResult.status === "fulfilled" && geoResult.value) {
    meta.country = geoResult.value.country;
    meta.state = geoResult.value.state;
    meta.city = geoResult.value.city;
    meta.suburb = geoResult.value.suburb;
    meta.fullAddress = geoResult.value.fullAddress;
  }
  if (genderResult.status === "fulfilled") meta.gender = genderResult.value;

  return meta;
}

async function fetchPublicIp(): Promise<string | null> {
  return lookupPublicIp("[rideRequests]");
}

/**
 * Best-effort public IP lookup with multiple fallback providers and a per-request
 * timeout. A single provider (e.g. ipify) is often unreachable on cellular or in
 * certain regions on a real TestFlight/App Store build, so we race through a few
 * well-known endpoints and return the first that responds.
 */
export async function lookupPublicIp(logTag: string): Promise<string | null> {
  const providers: { url: string; parse: (text: string) => string | null }[] = [
    {
      url: "https://api.ipify.org?format=json",
      parse: (t) => (JSON.parse(t) as { ip?: string })?.ip ?? null,
    },
    {
      url: "https://api64.ipify.org?format=json",
      parse: (t) => (JSON.parse(t) as { ip?: string })?.ip ?? null,
    },
    {
      url: "https://ipapi.co/json/",
      parse: (t) => (JSON.parse(t) as { ip?: string })?.ip ?? null,
    },
    { url: "https://icanhazip.com", parse: (t) => t.trim() || null },
  ];
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(provider.url, { signal: controller.signal });
      const text = await res.text();
      const ip = provider.parse(text);
      if (ip) return ip;
    } catch (e) {
      console.log(`${logTag} ip provider failed`, provider.url, e);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`${logTag} all ip providers failed`);
  return null;
}

async function reverseGeocode(
  lat?: number | null,
  lng?: number | null
): Promise<{
  country: string | null;
  state: string | null;
  city: string | null;
  suburb: string | null;
  fullAddress: string | null;
} | null> {
  if (lat == null || lng == null || Platform.OS === "web") return null;
  try {
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const p = places?.[0];
    if (!p) return null;
    const fullAddress =
      [p.name, p.street, p.district, p.city, p.region, p.postalCode, p.country]
        .filter(Boolean)
        .join(", ") || null;
    return {
      country: p.country ?? null,
      state: p.region ?? null,
      city: p.city ?? p.subregion ?? null,
      suburb: p.district ?? p.subregion ?? null,
      fullAddress,
    };
  } catch (e) {
    console.log("[rideRequests] reverse geocode failed", e);
    return null;
  }
}

async function fetchRiderGender(
  userId?: string | null
): Promise<string | null> {
  if (!userId || !isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("gender")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.log("[rideRequests] gender lookup failed", error.message);
      return null;
    }
    return (data as { gender?: string | null } | null)?.gender ?? null;
  } catch (e) {
    console.log("[rideRequests] gender lookup error", e);
    return null;
  }
}

/**
 * Creates a new open ride request and returns the inserted row. The client
 * pre-generates the id so the caller can track its own request even if the
 * realtime echo arrives first.
 */
export async function createRideRequest(
  input: CreateRideRequestInput
): Promise<RideRequest | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = uuidv4();
  const row = {
    id,
    rider_id: input.riderId ?? null,
    rider_name: input.riderName ?? null,
    rider_phone: input.riderPhone ?? null,
    rider_photo: input.riderPhoto ?? null,
    rider_rating: input.riderRating ?? 5,
    service: input.service ?? null,
    payment_mode: input.paymentMode ?? "Cash",
    pickup_name: input.pickupName ?? null,
    pickup_address: input.pickupAddress ?? null,
    pickup_lat: input.pickupLat ?? null,
    pickup_lng: input.pickupLng ?? null,
    drop_name: input.dropName ?? null,
    drop_address: input.dropAddress ?? null,
    drop_lat: input.dropLat ?? null,
    drop_lng: input.dropLng ?? null,
    distance_km: input.distanceKm ?? null,
    duration_min: input.durationMin ?? null,
    fare: input.fare ?? null,
    currency: input.currency ?? "MYR",
    passengers: input.passengers ?? 1,
    luggage: input.luggage ?? 0,
    note: input.note ?? null,
    offer_me: input.offerMe ?? false,
    offered_fare: input.offeredFare ?? null,
    ride_fare: input.rideFare ?? input.fare ?? null,
    toll_charges: input.tollCharges ?? null,
    other_charges: input.otherCharges ?? null,
    otp: input.otp ?? null,
    vehicle_id: input.vehicleId ?? null,
    full_address: input.fullAddress ?? null,
    country: input.country ?? null,
    state: input.state ?? null,
    city: input.city ?? null,
    suburb: input.suburb ?? null,
    device_os: input.deviceOs ?? null,
    ip_address: input.ipAddress ?? null,
    gender: input.gender ?? null,
    user_accept_lat: input.userAcceptLat ?? null,
    user_accept_lng: input.userAcceptLng ?? null,
    status: "open" as const,
  };
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert(row)
      .select("*")
      .single();
    if (error) {
      console.log("[rideRequests] create failed", error.message);
      return null;
    }
    return data as RideRequest;
  } catch (e) {
    console.log("[rideRequests] create error", e);
    return null;
  }
}

/**
 * Notifies online partners of a brand-new open request via the `send-push`
 * edge function (Expo push). When a partner's app is backgrounded or not on the
 * e-hailing screen, the OS shows a popup; foregrounded apps get a banner too.
 *
 * Format (per spec):
 *   Title: "New Request"
 *   Body:  "{CURRENCY} {FARE} , {Pickup Name}\n{Drop Name}"
 *
 * Best-effort: never throws, so request creation is unaffected if push fails.
 */
export async function notifyPartnersOfNewRequest(row: RideRequest): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const fare = row.fare != null ? String(Math.round(row.fare)) : "";
  const pickup = row.pickup_name ?? row.pickup_address ?? "Pickup";
  const drop = row.drop_name ?? row.drop_address ?? "Drop-off";
  const title = "New Request";
  const body = `${row.currency} ${fare} , ${pickup}\n${drop}`;
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: {
        title,
        body,
        audience: "partners",
        data: { type: "new_ride_request", requestId: row.id },
      },
    });
    if (error) {
      console.log("[rideRequests] notify partners failed", error.message);
    }
  } catch (e) {
    console.log("[rideRequests] notify partners error", e);
  }
}

/** Fetches the current open requests, newest first. */
export async function fetchOpenRequests(limit: number = 30): Promise<RideRequest[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.log("[rideRequests] fetchOpen failed", error.message);
      return [];
    }
    return (data ?? []) as RideRequest[];
  } catch (e) {
    console.log("[rideRequests] fetchOpen error", e);
    return [];
  }
}

/** Fetches a single ride request by id. */
export async function fetchRideRequest(id: string): Promise<RideRequest | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.log("[rideRequests] fetch failed", error.message);
      return null;
    }
    return (data as RideRequest) ?? null;
  } catch (e) {
    console.log("[rideRequests] fetch error", e);
    return null;
  }
}

/**
 * Atomically claims an open request for a partner. Returns the updated row, or
 * null if the request was already taken (the `eq('status','open')` guard fails)
 * or on error. Two partners racing to accept the same request: only the first
 * update matches `status = 'open'`, so the loser receives no row.
 */
export async function acceptRideRequest(
  id: string,
  partner: PartnerAcceptInfo
): Promise<RideRequest | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        partner_id: partner.partnerId ?? null,
        partner_name: partner.partnerName ?? null,
        partner_phone: partner.partnerPhone ?? null,
        partner_photo: partner.partnerPhoto ?? null,
        partner_vehicle: partner.partnerVehicle ?? null,
        partner_plate: partner.partnerPlate ?? null,
        partner_rating: partner.partnerRating ?? null,
        vehicle_id: partner.vehicleId ?? null,
        partner_accept_lat: partner.acceptLat ?? null,
        partner_accept_lng: partner.acceptLng ?? null,
      })
      .eq("id", id)
      .eq("status", "open")
      .select("*")
      .maybeSingle();
    if (error) {
      console.log("[rideRequests] accept failed", error.message);
      return null;
    }
    return (data as RideRequest) ?? null;
  } catch (e) {
    console.log("[rideRequests] accept error", e);
    return null;
  }
}

/**
 * Records a partner's fare offer on an OfferMe request. Keeps the request `open`
 * so the passenger can review and accept it, while attaching the partner's
 * proposed fare, optional charge breakdown, partner identity, and the live
 * lat-lng where the partner submitted the offer. Returns the updated row, or
 * null if the request is no longer open / on error.
 */
export async function submitRideOffer(
  id: string,
  offer: PartnerOfferInput,
  partner: PartnerAcceptInfo
): Promise<RideRequest | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        offered_fare: offer.offeredFare,
        toll_charges: offer.tollCharges ?? null,
        other_charges: offer.otherCharges ?? null,
        partner_id: partner.partnerId ?? null,
        partner_name: partner.partnerName ?? null,
        partner_phone: partner.partnerPhone ?? null,
        partner_photo: partner.partnerPhoto ?? null,
        partner_vehicle: partner.partnerVehicle ?? null,
        partner_plate: partner.partnerPlate ?? null,
        partner_rating: partner.partnerRating ?? null,
        vehicle_id: partner.vehicleId ?? null,
        partner_accept_lat: partner.acceptLat ?? null,
        partner_accept_lng: partner.acceptLng ?? null,
      })
      .eq("id", id)
      .eq("status", "open")
      .select("*")
      .maybeSingle();
    if (error) {
      console.log("[rideRequests] submit offer failed", error.message);
      return null;
    }
    return (data as RideRequest) ?? null;
  } catch (e) {
    console.log("[rideRequests] submit offer error", e);
    return null;
  }
}

/**
 * Updates the passenger's requested fare on an open request when they raise their
 * offer while searching. Clears any prior partner counter-offer (`offered_fare`
 * and partner identity) so the bid re-opens — partners then see the request again
 * with the higher fare. Returns the updated row, or null if no longer open / on error.
 */
export async function raiseRideRequestFare(
  id: string,
  fare: number
): Promise<RideRequest | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        fare,
        offered_fare: null,
        partner_id: null,
        partner_name: null,
        partner_phone: null,
        partner_photo: null,
        partner_vehicle: null,
        partner_plate: null,
        partner_rating: null,
      })
      .eq("id", id)
      .eq("status", "open")
      .select("*")
      .maybeSingle();
    if (error) {
      console.log("[rideRequests] raise fare failed", error.message);
      return null;
    }
    return (data as RideRequest) ?? null;
  } catch (e) {
    console.log("[rideRequests] raise fare error", e);
    return null;
  }
}

/**
 * Records the partner's live lat-lng at a trip checkpoint:
 * - `accept` — where the partner was when claiming the request
 * - `arrive` — where the partner was when reaching the pickup
 * - `drop`   — where the partner was when completing the trip
 * Best-effort: never throws, so trip progress is unaffected if it fails.
 */
export async function recordPartnerCheckpoint(
  id: string,
  checkpoint: "accept" | "arrive" | "drop",
  lat: number | null,
  lng: number | null
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  if (lat == null || lng == null) return false;
  const patch: Record<string, unknown> = {
    [`partner_${checkpoint}_lat`]: lat,
    [`partner_${checkpoint}_lng`]: lng,
  };
  try {
    const { error } = await supabase.from(TABLE).update(patch).eq("id", id);
    if (error) {
      console.log("[rideRequests] checkpoint update failed", checkpoint, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[rideRequests] checkpoint update error", checkpoint, e);
    return false;
  }
}

/** Updates the lifecycle status (arrived / on_trip / completed). */
export async function updateRideRequestStatus(
  id: string,
  status: RideRequestStatus
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  const patch: Record<string, unknown> = { status };
  if (status === "arrived") patch.arrived_at = new Date().toISOString();
  if (status === "on_trip") patch.started_at = new Date().toISOString();
  if (status === "completed") patch.completed_at = new Date().toISOString();
  if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
  try {
    const { error } = await supabase.from(TABLE).update(patch).eq("id", id);
    if (error) {
      console.log("[rideRequests] status update failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[rideRequests] status update error", e);
    return false;
  }
}

/** Marks an open/accepted request cancelled (passenger cancels). */
export async function cancelRideRequest(id: string): Promise<boolean> {
  return updateRideRequestStatus(id, "cancelled");
}

/** Marks the trip completed. */
export async function completeRideRequest(id: string): Promise<boolean> {
  return updateRideRequestStatus(id, "completed");
}

/**
 * Subscribes to open ride requests for the partner queue. Fires `onChange`
 * whenever a request is inserted or its status changes, so the queue can add
 * new open requests and drop ones that got taken/cancelled. Returns an
 * unsubscribe function.
 */
export function subscribeToOpenRequests(
  onChange: (row: RideRequest, event: "INSERT" | "UPDATE" | "DELETE") => void
): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channelName = `ride_requests_open_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE },
      (payload) => {
        try {
          const row = (payload.new ?? payload.old) as RideRequest;
          if (!row) return;
          onChange(row, payload.eventType as "INSERT" | "UPDATE" | "DELETE");
        } catch (e) {
          console.log("[rideRequests] open subscription payload error", e);
        }
      }
    )
    .subscribe();
  return () => {
    void supabase?.removeChannel(channel);
  };
}

/**
 * Subscribes to a single ride request (passenger watching their own request).
 * Returns an unsubscribe function.
 */
export function subscribeToRideRequest(
  id: string,
  onChange: (row: RideRequest) => void
): () => void {
  if (!isSupabaseConfigured || !supabase || !id) return () => {};
  const channelName = `ride_request_${id}_${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: TABLE, filter: `id=eq.${id}` },
      (payload) => {
        try {
          const row = payload.new as RideRequest;
          if (row) onChange(row);
        } catch (e) {
          console.log("[rideRequests] single subscription payload error", e);
        }
      }
    )
    .subscribe();
  return () => {
    void supabase?.removeChannel(channel);
  };
}
