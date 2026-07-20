/**
 * get.ride / Teksi — Supabase reverse proxy (Cloudflare Worker)
 *
 * Purpose
 * -------
 * Some networks/ISPs filter the `*.supabase.co` host, which makes the app's
 * startup health probe (`/auth/v1/health`) time out and forces it into the
 * offline local-PIN fallback (see `expo/contexts/AuthContext.tsx`). This Worker
 * lets the app reach Supabase through a domain you control instead.
 *
 * The app already resolves its endpoint from `EXPO_PUBLIC_SUPABASE_URL`
 * (`expo/utils/supabase.ts`), so pointing that variable at this Worker reroutes
 * every REST, Auth (GoTrue), Realtime (WebSocket), Storage, and Edge Function
 * call — no other client change is required.
 *
 * What it forwards
 * ----------------
 *   /auth/v1/*        GoTrue (OTP, sessions, /auth/v1/health)
 *   /rest/v1/*        PostgREST
 *   /realtime/v1/*    Realtime (WebSocket upgrade preserved)
 *   /storage/v1/*     Storage
 *   /functions/v1/*   Edge functions (send-push, ip-lookup, ai-route-proxy, ...)
 *
 * Configuration (wrangler.toml [vars] or dashboard):
 *   SUPABASE_ORIGIN   e.g. "https://rqlavogkgywxspuxgiwk.supabase.co"
 *
 * This proxy is transparent: it does NOT hold the service-role key and does not
 * add auth. Clients still send their own `apikey` / `Authorization` headers,
 * exactly as they would when talking to Supabase directly.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Only proxy the Supabase API surface. Anything else gets a 404 so the Worker
// can't be turned into an open relay for arbitrary origins.
const ALLOWED_PREFIXES = [
  "/auth/",
  "/rest/",
  "/realtime/",
  "/storage/",
  "/functions/",
];

function isAllowedPath(pathname) {
  return ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const reqHeaders =
    request.headers.get("Access-Control-Request-Headers") ||
    "authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, range";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Expose-Headers":
      "content-range, content-length, x-supabase-api-version",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = (env && env.SUPABASE_ORIGIN) || "";
    if (!origin) {
      return new Response(
        "Proxy misconfigured: SUPABASE_ORIGIN is not set.",
        { status: 500 }
      );
    }

    const url = new URL(request.url);

    // CORS preflight — answer locally so it never has to reach Supabase.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // Lightweight liveness check for the proxy itself.
    if (url.pathname === "/" || url.pathname === "/__proxy/health") {
      return new Response(
        JSON.stringify({ ok: true, origin, ts: Date.now() }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (!isAllowedPath(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    // Build the upstream URL: same path + query, Supabase host.
    const upstream = new URL(origin);
    upstream.pathname = url.pathname;
    upstream.search = url.search;

    // Copy request headers, dropping hop-by-hop and rewriting Host.
    const fwdHeaders = new Headers();
    for (const [key, value] of request.headers) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === "host") continue;
      fwdHeaders.set(key, value);
    }
    fwdHeaders.set("Host", upstream.host);

    const isWebSocket =
      (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";

    // For WebSocket upgrades (Realtime) forward the original request so the
    // Upgrade/Connection headers survive; Cloudflare returns the 101 with the
    // live socket attached, which we pass straight back to the client.
    if (isWebSocket) {
      const wsReq = new Request(upstream.toString(), request);
      return fetch(wsReq);
    }

    const init = {
      method: request.method,
      headers: fwdHeaders,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    };

    let upstreamResp;
    try {
      upstreamResp = await fetch(upstream.toString(), init);
    } catch (e) {
      return new Response(
        `Upstream fetch failed: ${e && e.message ? e.message : String(e)}`,
        { status: 502 }
      );
    }

    // Copy response headers, dropping hop-by-hop, and layer CORS on top so
    // web builds served from a different origin can read the response.
    const respHeaders = new Headers();
    for (const [key, value] of upstreamResp.headers) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      respHeaders.set(key, value);
    }
    const cors = corsHeaders(request);
    for (const [key, value] of Object.entries(cors)) {
      respHeaders.set(key, value);
    }

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
