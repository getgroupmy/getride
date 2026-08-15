# GET.ride — back office

A web tool for staff, written against the **existing** Supabase project: same
schema, same migrations, same RLS policies as the app in `../mobile/`.

## Why this is not 108 screens

The app carried 108 admin screens, 51,239 lines. An audit of them found that
roughly 40% are the same two screens repeated:

| Pattern | In the app | Here |
|---|---|---|
| Status-filtered lists (`admin-users-blocked`, `admin-partners-permit-pending`, …) — **27 of them 12–13 line wrappers** around a shared list component | 28 screens | **1** screen with a filter |
| Keyed `settings_entries` category editors — identical key/value shape, different `category` string | 14+ categories | **1** editor |

A filter is a control, not a screen. So this tool has four pages, not a hundred:
Overview, Users, Partners, Vehicles and Settings — where the three entity pages
are one component and Settings covers every category, including ones added after
this build.

## Security

No service-role key. This bundle ships to a browser, where any visitor could
read it. An admin is an ordinary authenticated user who happens to have an
`admin_access` row, and `caller_is_admin()` (migration 0069) is what actually
grants the wider read/write. The in-app check decides what to *render*, never
what is *permitted* — editing it in the console gets you nothing back.

A failed access check is reported as a failed check, not as a denial: a broken
query must not look identical to "you are not staff".

## Running it

```bash
cd admin
bun install
cp .env.example .env      # fill in URL + anon key
bun run dev               # http://localhost:5173
```

```bash
bun run typecheck
bun run test
bun run build
bun run preview
```

## Status

Verified: typecheck clean, 15 tests passing, production build succeeds, and the
app mounts and renders in headless Chromium with no page errors and no failed
requests. CI runs all three on every push.

### What is tested

`src/lib/settingsValues.ts` — the logic that decides what a staff edit actually
writes. It is small, and it is the part of this tool that can quietly corrupt
production config:

- **Types are preserved from the stored value.** One editor serves every
  category, so it has no schema telling it what a field is meant to be. A `true`
  rewritten as the string `"true"`, or a fee as `"25"`, type-checks everywhere
  and misbehaves at runtime.
- **Clearing a numeric field does not write zero.** `Number("")` is `0`, so the
  obvious implementation turns "left blank" into a real zero — for a fee or a
  rate that is a silent and expensive difference.
- **Search only matches the columns it is given**, and a `null` field never
  matches the text "null".

The screens import these helpers rather than keeping their own copies, so the
tests protect the code that actually runs.

## Not yet covered

Deliberately out of scope for this pass, and each is a real gap rather than an
oversight:

- **Document review queues** — approving partner/vehicle documents, with the
  storage buckets they live in.
- **Support** — ticket triage, chat and calls.
- **Push notifications** — composing and sending broadcasts.
- **Sub-admin permissions** — the view-vs-edit axis (`useReadOnlyGuard` in the
  app) is not enforced here; anyone with an `admin_access` row gets full reach.
- **EV orders** — the `ev_orders` back office and delivery checklist.
- **Geo tables, commission and coin settings** — reachable through the generic
  Settings editor only if they are stored as `settings_entries`; the ones with
  dedicated tables (`commission_rates`, `meter_digital_settings`) are not.

## The audit still to do

The recommendation in the scoping document had two halves. This delivers the
first — collapse the duplication. The second is still worth doing: find out
which of the remaining admin screens anyone has actually opened in the last six
months, and build only those. It is likely a short list.
