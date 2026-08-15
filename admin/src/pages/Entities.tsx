import { useCallback, useEffect, useMemo, useState } from "react";

import { requireSupabase } from "../supabase";
import type { EntityKind } from "../types";
import { filterRows } from "../lib/settingsValues";
import { confirmStatusMessage, isDestructiveStatus } from "../lib/adminSafety";

/**
 * Users, partners and vehicles — one screen.
 *
 * The app carried 28 separate screens here: `admin-users-approved`,
 * `admin-users-blocked`, `admin-partners-permit-pending` and so on, 27 of them
 * 12–13 line wrappers differing only by a status filter. A filter is a control,
 * not a screen, so they collapse into this one.
 */

interface Column {
  key: string;
  label: string;
}

const TABLE: Record<EntityKind, string> = {
  users: "profiles",
  partners: "partners",
  vehicles: "vehicles",
};

const COLUMNS: Record<EntityKind, Column[]> = {
  users: [
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "status", label: "Status" },
  ],
  partners: [
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "plate", label: "Plate" },
    { key: "status", label: "Status" },
    { key: "permit", label: "Permit" },
  ],
  vehicles: [
    { key: "plate", label: "Plate" },
    { key: "make", label: "Make" },
    { key: "model", label: "Model" },
    { key: "status", label: "Status" },
  ],
};

/** The status vocabulary each entity actually uses, per the schema. */
const STATUSES: Record<EntityKind, string[]> = {
  users: ["approved", "unapproved", "blocked", "rejected", "deleted", "unapproved-docs"],
  partners: [
    "approved",
    "unapproved",
    "blocked",
    "rejected",
    "unapproved-docs",
    "permit-pending",
    "permit-non-verified",
    "permit-verified",
  ],
  vehicles: ["approved", "unapproved", "blocked", "rejected"],
};

const PAGE_SIZE = 50;

type Row = Record<string, unknown> & { id: string };

export default function Entities({ kind }: { kind: EntityKind }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const columns = COLUMNS[kind];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = requireSupabase().from(TABLE[kind]).select("*").limit(PAGE_SIZE);
      if (status) q = q.eq("status", status);
      const { data, error: err } = await q;
      if (err) throw new Error(err.message);
      setRows((data ?? []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that list.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [kind, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => filterRows(rows, query, columns.map((c) => c.key)),
    [rows, query, columns]
  );

  const setRowStatus = async (row: Row, next: string) => {
    const current = String(row.status ?? "");
    if (next === current) return;

    // Approving is undoable by disapproving; being blocked or marked deleted is
    // not something the person can see or reverse. Only that direction asks.
    if (isDestructiveStatus(next)) {
      const label = String(row.name ?? row.plate ?? row.id);
      // The select is controlled by `row.status`, so declining simply leaves
      // state untouched and React restores the previous option.
      if (!confirm(confirmStatusMessage(label, current, next))) return;
    }

    setSaving(row.id);
    try {
      const { error: err } = await requireSupabase()
        .from(TABLE[kind])
        .update({ status: next })
        .eq("id", row.id);
      if (err) throw new Error(err.message);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: next } : r))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change did not save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <header className="page-head">
        <h1>{kind[0].toUpperCase() + kind.slice(1)}</h1>
        <div className="controls">
          <input
            aria-label="Search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES[kind].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Change status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.key}>{String(r[c.key] ?? "—")}</td>
                ))}
                <td>
                  <select
                    aria-label={`Status for ${String(r.name ?? r.plate ?? r.id)}`}
                    value={String(r.status ?? "")}
                    disabled={saving === r.id}
                    onChange={(e) => void setRowStatus(r, e.target.value)}
                  >
                    {STATUSES[kind].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && shown.length === 0 ? (
          <p className="empty">Nothing matches that.</p>
        ) : null}
      </div>

      <p className="note">
        Showing up to {PAGE_SIZE} rows. This one screen replaces the 28 status-filtered
        screens the app carried.
      </p>
    </section>
  );
}
