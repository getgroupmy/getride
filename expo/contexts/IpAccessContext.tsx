import { useCallback, useEffect, useState } from "react";
import createContextHook from "@nkzw/create-context-hook";
import {
  evaluateIp,
  getPublicIp,
  type IpAccessStatus,
} from "@/utils/ipAccessStore";

/**
 * Resolves the current device's public IP once on mount and evaluates it
 * against the admin-managed whitelist / blacklist. Consumers use this to:
 *  - allow whitelisted admins to skip the PIN (admin-login)
 *  - block blacklisted devices at login and request placement.
 */
export const [IpAccessProvider, useIpAccess] = createContextHook(() => {
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [status, setStatus] = useState<IpAccessStatus>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const ip = await getPublicIp(true);
      setCurrentIp(ip);
      const next = await evaluateIp(ip);
      setStatus(next);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isWhitelisted = status === "whitelist";
  const isBlacklisted = status === "blacklist";

  return {
    currentIp,
    status,
    isWhitelisted,
    isBlacklisted,
    isLoading,
    refresh,
  };
});
