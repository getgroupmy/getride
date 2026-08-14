import { useState, useEffect, useCallback } from "react";
import { Appearance } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";

export type ThemeMode = "off" | "always" | "system";
export type ColorScheme = "light" | "dark";

const THEME_STORAGE_KEY = "@theme_mode";

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("light");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const applyThemeMode = useCallback((mode: ThemeMode) => {
    if (mode === "off") {
      setColorScheme("light");
    } else if (mode === "always") {
      setColorScheme("dark");
    } else {
      const systemScheme = Appearance.getColorScheme();
      setColorScheme(systemScheme === "dark" ? "dark" : "light");
    }
  }, []);

  const loadThemeMode = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (stored) {
        const mode = stored as ThemeMode;
        setThemeModeState(mode);
        applyThemeMode(mode);
      } else {
        applyThemeMode("system");
      }
    } catch (error) {
      console.error("Error loading theme mode:", error);
      applyThemeMode("system");
    } finally {
      setIsLoading(false);
    }
  }, [applyThemeMode]);

  useEffect(() => {
    loadThemeMode();
  }, [loadThemeMode]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme: systemScheme }) => {
      if (themeMode === "system" && systemScheme) {
        setColorScheme(systemScheme === "dark" ? "dark" : "light");
      }
    });

    return () => subscription.remove();
  }, [themeMode]);

  useEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode, applyThemeMode]);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
      applyThemeMode(mode);
    } catch (error) {
      console.error("Error saving theme mode:", error);
    }
  };

  return {
    themeMode,
    colorScheme,
    setThemeMode,
    isLoading,
  };
});
