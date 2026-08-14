import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  fetchWalletBalances,
  subscribeWalletRealtime,
  type WalletBalances,
} from "@/utils/walletStore";

/**
 * The three balances, in one place.
 *
 * Balances appear on several screens and after every money action, so they are
 * held once and refreshed centrally — two screens must never show different
 * numbers for the same wallet.
 *
 * Clients can only *read* these tables (migration 0066); every balance-changing
 * operation goes through an owner-scoped SECURITY DEFINER RPC. So this context
 * never computes a balance — it re-reads the one the ledger reports, and the
 * action results that carry a fresh `balances` are applied directly rather than
 * refetched.
 */

const EMPTY: WalletBalances = {
  getWallet: 0,
  getCredit: 0,
  getCoin: 0,
  currency: "RM",
  source: "local",
};

export const [WalletProvider, useWallet] = createContextHook(() => {
  const { authState } = useAuth();
  const userId = authState.userId;

  const [balances, setBalances] = useState<WalletBalances>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setBalances(EMPTY);
      return;
    }
    setIsLoading(true);
    try {
      setBalances(await fetchWalletBalances(userId));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The ledger trigger moves balances, so a change can originate anywhere —
  // a commission charge on the driver's phone, an accepted coin transfer.
  useEffect(() => {
    if (!userId) return;
    return subscribeWalletRealtime(userId, () => {
      void refresh();
    });
  }, [userId, refresh]);

  /** Apply balances an action already returned, instead of a second round trip. */
  const apply = useCallback((next: WalletBalances | undefined) => {
    if (next) setBalances(next);
  }, []);

  return { balances, isLoading, refresh, apply };
});
