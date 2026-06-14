# Supabase setup

Everything needed to bring up a brand-new Supabase project for this app.

## Files

| File         | Purpose                                                          |
| ------------ | ---------------------------------------------------------------- |
| `schema.sql` | Tables, enums, triggers, RLS policies, storage buckets. Idempotent. |
| `seed.sql`   | Default settings entries + app settings, matching in-app defaults. |
| `reset.sql`  | Destructive teardown (keeps storage buckets).                    |
| `setup.sh`   | One-shot bootstrap script (`psql` wrapper).                      |

## Quick start (cloning into a new Supabase project)

1. Create a new project at https://supabase.com.
2. Copy the **Connection string (URI)** from *Project Settings → Database*.
3. Run:

   ```bash
   export SUPABASE_DB_URL="postgres://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"
   ./supabase/setup.sh
   ```

4. In *Project Settings → API*, copy:
   - `Project URL` → `EXPO_PUBLIC_SUPABASE_URL`
   - `anon public` key → `EXPO_PUBLIC_SUPABASE_ANON_KEY`

5. Restart the app — it now points at the new project with the same baseline data.

### No `psql`? Use the Dashboard

Open *SQL Editor* in Supabase and paste, in order:
1. `schema.sql`
2. `seed.sql`

Storage buckets are created automatically by `schema.sql`.

## What you get

**Tables**: `profiles`, `partners`, `partner_documents`, `settings_entries`, `app_settings`, `rides`.

**Storage buckets**:
- `avatars` (public)
- `app-assets` (public — app icon, splash, banners)
- `partner-documents` (private, owner-only)
- `ride-attachments` (private)

**RLS** is on by default. Defaults:
- Users can read/update their own `profiles` row.
- Partners + settings are readable by authenticated clients.
- Admin/back-office writes should use the `service_role` key.

## Push notifications

Push delivery uses Expo's push service. The schema adds two tables
(`push_tokens`, `push_notifications` — see `migrations/0042_push_notifications.sql`,
already folded into `schema.sql`) and an edge function that fans messages out
to Expo.

Devices register their Expo push token automatically on sign-in
(`expo/contexts/PushNotificationContext.tsx`). The in-app admin screen
*Settings → Push Notification* composes a message, picks an audience
(Everyone / Drivers / Users) and dispatches it.

`setup.sh` deploys the sender function automatically when the Supabase CLI is
on `PATH` (skip with `--no-functions`). To deploy it on its own — required, or
the in-app *Push Notification* screen reports "Send failed" because
`supabase.functions.invoke("send-push")` has nothing to call:

```bash
supabase functions deploy send-push --no-verify-jwt
```

The function reads tokens with the `service_role` key, which Supabase injects
as `SUPABASE_SERVICE_ROLE_KEY` for deployed functions — no extra secret needed.
"Drivers" vs "Users" is resolved by membership in the `partners` table.

## Re-seeding

```bash
./supabase/setup.sh --reset   # nuke + rebuild + seed
```

## Extending

Add new settings categories by inserting rows into `settings_entries` with a
new `category` string — the app's `AdminDataContext` already groups entries
by category.
