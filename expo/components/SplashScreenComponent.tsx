import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useBranding } from "@/contexts/BrandingContext";

export function SplashScreenComponent() {
  // useBranding may not be mounted during the very first paint; guard with try/catch.
  let bg: string | null = null;
  let imageUri: string | null = null;
  try {
    const b = useBranding();
    imageUri = b.splashImageUri;
    bg = imageUri ? b.splashBgColor : null;
  } catch {
    // Provider not ready yet — render blank until it is.
  }
  return (
    <View style={[styles.container, bg ? { backgroundColor: bg } : null]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.logo} contentFit="contain" />
      ) : null}
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
