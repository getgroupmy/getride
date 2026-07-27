import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as ExpoLinking from "expo-linking";
import React, { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConnectionStatusModal } from "@/components/ConnectionStatusModal";
import { SplashScreenComponent } from "@/components/SplashScreenComponent";
import { TabletFrame } from "@/components/TabletFrame";
import { useResponsive } from "@/hooks/useResponsive";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { AdminDataProvider } from "@/contexts/AdminDataContext";
import { AdminAccessProvider } from "@/contexts/AdminAccessContext";
import { DisplaySettingsProvider } from "@/contexts/DisplaySettingsContext";
import { SessionTrackingProvider } from "@/contexts/SessionTrackingContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { EmergencyContactsProvider } from "@/contexts/EmergencyContactsContext";
import { VoiceProtectionProvider } from "@/contexts/VoiceProtectionContext";
import { PushNotificationProvider } from "@/contexts/PushNotificationContext";
import { IpAccessProvider } from "@/contexts/IpAccessContext";
import { AppIconChangeModal } from "@/components/AppIconChangeModal";
import SupportCallListener from "@/components/SupportCallListener";
import IncomingTransferPopup from "@/components/IncomingTransferPopup";
import ReferralBonusToast from "@/components/ReferralBonusToast";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { installGlobalErrorGuard } from "@/utils/globalErrorGuard";
import { capturePendingReferral } from "@/utils/referral";

installGlobalErrorGuard();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { authState, isLoading, serverReachable, isSupabaseAuth, serverError, serverDetails } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const connectionAlertShown = useRef<boolean>(false);
  const [showConnectionModal, setShowConnectionModal] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const { isTablet } = useResponsive();
  const tabletRedirectDone = useRef<boolean>(false);

  useEffect(() => {
    if (isLoading) return;
    if (connectionAlertShown.current) return;
    if (isSupabaseAuth && serverReachable === null) return;
    connectionAlertShown.current = true;
    const connected = isSupabaseAuth ? !!serverReachable : false;
    console.log(
      "[RootLayoutNav] Showing connection status modal connected=",
      connected,
      "isSupabaseAuth=",
      isSupabaseAuth,
      "serverReachable=",
      serverReachable
    );
    setIsConnected(connected);
    setShowConnectionModal(true);
  }, [isLoading, serverReachable, isSupabaseAuth]);

  useEffect(() => {
    if (isLoading) return;

    // pin-setup is intentionally NOT in this list: authenticated users must
    // be able to reach it from the profile screen to (re)create a sign-in PIN.
    const inAuthGroup = segments[0] === "onboarding" || segments[0] === "phone-auth" || segments[0] === "otp-verify" || segments[0] === "pin-verify" || segments[0] === "name-entry" || segments[0] === "role-selection" || segments[0] === "profile-photo";

    console.log("[RootLayoutNav] Auth check complete. authenticated=", authState.isAuthenticated, "segment=", segments[0]);

    if (!authState.isAuthenticated && !inAuthGroup) {
      console.log("[RootLayoutNav] Not authenticated -> /onboarding");
      router.replace("/onboarding" as any);
    } else if (authState.isAuthenticated && inAuthGroup) {
      if (isTablet) {
        console.log("[RootLayoutNav] Authenticated tablet -> /partner-teksi");
        tabletRedirectDone.current = true;
        router.replace("/partner-teksi" as any);
      } else {
        console.log("[RootLayoutNav] Authenticated -> /");
        router.replace("/" as any);
      }
    } else if (
      authState.isAuthenticated &&
      isTablet &&
      !tabletRedirectDone.current &&
      ((segments.length as number) === 0 || (segments[0] as string) === "index" || segments[0] === undefined)
    ) {
      console.log("[RootLayoutNav] Tablet detected on root -> /partner-teksi");
      tabletRedirectDone.current = true;
      router.replace("/partner-teksi" as any);
    }
  }, [authState, segments, isLoading, router, isTablet]);

  if (isLoading) {
    return <SplashScreenComponent />;
  }

  return (
    <>
    <AppIconChangeModal />
    <SupportCallListener />
    <IncomingTransferPopup />
    <ReferralBonusToast />
    <ConnectionStatusModal
      visible={showConnectionModal}
      connected={isConnected}
      errorMessage={serverError}
      details={serverDetails}
      onClose={() => setShowConnectionModal(false)}
      onDiagnose={() => {
        setShowConnectionModal(false);
        router.push("/auth-diagnostics" as any);
      }}
    />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="phone-auth" options={{ gestureEnabled: false }} />
      <Stack.Screen name="otp-verify" options={{ gestureEnabled: false }} />
      <Stack.Screen name="name-entry" options={{ gestureEnabled: false }} />
      <Stack.Screen name="role-selection" options={{ gestureEnabled: false }} />
      <Stack.Screen name="pin-verify" options={{ gestureEnabled: false }} />
      <Stack.Screen name="pin-setup" options={{ gestureEnabled: false }} />
      <Stack.Screen name="profile-photo" options={{ gestureEnabled: false }} />
      <Stack.Screen name="change-pin" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="search" options={{ presentation: "modal", gestureEnabled: false }} />
      <Stack.Screen name="ride-confirm" options={{ gestureEnabled: false }} />
      <Stack.Screen name="ride-tracking" options={{ gestureEnabled: false }} />
      <Stack.Screen name="settings" options={{ gestureEnabled: false }} />
      <Stack.Screen name="map-picker" options={{ presentation: "card", animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="rules-terms" options={{ gestureEnabled: false }} />
      <Stack.Screen name="change-number" options={{ gestureEnabled: false }} />
      <Stack.Screen name="language" options={{ gestureEnabled: false }} />
      <Stack.Screen name="dark-mode" options={{ gestureEnabled: false }} />
      <Stack.Screen name="navigation" options={{ gestureEnabled: false }} />
      <Stack.Screen name="distances" options={{ gestureEnabled: false }} />
      <Stack.Screen name="offer-fare" options={{ gestureEnabled: false }} />
      <Stack.Screen name="partner-onboarding" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="partner-documents" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="vehicle-onboarding" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="partner-teksi" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="partner-ehailing" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="ride-running" options={{ animation: "slide_from_bottom", gestureEnabled: false }} />
      <Stack.Screen name="ride-detail" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-login" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-dashboard" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partner-add" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-approved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-unapproved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-blocked" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-rejected" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-unapproved-docs" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-permit-pending" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-permit-non-verified" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-permit-verified" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-partners-all" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicle-add" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicle-edit" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-approved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-unapproved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-blocked" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-rejected" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-unapproved-docs" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-permit-pending" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-permit-non-verified" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-permit-verified" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-vehicles-all" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-user-add" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-user-edit" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-approved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-unapproved" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-blocked" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-rejected" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-deleted" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-unapproved-docs" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-users-all" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-service" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-display" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-mock" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-commission" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-get-coin" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-vehicle-make-model" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-partner-type" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-required-documents" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-vehicle-services" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-site" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-referral" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-referral-tree" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-sub-admin" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ip-access" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-geo-fencing" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-multi-gate-places" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-multi-gate-place-gates" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-airport-areas" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-country-states-cities" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-api-keys" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-api-keys-services" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-api-keys-keys" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-api-elife" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-payment-type" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-driver-incentive" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-leaderboard" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-rides" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-fare-ai" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-fare-ai-logs" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-promocode" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-insurance-providers" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-insurance-types" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-insurance-durations" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-insurance-premium" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-free-ride" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-fixed-price" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-subscription-plan" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-advertisement-banners" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-push-notification" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-social-links" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-world-currency" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-app-version" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-search-radius" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-page-list" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-email-templates" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-supabase" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-rork-chat" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-splash" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-app-icon" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ev-vehicle-details" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ev-vehicle-inventory" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ev-delivery-advisors" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ev-finance-options" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-settings-ev-order-fee" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-session-history" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-trace-fraud" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-orders" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="teksi-ev" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="profile" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet-history" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet-scan" options={{ animation: "slide_from_bottom", gestureEnabled: false }} />
      <Stack.Screen name="wallet-show-code" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet-receive" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet-trade" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="wallet-coin-qr" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="referral-card" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="edit-profile" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="auth-diagnostics" options={{ animation: "slide_from_right", gestureEnabled: true, presentation: "modal" }} />
      <Stack.Screen name="support" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="support-chat" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-support" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-support-pool" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="admin-support-chat" options={{ animation: "slide_from_right", gestureEnabled: false }} />
      <Stack.Screen name="support-call" options={{ animation: "slide_from_bottom", gestureEnabled: false }} />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  // Referral deep links (…?ref=CODE): capture the code from the URL that
  // opened the app AND from links received while it's running, so it can be
  // applied as a bonus after signup.
  const incomingUrl = ExpoLinking.useURL();

  useEffect(() => {
    console.log("[RootLayout] Mounted, hiding native splash");
    SplashScreen.hideAsync().catch(() => {});
    ExpoLinking.getInitialURL()
      .then((url) => capturePendingReferral(url))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (incomingUrl) {
      capturePendingReferral(incomingUrl).catch(() => {});
    }
  }, [incomingUrl]);

  return (
    <QueryClientProvider client={queryClient}>
      <LocationProvider>
        <AuthProvider>
          <ThemeProvider>
            <AdminDataProvider>
              <AdminAccessProvider>
              <DisplaySettingsProvider>
                <BrandingProvider>
                <SessionTrackingProvider>
                  <EmergencyContactsProvider>
                    <VoiceProtectionProvider>
                      <PushNotificationProvider>
                        <IpAccessProvider>
                        <GestureHandlerRootView style={{ flex: 1 }}>
                          <RootErrorBoundary>
                            <TabletFrame>
                              <RootLayoutNav />
                            </TabletFrame>
                          </RootErrorBoundary>
                        </GestureHandlerRootView>
                        </IpAccessProvider>
                      </PushNotificationProvider>
                    </VoiceProtectionProvider>
                  </EmergencyContactsProvider>
                </SessionTrackingProvider>
                </BrandingProvider>
              </DisplaySettingsProvider>
              </AdminAccessProvider>
            </AdminDataProvider>
          </ThemeProvider>
        </AuthProvider>
      </LocationProvider>
    </QueryClientProvider>
  );
}
