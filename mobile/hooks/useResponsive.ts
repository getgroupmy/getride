import { useEffect, useState } from "react";
import { Dimensions, Platform, ScaledSize } from "react-native";

export type ResponsiveInfo = {
  width: number;
  height: number;
  isTablet: boolean;
  isLargeTablet: boolean;
  isPortrait: boolean;
  scale: number;
  contentMaxWidth: number;
};

function compute(window: ScaledSize): ResponsiveInfo {
  const { width, height } = window;
  const shortest = Math.min(width, height);
  const isPortrait = height >= width;
  const isTablet =
    Platform.OS !== "web"
      ? shortest >= 600
      : shortest >= 768;
  const isLargeTablet = shortest >= 900;
  const scale = isLargeTablet ? 1.25 : isTablet ? 1.15 : 1;
  const contentMaxWidth = width;
  return {
    width,
    height,
    isTablet,
    isLargeTablet,
    isPortrait,
    scale,
    contentMaxWidth,
  };
}

export function useResponsive(): ResponsiveInfo {
  const [info, setInfo] = useState<ResponsiveInfo>(() =>
    compute(Dimensions.get("window"))
  );

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setInfo(compute(window));
    });
    return () => {
      sub.remove();
    };
  }, []);

  return info;
}

export default useResponsive;
