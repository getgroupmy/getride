import React, { useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  useWindowDimensions,
  PanResponder,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Car,
  Clock,
  Truck,
  Bell,
  Shield,
  Settings,
  HelpCircle,
  MessageCircle,
  ChevronRight,
  Facebook,
  Instagram,
  LogOut,
  BookOpen,
  ShieldCheck,
  FileText,
  Gift,
  Heart,
  Mail,
  MapPin,
  Phone,
  Star,
  Tag,
  User,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { isMotionReduced, useReducedMotion } from "@/hooks/useReducedMotion";
import { motionDuration, motionSpring } from "@/utils/reducedMotion";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/contexts/PushNotificationContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import PartnerModeSelectModal, { PartnerMode, PartnerModeOption } from "@/components/PartnerModeSelectModal";
import {
  computeFirstStep,
  fetchUserProfile,
  findOrCreatePartner,
} from "@/utils/partnerOnboardingStore";
import { loadAssignedPartnerModeOptions, isVehicleRequiredForMode } from "@/utils/partnerModeOptions";
import { checkPartnerModeDocuments, summarizeDocIssues } from "@/utils/partnerModeDocCheck";
import {
  computeFirstVehicleStep,
  fetchPartnerVehicle,
} from "@/utils/vehicleOnboardingStore";
import {
  fetchAssignableVehicles,
  claimVehicle,
  type AssignableVehicle,
} from "@/utils/vehicleAssignmentStore";
import VehicleSelectModal from "@/components/VehicleSelectModal";
import { Alert } from "react-native";
import { useAdminData } from "@/contexts/AdminDataContext";
import { useDisplaySettings, DEFAULT_USER_MENU_ITEMS, getMenuItemOrder, PROFILE_MENU_ITEM_ID, PARTNER_MODE_MENU_ITEM_ID, PARTNER_MODE_DEFAULT_LABEL } from "@/contexts/DisplaySettingsContext";
import { useAdminAccess, markSuperAdminSession } from "@/contexts/AdminAccessContext";
import { evaluateCurrentIp } from "@/utils/ipAccessStore";

// Placeholder rider rating until per-account ratings are wired up. Kept as a
// single constant so the stars and the numeral can never disagree.
const PROFILE_RATING = 4.8;

const SIDE_MENU_ICON_MAP: Record<string, LucideIcon> = {
  Bell,
  BookOpen,
  Car,
  Clock,
  FileText,
  Gift,
  HelpCircle,
  Heart,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Settings,
  Shield,
  Star,
  Tag,
  User,
  Wallet,
};

interface MenuSideSheetProps {
  visible: boolean;
  onClose: () => void;
  onNavigateToIndex?: () => void;
  inline?: boolean;
}

export default function MenuSideSheet({ visible, onClose, onNavigateToIndex, inline = false }: MenuSideSheetProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const Colors = useColors();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { logout, authState, profile, refreshProfile } = useAuth();
  const { unregister } = usePushNotifications();
  const { rows: adminAccessRows, isSuper, refresh: refreshAdminAccess } = useAdminAccess();
  const { settings, refresh: refreshDisplaySettings } = useDisplaySettings();
  const showAdminLogin = isSuper || adminAccessRows.length > 0;
  const [adminChecking, setAdminChecking] = React.useState<boolean>(false);

  // Re-check admin_access membership whenever the sheet opens so newly granted
  // access shows up without needing an app restart.
  useEffect(() => {
    if (visible) {
      refreshAdminAccess();
      // Pull the latest admin display config (e.g. "Coming Soon" toggles) so it
      // applies immediately when the menu opens instead of after the next poll.
      refreshDisplaySettings();
    }
  }, [visible, refreshAdminAccess, refreshDisplaySettings]);
  const [liveProfile, setLiveProfile] = React.useState<{ name: string; avatar: string } | null>(null);

  // Mirror profile.tsx exactly: fetch name/avatar directly from public.profiles
  // whenever the sheet becomes visible. Guarantees the sheet shows the same
  // value the Profile screen shows, regardless of session type or cache state.
  // Keep liveProfile in sync with the shared AuthContext cache so any update
  // (e.g. edit-profile saving a new avatar) propagates here immediately — even
  // while the sheet is already mounted.
  useEffect(() => {
    if (!profile) return;
    setLiveProfile({
      name: profile.name ?? "",
      avatar: profile.avatar_url ?? profile.profile_image ?? "",
    });
  }, [profile?.name, profile?.avatar_url, profile?.profile_image]);

  // Every time the sheet is launched, re-pull the profile (name + avatar) from
  // Supabase via the shared AuthContext cache. This guarantees the avatar URL
  // reflects the latest upload (e.g. edit-profile just saved a new image) and
  // also covers the case where the local cache is missing it.
  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    (async () => {
      try {
        // Shared refresh — updates AuthContext.profile, which our other
        // useEffect mirrors into liveProfile.
        await refreshProfile();
        // Direct fallback fetch in case the shared refresh is gated (e.g.
        // legacy/PIN session). Keeps the sheet usable on every code path.
        if (isSupabaseConfigured && supabase && authState.userId) {
          const { data: row, error } = await supabase
            .from("profiles")
            .select("name, avatar_url, profile_image")
            .eq("id", authState.userId)
            .maybeSingle();
          if (!error && row && !cancelled) {
            setLiveProfile({
              name: (row as { name?: string | null }).name ?? "",
              avatar:
                (row as { avatar_url?: string | null }).avatar_url ??
                (row as { profile_image?: string | null }).profile_image ??
                "",
            });
          }
        }
      } catch (e) {
        console.log("[menu-sheet] profile fetch error", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, authState.userId, refreshProfile]);

  const resolvedName =
    liveProfile?.name || profile?.name || authState.profileName || "";
  const displayName = resolvedName || authState.phoneNumber || "User";
  const avatarUri =
    liveProfile?.avatar ||
    profile?.avatar_url ||
    profile?.profile_image ||
    authState.profileAvatar ||
    null;
  const initialChar = (resolvedName || authState.phoneNumber || "U")
    .trim()
    .charAt(0)
    .toUpperCase();
  const MENU_WIDTH = width * 0.68;
  
  const [modalVisible, setModalVisible] = React.useState(false);
  const [driverModeVisible, setDriverModeVisible] = React.useState(false);
  const [partnerModeOptions, setPartnerModeOptions] = React.useState<PartnerModeOption[]>([]);
  const [vehiclePickerVisible, setVehiclePickerVisible] = React.useState<boolean>(false);
  const [vehiclePickerLoading, setVehiclePickerLoading] = React.useState<boolean>(false);
  const [pickerVehicles, setPickerVehicles] = React.useState<AssignableVehicle[]>([]);
  const [pendingMode, setPendingMode] = React.useState<string>("");
  const { getEntries } = useAdminData();
  const slideAnim = useRef(new Animated.Value(-width * 0.68)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const menuWidthRef = useRef(MENU_WIDTH);
  const isAnimatingRef = useRef(false);
  const dragOffset = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return gestureState.dx < -5 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
    },
    onPanResponderGrant: () => {
      console.log("Menu swipe started");
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx < 0) {
        dragOffset.setValue(gestureState.dx);
        const progress = Math.min(1, Math.abs(gestureState.dx) / menuWidthRef.current);
        overlayOpacity.setValue(1 - progress);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      const shouldClose = gestureState.dx < -menuWidthRef.current * 0.3 || gestureState.vx < -0.5;
      
      if (shouldClose) {
        const remainingDistance = menuWidthRef.current + gestureState.dx;
        const velocity = Math.abs(gestureState.vx);
        const duration = Math.max(100, Math.min(200, remainingDistance / Math.max(velocity, 0.5)));
        
        Animated.parallel([
          Animated.timing(dragOffset, {
            toValue: -menuWidthRef.current,
            duration: motionDuration(duration, "transition", isMotionReduced()),
            useNativeDriver: true,
          }),
          Animated.timing(overlayOpacity, {
            toValue: 0,
            duration,
            useNativeDriver: true,
          }),
        ]).start(() => {
          slideAnim.setValue(-menuWidthRef.current);
          dragOffset.setValue(0);
          setModalVisible(false);
          onClose();
        });
      } else {
        Animated.parallel([
          Animated.spring(dragOffset, motionSpring({
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }, "transition", isMotionReduced())),
          Animated.timing(overlayOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    },
  }), [dragOffset, overlayOpacity, onClose, slideAnim]);

  useEffect(() => {
    menuWidthRef.current = MENU_WIDTH;
    if (!visible) {
      slideAnim.setValue(-MENU_WIDTH);
    }
  }, [MENU_WIDTH, slideAnim, visible]);

  useEffect(() => {
    const currentMenuWidth = menuWidthRef.current;
    
    if (visible) {
      isAnimatingRef.current = true;
      setModalVisible(true);
      slideAnim.setValue(-currentMenuWidth);
      overlayOpacity.setValue(0);
      dragOffset.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, motionSpring({
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }, "transition", reducedMotion)),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimatingRef.current = false;
      });
    } else {
      isAnimatingRef.current = true;
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -currentMenuWidth,
          duration: motionDuration(150, "transition", reducedMotion),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimatingRef.current = false;
        setModalVisible(false);
        dragOffset.setValue(0);
      });
    }
  }, [visible, slideAnim, overlayOpacity, dragOffset, reducedMotion]);

  const handleLogout = async () => {
    console.log("Logging out...");
    await unregister();
    await logout();
    onClose();
  };

  const userCfg = settings.userMenu;
  const goHome = () => {
    onClose();
    if (onNavigateToIndex) {
      onNavigateToIndex();
    } else {
      router.replace("/" as any);
    }
  };
  const defaultIconsById: Record<string, LucideIcon> = {
    "teksi-ev": Zap,
    "city": Car,
    "request-history": Clock,
    "freight": Truck,
    "wallet": Wallet,
    "notifications": Bell,
    "safety": Shield,
    "settings": Settings,
    "user-guide": BookOpen,
    "help": HelpCircle,
    "support": MessageCircle,
    "logout": LogOut,
  };
  const defaultPressById: Record<string, () => void> = {
    "teksi-ev": () => {
      onClose();
      setTimeout(() => router.push("/teksi-ev" as any), 150);
    },
    "city": goHome,
    "request-history": goHome,
    "freight": goHome,
    "wallet": () => {
      onClose();
      setTimeout(() => router.push("/wallet" as any), 150);
    },
    "notifications": goHome,
    "safety": () => {
      onClose();
      setTimeout(() => router.push("/safety" as any), 150);
    },
    "settings": () => {
      onClose();
      router.push("/settings" as any);
    },
    "user-guide": () => {
      onClose();
      router.push("/user-guide" as any);
    },
    "help": () => {
      onClose();
      setTimeout(() => router.push("/support" as any), 150);
    },
    "support": () => {
      onClose();
      setTimeout(() => router.push("/support" as any), 150);
    },
    "logout": handleLogout,
  };
  const userHiddenSet = new Set(userCfg.hidden ?? []);
  const userComingSoonSet = new Set(userCfg.comingSoon ?? []);
  const [comingSoonVisible, setComingSoonVisible] = React.useState<boolean>(false);
  // Show an in-app popup (NOT Alert.alert, which is a no-op on React Native Web
  // and silently fails in the preview). We deliberately do not call onClose here
  // because these sheets are conditionally mounted by their parents — closing
  // first would unmount this component before the popup could render.
  const showComingSoon = () => {
    setComingSoonVisible(true);
  };
  const userCustomById = new Map(userCfg.customItems.map((c) => [c.id, c]));
  const userDefaultLabels = new Map(DEFAULT_USER_MENU_ITEMS.map((d) => [d.id, d.label]));
  const menuItems = [
    ...getMenuItemOrder(DEFAULT_USER_MENU_ITEMS, userCfg)
      .filter((o) => !userHiddenSet.has(o.id))
      .map((o) => {
        const isComingSoon = userComingSoonSet.has(o.id);
        if (o.isCustom) {
          const c = userCustomById.get(o.id);
          return {
            id: o.id,
            icon: SIDE_MENU_ICON_MAP[c?.iconName ?? "Star"] ?? Star,
            label: c?.label ?? "",
            onPress: isComingSoon
              ? showComingSoon
              : () => {
                  onClose();
                  if (c?.route) {
                    setTimeout(() => router.push(c.route as any), 150);
                  }
                },
          };
        }
        const override = userCfg.routes[o.id];
        const basePress = isComingSoon
          ? showComingSoon
          : override
          ? () => {
              onClose();
              setTimeout(() => router.push(override as any), 150);
            }
          : defaultPressById[o.id] ?? goHome;
        const onPress = () => {
          console.log(`[menu-sheet] tapped "${o.id}" comingSoon=${isComingSoon}`);
          basePress();
        };
        return {
          id: o.id,
          icon: defaultIconsById[o.id] ?? Settings,
          label: userCfg.renames[o.id] ?? userDefaultLabels.get(o.id) ?? o.id,
          onPress,
        };
      }),
  ];

  const profileHidden = userHiddenSet.has(PROFILE_MENU_ITEM_ID);
  const profileComingSoon = userComingSoonSet.has(PROFILE_MENU_ITEM_ID);
  const partnerModeHidden = userHiddenSet.has(PARTNER_MODE_MENU_ITEM_ID);
  const partnerModeComingSoon = userComingSoonSet.has(PARTNER_MODE_MENU_ITEM_ID);
  const partnerModeLabel = userCfg.renames[PARTNER_MODE_MENU_ITEM_ID] ?? PARTNER_MODE_DEFAULT_LABEL;
  const menuContent = (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      {profileHidden ? (
        <View style={{ paddingTop: insets.top + 12 }} />
      ) : (
      <View style={[styles.profileSection, { borderBottomColor: Colors.border, paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.profileContainer}
          onPress={() => {
            if (profileComingSoon) {
              showComingSoon();
              return;
            }
            onClose();
            setTimeout(() => router.push("/profile" as any), 150);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${displayName}, rated ${PROFILE_RATING} out of 5. Open profile`}
          testID="menu-profile-open"
        >
          <View style={[styles.avatar, { backgroundColor: Colors.accent + '30' }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarText, { color: Colors.accentText }]}>{initialChar}</Text>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: Colors.text }]} numberOfLines={1}>{displayName}</Text>
            <View style={styles.ratingContainer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.ratingStars}>
                {[1, 2, 3, 4, 5].map((slot) => (
                  <Star
                    key={slot}
                    size={14}
                    color={Colors.accentText}
                    fill={slot <= Math.round(PROFILE_RATING) ? Colors.accent : "transparent"}
                  />
                ))}
              </View>
              <Text style={[styles.ratingText, { color: Colors.text }]}>{PROFILE_RATING.toFixed(1)}</Text>
            </View>
          </View>
          <ChevronRight color={Colors.textSecondary} size={24} />
        </TouchableOpacity>
      </View>
      )}

      <ScrollView
        style={styles.menuItems}
        contentContainerStyle={styles.menuItemsContent}
        showsVerticalScrollIndicator={false}
      >
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.menuItem}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <item.icon color={Colors.textSecondary} size={24} />
            <Text style={[styles.menuItemText, { color: Colors.text }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {partnerModeHidden ? null : (
        <TouchableOpacity
          style={[styles.driverModeButton, { backgroundColor: Colors.accent }]}
          onPress={async () => {
            console.log("Partner mode tapped");
            if (partnerModeComingSoon) {
              showComingSoon();
              return;
            }
            const uid = authState.userId;
            if (!uid) {
              setDriverModeVisible(true);
              return;
            }
            try {
              const prof = await fetchUserProfile(uid);
              const part = await findOrCreatePartner(uid, prof);
              const step = computeFirstStep(prof, part);
              if (step === "done") {
                const opts = await loadAssignedPartnerModeOptions(uid, getEntries);
                setPartnerModeOptions(opts);
                setDriverModeVisible(true);
              } else {
                onClose();
                setTimeout(() => router.push("/partner-onboarding" as never), 200);
              }
            } catch (e) {
              console.log("[menu-sheet] partner-mode gating failed", e);
              setDriverModeVisible(true);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel={partnerModeLabel}
          testID="driver-mode-button"
        >
          <Text style={[styles.driverModeText, { color: Colors.onAccent }]}>{partnerModeLabel}</Text>
        </TouchableOpacity>
        )}

        {showAdminLogin ? (
          <TouchableOpacity
            style={[styles.adminLoginButton, { borderColor: Colors.accent, backgroundColor: Colors.accent + "10", opacity: adminChecking ? 0.6 : 1 }]}
            disabled={adminChecking}
            onPress={async () => {
              console.log("Admin login tapped");
              setAdminChecking(true);
              try {
                const { ip, status } = await evaluateCurrentIp();
                if (status === "whitelist") {
                  console.log("[menu-sheet] whitelisted IP bypass", ip);
                  await markSuperAdminSession();
                  onClose();
                  setTimeout(() => {
                    router.replace("/admin-dashboard" as any);
                  }, 200);
                  return;
                }
                onClose();
                setTimeout(() => {
                  router.push("/admin-login" as any);
                }, 200);
              } catch (e) {
                console.log("[menu-sheet] admin IP check failed", e);
                onClose();
                setTimeout(() => {
                  router.push("/admin-login" as any);
                }, 200);
              } finally {
                setAdminChecking(false);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ disabled: adminChecking, busy: adminChecking }}
            accessibilityLabel={adminChecking ? "Checking admin access" : "Admin login"}
            testID="admin-login-button"
          >
            <ShieldCheck color={Colors.accentText} size={18} />
            <Text style={[styles.adminLoginText, { color: Colors.accentText }]}>
              {adminChecking ? "Checking…" : "Admin login"}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.socialContainer}>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => console.log("Facebook")}
            accessibilityRole="link"
            accessibilityLabel="GET.ride on Facebook"
          >
            <View style={styles.facebookIcon}>
              <Facebook color="#FFFFFF" size={22} fill="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => console.log("Instagram")}
            accessibilityRole="link"
            accessibilityLabel="GET.ride on Instagram"
          >
            <View style={styles.instagramIcon}>
              <Instagram color="#FFFFFF" size={22} />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );

  const handleSelectMode = async (mode: PartnerMode) => {
    console.log("Selected partner mode:", mode);
    setDriverModeVisible(false);
    onClose();
    const normalized = mode.trim().toLowerCase();

    // Cross-check the partner's required documents for this partner type.
    // If any compulsory doc is missing, rejected, or expired, route the
    // partner to /partner-documents instead of letting them go online.
    try {
      const docCheck = await checkPartnerModeDocuments(
        authState.userId,
        mode,
        getEntries
      );
      if (docCheck.blockingIssues.length > 0) {
        const body = summarizeDocIssues(docCheck.blockingIssues);
        Alert.alert(
          "Update required documents",
          `Before you can go online as ${mode}, please update the following:\n\n${body}`,
          [
            { text: "Not now", style: "cancel" as const },
            {
              text: "Update documents",
              onPress: () => {
                setTimeout(
                  () => router.push("/partner-documents" as never),
                  200
                );
              },
            },
          ]
        );
        return;
      }
    } catch (e) {
      console.log("[menu-sheet] doc-check failed, continuing", e);
    }

    // If the picked partner type requires a vehicle, gate routing on the
    // partner having an assigned vehicle. Missing → run vehicle onboarding.
    // Uses the cache-first helper with a Supabase fallback so a not-yet-synced
    // settings cache never silently skips the vehicle picker.
    let needsVehicle = false;
    try {
      needsVehicle = await isVehicleRequiredForMode(mode, getEntries);
      console.log("[menu-sheet] needsVehicle for", normalized, "=", needsVehicle);
    } catch (e) {
      console.log("[menu-sheet] vehicleRequired lookup failed", e);
    }

    if (needsVehicle && authState.userId) {
      try {
        // Show the picker with whatever vehicles the user already has
        // assigned or added. If they have none, we still surface the picker
        // so they can hit "Add a new vehicle" and run vehicle-onboarding.
        setPendingMode(mode);
        setVehiclePickerVisible(true);
        setVehiclePickerLoading(true);
        const list = await fetchAssignableVehicles(authState.userId);
        setPickerVehicles(list);
        setVehiclePickerLoading(false);
        // If they have an in-progress onboarding (a stub row with missing
        // fields), still let them pick it — the picker will show "Pending
        // review" and steer them to add-new.
        // Auto-skip the picker entirely only when there are zero vehicles
        // AND no in-flight partner record — that way new users go straight
        // to vehicle-onboarding.
        if (list.length === 0) {
          // No vehicles at all → check partner onboarding fallback.
          const prof = await fetchUserProfile(authState.userId);
          const part = await findOrCreatePartner(authState.userId, prof);
          if (part) {
            const vehicle = await fetchPartnerVehicle(part.id);
            const step = computeFirstVehicleStep(vehicle);
            if (step !== "done") {
              setVehiclePickerVisible(false);
              setTimeout(
                () =>
                  router.push({
                    pathname: "/vehicle-onboarding" as never,
                    params: { partnerType: mode },
                  } as never),
                200
              );
              return;
            }
          }
        }
        return; // Wait for the user to pick from the modal.
      } catch (e) {
        console.log("[menu-sheet] vehicle gating failed", e);
        setVehiclePickerLoading(false);
      }
    }

    routeToPartnerScreen(normalized);
  };

  const routeToPartnerScreen = (modeNormalized: string, vehicleId?: string) => {
    setTimeout(() => {
      const params = vehicleId ? { vehicleId } : undefined;
      if (modeNormalized === "teksi" || modeNormalized.includes("taxi")) {
        router.push({ pathname: "/partner-teksi" as never, params } as never);
      } else {
        router.push({ pathname: "/partner-ehailing" as never, params } as never);
      }
    }, 200);
  };

  const handleVehiclePicked = async (row: AssignableVehicle) => {
    if (!authState.userId) return;
    // Guard: only fully-selectable rows go through claim_vehicle. Incomplete /
    // Pending review / Contact Admin rows are routed to the status / resume
    // flow instead so we never surface the misleading "not assigned" alert
    // for a vehicle the user actually owns but hasn't finished setting up.
    if (!row.selectable) {
      console.log(
        "[menu-sheet] non-selectable vehicle tapped — routing to status/resume",
        { vehicleId: row.vehicle.id, statusLabel: row.statusLabel }
      );
      handleViewVehicleStatus(row);
      return;
    }
    setVehiclePickerLoading(true);
    // `row.vehicle.id` is the Supabase UUID from the `vehicle` table — the
    // same column `claim_vehicle(p_vehicle_id uuid, ...)` expects. Never
    // pass a display_id here.
    const res = await claimVehicle(row.vehicle.id, authState.userId);
    setVehiclePickerLoading(false);
    if (!res.ok) {
      const message =
        res.reason === "vehicle_in_use"
          ? "This vehicle is already being used by another driver. Please pick another one or wait until it goes offline."
          : res.reason === "user_busy"
          ? "You're already driving another vehicle. Please go offline on that one first."
          : res.reason === "not_assigned"
          ? "You're not assigned to this vehicle."
          : "Couldn't start the session. Please try again.";
      Alert.alert("Can't use this vehicle", message);
      return;
    }
    setVehiclePickerVisible(false);
    const mode = pendingMode.trim().toLowerCase();
    routeToPartnerScreen(mode, row.vehicle.id);
  };

  const handleAddNewVehicle = () => {
    setVehiclePickerVisible(false);
    setTimeout(
      () =>
        router.push({
          pathname: "/vehicle-onboarding" as never,
          params: { partnerType: pendingMode, addNew: "1" },
        } as never),
      200
    );
  };

  const handleViewVehicleStatus = (row: AssignableVehicle) => {
    setVehiclePickerVisible(false);
    // Incomplete rows resume the onboarding flow instead of opening the
    // status screen. The vehicle-onboarding screen branches on `role` —
    // non-owners must verify the owner ID before resuming.
    const params: Record<string, string> = {
      partnerType: pendingMode,
      vehicleId: row.vehicle.id,
    };
    if (row.incomplete) {
      params.resume = "1";
      params.role = row.role;
    } else {
      params.viewStatus = "1";
    }
    setTimeout(
      () =>
        router.push({
          pathname: "/vehicle-onboarding" as never,
          params,
        } as never),
      200
    );
  };

  const partnerModeModal = (
    <>
      <PartnerModeSelectModal
        visible={driverModeVisible}
        onClose={() => setDriverModeVisible(false)}
        onSelect={handleSelectMode}
        options={partnerModeOptions}
      />
      <VehicleSelectModal
        visible={vehiclePickerVisible}
        loading={vehiclePickerLoading}
        vehicles={pickerVehicles}
        serviceName={pendingMode}
        onClose={() => setVehiclePickerVisible(false)}
        onSelect={handleVehiclePicked}
        onViewStatus={handleViewVehicleStatus}
        onAddNew={handleAddNewVehicle}
      />
    </>
  );

  const comingSoonModal = (
    <Modal
      visible={comingSoonVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setComingSoonVisible(false)}
      statusBarTranslucent
    >
      <View style={styles.csOverlay}>
        <View style={[styles.csCard, { backgroundColor: Colors.secondary }]}>
          <Text style={[styles.csTitle, { color: Colors.text }]}>Coming Soon</Text>
          <Text style={[styles.csBody, { color: Colors.textSecondary }]}>This feature isn&apos;t available yet.</Text>
          <TouchableOpacity
            style={[styles.csButton, { backgroundColor: Colors.accent }]}
            onPress={() => setComingSoonVisible(false)}
            testID="coming-soon-ok"
            accessibilityRole="button"
          >
            <Text style={[styles.csButtonText, { color: Colors.onAccent }]}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (inline) {
    return (
      <View style={[styles.inlineMenu, { backgroundColor: Colors.secondary }]}>
        {menuContent}
        {partnerModeModal}
        {comingSoonModal}
      </View>
    );
  }

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.overlay,
            {
              opacity: overlayOpacity,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.overlayTouchable}
            activeOpacity={1}
            onPress={onClose}
            accessibilityRole="button"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.menu,
            {
              width: MENU_WIDTH,
              backgroundColor: Colors.secondary,
              transform: [{ translateX: Animated.add(slideAnim, dragOffset) }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          {menuContent}
        </Animated.View>
        {partnerModeModal}
        {comingSoonModal}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  overlayTouchable: {
    flex: 1,
  },
  menu: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  inlineMenu: {
    flex: 1,
    height: "100%" as const,
  },
  safeArea: {
    flex: 1,
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  profileContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    overflow: "hidden" as const,
  },
  avatarImage: { width: "100%" as const, height: "100%" as const },
  avatarText: {
    fontSize: 24,
    fontWeight: "700" as const,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingStars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },
  menuItems: {
    flex: 1,
  },
  menuItemsContent: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  driverModeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 8,
  },
  driverModeText: {
    fontSize: 18,
    fontWeight: "700" as const,
  },
  adminLoginButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  adminLoginText: {
    fontSize: 15,
    fontWeight: "700" as const,
  },
  socialContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
  },
  socialButton: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  facebookIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1877F2",
    justifyContent: "center",
    alignItems: "center",
  },
  instagramIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E4405F",
    justifyContent: "center",
    alignItems: "center",
  },
  csOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 40,
  },
  csCard: {
    width: "100%" as const,
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    alignItems: "center" as const,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  csTitle: {
    fontSize: 19,
    fontWeight: "700" as const,
    marginBottom: 8,
  },
  csBody: {
    fontSize: 15,
    textAlign: "center" as const,
    marginBottom: 20,
  },
  csButton: {
    alignSelf: "stretch" as const,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center" as const,
  },
  csButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
  },
});
