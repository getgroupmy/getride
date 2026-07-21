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
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  LayoutDashboard,
  Users,
  Car,
  DollarSign,
  MapPin,
  AlertTriangle,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  LogOut,
  FileText,
  BarChart3,
  Package,
  Headphones,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";

interface AdminSideSheetProps {
  visible: boolean;
  onClose: () => void;
}

export default function AdminSideSheet({ visible, onClose }: AdminSideSheetProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const Colors = useColors();
  const insets = useSafeAreaInsets();
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

  const handleSignOut = () => {
    Alert.alert("Sign out", "Sign out of admin?", [
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

  const menuItems = [
    { icon: LayoutDashboard, label: "Dashboard", onPress: () => onClose() },
    { icon: Users, label: "Partners", onPress: () => { onClose(); setTimeout(() => router.push("/admin-partners" as any), 200); } },
    { icon: Car, label: "Vehicles", onPress: () => { onClose(); setTimeout(() => router.push("/admin-vehicles" as any), 200); } },
    { icon: Users, label: "Users", onPress: () => { onClose(); setTimeout(() => router.push("/admin-users" as any), 200); } },
    { icon: Package, label: "EV Orders", onPress: () => { onClose(); setTimeout(() => router.push("/admin-orders" as any), 200); } },
    { icon: FileText, label: "Documents", onPress: () => { onClose(); setTimeout(() => router.push("/admin-documents" as any), 200); } },
    { icon: Headphones, label: "Support", onPress: () => { onClose(); setTimeout(() => router.push("/admin-support" as any), 200); } },
    { icon: Car, label: "Live rides", onPress: () => handleNavigate("Live rides") },
    { icon: MapPin, label: "Zones & Surge", onPress: () => handleNavigate("Zones & Surge") },
    { icon: DollarSign, label: "Payments", onPress: () => handleNavigate("Payments") },
    { icon: BarChart3, label: "Analytics", onPress: () => handleNavigate("Analytics") },
    { icon: AlertTriangle, label: "Issues", onPress: () => handleNavigate("Issues") },
    { icon: FileText, label: "Reports", onPress: () => handleNavigate("Reports") },
    { icon: ShieldAlert, label: "Trace Fraud", onPress: () => { onClose(); setTimeout(() => router.push("/admin-trace-fraud" as any), 200); } },
    { icon: MapPin, label: "Session & Location History", onPress: () => { onClose(); setTimeout(() => router.push("/admin-session-history" as any), 200); } },
    { icon: Settings, label: "Settings", onPress: () => { onClose(); setTimeout(() => router.push("/admin-settings" as any), 200); } },
    { icon: LogOut, label: "Sign out", onPress: handleSignOut },
  ];

  const menuContent = (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <View style={[styles.profileSection, { borderBottomColor: Colors.border, paddingTop: insets.top + 12 }]}>
        <View style={styles.profileContainer}>
          <View style={[styles.avatar, { backgroundColor: Colors.accent + "30" }]}>
            <ShieldCheck color={Colors.accent} size={26} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: Colors.text }]}>Admin</Text>
            <Text style={[styles.profileRole, { color: Colors.textSecondary }]}>Super administrator</Text>
          </View>
        </View>
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
            testID={`admin-menu-${item.label}`}
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
          onPress={() => {
            onClose();
            setTimeout(() => router.replace("/" as any), 200);
          }}
          testID="passenger-mode-button"
        >
          <Text style={[styles.passengerModeText, { color: Colors.onAccent }]}>Passenger Mode</Text>
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
  },
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
