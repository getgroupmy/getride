import { useCallback, useMemo } from "react";
import { Alert, Platform } from "react-native";
import { usePathname } from "expo-router";
import { useAdminAccess } from "@/contexts/AdminAccessContext";

/**
 * Derive the admin_access `page` key from the current route. The convention
 * matches the route segment (e.g. "/admin-settings-display" → "admin-settings-display").
 */
function pageKeyFromPath(path: string | null | undefined): string {
  if (!path) return "";
  const trimmed = path.replace(/^\/+/, "").split(/[?#]/)[0];
  return trimmed.split("/")[0] ?? "";
}

/**
 * Returns the page's edit gate, derived from `useAdminAccess().canEdit(<pageKey>)`.
 * `pageKey` defaults to the current route segment. A `guard()` helper is provided
 * to wrap mutation handlers — it shows a "Read-only" alert and returns `false`
 * when the user lacks edit permission.
 */
export function useReadOnlyGuard(pageKey?: string): {
  editable: boolean;
  guard: () => boolean;
  pageKey: string;
} {
  const pathname = usePathname();
  const { canEdit } = useAdminAccess();
  const resolvedKey = useMemo(() => pageKey ?? pageKeyFromPath(pathname), [pageKey, pathname]);
  const editable = canEdit(resolvedKey);

  const guard = useCallback((): boolean => {
    if (editable) return true;
    const msg = "You have read-only access on this page.";
    if (Platform.OS === "web") {
      console.log("[readOnlyGuard] blocked write on", resolvedKey);
      try {
        if (typeof window !== "undefined") {
          window.alert(msg);
        }
      } catch {}
    } else {
      Alert.alert("Read-only", msg);
    }
    return false;
  }, [editable, resolvedKey]);

  return { editable, guard, pageKey: resolvedKey };
}
