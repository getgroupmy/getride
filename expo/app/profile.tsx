import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Mail,
  Phone,
  Star,
  Shield,
  KeyRound,
  LogOut,
  User as UserIcon,
  CheckCircle2,
  Globe2,
  IdCard,
  MapPin,
  Lock,
  UserPlus,
} from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/contexts/PushNotificationContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import { fetchMyReferrer, type MyReferrer } from "@/utils/referral";

interface ProfileData {
  name: string;
  email: string;
  avatar: string;
  country: string;
  idNumber: string;
  address: string;
  idImage: string;
}

/**
 * User profile screen. Read-only display of the signed-in user's details.
 * Tapping the profile image navigates to the edit-profile screen.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const Colors = useColors();
  const styles = makeStyles(Colors);
  const { authState, logout, hasPinSet, forgotPin, refreshProfile } = useAuth();
  const { unregister } = usePushNotifications();

  const [data, setData] = useState<ProfileData>({ name: "", email: "", avatar: "", country: "", idNumber: "", address: "", idImage: "" });
  const [referrer, setReferrer] = useState<MyReferrer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = React.useCallback(
    (message: string) => {
      setToastMsg(message);
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => setToastMsg(null));
      }, 2400);
    },
    [toastAnim]
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const load = React.useCallback(async () => {
    try {
      if (isSupabaseConfigured && supabase && authState.userId) {
        const { data: row, error } = await supabase
          .from("profiles")
          .select("name, email, avatar_url, nationality, ic, address, id_image")
          .eq("id", authState.userId)
          .maybeSingle();
        if (!error && row) {
          setData({
            name: row.name ?? "",
            email: row.email ?? "",
            avatar: row.avatar_url ?? "",
            country: row.nationality ?? "",
            idNumber: row.ic ?? "",
            address: row.address ?? "",
            idImage: row.id_image ?? "",
          });
          // Push the freshest row into the shared AuthContext cache so the
          // side sheets (and anything else listening) update immediately.
          refreshProfile().catch(() => {});
        }
        // Who invited this user, if anyone (drives the "Referred" badge).
        fetchMyReferrer()
          .then((r) => setReferrer(r))
          .catch(() => {});
      }
    } catch (e) {
      console.log("[profile] load error", e);
    } finally {
      setLoading(false);
    }
  }, [authState.userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh details when returning from the edit screen.
  useFocusEffect(
    React.useCallback(() => {
      load();
      (async () => {
        try {
          const raw = await AsyncStorage.getItem("profile.phoneSyncToast");
          if (!raw) return;
          await AsyncStorage.removeItem("profile.phoneSyncToast");
          let phone: string | undefined;
          try {
            const parsed = JSON.parse(raw) as { phone?: string };
            phone = parsed?.phone;
          } catch {}
          showToast(phone ? `Phone updated to ${phone}` : "Phone number updated");
        } catch (e) {
          console.log("[profile] toast flag read error", e);
        }
      })();
    }, [load, showToast])
  );

  const handleForgotPin = () => {
    Alert.alert(
      "Reset PIN?",
      "This will clear your current sign-in PIN. You'll set a new one now.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset PIN",
          style: "destructive",
          onPress: async () => {
            const ok = await forgotPin();
            if (!ok) {
              Alert.alert("Couldn't reset PIN", "Please try again in a moment.");
              return;
            }
            router.push({
              pathname: "/pin-setup" as any,
              params: {
                phoneNumber: authState.phoneNumber ?? "",
                firstName: data.name ?? "",
              },
            } as any);
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await unregister();
          await logout();
          router.replace("/onboarding" as any);
        },
      },
    ]);
  };

  const pinExists = hasPinSet(authState.phoneNumber ?? "");
  const firstChar = (data.name || authState.phoneNumber || "U").trim().charAt(0).toUpperCase();
  const displayName = data.name || "Unnamed";
  const displayEmail = data.email || "—";
  const displayPhone = authState.phoneNumber ?? "—";

  return (
    <View style={styles.container}>
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="profile-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft color={Colors.text} size={26} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => router.push("/edit-profile" as any)}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="profile-edit"
          >
            <Pencil color={Colors.accent} size={20} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarTouch}
              onPress={() => router.push("/edit-profile" as any)}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              testID="profile-avatar"
              activeOpacity={0.85}
            >
              <View style={[styles.avatar, { backgroundColor: Colors.accent + "25" }]}>
                {data.avatar ? (
                  <Image source={{ uri: data.avatar }} style={styles.avatarImage} />
                ) : (
                  <Text style={[styles.avatarText, { color: Colors.accent }]}>{firstChar}</Text>
                )}
              </View>
              <View style={[styles.editBadge, { backgroundColor: Colors.accent }]}>
                <Pencil color={Colors.onAccent} size={12} />
              </View>
            </TouchableOpacity>
            <Text style={styles.nameText}>{displayName}</Text>
            <Text style={styles.avatarHint}>Tap photo to edit profile</Text>

            <View style={styles.ratingRow}>
              <Star color={Colors.accent} size={16} fill={Colors.accent} />
              <Text style={styles.ratingText}>4.8</Text>
              <Text style={styles.ratingSub}>· Member</Text>
            </View>

            {referrer ? (
              <View style={styles.referredBadge} testID="profile-referred-badge">
                <UserPlus color={Colors.accent} size={13} />
                <Text style={styles.referredBadgeText} numberOfLines={1}>
                  Referred
                  {referrer.name ? (
                    <Text style={styles.referredBadgeName}> · Invited by {referrer.name}</Text>
                  ) : null}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>

            <View style={styles.row}>
              <UserIcon color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Name</Text>
                <Text style={styles.rowValue}>{displayName}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Mail color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Email</Text>
                <Text style={styles.rowValue}>{displayEmail}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Phone color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Phone</Text>
                <Text style={styles.rowValue}>{displayPhone}</Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Identity</Text>

            <View style={styles.row}>
              <Globe2 color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>Country</Text>
                <Text style={styles.rowValue}>{data.country || "—"}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <IdCard color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <View style={styles.lockRow}>
                  <Text style={styles.rowLabel}>Passport / ID Number</Text>
                  <Lock color={Colors.textSecondary} size={11} />
                </View>
                <Text style={styles.rowValue}>{data.idNumber || "—"}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <MapPin color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <View style={styles.lockRow}>
                  <Text style={styles.rowLabel}>Address</Text>
                  <Lock color={Colors.textSecondary} size={11} />
                </View>
                <Text style={styles.rowValue}>{data.address || "—"}</Text>
              </View>
            </View>

            {data.idImage ? (
              <View style={styles.idImageWrap} testID="profile-id-image">
                <Image source={{ uri: data.idImage }} style={styles.idImage} resizeMode="cover" />
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Security</Text>
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() =>
                router.push(
                  pinExists
                    ? ("/change-pin" as any)
                    : ({ pathname: "/pin-setup" as any, params: { phoneNumber: authState.phoneNumber ?? "", firstName: data.name ?? "" } } as any)
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Change your PIN"
              testID="profile-pin"
            >
              <Shield color={Colors.textSecondary} size={18} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{pinExists ? "Change PIN" : "Set PIN"}</Text>
                <Text style={styles.rowValue}>
                  {pinExists ? "Update your sign-in PIN" : "Create a 6-digit sign-in PIN"}
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>

            {pinExists && (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={handleForgotPin}
                testID="profile-forgot-pin"
                accessibilityRole="button"
              >
                <KeyRound color={Colors.textSecondary} size={18} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>Forgot PIN</Text>
                  <Text style={styles.rowValue}>Reset and create a new sign-in PIN</Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.signOut, { borderColor: Colors.border }]}
            onPress={handleSignOut}
            testID="profile-signout"
            accessibilityRole="button"
          >
            <LogOut color="#E11D48" size={18} />
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {toastMsg ? (
        <Animated.View
          style={[
            styles.toast,
            { pointerEvents: "none" },
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
          testID="profile-toast"
        >
          <CheckCircle2 color="#10B981" size={18} />
          <Text style={styles.toastText} numberOfLines={2}>
            {toastMsg}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const makeStyles = (Colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    safeTop: { backgroundColor: Colors.background },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    backBtn: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
    headerTitle: { flex: 1, textAlign: "center" as const, fontSize: 18, fontWeight: "700" as const, color: Colors.text },
    editBtn: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
    loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
    avatarSection: { alignItems: "center" as const, paddingVertical: 20 },
    avatarTouch: { position: "relative" as const },
    avatar: {
      width: 104,
      height: 104,
      borderRadius: 52,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      overflow: "hidden" as const,
    },
    avatarImage: { width: "100%" as const, height: "100%" as const },
    avatarText: { fontSize: 42, fontWeight: "700" as const },
    editBadge: {
      position: "absolute" as const,
      right: -2,
      bottom: -2,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 3,
      borderColor: Colors.background,
    },
    nameText: { fontSize: 20, fontWeight: "700" as const, color: Colors.text, marginTop: 14 },
    avatarHint: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
    ratingRow: { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 10, gap: 4 },
    ratingText: { fontSize: 15, fontWeight: "700" as const, color: Colors.text },
    ratingSub: { fontSize: 13, color: Colors.textSecondary },
    referredBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginTop: 12,
      maxWidth: "100%" as const,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: Colors.accent + "18",
      borderWidth: 1,
      borderColor: Colors.accent + "33",
    },
    referredBadgeText: { flexShrink: 1, fontSize: 12, fontWeight: "700" as const, color: Colors.accent },
    referredBadgeName: { fontWeight: "600" as const, color: Colors.accent },
    section: { marginTop: 24 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700" as const,
      color: Colors.textSecondary,
      letterSpacing: 1,
      textTransform: "uppercase" as const,
      marginBottom: 10,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      backgroundColor: Colors.gray[50],
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 10,
    },
    rowBody: { flex: 1 },
    rowLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 2 },
    rowValue: { fontSize: 15, fontWeight: "600" as const, color: Colors.text },
    lockRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 2 },
    idImageWrap: {
      marginTop: 4,
      borderRadius: 12,
      overflow: "hidden" as const,
      borderWidth: 1,
      borderColor: Colors.border,
      backgroundColor: Colors.gray[50],
    },
    idImage: { width: "100%" as const, height: 180 },
    linkRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      backgroundColor: Colors.gray[50],
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginBottom: 10,
    },
    signOut: {
      marginTop: 24,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      paddingVertical: 14,
    },
    signOutText: { fontSize: 15, fontWeight: "700" as const, color: "#E11D48" },
    toast: {
      position: "absolute" as const,
      left: 20,
      right: 20,
      bottom: 32,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: "#111827",
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    toastText: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "600" as const },
  });
