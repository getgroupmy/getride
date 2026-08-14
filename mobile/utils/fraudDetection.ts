/**
 * Pure fraud-signal detection over already-fetched rows from `user_sessions`,
 * `ride_requests`, `wallet_transactions` and `wallet_transfer_requests`.
 *
 * Every `detect*` function is a pure, side-effect-free scan: it takes plain
 * arrays (as returned by a Supabase `select("*")`) and thresholds, and
 * returns `FraudFinding[]`. Nothing here talks to the network — the admin
 * screen (`app/admin-trace-fraud.tsx`) owns fetching and simply calls
 * `runFraudScan`.
 */

export type FraudSeverity = "low" | "medium" | "high";

export type FraudCategory =
  | "multi_device_account"
  | "shared_device"
  | "ip_cluster"
  | "location_mismatch"
  | "implausible_trip"
  | "collusion_pair"
  | "excessive_cancellations"
  | "promotion_abuse";

export interface FraudFinding {
  id: string;
  category: FraudCategory;
  severity: FraudSeverity;
  title: string;
  description: string;
  /** Account keys / ride ids / device ids implicated, for drill-down. */
  subjects: string[];
  evidence: Record<string, unknown>;
}

export interface SessionSignal {
  user_id: string | null;
  phone: string | null;
  device_id: string | null;
  public_ip: string | null;
  captured_at: string;
  os_name?: string | null;
  device_model_name?: string | null;
}

export interface RideSignal {
  id: string;
  rider_id: string | null;
  rider_phone?: string | null;
  partner_id: string | null;
  partner_phone?: string | null;
  status: string;
  distance_km: number | null;
  duration_min: number | null;
  fare?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  partner_arrive_lat?: number | null;
  partner_arrive_lng?: number | null;
  partner_drop_lat?: number | null;
  partner_drop_lng?: number | null;
  user_drop_lat?: number | null;
  user_drop_lng?: number | null;
  cancel_reason?: string | null;
  cancel_requested_by?: string | null;
  created_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
}

export interface WalletTxSignal {
  id: string;
  user_id: string;
  wallet_type: string;
  kind: string;
  amount: number;
  created_at: string;
}

export interface TransferSignal {
  id: string;
  from_user_id: string;
  to_user_id: string;
  coins: number;
  status: string;
  created_at: string;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Account identity key: prefer the Supabase user id, fall back to phone. */
function accountKey(userId: string | null, phone: string | null): string | null {
  if (userId) return `uid:${userId}`;
  if (phone) return `phone:${phone}`;
  return null;
}

function severityByCount(count: number, mediumAt: number, highAt: number): FraudSeverity {
  if (count >= highAt) return "high";
  if (count >= mediumAt) return "medium";
  return "low";
}

/** Same account (uid/phone) signing in from several distinct physical devices. */
export function detectMultiDeviceAccounts(
  sessions: SessionSignal[],
  opts: { minDevices?: number } = {}
): FraudFinding[] {
  const minDevices = opts.minDevices ?? 2;
  const byAccount = new Map<string, { phone: string | null; devices: Set<string> }>();
  for (const s of sessions) {
    const key = accountKey(s.user_id, s.phone);
    if (!key || !s.device_id) continue;
    const entry = byAccount.get(key) ?? { phone: s.phone, devices: new Set<string>() };
    entry.devices.add(s.device_id);
    if (s.phone) entry.phone = s.phone;
    byAccount.set(key, entry);
  }
  const findings: FraudFinding[] = [];
  for (const [key, entry] of byAccount) {
    if (entry.devices.size < minDevices) continue;
    findings.push({
      id: `multi_device_account:${key}`,
      category: "multi_device_account",
      severity: severityByCount(entry.devices.size, 3, 5),
      title: `Account used on ${entry.devices.size} devices`,
      description: `${entry.phone ?? key} signed in from ${entry.devices.size} distinct devices.`,
      subjects: [key],
      evidence: { account: key, phone: entry.phone, deviceCount: entry.devices.size, devices: Array.from(entry.devices) },
    });
  }
  return findings;
}

/** Same physical device logging in as several distinct accounts. */
export function detectSharedDevices(
  sessions: SessionSignal[],
  opts: { minAccounts?: number } = {}
): FraudFinding[] {
  const minAccounts = opts.minAccounts ?? 2;
  const byDevice = new Map<string, Set<string>>();
  const phoneByAccount = new Map<string, string | null>();
  for (const s of sessions) {
    const key = accountKey(s.user_id, s.phone);
    if (!key || !s.device_id) continue;
    if (!phoneByAccount.has(key)) phoneByAccount.set(key, s.phone);
    const set = byDevice.get(s.device_id) ?? new Set<string>();
    set.add(key);
    byDevice.set(s.device_id, set);
  }
  const findings: FraudFinding[] = [];
  for (const [deviceId, accounts] of byDevice) {
    if (accounts.size < minAccounts) continue;
    const phones = Array.from(accounts).map((a) => phoneByAccount.get(a) ?? a);
    findings.push({
      id: `shared_device:${deviceId}`,
      category: "shared_device",
      severity: severityByCount(accounts.size, 3, 5),
      title: `Device used by ${accounts.size} accounts`,
      description: `Device ${deviceId} was used to sign in as ${accounts.size} different accounts (${phones.join(", ")}).`,
      subjects: Array.from(accounts),
      evidence: { device_id: deviceId, accountCount: accounts.size, accounts: phones },
    });
  }
  return findings;
}

/** Many distinct accounts sharing the same resolved public IP — device-farm signal. */
export function detectIpClusters(
  sessions: SessionSignal[],
  opts: { minAccounts?: number } = {}
): FraudFinding[] {
  const minAccounts = opts.minAccounts ?? 3;
  const byIp = new Map<string, Set<string>>();
  const phoneByAccount = new Map<string, string | null>();
  for (const s of sessions) {
    const key = accountKey(s.user_id, s.phone);
    if (!key || !s.public_ip) continue;
    if (!phoneByAccount.has(key)) phoneByAccount.set(key, s.phone);
    const set = byIp.get(s.public_ip) ?? new Set<string>();
    set.add(key);
    byIp.set(s.public_ip, set);
  }
  const findings: FraudFinding[] = [];
  for (const [ip, accounts] of byIp) {
    if (accounts.size < minAccounts) continue;
    const phones = Array.from(accounts).map((a) => phoneByAccount.get(a) ?? a);
    findings.push({
      id: `ip_cluster:${ip}`,
      category: "ip_cluster",
      severity: severityByCount(accounts.size, 4, 8),
      title: `${accounts.size} accounts from one IP`,
      description: `Public IP ${ip} was shared by ${accounts.size} different accounts (${phones.join(", ")}).`,
      subjects: Array.from(accounts),
      evidence: { public_ip: ip, accountCount: accounts.size, accounts: phones },
    });
  }
  return findings;
}

/**
 * Checkpoint GPS that doesn't match the declared pickup/drop — either side
 * spoofing location to fake a pickup or a drop-off.
 */
export function detectLocationMismatches(
  rides: RideSignal[],
  opts: { arriveThresholdKm?: number; dropThresholdKm?: number; dropAgreementKm?: number } = {}
): FraudFinding[] {
  const arriveThresholdKm = opts.arriveThresholdKm ?? 1.5;
  const dropThresholdKm = opts.dropThresholdKm ?? 2;
  const dropAgreementKm = opts.dropAgreementKm ?? 1.5;
  const findings: FraudFinding[] = [];

  for (const r of rides) {
    if (r.status !== "completed" && r.status !== "on_trip" && r.status !== "cancelled") continue;

    if (
      r.partner_arrive_lat != null &&
      r.partner_arrive_lng != null &&
      r.pickup_lat != null &&
      r.pickup_lng != null
    ) {
      const d = haversineKm(r.partner_arrive_lat, r.partner_arrive_lng, r.pickup_lat, r.pickup_lng);
      if (d >= arriveThresholdKm) {
        findings.push({
          id: `location_mismatch:arrive:${r.id}`,
          category: "location_mismatch",
          severity: severityByCount(Math.round(d), 3, 6),
          title: `Fake pickup on ride ${r.id.slice(0, 8)}`,
          description: `Partner marked "arrived" ${d.toFixed(1)} km from the declared pickup point.`,
          subjects: [r.id, r.partner_id ?? "", r.rider_id ?? ""].filter(Boolean),
          evidence: { ride_id: r.id, distance_km: Number(d.toFixed(2)), rider_id: r.rider_id, partner_id: r.partner_id },
        });
      }
    }

    if (
      r.status === "completed" &&
      r.partner_drop_lat != null &&
      r.partner_drop_lng != null &&
      r.drop_lat != null &&
      r.drop_lng != null
    ) {
      const d = haversineKm(r.partner_drop_lat, r.partner_drop_lng, r.drop_lat, r.drop_lng);
      if (d >= dropThresholdKm) {
        findings.push({
          id: `location_mismatch:drop:${r.id}`,
          category: "location_mismatch",
          severity: severityByCount(Math.round(d), 4, 8),
          title: `Fake drop-off on ride ${r.id.slice(0, 8)}`,
          description: `Trip was completed ${d.toFixed(1)} km from the declared drop-off address.`,
          subjects: [r.id, r.partner_id ?? "", r.rider_id ?? ""].filter(Boolean),
          evidence: { ride_id: r.id, distance_km: Number(d.toFixed(2)), rider_id: r.rider_id, partner_id: r.partner_id },
        });
      }
    }

    if (
      r.status === "completed" &&
      r.partner_drop_lat != null &&
      r.partner_drop_lng != null &&
      r.user_drop_lat != null &&
      r.user_drop_lng != null
    ) {
      const d = haversineKm(r.partner_drop_lat, r.partner_drop_lng, r.user_drop_lat, r.user_drop_lng);
      if (d >= dropAgreementKm) {
        findings.push({
          id: `location_mismatch:sides:${r.id}`,
          category: "location_mismatch",
          severity: severityByCount(Math.round(d), 3, 6),
          title: `Rider/partner drop-off disagree on ride ${r.id.slice(0, 8)}`,
          description: `Rider and partner GPS at drop-off were ${d.toFixed(1)} km apart — one side's location looks spoofed.`,
          subjects: [r.id, r.partner_id ?? "", r.rider_id ?? ""].filter(Boolean),
          evidence: { ride_id: r.id, distance_km: Number(d.toFixed(2)), rider_id: r.rider_id, partner_id: r.partner_id },
        });
      }
    }
  }

  return findings;
}

/** Trips whose declared distance/duration imply an impossible average speed. */
export function detectImplausibleTrips(
  rides: RideSignal[],
  opts: { maxSpeedKmh?: number; minDistanceKm?: number } = {}
): FraudFinding[] {
  const maxSpeedKmh = opts.maxSpeedKmh ?? 140;
  const minDistanceKm = opts.minDistanceKm ?? 1;
  const findings: FraudFinding[] = [];

  for (const r of rides) {
    if (r.status !== "completed") continue;
    if (r.distance_km == null || r.duration_min == null) continue;
    if (r.distance_km < minDistanceKm) continue;
    if (r.duration_min <= 0) {
      findings.push({
        id: `implausible_trip:zero_time:${r.id}`,
        category: "implausible_trip",
        severity: "high",
        title: `Zero-duration trip ${r.id.slice(0, 8)}`,
        description: `A ${r.distance_km.toFixed(1)} km trip was logged with 0 minutes of duration.`,
        subjects: [r.id, r.partner_id ?? "", r.rider_id ?? ""].filter(Boolean),
        evidence: { ride_id: r.id, distance_km: r.distance_km, duration_min: r.duration_min },
      });
      continue;
    }
    const impliedSpeed = r.distance_km / (r.duration_min / 60);
    if (impliedSpeed >= maxSpeedKmh) {
      findings.push({
        id: `implausible_trip:speed:${r.id}`,
        category: "implausible_trip",
        severity: severityByCount(Math.round(impliedSpeed / 40), 3, 5),
        title: `Implausible speed on trip ${r.id.slice(0, 8)}`,
        description: `${r.distance_km.toFixed(1)} km in ${r.duration_min} min implies ~${impliedSpeed.toFixed(0)} km/h.`,
        subjects: [r.id, r.partner_id ?? "", r.rider_id ?? ""].filter(Boolean),
        evidence: { ride_id: r.id, distance_km: r.distance_km, duration_min: r.duration_min, implied_speed_kmh: Number(impliedSpeed.toFixed(1)) },
      });
    }
  }

  return findings;
}

/**
 * A rider/partner pair completing an unusually large number of trips
 * together — a common way to farm ride-completion incentives or run up
 * fake fares between two colluding accounts.
 */
export function detectCollusionPairs(
  rides: RideSignal[],
  opts: { minTrips?: number } = {}
): FraudFinding[] {
  const minTrips = opts.minTrips ?? 5;
  const byPair = new Map<string, RideSignal[]>();
  for (const r of rides) {
    if (r.status !== "completed") continue;
    if (!r.rider_id || !r.partner_id) continue;
    const key = `${r.rider_id}::${r.partner_id}`;
    const list = byPair.get(key) ?? [];
    list.push(r);
    byPair.set(key, list);
  }
  const findings: FraudFinding[] = [];
  for (const [key, list] of byPair) {
    if (list.length < minTrips) continue;
    const [riderId, partnerId] = key.split("::");
    const totalFare = list.reduce((sum, r) => sum + (r.fare ?? 0), 0);
    findings.push({
      id: `collusion_pair:${key}`,
      category: "collusion_pair",
      severity: severityByCount(list.length, 8, 15),
      title: `Rider/partner pair rode together ${list.length} times`,
      description: `Rider ${r_(riderId)} and partner ${r_(partnerId)} completed ${list.length} trips together, totalling ${totalFare.toFixed(2)}.`,
      subjects: [riderId, partnerId, ...list.map((r) => r.id)],
      evidence: { rider_id: riderId, partner_id: partnerId, tripCount: list.length, totalFare: Number(totalFare.toFixed(2)) },
    });
  }
  return findings;
}

function r_(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** A rider or partner racking up an abnormal number of cancellations. */
export function detectExcessiveCancellations(
  rides: RideSignal[],
  opts: { minCancellations?: number; windowHours?: number } = {}
): FraudFinding[] {
  const minCancellations = opts.minCancellations ?? 5;
  const windowMs = (opts.windowHours ?? 24) * 60 * 60 * 1000;
  const cancelled = rides.filter((r) => r.status === "cancelled" && r.cancelled_at);
  const byActor = new Map<string, { role: "rider" | "partner"; times: number[] }>();

  for (const r of cancelled) {
    const t = new Date(r.cancelled_at as string).getTime();
    if (Number.isNaN(t)) continue;
    if (r.rider_id) {
      const key = `rider:${r.rider_id}`;
      const e = byActor.get(key) ?? { role: "rider" as const, times: [] };
      e.times.push(t);
      byActor.set(key, e);
    }
    if (r.partner_id) {
      const key = `partner:${r.partner_id}`;
      const e = byActor.get(key) ?? { role: "partner" as const, times: [] };
      e.times.push(t);
      byActor.set(key, e);
    }
  }

  const findings: FraudFinding[] = [];
  for (const [key, entry] of byActor) {
    const times = entry.times.slice().sort((a, b) => a - b);
    let maxInWindow = 1;
    let windowStartIdx = 0;
    for (let i = 0; i < times.length; i++) {
      while (times[i] - times[windowStartIdx] > windowMs) windowStartIdx++;
      maxInWindow = Math.max(maxInWindow, i - windowStartIdx + 1);
    }
    if (maxInWindow < minCancellations) continue;
    const [, actorId] = key.split(":");
    findings.push({
      id: `excessive_cancellations:${key}`,
      category: "excessive_cancellations",
      severity: severityByCount(maxInWindow, 8, 15),
      title: `${maxInWindow} cancellations by a ${entry.role} in ${opts.windowHours ?? 24}h`,
      description: `${entry.role === "rider" ? "Rider" : "Partner"} ${r_(actorId)} cancelled ${maxInWindow} rides within a ${opts.windowHours ?? 24}-hour window.`,
      subjects: [actorId],
      evidence: { actor_id: actorId, role: entry.role, cancellations: maxInWindow, windowHours: opts.windowHours ?? 24 },
    });
  }
  return findings;
}

const PROMO_KIND_PATTERN = /reward|bonus|referral|incentive|promo/i;

/**
 * Cross-references reward/bonus wallet transactions with the device/IP
 * clusters from session telemetry: several accounts on one device or IP all
 * collecting the same kind of promotional credit is a strong farming signal.
 */
export function detectPromotionAbuse(
  walletTx: WalletTxSignal[],
  sessions: SessionSignal[],
  opts: { minAccountsPerDevice?: number } = {}
): FraudFinding[] {
  const minAccountsPerDevice = opts.minAccountsPerDevice ?? 2;

  const deviceByAccount = new Map<string, Set<string>>();
  for (const s of sessions) {
    const key = accountKey(s.user_id, s.phone);
    if (!key || !s.device_id) continue;
    const set = deviceByAccount.get(key) ?? new Set<string>();
    set.add(s.device_id);
    deviceByAccount.set(key, set);
  }

  const promoTx = walletTx.filter((t) => PROMO_KIND_PATTERN.test(t.kind));
  const byDevice = new Map<string, { accounts: Set<string>; totalAmount: number; kinds: Set<string> }>();

  for (const t of promoTx) {
    const key = `uid:${t.user_id}`;
    const devices = deviceByAccount.get(key);
    if (!devices) continue;
    for (const deviceId of devices) {
      const e = byDevice.get(deviceId) ?? { accounts: new Set<string>(), totalAmount: 0, kinds: new Set<string>() };
      e.accounts.add(key);
      e.totalAmount += t.amount;
      e.kinds.add(t.kind);
      byDevice.set(deviceId, e);
    }
  }

  const findings: FraudFinding[] = [];
  for (const [deviceId, entry] of byDevice) {
    if (entry.accounts.size < minAccountsPerDevice) continue;
    findings.push({
      id: `promotion_abuse:${deviceId}`,
      category: "promotion_abuse",
      severity: severityByCount(entry.accounts.size, 3, 5),
      title: `Promo credit farmed on one device (${entry.accounts.size} accounts)`,
      description: `${entry.accounts.size} accounts on device ${deviceId} collected ${Array.from(entry.kinds).join(", ")} credit totalling ${entry.totalAmount.toFixed(2)}.`,
      subjects: Array.from(entry.accounts),
      evidence: {
        device_id: deviceId,
        accountCount: entry.accounts.size,
        totalAmount: Number(entry.totalAmount.toFixed(2)),
        kinds: Array.from(entry.kinds),
      },
    });
  }
  return findings;
}

/**
 * P2P coin transfers hopping in a tight circle between a small set of
 * accounts — a common wash-trading pattern for inflating GET.coin balances
 * or exploiting transfer-triggered rewards.
 */
export function detectTransferCircles(
  transfers: TransferSignal[],
  opts: { minTransfers?: number } = {}
): FraudFinding[] {
  const minTransfers = opts.minTransfers ?? 6;
  const accepted = transfers.filter((t) => t.status === "accepted");
  const byPair = new Map<string, TransferSignal[]>();
  for (const t of accepted) {
    const key = [t.from_user_id, t.to_user_id].sort().join("::");
    const list = byPair.get(key) ?? [];
    list.push(t);
    byPair.set(key, list);
  }
  const findings: FraudFinding[] = [];
  for (const [key, list] of byPair) {
    if (list.length < minTransfers) continue;
    const [a, b] = key.split("::");
    const totalCoins = list.reduce((sum, t) => sum + t.coins, 0);
    findings.push({
      id: `promotion_abuse:transfer_circle:${key}`,
      category: "promotion_abuse",
      severity: severityByCount(list.length, 10, 20),
      title: `${list.length} coin transfers between two accounts`,
      description: `${r_(a)} and ${r_(b)} exchanged ${list.length} accepted coin transfers totalling ${totalCoins.toFixed(2)} GC.`,
      subjects: [a, b],
      evidence: { accounts: [a, b], transferCount: list.length, totalCoins: Number(totalCoins.toFixed(2)) },
    });
  }
  return findings;
}

const SEVERITY_RANK: Record<FraudSeverity, number> = { high: 3, medium: 2, low: 1 };

export function runFraudScan(input: {
  sessions?: SessionSignal[];
  rides?: RideSignal[];
  walletTx?: WalletTxSignal[];
  transfers?: TransferSignal[];
}): FraudFinding[] {
  const sessions = input.sessions ?? [];
  const rides = input.rides ?? [];
  const walletTx = input.walletTx ?? [];
  const transfers = input.transfers ?? [];

  const findings: FraudFinding[] = [
    ...detectMultiDeviceAccounts(sessions),
    ...detectSharedDevices(sessions),
    ...detectIpClusters(sessions),
    ...detectLocationMismatches(rides),
    ...detectImplausibleTrips(rides),
    ...detectCollusionPairs(rides),
    ...detectExcessiveCancellations(rides),
    ...detectPromotionAbuse(walletTx, sessions),
    ...detectTransferCircles(transfers),
  ];

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
