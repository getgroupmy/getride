/**
 * Editing values in the generic settings editor.
 *
 * One editor serves every category, which means it has no schema telling it
 * what a field is meant to be. All it has is the value already stored, so the
 * stored type is what it preserves: a boolean stays a boolean, a number stays a
 * number, and anything else is text.
 *
 * That matters more than it looks. These rows are read by the app at runtime —
 * a `true` silently rewritten as the string `"true"`, or a fee rewritten as
 * `"25"`, is a config change that type-checks everywhere and misbehaves in
 * production.
 */

export type Primitive = string | number | boolean;

/**
 * Interpret typed text as the same type as the value it replaces.
 *
 * Empty input is deliberately *not* coerced to zero on a numeric field.
 * `Number("")` is `0`, so the obvious implementation turns clearing a field
 * into writing a real zero — which for a fee or a rate is a silent, expensive
 * difference from "left alone".
 */
export function coerceValue(previous: Primitive | undefined, raw: string): Primitive {
  if (typeof previous === "boolean") return raw === "true";

  if (typeof previous === "number") {
    if (raw.trim() === "") return previous;
    const n = Number(raw);
    return Number.isFinite(n) ? n : previous;
  }

  return raw;
}

/**
 * Every key present across a category's rows, so the table has columns.
 *
 * The value type is deliberately unconstrained: this only reads key names, and
 * rows in one category routinely carry different fields.
 */
export function collectKeys(rows: { values?: Record<string, unknown> }[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.values ?? {})) set.add(key);
  }
  return [...set].sort();
}

/**
 * Narrow a loaded page of rows by a search box.
 *
 * Matching is done here rather than in the query because the list is already
 * capped at one page: a desk user typing a name expects it to narrow as they
 * type, not to wait on a round trip.
 */
export function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  query: string,
  keys: string[]
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    keys.some((key) => String(row[key] ?? "").toLowerCase().includes(needle))
  );
}
