#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-shot Supabase bootstrap for a freshly cloned project.
#
# Usage:
#   export SUPABASE_DB_URL="postgres://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
#   ./supabase/setup.sh                # schema + seed
#   ./supabase/setup.sh --reset        # drop everything first, then schema+seed
#   ./supabase/setup.sh --schema-only  # skip seed
#
# Requires: psql in PATH. Install via Postgres client tools, e.g.:
#   macOS  : brew install libpq && brew link --force libpq
#   Ubuntu : sudo apt-get install -y postgresql-client
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Error: SUPABASE_DB_URL is not set."
  echo "Find it in Supabase Dashboard → Project Settings → Database → Connection string (URI)."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found. Install the Postgres client first."
  exit 1
fi

RESET=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --reset)       RESET=1 ;;
    --schema-only) SEED=0  ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

if [[ $RESET -eq 1 ]]; then
  echo "→ Resetting (dropping existing tables)…"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DIR/reset.sql"
fi

echo "→ Applying schema…"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DIR/schema.sql"

if [[ $SEED -eq 1 ]]; then
  echo "→ Seeding default data…"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DIR/seed.sql"
fi

echo "✓ Supabase setup complete."
