import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { lightColors, darkColors } from "@/constants/colors";

export function useColors() {
  const { colorScheme } = useTheme();

  const colors = useMemo(() => {
    return colorScheme === "dark" ? darkColors : lightColors;
  }, [colorScheme]);

  return colors;
}
