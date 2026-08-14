import { useCallback, useEffect, useState } from "react";

import { requireSupabase } from "../supabase";

/**
 * A count of the things that need someone's attention.
 *
 * Counts only — `head: true` with an exact count reads no rows, so opening the
 * back office never pulls thousands of records across the wire just to render
 * six numbers.
 */

interface Tile {
  label: string;
  table: string;
  filter?: { column: string; value: string };
  hint: string;
}

const TILES: Tile[] = [
  {
    label: "Partners awaiting approval",
    table: "partners",
    filter: { column: "status", value: "unapproved" },
    hint: "Cannot receive requests yet",
  },
  {
    label: "Permits pending",
    table: "partners",
    filter: { column: "status", value: "permit-pending" },
    hint: "Submitted, not yet verified",
  },
  {
    label: "Vehicles awaiting approval",
    table: "vehicles",
    filter: { column: "status", value: "unapproved" },
    hint: "Not yet on the road",
  },
  {
    label: "Users blocked",
    table: "profiles",
    filter: { column: "status", value: "blocked" },
    hint: "Cannot sign in",
  },
  {
    label: "Open ride requests",
    table: "ride_requests",
    filter: { column: "status", value: "open" },
    hint: "Waiting for a driver right now",
  },
  { label: "Support tickets", table: "support_tickets", hint: "All time" },
];

type Counts = Record<string, number | null>;

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const next: Counts = {};
    const problems: string[] = [];

    await Promise.all(
      TILES.map(async (tile) => {
        try {
          let q = requireSupabase()
            .from(tile.table)
            .select("id", { count: "exact", head: true });
          if (tile.filter) q = q.eq(tile.filter.column, tile.filter.value);
          const { count, error } = await q;
          if (error) throw new Error(error.message);
          next[tile.label] = count ?? 0;
        } catch (e) {
          // A missing table on an older database is not a broken dashboard —
          // that tile reads "—" and the others still render.
          next[tile.label] = null;
          problems.push(
            `${tile.label}: ${e instanceof Error ? e.message : "unavailable"}`
          );
        }
      })
    );

    setCounts(next);
    setErrors(problems);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <header className="page-head">
        <h1>Overview</h1>
        <div className="controls">
          <button onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="tiles">
        {TILES.map((t) => {
          const value = counts[t.label];
          return (
            <div key={t.label} className="tile">
              <span className="tile-value">{value == null ? "—" : value}</span>
              <span className="tile-label">{t.label}</span>
              <span className="tile-hint">{t.hint}</span>
            </div>
          );
        })}
      </div>

      {errors.length ? (
        <div className="note">
          <strong>Some counts are unavailable:</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
