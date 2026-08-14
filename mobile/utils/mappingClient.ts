import { loadAssignments, type MappingCapability } from "./serviceAssignmentsStore";
import {
  loadProviders,
  reportKeyUsage,
  type ApiKeyEntry,
  type ApiProviderDef,
  type ApiServiceDef,
} from "./apiKeysStore";

/**
 * mappingClient
 *
 * Bridges the per-page service assignments and the API keys store into the
 * actual map calls. Each consuming page picks a {pageId, capability} pair
 * and either:
 *   - resolves the assigned provider/service/key via `getMappingKey`, or
 *   - delegates the call to `runWithMappingRotation` which automatically
 *     rotates through available keys on failure and reports usage.
 */

export interface ResolvedService {
  provider: ApiProviderDef;
  service: ApiServiceDef;
}

export interface MappingCallContext {
  /** API key value (may be empty if the assigned service is keyless, e.g. Nominatim). */
  key: string;
  /** Provider id (e.g. "google", "openstreetmap", "mapbox"). */
  providerSlug: string;
  /** Service id within the provider (e.g. "places", "geocoding"). */
  serviceSlug: string;
  providerName: string;
  serviceName: string;
}

export interface ResolvedKey extends MappingCallContext {
  providerId: string;
  serviceId: string;
  keyId: string;
  keyLabel: string;
}

async function resolveAssignedService(
  pageId: string,
  capability: MappingCapability
): Promise<ResolvedService | null> {
  try {
    const [assignments, providers] = await Promise.all([loadAssignments(), loadProviders()]);
    const a = assignments[pageId]?.[capability];
    if (!a) return null;
    const provider = providers.find((p) => p.id === a.providerId);
    if (!provider) return null;
    const service = provider.services.find((s) => s.id === a.serviceId);
    if (!service) return null;
    return { provider, service };
  } catch (e) {
    console.log("[mappingClient] resolveAssignedService error", e);
    return null;
  }
}

function pickActiveKeys(service: ApiServiceDef): ApiKeyEntry[] {
  const candidates = service.keys.filter((k) => !k.disabled && k.value.trim().length > 0);
  return [...candidates].sort((a, b) => {
    if (a.failedCount !== b.failedCount) return a.failedCount - b.failedCount;
    return a.useCount - b.useCount;
  });
}

async function reportSafe(
  providerId: string,
  serviceId: string,
  keyId: string,
  success: boolean
): Promise<void> {
  try {
    await reportKeyUsage(providerId, serviceId, keyId, success);
  } catch (e) {
    console.log("[mappingClient] report error", e);
  }
}

/**
 * Returns the next available key for the given page+capability or null when
 * there is no assignment / no usable key. Useful for one-shot URL building.
 * Caller should call `reportMappingResult` after the request completes.
 */
export async function getMappingKey(
  pageId: string,
  capability: MappingCapability
): Promise<ResolvedKey | null> {
  const resolved = await resolveAssignedService(pageId, capability);
  if (!resolved) return null;
  const k = pickActiveKeys(resolved.service)[0];
  if (!k) return null;
  return {
    providerId: resolved.provider.id,
    serviceId: resolved.service.id,
    providerSlug: resolved.provider.id,
    serviceSlug: resolved.service.id,
    providerName: resolved.provider.name,
    serviceName: resolved.service.name,
    key: k.value,
    keyId: k.id,
    keyLabel: k.label,
  };
}

export async function reportMappingResult(
  resolved: Pick<ResolvedKey, "providerId" | "serviceId" | "keyId">,
  success: boolean
): Promise<void> {
  await reportSafe(resolved.providerId, resolved.serviceId, resolved.keyId, success);
}

export interface RotationOutcome<T> {
  ok: boolean;
  value: T;
}

/**
 * Run `perform` with the assigned provider + key. On failure rotates to the
 * next key (lowest failedCount, then lowest useCount) and reports usage. If
 * no service is assigned, calls `fallback`. If the assigned service has no
 * keys configured (e.g. OSM Nominatim) it is invoked once with an empty key.
 */
export async function runWithMappingRotation<T>(
  pageId: string,
  capability: MappingCapability,
  perform: (ctx: MappingCallContext) => Promise<RotationOutcome<T>>,
  fallback: () => Promise<T>
): Promise<T> {
  const resolved = await resolveAssignedService(pageId, capability);
  if (!resolved) {
    return fallback();
  }
  const { provider, service } = resolved;
  const baseCtx = {
    providerSlug: provider.id,
    serviceSlug: service.id,
    providerName: provider.name,
    serviceName: service.name,
  };

  const keys = pickActiveKeys(service);
  if (keys.length === 0) {
    try {
      const r = await perform({ ...baseCtx, key: "" });
      if (r.ok) return r.value;
    } catch (e) {
      console.log("[mappingClient] keyless perform error", e);
    }
    return fallback();
  }

  let lastValue: T | null = null;
  let hadValue = false;
  for (const k of keys) {
    try {
      const r = await perform({ ...baseCtx, key: k.value });
      if (r.ok) {
        await reportSafe(provider.id, service.id, k.id, true);
        return r.value;
      }
      await reportSafe(provider.id, service.id, k.id, false);
      lastValue = r.value;
      hadValue = true;
    } catch (e) {
      console.log("[mappingClient] perform error", e);
      await reportSafe(provider.id, service.id, k.id, false);
    }
  }
  if (hadValue && lastValue !== null) return lastValue;
  return fallback();
}
