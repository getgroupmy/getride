# Supabase reverse proxy (Cloudflare Worker)

A transparent relay that lets the get.ride / Teksi app reach Supabase when the
network filters `*.supabase.co`.

## Why this exists

On startup the app pings `${EXPO_PUBLIC_SUPABASE_URL}/auth/v1/health` with a 5s
timeout (`expo/contexts/AuthContext.tsx`). If that host is blocked, the probe
fails and the app drops into the offline local-PIN fallback — OTP won't send and
no RLS-protected data loads. The app resolves its endpoint from
`EXPO_PUBLIC_SUPABASE_URL` (`expo/utils/supabase.ts`), so routing that variable
through a domain **you** control sidesteps the block without touching app logic.

The Worker forwards the whole Supabase API surface and preserves the client's
own `apikey` / `Authorization` headers — it holds no secrets and adds no auth:

| Path prefix       | Service                                  |
| ----------------- | ---------------------------------------- |
| `/auth/v1/*`      | GoTrue (OTP, sessions, `/auth/v1/health`)|
| `/rest/v1/*`      | PostgREST                                |
| `/realtime/v1/*`  | Realtime (WebSocket upgrade preserved)   |
| `/storage/v1/*`   | Storage                                  |
| `/functions/v1/*` | Edge functions                           |

Any other path returns 404 so the Worker can't be used as an open relay.

## Deploy

Requires a Cloudflare account and the [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
CLI (`npm i -g wrangler`).

```bash
cd cloudflare/supabase-proxy
wrangler login

# Confirm the upstream project (defaults to the app's project in wrangler.toml)
# wrangler.toml -> [vars] SUPABASE_ORIGIN

wrangler deploy
```

### Pick a hostname that isn't blocked

- **Custom route (recommended).** Add a CNAME on a domain you own and bind a
  route. A novel host like `sb.get.ride` is far less likely to be filtered than
  `workers.dev`. Uncomment the `[[routes]]` block in `wrangler.toml` and set your
  zone, then `wrangler deploy`.
- **workers.dev subdomain.** Uncomment `workers_dev = true` for a zero-DNS
  option (e.g. `getride-supabase-proxy.<you>.workers.dev`). Note some filters
  also block `workers.dev`.

### Verify

```bash
# Proxy liveness
curl -s https://sb.get.ride/__proxy/health

# Real Supabase health, through the proxy — should return 200
curl -i https://sb.get.ride/auth/v1/health -H "apikey: <anon-key>"
```

## Wire the app to the proxy

Set the override in `expo/env` (already scaffolded there, commented out) and
rebuild:

```
EXPO_PUBLIC_SUPABASE_URL=https://sb.get.ride
EXPO_PUBLIC_SUPABASE_ANON_KEY=<same anon key as before>
```

Keep the **same anon key** — the proxy forwards it untouched; only the host
changes. Everything downstream (`SUPABASE_URL_RESOLVED`, the health probe, edge
functions, realtime) picks up the new endpoint automatically.

## Notes & limits

- **Transparent, not a secret store.** The service-role key never touches the
  proxy. RLS and JWT verification still happen on Supabase exactly as before.
- **Lock it down if needed.** To keep the proxy private to your app you can add
  a Cloudflare WAF rule (e.g. require a custom header, or rate-limit by IP) in
  front of the Worker.
- **Realtime.** WebSocket upgrades are forwarded as-is; no extra config needed.
- **This is a routing workaround, not a way in.** It only helps when the block is
  network reachability to Supabase's host. If `/auth-diagnostics` shows an HTTP
  error (not a DNS/timeout/connection failure), the issue is app- or auth-side
  and the proxy won't change it.
