/**
 * Device battery level, where the platform will actually tell us.
 *
 * The meter's status cluster carries a battery gauge because a dash-mounted
 * meter that dies mid-hire is the driver's problem. There is no battery native
 * module in this build, so the only real source is the browser's Battery
 * Status API on web. Everywhere else this reports `null` and the gauge hides —
 * an instrument that invents a reading is worse than one that admits it has
 * none, the same rule the CANBus transports follow.
 *
 * Adding `expo-battery` would light this up on native; the shape returned here
 * is what that would fill in, so only this file would change.
 */

import { useEffect, useState } from "react";
import { Platform } from "react-native";

export interface DeviceBattery {
  /** Charge from 0 to 1, or null when the platform will not say. */
  level: number | null;
  charging: boolean;
}

const UNKNOWN: DeviceBattery = { level: null, charging: false };

interface WebBatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

export function useDeviceBattery(): DeviceBattery {
  const [battery, setBattery] = useState<DeviceBattery>(UNKNOWN);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const nav = globalThis.navigator as
      | { getBattery?: () => Promise<WebBatteryManager> }
      | undefined;
    if (typeof nav?.getBattery !== "function") return;

    let cancelled = false;
    let manager: WebBatteryManager | null = null;
    const read = () => {
      if (cancelled || !manager) return;
      setBattery({
        level: Number.isFinite(manager.level) ? manager.level : null,
        charging: !!manager.charging,
      });
    };

    nav
      .getBattery()
      .then((m) => {
        if (cancelled) return;
        manager = m;
        read();
        m.addEventListener("levelchange", read);
        m.addEventListener("chargingchange", read);
      })
      .catch((e) => console.log("[battery] unavailable", e));

    return () => {
      cancelled = true;
      manager?.removeEventListener("levelchange", read);
      manager?.removeEventListener("chargingchange", read);
    };
  }, []);

  return battery;
}

export default useDeviceBattery;
