import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  computeFirstVehicleStep,
  type VehicleRow,
} from "@/utils/vehicleOnboardingStore";

/** Aggregated row used by the vehicle picker. */
export interface AssignableVehicle {
  vehicle: VehicleRow;
  /** How the user is linked to the vehicle. */
  role: "owner" | "driver" | "co-driver";
  /** Is the vehicle currently in an active session? */
  inUseByOther: boolean;
  /** True when the current user is the one driving it now. */
  inUseByMe: boolean;
  /** Free-form status label shown in the UI. */
  statusLabel:
    | "Available"
    | "In use by you"
    | "In use"
    | "Pending review"
    | "Incomplete"
    | "Contact Admin"
    | "Offline";
  /** Whether the user can pick this vehicle right now. */
  selectable: boolean;
  /** True when onboarding wasn't finished yet — tapping should resume the flow. */
  incomplete: boolean;
}

interface ActiveSessionRow {
  vehicle_id: string;
  user_id: string;
  status: string;
}

const VEHICLE_TABLE = "vehicle" as const;

type ApprovalBucket = "approved" | "pending" | "blocked";

/** Vehicle status/permit values that mean the record is locked and the user
 *  needs to contact an admin (cannot self-serve). */
const BLOCKED_STATES = new Set<string>(["blocked", "deleted", "rejected"]);

/** Status/permit values that indicate the vehicle is still awaiting admin
 *  review/approval — driver can view status but cannot use yet. */
const PENDING_STATES = new Set<string>([
  "unapproved",
  "unapproved-docs",
  "permit-pending",
  "permit-non-verified",
  "permit-verified",
  "pending",
]);

const classifyVehicle = (v: VehicleRow): ApprovalBucket => {
  const s = String(v.status ?? "").toLowerCase().trim();
  const p = String(v.permit ?? "").toLowerCase().trim();
  if (BLOCKED_STATES.has(s) || BLOCKED_STATES.has(p)) return "blocked";
  if (!v.documents_ok) return "pending";
  if (PENDING_STATES.has(s) || PENDING_STATES.has(p)) return "pending";
  return "approved";
};

/**
 * Fetch every vehicle the given user is allowed to drive:
 *   - vehicles where `auth_user_id` is the user (added them themselves), AND
 *   - vehicles linked via `vehicle_user_assignment` with `is_active = true`.
 *
 * Each row is annotated with the user's role and the current active-session
 * status so the picker can show a coloured indicator.
 */
export async function fetchAssignableVehicles(
  userId: string
): Promise<AssignableVehicle[]> {
  if (!isSupabaseConfigured || !supabase || !userId) return [];

  try {
    // 1. Vehicles the user directly owns / added.
    const ownedReq = supabase
      .from(VEHICLE_TABLE)
      .select("*")
      .eq("auth_user_id", userId);

    // 2. Active assignments (driver / co-driver).
    const assignedReq = supabase
      .from("vehicle_user_assignment")
      .select("vehicle_id, role")
      .eq("user_id", userId)
      .eq("is_active", true);

    const [ownedRes, assignedRes] = await Promise.all([ownedReq, assignedReq]);

    if (ownedRes.error) {
      console.log(
        "[vehicleAssignmentStore] owned fetch error",
        ownedRes.error.message
      );
    }
    if (assignedRes.error) {
      // Table may not exist yet (migration 0031 not applied) — degrade gracefully.
      console.log(
        "[vehicleAssignmentStore] assignment fetch error",
        assignedRes.error.message
      );
    }

    const owned = (ownedRes.data as VehicleRow[] | null) ?? [];
    const assignments =
      ((assignedRes.data as { vehicle_id: string; role: string }[] | null) ??
        []);

    // 3. Pull the assigned vehicle rows that we don't already have from owned.
    const ownedIds = new Set(owned.map((v) => v.id));
    const assignedIds = assignments
      .map((a) => a.vehicle_id)
      .filter((id) => !ownedIds.has(id));

    let assignedRows: VehicleRow[] = [];
    if (assignedIds.length > 0) {
      const { data, error } = await supabase
        .from(VEHICLE_TABLE)
        .select("*")
        .in("id", assignedIds);
      if (error) {
        console.log(
          "[vehicleAssignmentStore] assigned vehicles fetch error",
          error.message
        );
      } else {
        assignedRows = (data as VehicleRow[] | null) ?? [];
      }
    }

    const all = [...owned, ...assignedRows];
    if (all.length === 0) return [];

    // 4. Live sessions for these vehicles.
    let sessions: ActiveSessionRow[] = [];
    try {
      const { data, error } = await supabase
        .from("vehicle_active_session")
        .select("vehicle_id, user_id, status")
        .in(
          "vehicle_id",
          all.map((v) => v.id)
        );
      if (error) {
        console.log(
          "[vehicleAssignmentStore] sessions fetch error",
          error.message
        );
      } else {
        sessions = (data as ActiveSessionRow[] | null) ?? [];
      }
    } catch (e) {
      console.log("[vehicleAssignmentStore] sessions threw", e);
    }
    const sessionByVehicle = new Map<string, ActiveSessionRow>();
    for (const s of sessions) sessionByVehicle.set(s.vehicle_id, s);

    // 5. Roles by vehicle id (owner overrides assignment role).
    const roleByVehicle = new Map<string, AssignableVehicle["role"]>();
    for (const a of assignments) {
      const r = (a.role === "owner" || a.role === "co-driver"
        ? a.role
        : "driver") as AssignableVehicle["role"];
      roleByVehicle.set(a.vehicle_id, r);
    }
    for (const v of owned) roleByVehicle.set(v.id, "owner");

    return all.map<AssignableVehicle>((v) => {
      const role = roleByVehicle.get(v.id) ?? "driver";
      const sess = sessionByVehicle.get(v.id) ?? null;
      const inUseByMe = !!sess && sess.user_id === userId;
      const inUseByOther = !!sess && sess.user_id !== userId;
      const bucket = classifyVehicle(v);
      const incomplete = computeFirstVehicleStep(v) !== "done";

      let statusLabel: AssignableVehicle["statusLabel"] = "Available";
      let selectable = false;
      if (bucket === "blocked") {
        statusLabel = "Contact Admin";
        selectable = false;
      } else if (incomplete) {
        // Onboarding stopped mid-flow — tappable to resume from the
        // first incomplete step (handled by vehicle-onboarding screen).
        statusLabel = "Incomplete";
        selectable = false;
      } else if (bucket === "pending") {
        statusLabel = "Pending review";
        selectable = false;
      } else if (inUseByMe) {
        statusLabel = "In use by you";
        selectable = true;
      } else if (inUseByOther) {
        statusLabel = "In use";
        selectable = false;
      } else {
        statusLabel = "Available";
        selectable = true;
      }

      return {
        vehicle: v,
        role,
        inUseByOther,
        inUseByMe,
        statusLabel,
        selectable,
        incomplete,
      };
    });
  } catch (e) {
    console.log("[vehicleAssignmentStore] fetchAssignableVehicles threw", e);
    return [];
  }
}

/**
 * Atomically claim a vehicle via the `claim_vehicle` RPC.
 * Returns `{ ok: true }` on success or `{ ok: false, reason }` on failure.
 * `reason` matches the SQL exception name when possible (`not_assigned`,
 * `vehicle_in_use`, `user_busy`) so the caller can localise the message.
 */
export async function claimVehicle(
  vehicleId: string,
  userId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: "supabase_unconfigured" };
  }
  try {
    const { error } = await supabase.rpc("claim_vehicle", {
      p_vehicle_id: vehicleId,
      p_user_id: userId,
    });
    if (error) {
      const msg = error.message || "";
      const known = ["not_assigned", "vehicle_in_use", "user_busy"].find((k) =>
        msg.includes(k)
      );
      console.log("[vehicleAssignmentStore] claimVehicle error", msg);
      return { ok: false, reason: known ?? msg };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[vehicleAssignmentStore] claimVehicle threw", e);
    return { ok: false, reason: msg };
  }
}

export async function releaseVehicle(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !userId) return false;
  try {
    const { error } = await supabase.rpc("release_vehicle", { p_user_id: userId });
    if (error) {
      console.log("[vehicleAssignmentStore] releaseVehicle error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[vehicleAssignmentStore] releaseVehicle threw", e);
    return false;
  }
}
