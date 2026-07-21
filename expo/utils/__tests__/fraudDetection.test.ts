import {
  detectCollusionPairs,
  detectExcessiveCancellations,
  detectImplausibleTrips,
  detectIpClusters,
  detectLocationMismatches,
  detectMultiDeviceAccounts,
  detectPromotionAbuse,
  detectSharedDevices,
  detectTransferCircles,
  haversineKm,
  runFraudScan,
  type RideSignal,
  type SessionSignal,
  type TransferSignal,
  type WalletTxSignal,
} from "@/utils/fraudDetection";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(3.139, 101.6869, 3.139, 101.6869)).toBe(0);
  });

  it("computes a sane distance between two known points", () => {
    // Kuala Lumpur city centre to KLIA — roughly 45-55 km as the crow flies.
    const d = haversineKm(3.139, 101.6869, 2.7456, 101.7099);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(60);
  });
});

describe("detectMultiDeviceAccounts", () => {
  it("flags an account seen on 3+ distinct devices", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: "+60111", device_id: "dA", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u1", phone: "+60111", device_id: "dB", public_ip: null, captured_at: "2026-01-02T00:00:00Z" },
      { user_id: "u1", phone: "+60111", device_id: "dC", public_ip: null, captured_at: "2026-01-03T00:00:00Z" },
    ];
    const findings = detectMultiDeviceAccounts(sessions);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("multi_device_account");
    expect(findings[0].evidence.deviceCount).toBe(3);
  });

  it("does not flag a single-device account", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: "+60111", device_id: "dA", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u1", phone: "+60111", device_id: "dA", public_ip: null, captured_at: "2026-01-02T00:00:00Z" },
    ];
    expect(detectMultiDeviceAccounts(sessions)).toHaveLength(0);
  });

  it("respects a custom minDevices threshold", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: null, device_id: "dA", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u1", phone: null, device_id: "dB", public_ip: null, captured_at: "2026-01-02T00:00:00Z" },
    ];
    expect(detectMultiDeviceAccounts(sessions, { minDevices: 2 })).toHaveLength(1);
    expect(detectMultiDeviceAccounts(sessions, { minDevices: 3 })).toHaveLength(0);
  });
});

describe("detectSharedDevices", () => {
  it("flags a device used by several accounts", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: "+60111", device_id: "dShared", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", phone: "+60222", device_id: "dShared", public_ip: null, captured_at: "2026-01-02T00:00:00Z" },
      { user_id: "u3", phone: "+60333", device_id: "dShared", public_ip: null, captured_at: "2026-01-03T00:00:00Z" },
    ];
    const findings = detectSharedDevices(sessions);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("shared_device");
    expect(findings[0].subjects).toEqual(expect.arrayContaining(["uid:u1", "uid:u2", "uid:u3"]));
  });

  it("ignores rows with no device id", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: null, device_id: null, public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", phone: null, device_id: null, public_ip: null, captured_at: "2026-01-02T00:00:00Z" },
    ];
    expect(detectSharedDevices(sessions)).toHaveLength(0);
  });
});

describe("detectIpClusters", () => {
  it("flags an IP shared by at least the threshold number of accounts", () => {
    const sessions: SessionSignal[] = ["u1", "u2", "u3"].map((u, i) => ({
      user_id: u,
      phone: `+601${i}`,
      device_id: `d${i}`,
      public_ip: "1.2.3.4",
      captured_at: "2026-01-01T00:00:00Z",
    }));
    expect(detectIpClusters(sessions, { minAccounts: 3 })).toHaveLength(1);
    expect(detectIpClusters(sessions, { minAccounts: 4 })).toHaveLength(0);
  });
});

function ride(overrides: Partial<RideSignal>): RideSignal {
  return {
    id: "ride-1",
    rider_id: "rider-1",
    partner_id: "partner-1",
    status: "completed",
    distance_km: 5,
    duration_min: 10,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:20:00Z",
    ...overrides,
  };
}

describe("detectLocationMismatches", () => {
  it("flags a partner marking arrived far from the declared pickup", () => {
    const rides: RideSignal[] = [
      ride({
        pickup_lat: 3.139,
        pickup_lng: 101.6869,
        partner_arrive_lat: 3.2,
        partner_arrive_lng: 101.75,
      }),
    ];
    const findings = detectLocationMismatches(rides);
    expect(findings.some((f) => f.id.startsWith("location_mismatch:arrive"))).toBe(true);
  });

  it("flags a trip completed far from the declared drop-off", () => {
    const rides: RideSignal[] = [
      ride({
        drop_lat: 3.139,
        drop_lng: 101.6869,
        partner_drop_lat: 3.3,
        partner_drop_lng: 101.9,
      }),
    ];
    const findings = detectLocationMismatches(rides);
    expect(findings.some((f) => f.id.startsWith("location_mismatch:drop"))).toBe(true);
  });

  it("flags rider/partner GPS disagreement at drop-off", () => {
    const rides: RideSignal[] = [
      ride({
        partner_drop_lat: 3.139,
        partner_drop_lng: 101.6869,
        user_drop_lat: 3.25,
        user_drop_lng: 101.8,
      }),
    ];
    const findings = detectLocationMismatches(rides);
    expect(findings.some((f) => f.id.startsWith("location_mismatch:sides"))).toBe(true);
  });

  it("does not flag closely matching checkpoints", () => {
    const rides: RideSignal[] = [
      ride({
        pickup_lat: 3.139,
        pickup_lng: 101.6869,
        partner_arrive_lat: 3.1391,
        partner_arrive_lng: 101.687,
        drop_lat: 3.15,
        drop_lng: 101.7,
        partner_drop_lat: 3.1501,
        partner_drop_lng: 101.7001,
        user_drop_lat: 3.1502,
        user_drop_lng: 101.7002,
      }),
    ];
    expect(detectLocationMismatches(rides)).toHaveLength(0);
  });

  it("ignores open/accepted rides with no checkpoint data yet", () => {
    const rides: RideSignal[] = [ride({ status: "open" })];
    expect(detectLocationMismatches(rides)).toHaveLength(0);
  });
});

describe("detectImplausibleTrips", () => {
  it("flags a zero-duration trip with real distance", () => {
    const findings = detectImplausibleTrips([ride({ distance_km: 8, duration_min: 0 })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toContain("zero_time");
  });

  it("flags a trip implying an impossible average speed", () => {
    // 100 km in 5 minutes => 1200 km/h.
    const findings = detectImplausibleTrips([ride({ distance_km: 100, duration_min: 5 })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toContain("speed");
  });

  it("does not flag a normal-paced trip", () => {
    const findings = detectImplausibleTrips([ride({ distance_km: 10, duration_min: 15 })]);
    expect(findings).toHaveLength(0);
  });

  it("ignores non-completed rides", () => {
    const findings = detectImplausibleTrips([ride({ status: "on_trip", distance_km: 100, duration_min: 1 })]);
    expect(findings).toHaveLength(0);
  });
});

describe("detectCollusionPairs", () => {
  it("flags a rider/partner pair completing many trips together", () => {
    const rides: RideSignal[] = Array.from({ length: 6 }, (_, i) =>
      ride({ id: `ride-${i}`, fare: 20 })
    );
    const findings = detectCollusionPairs(rides, { minTrips: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.tripCount).toBe(6);
    expect(findings[0].evidence.totalFare).toBe(120);
  });

  it("does not flag pairs below the threshold", () => {
    const rides: RideSignal[] = Array.from({ length: 3 }, (_, i) => ride({ id: `ride-${i}` }));
    expect(detectCollusionPairs(rides, { minTrips: 5 })).toHaveLength(0);
  });
});

describe("detectExcessiveCancellations", () => {
  it("flags a rider cancelling many rides within the time window", () => {
    const rides: RideSignal[] = Array.from({ length: 6 }, (_, i) =>
      ride({
        id: `ride-${i}`,
        status: "cancelled",
        cancelled_at: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
      })
    );
    const findings = detectExcessiveCancellations(rides, { minCancellations: 5, windowHours: 24 });
    expect(findings.some((f) => f.evidence.role === "rider")).toBe(true);
  });

  it("does not flag cancellations spread far apart in time", () => {
    const rides: RideSignal[] = Array.from({ length: 6 }, (_, i) =>
      ride({
        id: `ride-${i}`,
        status: "cancelled",
        cancelled_at: new Date(Date.UTC(2026, i, 1)).toISOString(),
      })
    );
    const findings = detectExcessiveCancellations(rides, { minCancellations: 5, windowHours: 24 });
    expect(findings).toHaveLength(0);
  });
});

describe("detectPromotionAbuse", () => {
  it("flags several accounts on one device collecting reward credit", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: "+60111", device_id: "dShared", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", phone: "+60222", device_id: "dShared", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
    ];
    const walletTx: WalletTxSignal[] = [
      { id: "t1", user_id: "u1", wallet_type: "get_coin", kind: "reward", amount: 10, created_at: "2026-01-01T00:00:00Z" },
      { id: "t2", user_id: "u2", wallet_type: "get_coin", kind: "reward", amount: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    const findings = detectPromotionAbuse(walletTx, sessions);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.accountCount).toBe(2);
  });

  it("ignores non-promotional transaction kinds", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: null, device_id: "dShared", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", phone: null, device_id: "dShared", public_ip: null, captured_at: "2026-01-01T00:00:00Z" },
    ];
    const walletTx: WalletTxSignal[] = [
      { id: "t1", user_id: "u1", wallet_type: "get_wallet", kind: "topup", amount: 10, created_at: "2026-01-01T00:00:00Z" },
      { id: "t2", user_id: "u2", wallet_type: "get_wallet", kind: "topup", amount: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(detectPromotionAbuse(walletTx, sessions)).toHaveLength(0);
  });
});

describe("detectTransferCircles", () => {
  it("flags two accounts exchanging many accepted coin transfers", () => {
    const transfers: TransferSignal[] = Array.from({ length: 7 }, (_, i) => ({
      id: `xfer-${i}`,
      from_user_id: i % 2 === 0 ? "a" : "b",
      to_user_id: i % 2 === 0 ? "b" : "a",
      coins: 5,
      status: "accepted",
      created_at: "2026-01-01T00:00:00Z",
    }));
    const findings = detectTransferCircles(transfers, { minTransfers: 6 });
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.transferCount).toBe(7);
  });

  it("ignores pending/declined transfers", () => {
    const transfers: TransferSignal[] = Array.from({ length: 7 }, (_, i) => ({
      id: `xfer-${i}`,
      from_user_id: "a",
      to_user_id: "b",
      coins: 5,
      status: "pending",
      created_at: "2026-01-01T00:00:00Z",
    }));
    expect(detectTransferCircles(transfers, { minTransfers: 6 })).toHaveLength(0);
  });
});

describe("runFraudScan", () => {
  it("combines all detectors and sorts by severity", () => {
    const sessions: SessionSignal[] = [
      { user_id: "u1", phone: "+60111", device_id: "dShared", public_ip: "1.1.1.1", captured_at: "2026-01-01T00:00:00Z" },
      { user_id: "u2", phone: "+60222", device_id: "dShared", public_ip: "1.1.1.1", captured_at: "2026-01-01T00:00:00Z" },
    ];
    const rides: RideSignal[] = [ride({ distance_km: 8, duration_min: 0 })];
    const findings = runFraudScan({ sessions, rides });
    expect(findings.length).toBeGreaterThan(0);
    for (let i = 1; i < findings.length; i++) {
      const rank = { high: 3, medium: 2, low: 1 } as const;
      expect(rank[findings[i - 1].severity]).toBeGreaterThanOrEqual(rank[findings[i].severity]);
    }
  });

  it("returns no findings for clean, empty input", () => {
    expect(runFraudScan({})).toHaveLength(0);
  });
});
