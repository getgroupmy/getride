import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import {
  AlwaysOnConfig,
  fetchAlwaysOnConfig,
  isRouteAlwaysOn,
  subscribeAlwaysOnConfig,
} from "@/utils/alwaysOnStore";
import { activateKeepAwake, deactivateKeepAwake } from "@/utils/keepAwake";

const KEEP_AWAKE_TAG = "get-ride-always-on";

/**
 * Global controller for the "Always ON" pages (Admin -> Settings -> Always ON).
 *
 * Mounted once at the app root. It loads the admin-configured set of pages on
 * which the screen must never sleep, keeps it live via a realtime subscription
 * (plus a refetch after any config change), and — whenever the active route is
 * one of those pages — holds an `expo-keep-awake` lock, releasing it the moment
 * the driver leaves. A single tagged lock is used so this never fights a lock a
 * screen might hold for its own reasons.
 *
 * Until an admin picks their own set the built-in defaults apply
 * (`partner-teksi`, `partner-ehailing`, `meter-digital`), so a taxi shift keeps
 * the console lit out of the box.
 */
export function useAlwaysOn(): void {
  const pathname = usePathname();
  const [routes, setRoutes] = useState<string[]>([]);
  // Track the lock we currently hold so we don't spam activate/deactivate.
  const heldRef = useRef<boolean>(false);

  // Load the config once, then keep it live via realtime + a refetch on change.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const config: AlwaysOnConfig = await fetchAlwaysOnConfig();
        if (!cancelled) setRoutes(config.routes);
      } catch (e) {
        console.log("[alwayson] load failed", e);
      }
    };
    void load();
    const unsubscribe = subscribeAlwaysOnConfig(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Apply / release the screen lock as the route or config changes.
  useEffect(() => {
    const shouldStayOn = isRouteAlwaysOn(pathname, routes);
    if (shouldStayOn && !heldRef.current) {
      heldRef.current = true;
      void activateKeepAwake(KEEP_AWAKE_TAG);
    } else if (!shouldStayOn && heldRef.current) {
      heldRef.current = false;
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }, [pathname, routes]);

  // Release the lock if the controller ever unmounts (app teardown).
  useEffect(() => {
    return () => {
      if (heldRef.current) {
        heldRef.current = false;
        void deactivateKeepAwake(KEEP_AWAKE_TAG);
      }
    };
  }, []);
}
