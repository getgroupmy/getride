import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { darkColors, lightColors } from "@/constants/colors";

const queryClient = new QueryClient();

/**
 * Root layout for the rebuilt app.
 *
 * Deliberately thin. The legacy app stacked twelve providers here; each one is
 * re-introduced as the phase that needs it lands, so nothing sits in the tree
 * before there is a screen depending on it.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? darkColors : lightColors;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: "GET.ride" }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
