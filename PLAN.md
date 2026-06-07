# Add an Auth Diagnostics screen to pinpoint why no SMS is sent

## Why this is happening

Your Supabase Auth Logs are empty **and** your Metro console doesn't show the "sending OTP" log line that the app prints right before calling Supabase. That means the request isn't actually reaching Supabase — so MessageBird is never asked to send anything. We need to find out *where* the call dies (config, network, SDK, or a code branch that skips the send).

## What I'll add

A new **Auth Diagnostics** screen, reachable from the phone-login screen via a small "Diagnostics" link (long-press the title, so end-users won't see it). It runs a series of checks in order and shows a clear pass/fail row for each, plus a "Copy report" button so you can paste results back to me.

### Checks the screen will run

1. **Environment** — confirms the Supabase URL and anon key are actually present in the running build (shows the URL host and a masked key prefix).
2. **Internet reachability** — a plain fetch to a neutral endpoint to rule out the device having no network.
3. **Supabase health ping** — direct fetch to `/auth/v1/health` on your project, showing the HTTP status. If this fails, the URL/key is wrong or the project is paused.
4. **Anon key sanity** — a tiny read against `profiles` to confirm the anon key is accepted.
5. **Phone provider raw test** — bypasses the SDK and calls `/auth/v1/otp` directly with `fetch`, sending your typed phone number. Displays the exact HTTP status code and full JSON response body. This is the smoking-gun test:
   - `200` → Supabase accepted the request; the failure is between Supabase and MessageBird (originator/credit/country routing) and you'll now see an entry appear in Auth Logs.
   - `400 / 422` with a specific message → tells us exactly which field/setting is wrong (e.g. `phone_provider_disabled`, `sms_send_failed`, `signups_not_allowed`).
   - `429` → rate-limited.
   - Network error / no response → the device can't reach Supabase at all.
6. **SDK test** — repeats the same request through `supabase.auth.signInWithOtp` so we can compare and prove the SDK path matches the raw path.

### Extra logging

I'll also upgrade the existing `sendOtp` and `verifyOtp` functions to log:
- The exact phone string being sent (so we can see if normalization mangled it)
- A unique request id printed before and after the call (so you can confirm the call actually started and finished)
- The raw error object, not just `error.message`

### How you'll use it

1. Open the app, go to the phone login screen, long-press the title to open Diagnostics.
2. Type your phone number (with country code), tap **Run all checks**.
3. Screenshot or tap **Copy report** and send it to me. From the output I can tell you the exact next step (fix env var, fix MessageBird originator, enable provider, switch country, etc.) without more guesswork.

### What this will *not* do

- It won't change your existing OTP/PIN flow — purely additive.
- It won't store or transmit your phone number anywhere except to Supabase, the same as the normal flow.

After you approve, I'll implement it and run the build check.