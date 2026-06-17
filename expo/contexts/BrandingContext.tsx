import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import {
  fetchRemoteBranding,
  updateRemoteBranding,
  uploadBrandingImage,
  BRANDING_TABLE,
} from "@/utils/brandingStore";

const STORAGE_KEY = "@branding_v2";

export interface BrandingState {
  splashImageUri: string | null;
  splashBgColor: string;
  appIconUri: string | null;
  /** ISO timestamp last time the admin updated the app icon. */
  iconChangedAt: string | null;
  /** ISO timestamp the current install has acknowledged. */
  iconAckAt: string | null;
}

export const DEFAULT_BRANDING: BrandingState = {
  splashImageUri: null,
  splashBgColor: "#ff007f",
  appIconUri: null,
  iconChangedAt: null,
  iconAckAt: null,
};

export const [BrandingProvider, useBranding] = createContextHook(() => {
  const [state, setState] = useState<BrandingState>(DEFAULT_BRANDING);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const ackRef = useRef<string | null>(null);

  const persistLocal = useCallback(async (next: BrandingState) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.log("[branding] local save error", e);
    }
  }, []);

  const applyRemote = useCallback(
    (remote: {
      splash_image_url: string | null;
      splash_bg_color: string;
      app_icon_url: string | null;
      icon_changed_at: string | null;
    }) => {
      setState((prev) => {
        const next: BrandingState = {
          splashImageUri: remote.splash_image_url ?? null,
          splashBgColor: remote.splash_bg_color ?? DEFAULT_BRANDING.splashBgColor,
          appIconUri: remote.app_icon_url ?? null,
          iconChangedAt: remote.icon_changed_at ?? null,
          iconAckAt: ackRef.current ?? prev.iconAckAt,
        };
        persistLocal(next);
        return next;
      });
    },
    [persistLocal]
  );

  // 1) Hydrate from AsyncStorage (instant), then 2) refresh from Supabase.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && mounted) {
          const parsed = JSON.parse(raw) as Partial<BrandingState>;
          const merged = { ...DEFAULT_BRANDING, ...parsed };
          ackRef.current = merged.iconAckAt;
          setState(merged);
        }
      } catch (e) {
        console.log("[branding] load error", e);
      } finally {
        if (mounted) setHydrated(true);
      }

      const remote = await fetchRemoteBranding();
      if (remote && mounted) {
        applyRemote(remote);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [applyRemote]);

  // Realtime sync — when the admin publishes new branding, every device picks
  // it up without needing a relaunch.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("app_branding_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: BRANDING_TABLE },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null;
          if (!row) return;
          applyRemote({
            splash_image_url: (row.splash_image_url as string | null) ?? null,
            splash_bg_color:
              (row.splash_bg_color as string | null) ?? DEFAULT_BRANDING.splashBgColor,
            app_icon_url: (row.app_icon_url as string | null) ?? null,
            icon_changed_at: (row.icon_changed_at as string | null) ?? null,
          });
        }
      )
      .subscribe();
    return () => {
      try {
        supabase?.removeChannel(channel);
      } catch {}
    };
  }, [applyRemote]);

  const setSplash = useCallback(
    async (localUriOrPublicUrl: string | null, bg: string): Promise<boolean> => {
      let publicUrl: string | null = localUriOrPublicUrl;
      if (
        localUriOrPublicUrl &&
        !localUriOrPublicUrl.startsWith("http://") &&
        !localUriOrPublicUrl.startsWith("https://")
      ) {
        publicUrl = await uploadBrandingImage(localUriOrPublicUrl, "splash");
        if (!publicUrl) return false;
      }
      const remote = await updateRemoteBranding({
        splash_image_url: publicUrl,
        splash_bg_color: bg,
      });
      if (!remote) return false;
      applyRemote(remote);
      return true;
    },
    [applyRemote]
  );

  const setAppIcon = useCallback(
    async (localUriOrPublicUrl: string | null): Promise<boolean> => {
      let publicUrl: string | null = localUriOrPublicUrl;
      if (
        localUriOrPublicUrl &&
        !localUriOrPublicUrl.startsWith("http://") &&
        !localUriOrPublicUrl.startsWith("https://")
      ) {
        publicUrl = await uploadBrandingImage(localUriOrPublicUrl, "icon");
        if (!publicUrl) return false;
      }
      const now = new Date().toISOString();
      const remote = await updateRemoteBranding({
        app_icon_url: publicUrl,
        icon_changed_at: now,
      });
      if (!remote) return false;
      applyRemote(remote);
      return true;
    },
    [applyRemote]
  );

  const acknowledgeIconChange = useCallback(async () => {
    setState((prev) => {
      const next = { ...prev, iconAckAt: prev.iconChangedAt };
      ackRef.current = next.iconAckAt;
      persistLocal(next);
      return next;
    });
  }, [persistLocal]);

  const reset = useCallback(async () => {
    const remote = await updateRemoteBranding({
      splash_image_url: null,
      splash_bg_color: DEFAULT_BRANDING.splashBgColor,
      app_icon_url: null,
      icon_changed_at: new Date().toISOString(),
    });
    if (remote) applyRemote(remote);
  }, [applyRemote]);

  const hasUnacknowledgedIconChange = useMemo<boolean>(() => {
    if (!state.iconChangedAt) return false;
    return state.iconAckAt !== state.iconChangedAt;
  }, [state.iconChangedAt, state.iconAckAt]);

  return {
    ...state,
    hydrated,
    hasUnacknowledgedIconChange,
    setSplash,
    setAppIcon,
    acknowledgeIconChange,
    reset,
  };
});
