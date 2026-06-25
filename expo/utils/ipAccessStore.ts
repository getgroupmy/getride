import { isSupabaseConfigured, supabase } from "@/utils/supabase";

/** A single admin-managed IP rule. */
export interface IpAccessRule {
  id: string;
  ip_address: string;
  list_type: IpListType;
  label: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type IpListType = "whitelist" | "blacklist";

/**
 * Result of evaluating the current device's public IP against the rules.
 * Blacklist wins over whitelist when (improbably) an IP is in both lists.
 */
export type IpAccessStatus = IpListType | null;

let cachedIp: string | null = null;

/**
 * Best-effort public IP lookup via ipify. Cached for the session so repeated
 * checks (login, request placement) don't re-hit the network each time.
 */
export async function getPublicIp(force?: boolean): Promise<string | null> {
  if (cachedIp && !force) return cachedIp;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    const json = (await res.json()) as { ip?: string };
    cachedIp = json?.ip ?? null;
    return cachedIp;
  } catch (e) {
    console.log("[ipAccess] ip lookup failed", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch all rules, newest first. */
export async function listIpRules(): Promise<IpAccessRule[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("ip_access_rules")
      .select("id, ip_address, list_type, label, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) {
      console.log("[ipAccess] list error", error.message);
      return [];
    }
    return (data ?? []) as IpAccessRule[];
  } catch (e) {
    console.log("[ipAccess] list threw", e);
    return [];
  }
}

/** Insert (or upsert) a rule. Returns the saved row or null on failure. */
export async function addIpRule(input: {
  ipAddress: string;
  listType: IpListType;
  label?: string | null;
}): Promise<IpAccessRule | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const ip = input.ipAddress.trim();
  if (!ip) return null;
  try {
    const { data, error } = await supabase
      .from("ip_access_rules")
      .upsert(
        {
          ip_address: ip,
          list_type: input.listType,
          label: input.label?.trim() || null,
        },
        { onConflict: "ip_address,list_type" }
      )
      .select("id, ip_address, list_type, label, created_at, updated_at")
      .single();
    if (error) {
      console.log("[ipAccess] add error", error.message);
      return null;
    }
    return data as IpAccessRule;
  } catch (e) {
    console.log("[ipAccess] add threw", e);
    return null;
  }
}

/** Update an existing rule's IP, list type, and/or label. */
export async function updateIpRule(
  id: string,
  input: { ipAddress: string; listType: IpListType; label?: string | null }
): Promise<IpAccessRule | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const ip = input.ipAddress.trim();
  if (!ip) return null;
  try {
    const { data, error } = await supabase
      .from("ip_access_rules")
      .update({
        ip_address: ip,
        list_type: input.listType,
        label: input.label?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, ip_address, list_type, label, created_at, updated_at")
      .single();
    if (error) {
      console.log("[ipAccess] update error", error.message);
      return null;
    }
    return data as IpAccessRule;
  } catch (e) {
    console.log("[ipAccess] update threw", e);
    return null;
  }
}

/** Delete a rule by id. */
export async function deleteIpRule(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from("ip_access_rules").delete().eq("id", id);
    if (error) {
      console.log("[ipAccess] delete error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[ipAccess] delete threw", e);
    return false;
  }
}

/**
 * Evaluate a specific IP against the stored rules. Blacklist takes priority
 * over whitelist. Returns null if the IP is unknown or unmatched.
 */
export async function evaluateIp(ip: string | null): Promise<IpAccessStatus> {
  if (!ip || !isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("ip_access_rules")
      .select("list_type")
      .eq("ip_address", ip);
    if (error) {
      console.log("[ipAccess] evaluate error", error.message);
      return null;
    }
    const types = new Set((data ?? []).map((r: { list_type: IpListType }) => r.list_type));
    if (types.has("blacklist")) return "blacklist";
    if (types.has("whitelist")) return "whitelist";
    return null;
  } catch (e) {
    console.log("[ipAccess] evaluate threw", e);
    return null;
  }
}

/** Convenience: resolve the current device IP then evaluate it. */
export async function evaluateCurrentIp(): Promise<{
  ip: string | null;
  status: IpAccessStatus;
}> {
  const ip = await getPublicIp();
  const status = await evaluateIp(ip);
  return { ip, status };
}
