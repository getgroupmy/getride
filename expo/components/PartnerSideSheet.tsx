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
  Alert,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  LayoutDashboard,
  Wallet,
  Clock,
  Car,
  FileText,
  Bell,
  HelpCircle,
  Settings,
  ChevronRight,
  LogOut,
  UserRound,
  BookOpen,
  Gift,
  Heart,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Shield,
  Star,
  Tag,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useDisplaySettings, DEFAULT_PARTNER_MENU_ITEMS, getMenuItemOrder } from "@/contexts/DisplaySettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";

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

interface PartnerSideSheetProps {
  visible: boolean;
  onClose: () => void;
}

export default function PartnerSideSheet({ visible, onClose }: PartnerSideSheetProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useDisplaySettings();
  const { authState, profile, refreshProfile } = useAuth();
  const [liveProfile, setLiveProfile] = React.useState<{ name: string; avatar: string } | null>(null);

  // Mirror profile.tsx exactly: fetch name/avatar directly from public.profiles
  // whenever the sheet becomes visible so the header always matches the
  // Profile screen, regardless of cache state or session type.
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
        console.log("[partner-sheet] profile fetch error", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, authState.userId, refreshProfile]);

  const resolvedName =
    liveProfile?.name || profile?.name || authState.profileName || "";
  const displayName = resolvedName || authState.phoneNumber || "Partner";
  const avatarUri =
    liveProfile?.avatar ||
    profile?.avatar_url ||
    profile?.profile_image ||
    authState.profileAvatar ||
    null;
  const MENU_WIDTH = width * 0.68;

  const [modalVisible, setModalVisible] = React.useState<boolean>(false);
  const slideAnim = useRef(new Animated.Value(-width * 0.68)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const menuWidthRef = useRef<number>(MENU_WIDTH);
  const dragOffset = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx < -5 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) {
        dragOffset.setValue(g.dx);
        const progress = Math.min(1, Math.abs(g.dx) / menuWidthRef.current);
        overlayOpacity.setValue(1 - progress);
      }
    },
    onPanResponderRelease: (_, g) => {
      const shouldClose = g.dx < -menuWidthRef.current * 0.3 || g.vx < -0.5;
      if (shouldClose) {
        const remaining = menuWidthRef.current + g.dx;
        const v = Math.abs(g.vx);
        const duration = Math.max(100, Math.min(200, remaining / Math.max(v, 0.5)));
        Animated.parallel([
          Animated.timing(dragOffset, { toValue: -menuWidthRef.current, duration, useNativeDriver: true }),
          Animated.timing(overlayOpacity, { toValue: 0, duration, useNativeDriver: true }),
        ]).start(() => {
          slideAnim.setValue(-menuWidthRef.current);
          dragOffset.setValue(0);
          setModalVisible(false);
          onClose();
        });
      } else {
        Animated.parallel([
          Animated.spring(dragOffset, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }),
          Animated.timing(overlayOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        ]).start();
      }
    },
  }), [dragOffset, overlayOpacity, onClose, slideAnim]);

  useEffect(() => {
    menuWidthRef.current = MENU_WIDTH;
    if (!visible) slideAnim.setValue(-MENU_WIDTH);
  }, [MENU_WIDTH, slideAnim, visible]);

  useEffect(() => {
    const w = menuWidthRef.current;
    if (visible) {
      setModalVisible(true);
      slideAnim.setValue(-w);
      overlayOpacity.setValue(0);
      dragOffset.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
        Animated.timing(overlayOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -w, duration: 150, useNativeDriver: true }),
        Animated.timing(overlayOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        setModalVisible(false);
        dragOffset.setValue(0);
      });
    }
  }, [visible, slideAnim, overlayOpacity, dragOffset]);

  const handleNavigate = (label: string) => {
    onClose();
    setTimeout(() => Alert.alert(label, "Coming soon"), 200);
  };

  const showComingSoon = () => {
    onClose();
    setTimeout(() => Alert.alert("Coming Soon", "This feature isn't available yet.", [{ text: "OK" }]), 200);
  };

  const handleSwitchToRider = () => {
    onClose();
    setTimeout(() => router.replace("/" as any), 200);
  };

  const handleSignOut = () => {
    Alert.alert("Sign out", "Sign out of partner?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          onClose();
          setTimeout(() => router.replace("/" as any), 200);
        },
      },
    ]);
  };

  const partnerCfg = settings.partnerMenu;
  const defaultIconsById: Record<string, LucideIcon> = {
    "teksi-ev": Zap,
    "dashboard": LayoutDashboard,
    "earnings": Wallet,
    "trip-history": Clock,
    "vehicle": Car,
    "documents": FileText,
    "notifications": Bell,
    "safety": Shield,
    "support": HelpCircle,
    "settings": Settings,
    "sign-out": LogOut,
  };
  const defaultPressById: Record<string, () => void> = {
    "teksi-ev": () => {
      onClose();
      setTimeout(() => router.push("/teksi-ev" as any), 200);
    },
    "dashboard": () => onClose(),
    "earnings": () => handleNavigate("Earnings"),
    "trip-history": () => handleNavigate("Trip history"),
    "vehicle": () => handleNavigate("Vehicle"),
    "documents": () => {
      onClose();
      setTimeout(() => router.push("/partner-documents" as any), 200);
    },
    "notifications": () => handleNavigate("Notifications"),
    "safety": () => {
      onClose();
      setTimeout(() => router.push("/safety" as any), 200);
    },
    "support": () => {
      onClose();
      setTimeout(() => router.push("/support" as any), 200);
    },
    "settings": () => {
      onClose();
      setTimeout(() => router.push("/settings" as any), 200);
    },
    "sign-out": handleSignOut,
  };
  const partnerHiddenSet = new Set(partnerCfg.hidden ?? []);
  const partnerComingSoonSet = new Set(partnerCfg.comingSoon ?? []);
  const partnerCustomById = new Map(partnerCfg.customItems.map((c) => [c.id, c]));
  const partnerDefaultLabels = new Map(DEFAULT_PARTNER_MENU_ITEMS.map((d) => [d.id, d.label]));
  const menuItems = [
    ...getMenuItemOrder(DEFAULT_PARTNER_MENU_ITEMS, partnerCfg)
      .filter((o) => !partnerHiddenSet.has(o.id))
      .map((o) => {
        const isComingSoon = partnerComingSoonSet.has(o.id);
        if (o.isCustom) {
          const c = partnerCustomById.get(o.id);
          return {
            icon: SIDE_MENU_ICON_MAP[c?.iconName ?? "Star"] ?? Star,
            label: c?.label ?? "",
            onPress: isComingSoon
              ? showComingSoon
              : () => {
                  onClose();
                  if (c?.route) {
                    setTimeout(() => router.push(c.route as any), 200);
                  } else {
                    setTimeout(() => Alert.alert(c?.label ?? "", "Coming soon"), 200);
                  }
                },
          };
        }
        const override = partnerCfg.routes[o.id];
        const onPress = isComingSoon
          ? showComingSoon
          : override
          ? () => {
              onClose();
              setTimeout(() => router.push(override as any), 200);
            }
          : defaultPressById[o.id] ?? (() => onClose());
        return {
          icon: defaultIconsById[o.id] ?? Settings,
          label: partnerCfg.renames[o.id] ?? partnerDefaultLabels.get(o.id) ?? o.id,
          onPress,
        };
      }),
  ];

  const menuContent = (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <View style={[styles.profileSection, { borderBottomColor: Colors.border, paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.profileContainer}
          onPress={() => {
            onClose();
            setTimeout(() => router.push("/profile" as any), 200);
          }}
          testID="partner-profile-open"
        >
          <View style={[styles.avatar, { backgroundColor: Colors.accent + "30" }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <UserRound color={Colors.accent} size={26} />
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: Colors.text }]} numberOfLines={1}>{displayName}</Text>
            <Text style={[styles.profileRole, { color: Colors.textSecondary }]} numberOfLines={1}>
              {profile?.phone || authState.phoneNumber || "On duty"}
            </Text>
          </View>
          <ChevronRight color={Colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.menuItems}
        contentContainerStyle={styles.menuItemsContent}
        showsVerticalScrollIndicator={false}
      >
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuItem}
            onPress={item.onPress}
            testID={`partner-menu-${item.label}`}
          >
            <item.icon color={Colors.textSecondary} size={22} />
            <Text style={[styles.menuItemText, { color: Colors.text }]}>{item.label}</Text>
            <ChevronRight color={Colors.textSecondary} size={18} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.passengerModeButton, { backgroundColor: Colors.accent }]}
          onPress={handleSwitchToRider}
          testID="passenger-mode-button"
        >
          <Text style={[styles.passengerModeText, { color: Colors.secondary }]}>Passenger Mode</Text>
        </TouchableOpacity>

        <View style={styles.socialContainer}>
          <TouchableOpacity style={styles.socialButton} onPress={() => console.log("Facebook")}>
            <View style={styles.facebookIcon}>
              <Text style={styles.socialIconText}>f</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.socialButton} onPress={() => console.log("Instagram")}>
            <View style={styles.instagramIcon}>
              <Text style={styles.socialIconText}>📷</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <TouchableOpacity
            style={styles.overlayTouchable}
            activeOpacity={1}
            onPress={onClose}
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  overlayTouchable: { flex: 1 },
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
  safeArea: { flex: 1 },
  profileSection: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
  },
  profileContainer: { flexDirection: "row" as const, alignItems: "center" as const },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginRight: 12,
    overflow: "hidden" as const,
  },
  avatarImage: { width: "100%" as const, height: "100%" as const },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: "700" as const, marginBottom: 2 },
  profileRole: { fontSize: 13 },
  menuItems: { flex: 1 },
  menuItemsContent: { paddingTop: 8, paddingBottom: 8 },
  menuItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 16,
  },
  menuItemText: { flex: 1, fontSize: 16, fontWeight: "500" as const },
  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 },
  passengerModeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center" as const,
    marginBottom: 16,
  },
  passengerModeText: { fontSize: 18, fontWeight: "700" as const },
  socialContainer: {
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    gap: 20,
  },
  socialButton: {
    width: 48,
    height: 48,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  facebookIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1877F2",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  instagramIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E4405F",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  socialIconText: { fontSize: 20, color: "#FFFFFF", fontWeight: "700" as const },
});
