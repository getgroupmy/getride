import { createSupabaseMock, findStep, type SupabaseMock } from "@/test-utils/supabaseMock";
import {
  missingColumnFromError,
  updateRideRequestStatus,
  cancelRideRequest,
  requestRideCancellation,
  declineRideCancellation,
  REQUEST_EXPIRY_MS,
  type RideRequestStatus,
} from "@/utils/rideRequestsStore";

jest.mock("@/utils/supabase", () => {
  let n = 0;
  return {
    isSupabaseConfigured: true,
    supabase: null,
    uuidv4: () => `test-uuid-${++n}`,
  };
});

const supabaseModule = jest.requireMock("@/utils/supabase") as {
  isSupabaseConfigured: boolean;
  supabase: unknown;
};

let sb: SupabaseMock;

beforeEach(() => {
  sb = createSupabaseMock();
  supabaseModule.supabase = sb.client;
  supabaseModule.isSupabaseConfigured = true;
});

const missingColumn = (column: string) => ({
  message: `Could not find the '${column}' column of 'ride_requests' in the schema cache`,
});

describe("missingColumnFromError", () => {
  it("extracts the column name from a PostgREST missing-column error", () => {
    expect(missingColumnFromError(missingColumn("cancel_reason").message)).toBe(
      "cancel_reason"
    );
    expect(
      missingColumnFromError(
        "Could not find the 'partner_live_lat' column of 'ride_requests' in the schema cache"
      )
    ).toBe("partner_live_lat");
  });

  it("returns null for unrelated errors", () => {
    expect(missingColumnFromError("permission denied for table ride_requests")).toBeNull();
    expect(missingColumnFromError("")).toBeNull();
    expect(missingColumnFromError("Could not find the table in the schema cache")).toBeNull();
  });
});

describe("updateRideRequestStatus", () => {
  it("stamps the matching timestamp column for each status transition", async () => {
    const cases: [RideRequestStatus, string][] = [
      ["arrived", "arrived_at"],
      ["on_trip", "started_at"],
      ["completed", "completed_at"],
      ["cancelled", "cancelled_at"],
    ];
    for (const [status, column] of cases) {
      sb.queueResult({ error: null });
      expect(await updateRideRequestStatus("req-1", status)).toBe(true);
      const query = sb.queries[sb.queries.length - 1];
      const patch = findStep(query, "update")!.args[0] as Record<string, unknown>;
      expect(patch.status).toBe(status);
      expect(typeof patch[column]).toBe("string");
      expect(findStep(query, "eq")!.args).toEqual(["id", "req-1"]);
    }
  });

  it("does not stamp extra timestamps when accepting", async () => {
    sb.queueResult({ error: null });
    await updateRideRequestStatus("req-1", "accepted");
    const patch = findStep(sb.queries[0], "update")!.args[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["status"]);
  });

  it("returns false on error or missing id/configuration", async () => {
    sb.queueResult({ error: { message: "boom" } });
    expect(await updateRideRequestStatus("req-1", "arrived")).toBe(false);

    expect(await updateRideRequestStatus("", "arrived")).toBe(false);

    supabaseModule.isSupabaseConfigured = false;
    expect(await updateRideRequestStatus("req-1", "arrived")).toBe(false);
  });
});

describe("cancelRideRequest — schema degradation", () => {
  it("cancels with the reason when the column exists", async () => {
    sb.queueResult({ error: null });
    expect(await cancelRideRequest("req-1", "Driver too far")).toBe(true);
    const patch = findStep(sb.queries[0], "update")!.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "cancelled", cancel_reason: "Driver too far" });
  });

  it("retries without cancel_reason when the live DB predates the migration", async () => {
    sb.queueResult({ error: missingColumn("cancel_reason") });
    sb.queueResult({ error: null });
    expect(await cancelRideRequest("req-1", "Driver too far")).toBe(true);

    expect(sb.queries).toHaveLength(2);
    const retryPatch = findStep(sb.queries[1], "update")!.args[0] as Record<string, unknown>;
    expect(retryPatch.cancel_reason).toBeUndefined();
    expect(retryPatch.status).toBe("cancelled");
  });

  it("does not loop on a missing column that is not in the patch", async () => {
    sb.queueResult({ error: missingColumn("some_other_column") });
    expect(await cancelRideRequest("req-1", "reason")).toBe(false);
    expect(sb.queries).toHaveLength(1);
  });

  it("fails cleanly on unrelated errors", async () => {
    sb.queueResult({ error: { message: "permission denied" } });
    expect(await cancelRideRequest("req-1")).toBe(false);
  });
});

describe("requestRideCancellation — driver-approval flow", () => {
  it("stamps cancel_requested_at/by scoped to active statuses", async () => {
    sb.queueResult({ error: null });
    expect(await requestRideCancellation("req-1", "rider", "Changed plans")).toBe(true);
    const query = sb.queries[0];
    const patch = findStep(query, "update")!.args[0] as Record<string, unknown>;
    expect(typeof patch.cancel_requested_at).toBe("string");
    expect(patch.cancel_requested_by).toBe("rider");
    expect(patch.cancel_reason).toBe("Changed plans");
    expect(findStep(query, "in")!.args).toEqual([
      "status",
      ["accepted", "arrived", "on_trip"],
    ]);
  });

  it("retries without cancel_reason when only that column is missing", async () => {
    sb.queueResult({ error: missingColumn("cancel_reason") });
    sb.queueResult({ error: null });
    expect(await requestRideCancellation("req-1", "rider", "Changed plans")).toBe(true);
    const retryPatch = findStep(sb.queries[1], "update")!.args[0] as Record<string, unknown>;
    expect(retryPatch.cancel_reason).toBeUndefined();
    expect(retryPatch.cancel_requested_by).toBe("rider");
  });

  it("falls back to a direct cancel when the approval columns don't exist", async () => {
    // The rider must not be left waiting for an approval that can never arrive.
    sb.queueResult({ error: missingColumn("cancel_requested_at") });
    sb.queueResult({ error: null }); // the direct cancelRideRequest update
    expect(await requestRideCancellation("req-1", "rider", "Changed plans")).toBe(true);

    const fallback = sb.queries[1];
    const patch = findStep(fallback, "update")!.args[0] as Record<string, unknown>;
    expect(patch.status).toBe("cancelled");
    expect(patch.cancel_reason).toBe("Changed plans");
  });
});

describe("declineRideCancellation", () => {
  it("clears the cancellation request", async () => {
    sb.queueResult({ error: null });
    expect(await declineRideCancellation("req-1")).toBe(true);
    const patch = findStep(sb.queries[0], "update")!.args[0] as Record<string, unknown>;
    expect(patch).toEqual({ cancel_requested_at: null, cancel_requested_by: null });
  });

  it("treats missing approval columns as success (nothing to clear)", async () => {
    sb.queueResult({ error: missingColumn("cancel_requested_at") });
    expect(await declineRideCancellation("req-1")).toBe(true);
  });

  it("fails on unrelated errors", async () => {
    sb.queueResult({ error: { message: "permission denied" } });
    expect(await declineRideCancellation("req-1")).toBe(false);
  });
});

describe("constants", () => {
  it("expires open requests after 7 minutes", () => {
    expect(REQUEST_EXPIRY_MS).toBe(7 * 60 * 1000);
  });
});
