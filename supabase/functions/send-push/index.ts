// ============================================================================
// send-push — Supabase Edge Function
// ----------------------------------------------------------------------------
// Broadcasts a push notification to registered devices through Expo's push
// service (https://exp.host/--/api/v2/push/send).
//
// Request body: { title: string, body: string, audience?: "all" | "partners" | "users", profileId?: string, data?: object }
//
// Audience resolution:
//   * all      — every registered token
//   * partners — tokens whose profile is in `partners` (auth_user_id)
//   * users    — tokens whose profile is NOT a partner (user-mode accounts)
//
// "drivers" is accepted as a legacy alias for "partners".
//
// When `profileId` is set the notification goes only to that profile's
// devices (used for targeted events like wallet transfer requests) and the
// audience field is ignored.
//
// Reads tokens with the service-role key (bypasses RLS) and logs the dispatch
// to `public.push_notifications`.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Audience = "all" | "partners" | "users";

interface SendBody {
  title?: string;
  body?: string;
  audience?: string;
  /** Target a single profile's devices instead of a broadcast audience. */
  profileId?: string;
  data?: Record<string, unknown>;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let payload: SendBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const title = (payload.title ?? "").trim();
  const body = (payload.body ?? "").trim();
  const rawAudience = (payload.audience ?? "all").toLowerCase();
  // "drivers" is the legacy key for the partner audience.
  const audience = (
    rawAudience === "drivers" || rawAudience === "partners"
      ? "partners"
      : rawAudience === "users"
        ? "users"
        : "all"
  ) as Audience;

  if (!title || !body) {
    return json({ error: "title and body are required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Function is missing Supabase credentials" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const profileId = (payload.profileId ?? "").trim();

  // Resolve the audience to a set of profile ids when scoping by role.
  let profileFilter: string[] | null = null;
  if (profileId) {
    profileFilter = [profileId];
  } else if (audience !== "all") {
    const { data: partners, error: partnersErr } = await supabase
      .from("partners")
      .select("auth_user_id")
      .not("auth_user_id", "is", null);
    if (partnersErr) {
      return json({ error: `Failed to load partners: ${partnersErr.message}` }, 500);
    }
    const partnerIds = (partners ?? [])
      .map((p: { auth_user_id: string | null }) => p.auth_user_id)
      .filter((v: string | null): v is string => !!v);

    if (audience === "partners") {
      profileFilter = partnerIds;
      if (profileFilter.length === 0) {
        return json({ recipients: 0, sent: 0, failed: 0, tickets: [] });
      }
    } else {
      // users — everyone who is not a partner (user-mode accounts)
      const { data: rows, error } = await supabase
        .from("push_tokens")
        .select("profile_id")
        .not("profile_id", "is", null);
      if (error) {
        return json({ error: `Failed to load tokens: ${error.message}` }, 500);
      }
      const partnerSet = new Set(partnerIds);
      profileFilter = Array.from(
        new Set(
          (rows ?? [])
            .map((r: { profile_id: string | null }) => r.profile_id)
            .filter((v: string | null): v is string => !!v && !partnerSet.has(v))
        )
      );
      if (profileFilter.length === 0) {
        return json({ recipients: 0, sent: 0, failed: 0, tickets: [] });
      }
    }
  }

  let query = supabase.from("push_tokens").select("token");
  if (profileFilter) {
    query = query.in("profile_id", profileFilter);
  }
  const { data: tokenRows, error: tokensErr } = await query;
  if (tokensErr) {
    return json({ error: `Failed to load tokens: ${tokensErr.message}` }, 500);
  }

  const tokens = Array.from(
    new Set(
      (tokenRows ?? [])
        .map((r: { token: string }) => r.token)
        .filter((t: string) => typeof t === "string" && t.startsWith("ExponentPushToken"))
    )
  );

  const loggedAudience = profileId ? "direct" : audience;

  if (tokens.length === 0) {
    await supabase.from("push_notifications").insert({
      title,
      body,
      audience: loggedAudience,
      recipients: 0,
      sent: 0,
      failed: 0,
    });
    return json({ recipients: 0, sent: 0, failed: 0, tickets: [] });
  }

  // Expo accepts up to 100 messages per request.
  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    sound: "default",
    data: payload.data ?? { audience },
  }));

  const tickets: unknown[] = [];
  let sent = 0;
  let failed = 0;
  // Tokens Expo reports as no longer valid — pruned after dispatch.
  const deadTokens = new Set<string>();

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      const result = await res.json();
      const data = Array.isArray(result?.data) ? result.data : [];
      for (let j = 0; j < data.length; j += 1) {
        const ticket = data[j];
        tickets.push(ticket);
        if (ticket?.status === "ok") {
          sent += 1;
        } else {
          failed += 1;
          // Expo flags unregistered/invalid tokens — collect them for pruning.
          const errCode = ticket?.details?.error;
          if (errCode === "DeviceNotRegistered" || errCode === "InvalidCredentials") {
            const badToken = chunk[j]?.to;
            if (typeof badToken === "string") deadTokens.add(badToken);
          }
        }
      }
      // If Expo returned fewer tickets than messages (hard error), count the rest as failed.
      if (data.length < chunk.length) failed += chunk.length - data.length;
    } catch (e) {
      failed += chunk.length;
      tickets.push({ status: "error", message: String(e) });
    }
  }

  // Auto-prune dead tokens so future broadcasts stay lean.
  let pruned = 0;
  if (deadTokens.size > 0) {
    const { error: pruneErr } = await supabase
      .from("push_tokens")
      .delete()
      .in("token", Array.from(deadTokens));
    if (pruneErr) {
      console.log("[send-push] failed to prune dead tokens:", pruneErr.message);
    } else {
      pruned = deadTokens.size;
    }
  }

  await supabase.from("push_notifications").insert({
    title,
    body,
    audience: loggedAudience,
    recipients: tokens.length,
    sent,
    failed,
  });

  return json({ recipients: tokens.length, sent, failed, pruned, tickets });
});
