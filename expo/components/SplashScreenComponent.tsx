import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useBranding, DEFAULT_BRANDING } from "@/contexts/BrandingContext";

export function SplashScreenComponent() {
  // useBranding may not be mounted during the very first paint; guard with try/catch.
  let bg = DEFAULT_BRANDING.splashBgColor;
  let imageUri: string | null = null;
  try {
    const b = useBranding();
    bg = b.splashBgColor ?? DEFAULT_BRANDING.splashBgColor;
    imageUri = b.splashImageUri;
  } catch {
    // Provider not ready yet — fall back to defaults.
  }
  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Image
        source={imageUri ? { uri: imageUri } : require("@/assets/images/splash-icon.png")}
        style={styles.logo}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 280,
    height: 280,
  },
});
