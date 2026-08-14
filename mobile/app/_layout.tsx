import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/contexts/AuthContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

const queryClient = new QueryClient();

/**
 * Providers are added as the phase that needs them lands, rather than all at
 * once: theme, then auth (every ride write is RLS-scoped to a session), then
 * location (the rider surface opens on a fix).
 */
function Navigator() {
  const colors = useColors();
  const { colorScheme } = useTheme();

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome-back" options={{ headerShown: false }} />
        <Stack.Screen name="phone-auth" options={{ headerShown: false }} />
        <Stack.Screen name="otp-verify" options={{ title: "Verify" }} />
        <Stack.Screen name="pin-setup" options={{ title: "Set a PIN" }} />
        <Stack.Screen name="search" options={{ title: "Destination" }} />
        <Stack.Screen name="ride-confirm" options={{ title: "Confirm ride" }} />
        {/* A ride in progress is not something to swipe back out of. */}
        <Stack.Screen
          name="ride-tracking"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="partner-onboarding" options={{ title: "Drive with us" }} />
        <Stack.Screen name="partner-ehailing" options={{ title: "Requests" }} />
        <Stack.Screen
          name="ride-running"
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <LocationProvider>
              <Navigator />
            </LocationProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
