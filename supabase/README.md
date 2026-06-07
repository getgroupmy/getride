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

## Re-seeding

```bash
./supabase/setup.sh --reset   # nuke + rebuild + seed
```

## Extending

Add new settings categories by inserting rows into `settings_entries` with a
new `category` string — the app's `AdminDataContext` already groups entries
by category.
