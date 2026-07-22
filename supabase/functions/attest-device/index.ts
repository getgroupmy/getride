// ============================================================================
// attest-device — Supabase Edge Function  [TEMPLATE — NOT YET DEPLOYED]
// ----------------------------------------------------------------------------
// Verifies a platform device-attestation token SERVER-SIDE and logs the verdict
// to public.device_attestations. This is the un-forgeable half of the sign-up
// anti-fraud pipeline: the client can lie about its device_id, but it cannot
// forge a Google-/Apple-signed attestation for a genuine, unmodified app.
//
//   Android → Google Play Integrity API   (integrity token)
//   iOS     → Apple App Attest             (attestation object + key id)
//
// IMPORTANT: this function is INERT until BOTH of the following exist:
//   1. A native client that produces real attestation tokens (Expo Go / the
//      Rork managed flow cannot — a custom dev/prod build is required).
//   2. The provider credentials below, set as Supabase function secrets.
// Until then it is not deployed and nothing in the app calls it. See
// docs/device-attestation.md for the full activation checklist.
//
// Required secrets (supabase secrets set ...):
//   ANDROID_PACKAGE_NAME          e.g. com.getride.app
//   GOOGLE_SERVICE_ACCOUNT_JSON   Play Integrity service-account key (JSON)
//   APPLE_APP_ATTEST_TEAM_ID      Apple Developer Team ID
//   APPLE_APP_ATTEST_BUNDLE_ID    e.g. com.getride.app
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Deploy (only once the above are in place):
//   supabase functions deploy attest-device --no-verify-jwt
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Platform = "android" | "ios";

interface AttestRequest {
  platform: Platform;
  device_id?: string | null;
  user_id?: string | null;
  // Android Play Integrity: the token from the Play Integrity API.
  integrity_token?: string;
  // iOS App Attest: base64 attestation object + the generated key id + the
  // challenge (nonce) the client attested over.
  attestation?: string;
  key_id?: string;
  challenge?: string;
}

interface Verdict {
  passed: boolean;
  attest_key_id: string | null;
  detail: Record<string, unknown>;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Android — Play Integrity
// ---------------------------------------------------------------------------
// Decodes + verifies the integrity token via Google's Play Integrity API and
// maps the device/app/account verdicts to a pass/fail. Implemented as a clearly
// separated step so it can be filled in and tested against a real service
// account without touching the request plumbing.
async function verifyPlayIntegrity(token: string): Promise<Verdict> {
  const pkg = Deno.env.get("ANDROID_PACKAGE_NAME");
  const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!pkg || !saJson) {
    return { passed: false, attest_key_id: null, detail: { error: "not_configured" } };
  }

  // Activation step: exchange the service-account JSON for an OAuth2 access
  // token, then POST the integrity token to
  //   https://playintegrity.googleapis.com/v1/${pkg}:decodeIntegrityToken
  // and require:
  //   deviceIntegrity.deviceRecognitionVerdict ⊇ ["MEETS_DEVICE_INTEGRITY"]
  //   appIntegrity.appRecognitionVerdict === "PLAY_RECOGNIZED"
  //   accountDetails.appLicensingVerdict === "LICENSED" (optional)
  // The Play Integrity token carries no stable device id, so attest_key_id
  // stays null; the value here is proving the request is from a real device.
  return {
    passed: false,
    attest_key_id: null,
    detail: { error: "verification_not_implemented", token_len: token.length },
  };
}

// ---------------------------------------------------------------------------
// iOS — App Attest
// ---------------------------------------------------------------------------
// Verifies the CBOR attestation object against Apple's App Attest root, checks
// the nonce/challenge, and returns the hardware-backed key id (stable per app
// install) so it can be used as a strong device signal.
async function verifyAppAttest(
  attestation: string,
  keyId: string,
  challenge: string,
): Promise<Verdict> {
  const teamId = Deno.env.get("APPLE_APP_ATTEST_TEAM_ID");
  const bundleId = Deno.env.get("APPLE_APP_ATTEST_BUNDLE_ID");
  if (!teamId || !bundleId) {
    return { passed: false, attest_key_id: null, detail: { error: "not_configured" } };
  }

  // Activation step: decode the base64 CBOR attestation object, verify the x5c
  // certificate chain up to Apple's App Attest root CA, confirm the nonce =
  // SHA256(authenticatorData ‖ SHA256(challenge)), and that the rpId hash =
  // SHA256(teamId + "." + bundleId). On success the credential id IS the
  // hardware-backed key id.
  return {
    passed: false,
    attest_key_id: keyId ?? null,
    detail: {
      error: "verification_not_implemented",
      attestation_len: attestation.length,
      challenge_len: challenge.length,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  let body: AttestRequest;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (body.platform !== "android" && body.platform !== "ios") {
    return json({ ok: false, error: "platform must be 'android' or 'ios'" }, 400);
  }

  let verdict: Verdict;
  if (body.platform === "android") {
    if (!body.integrity_token) {
      return json({ ok: false, error: "integrity_token required" }, 400);
    }
    verdict = await verifyPlayIntegrity(body.integrity_token);
  } else {
    if (!body.attestation || !body.key_id || !body.challenge) {
      return json({ ok: false, error: "attestation, key_id and challenge required" }, 400);
    }
    verdict = await verifyAppAttest(body.attestation, body.key_id, body.challenge);
  }

  // Record the verdict (service role → bypasses RLS). Best-effort.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      await admin.from("device_attestations").insert({
        user_id: body.user_id ?? null,
        device_id: body.device_id ?? null,
        platform: body.platform,
        attest_key_id: verdict.attest_key_id,
        passed: verdict.passed,
        verdict: verdict.detail,
      });
    } catch (e) {
      console.log("[attest-device] record failed", e);
    }
  }

  return json({
    ok: true,
    passed: verdict.passed,
    attest_key_id: verdict.attest_key_id,
  });
});
