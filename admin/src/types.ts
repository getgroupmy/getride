/**
 * Row shapes the back office reads.
 *
 * Deliberately a small, local mirror of the columns this tool touches rather
 * than a copy of the whole app's domain types: the schema is the contract, and
 * duplicating types that drift is worse than naming the few fields used here.
 */

export type EntityKind = "users" | "partners" | "vehicles";

export interface PersonRow {
  id: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
  status: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface VehicleRow {
  id: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  status: string | null;
  [key: string]: unknown;
}

/** The free-form key/value bag every admin-configurable setting is stored as. */
export interface SettingEntry {
  id: string;
  category: string;
  values: Record<string, string | number | boolean>;
  created_at?: string | null;
  updated_at?: string | null;
}
