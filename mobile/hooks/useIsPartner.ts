/**
 * useIsPartner — does the signed-in rider also operate as a partner (driver)?
 *
 * Used to reveal partner-only entries inside the ordinary user-side UI (e.g.
 * the OBD-II / CANBus reader row in Settings). The lookup is read-only: it
 * never creates the stub partner row that `findOrCreatePartner` would.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchPartnerForUser,
  isActivePartner,
  type PartnerProfileRow,
} from "@/utils/partnerOnboardingStore";

export interface UseIsPartnerResult {
  /** True once a partner record for this user has been confirmed. */
  isPartner: boolean;
  partner: PartnerProfileRow | null;
  /** True while the first lookup is in flight — render nothing partner-only. */
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useIsPartner(): UseIsPartnerResult {
  const { authState } = useAuth();
  const userId = authState.userId;
  const [partner, setPartner] = useState<PartnerProfileRow | null>(null);
  const [loading, setLoading] = useState<boolean>(!!userId);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setPartner(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const row = await fetchPartnerForUser(userId);
    if (!mountedRef.current) return;
    setPartner(row);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { isPartner: isActivePartner(partner), partner, loading, refresh };
}
