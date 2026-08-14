/**
 * useCanbusStatus — read-only "is the OBD-II reader linked?" for UI that must
 * not open a connection of its own (the side menu, badges, gates).
 *
 * It reads the shared registry `useCanbus` publishes into, so it costs nothing
 * and never competes with the screen that actually owns the dongle. Use
 * `useCanbus` instead when you need to connect, disconnect or read telemetry.
 */

import { useSyncExternalStore } from "react";
import {
  getCanbusLiveStatus,
  subscribeCanbusLiveStatus,
  type CanbusLiveStatus,
} from "@/utils/canbus/liveStatus";

export function useCanbusStatus(): CanbusLiveStatus {
  return useSyncExternalStore(
    subscribeCanbusLiveStatus,
    getCanbusLiveStatus,
    getCanbusLiveStatus,
  );
}
