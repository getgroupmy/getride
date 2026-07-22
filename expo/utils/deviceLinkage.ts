/**
 * Device-linkage analysis for fraud / duplicate-account detection.
 *
 * Every session row carries a stable per-device fingerprint (`device_id` —
 * ANDROID_ID on Android, identifierForVendor on iOS, a persisted UUID
 * elsewhere). When the SAME device_id shows up under two different accounts it
 * is a strong signal of multi-accounting (one person, many sign-ups) or a
 * shared/compromised device. These pure helpers turn raw session rows into
 * that linkage so the admin UI can flag it.
 */

export interface SessionIdentity {
  user_id: string | null;
  phone: string | null;
  device_id: string | null;
}

/**
 * Stable key identifying an account across sessions: prefer the authenticated
 * user id, else fall back to the phone number. Returns null for anonymous
 * sessions that can't be attributed to anyone.
 */
export function accountKey(s: {
  user_id: string | null;
  phone: string | null;
}): string | null {
  if (s.user_id) return s.user_id;
  if (s.phone) return `phone:${s.phone}`;
  return null;
}

export interface AccountLink {
  /** Other account keys seen on at least one device this account also used. */
  linkedAccounts: string[];
  /** device_ids used by this account that are ALSO used by another account. */
  sharedDevices: string[];
}

/**
 * Compute per-account device linkage from raw session rows.
 *
 * Two accounts are "linked" when the same `device_id` appears under both.
 * Only accounts that are linked to at least one OTHER account appear in the
 * returned map, so callers can treat presence in the map as "flagged".
 * Sessions with no `device_id` or no resolvable account are ignored, and an
 * account is never linked to itself.
 */
export function computeDeviceLinks(
  sessions: SessionIdentity[]
): Map<string, AccountLink> {
  const accountsByDevice = new Map<string, Set<string>>();
  const devicesByAccount = new Map<string, Set<string>>();

  for (const s of sessions) {
    const device = s.device_id;
    if (!device) continue;
    const acct = accountKey(s);
    if (!acct) continue;

    let accts = accountsByDevice.get(device);
    if (!accts) {
      accts = new Set<string>();
      accountsByDevice.set(device, accts);
    }
    accts.add(acct);

    let devs = devicesByAccount.get(acct);
    if (!devs) {
      devs = new Set<string>();
      devicesByAccount.set(acct, devs);
    }
    devs.add(device);
  }

  const result = new Map<string, AccountLink>();
  for (const [acct, devices] of devicesByAccount) {
    const linked = new Set<string>();
    const shared = new Set<string>();
    for (const device of devices) {
      const accts = accountsByDevice.get(device);
      if (!accts || accts.size < 2) continue;
      shared.add(device);
      for (const other of accts) {
        if (other !== acct) linked.add(other);
      }
    }
    if (linked.size > 0) {
      result.set(acct, {
        linkedAccounts: Array.from(linked).sort(),
        sharedDevices: Array.from(shared).sort(),
      });
    }
  }
  return result;
}
