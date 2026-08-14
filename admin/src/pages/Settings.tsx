import { useCallback, useEffect, useMemo, useState } from "react";

import { requireSupabase } from "../supabase";
import type { SettingEntry } from "../types";

/**
 * Settings — one editor for every category.
 *
 * `settings_entries` stores each row as a free-form key/value bag under a
 * `category` string. The app gave most categories a bespoke screen, but the
 * shape underneath is identical, so one editor serves them all: pick a
 * category, edit the rows.
 *
 * The trade-off is honest: a bespoke screen can validate its own fields and a
 * generic editor cannot. That is the right trade for a back office — a
 * category can be added without shipping a build — but it is why the value
 * editor keeps types (a boolean stays a boolean) rather than turning
 * everything into strings.
 */

/** Categories the app is known to use, offered before anything is loaded. */
const KNOWN_CATEGORIES = [
  "airport-areas",
  "country-states-cities",
  "document-type",
  "ev-delivery-advisors",
  "ev-delivery-checklist",
  "ev-finance-options",
  "ev-order-fee",
  "ev-vehicle-details",
  "ev-vehicle-inventory",
  "multi-gate-places",
  "partner-type",
  "payment-type",
  "required-documents",
  "service-settings",
  "vehicle-services",
];

type Primitive = string | number | boolean;

function coerce(previous: Primitive, raw: string): Primitive {
  if (typeof previous === "boolean") return raw === "true";
  if (typeof previous === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : previous;
  }
  return raw;
}

export default function Settings() {
  const [category, setCategory] = useState(KNOWN_CATEGORIES[0]);
  const [entries, setEntries] = useState<SettingEntry[]>([]);
  const [categories, setCategories] = useState<string[]>(KNOWN_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await requireSupabase()
        .from("settings_entries")
        .select("*")
        .eq("category", category)
        .limit(200);
      if (err) throw new Error(err.message);
      setEntries((data ?? []) as SettingEntry[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load those settings.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  // Discover categories actually present, so a category added after this build
  // still appears rather than being invisible until someone edits the list.
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await requireSupabase()
          .from("settings_entries")
          .select("category")
          .limit(1000);
        const found = new Set(KNOWN_CATEGORIES);
        for (const row of (data ?? []) as { category: string }[]) {
          if (row.category) found.add(row.category);
        }
        setCategories([...found].sort());
      } catch {
        // The known list is a fine fallback.
      }
    })();
  }, []);

  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      for (const k of Object.keys(e.values ?? {})) set.add(k);
    }
    return [...set].sort();
  }, [entries]);

  const saveEntry = async (entry: SettingEntry, key: string, raw: string) => {
    const previous = entry.values?.[key];
    const nextValue = coerce(
      (previous ?? "") as Primitive,
      raw
    );
    const values = { ...entry.values, [key]: nextValue };

    setSavingId(entry.id);
    try {
      const { error: err } = await requireSupabase()
        .from("settings_entries")
        .update({ values, updated_at: new Date().toISOString() })
        .eq("id", entry.id);
      if (err) throw new Error(err.message);
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, values } : e))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change did not save.");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (entry: SettingEntry) => {
    if (!confirm("Delete this row? This cannot be undone.")) return;
    setSavingId(entry.id);
    try {
      const { error: err } = await requireSupabase()
        .from("settings_entries")
        .delete()
        .eq("id", entry.id);
      if (err) throw new Error(err.message);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That row was not deleted.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section>
      <header className="page-head">
        <h1>Settings</h1>
        <div className="controls">
          <select
            aria-label="Settings category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {entries.length === 0 && !loading ? (
        <p className="empty">No rows in this category.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  {keys.map((k) => {
                    const v = e.values?.[k];
                    return (
                      <td key={k}>
                        {typeof v === "boolean" ? (
                          <input
                            type="checkbox"
                            aria-label={k}
                            checked={v}
                            disabled={savingId === e.id}
                            onChange={(ev) =>
                              void saveEntry(e, k, ev.target.checked ? "true" : "false")
                            }
                          />
                        ) : (
                          <input
                            aria-label={k}
                            defaultValue={v === undefined ? "" : String(v)}
                            disabled={savingId === e.id}
                            onBlur={(ev) => {
                              if (ev.target.value !== String(v ?? "")) {
                                void saveEntry(e, k, ev.target.value);
                              }
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      className="danger"
                      onClick={() => void remove(e)}
                      disabled={savingId === e.id}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="note">
        Edits save when a field loses focus. One editor covers every category, so a new
        category needs no new screen.
      </p>
    </section>
  );
}
