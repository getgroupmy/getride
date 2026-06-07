/**
 * Auto-discovered list of admin pages.
 *
 * Uses Metro's `require.context` to scan `expo/app/admin-*.tsx` at bundle time,
 * so new admin pages added to the project show up automatically in the
 * sub-admin "Grant access" picker without anyone having to maintain a list.
 *
 * The `key` returned is the file name without extension (which matches the
 * expo-router route key used elsewhere in the codebase, e.g. `admin-orders`),
 * and `label` is a humanized version derived from the key.
 */

export interface AdminPageOption {
  key: string;
  label: string;
}

/** Pages we never want to expose in the picker (auth flow, etc.). */
const EXCLUDED: ReadonlySet<string> = new Set<string>(["admin-login"]);

function humanize(key: string): string {
  const stripped = key.replace(/^admin-?/, "");
  if (!stripped) return "Admin (root)";
  return stripped
    .split("-")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function discoverPages(): string[] {
  try {
    // Metro supports require.context (Expo SDK 50+). Path is relative to THIS file.
    const ctx = (require as unknown as {
      context: (
        path: string,
        recursive: boolean,
        pattern: RegExp
      ) => { keys: () => string[] };
    }).context("../app", false, /^\.\/admin-.*\.tsx$/);
    const keys = ctx.keys();
    return keys
      .map((k) => k.replace(/^\.\//, "").replace(/\.tsx$/, ""))
      .filter((k) => !EXCLUDED.has(k));
  } catch (e) {
    console.log("[adminPages] require.context failed, falling back", e);
    return [];
  }
}

/** All admin pages discovered at build time, sorted alphabetically. */
export const ADMIN_PAGE_KEYS: string[] = discoverPages().sort();

/** Picker options: wildcard first, then every admin page. */
export const ADMIN_PAGE_OPTIONS: AdminPageOption[] = [
  { key: "*", label: "All pages (super-admin)" },
  ...ADMIN_PAGE_KEYS.map((k) => ({ key: k, label: humanize(k) })),
];

/** Look up a friendly label for a page key (returns the key if unknown). */
export function adminPageLabel(key: string): string {
  if (key === "*") return "All pages (super-admin)";
  return ADMIN_PAGE_OPTIONS.find((o) => o.key === key)?.label ?? humanize(key);
}
