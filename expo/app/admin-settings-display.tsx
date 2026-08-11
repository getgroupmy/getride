import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  Pressable,
  Platform,
  Image,
  KeyboardAvoidingView,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Eye,
  RotateCcw,
  Minus,
  Plus,
  ChevronDown,
  Check,
  Image as ImageIcon,
  Upload,
  X,
  ShoppingBag,
  Car,
  Building2,
  Package,
  Truck,
  Bike,
  Bus,
  Plane,
  MapPin,
  Navigation,
  Clock,
  Bell,
  ChevronRight,
  ChevronUp,
  Layers,
  ArrowUpDown,
  Menu as MenuIcon,
  UserRound,
  Briefcase,
  Pencil,
  Trash2,
  BookOpen,
  FileText,
  Gift,
  HelpCircle,
  Heart,
  Mail,
  MessageCircle,
  Phone,
  Settings,
  Shield,
  Star,
  Tag,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import {
  useDisplaySettings,
  DISPLAY_SETTINGS_META,
  DisplaySettings,
  SERVICE_BOX_ICONS,
  SERVICE_BOX_COUNT,
  RECENT_LOCATIONS_MIN,
  RECENT_LOCATIONS_MAX,
  DEFAULT_SERVICE_BOXES,
  RECENTER_BUTTON_BOTTOM_MIN,
  RECENTER_BUTTON_BOTTOM_MAX,
  RECENTER_BUTTON_BOTTOM_STEP,
  MAP_HEIGHT_OFFSET_MIN,
  MAP_HEIGHT_OFFSET_MAX,
  MAP_HEIGHT_OFFSET_STEP,
  DROP_PIN_OFFSET_MIN,
  DROP_PIN_OFFSET_MAX,
  DROP_PIN_OFFSET_STEP,
  ADDRESS_BAR_TOP_OFFSET_MIN,
  ADDRESS_BAR_TOP_OFFSET_MAX,
  ADDRESS_BAR_TOP_OFFSET_STEP,
  DISCOUNT_BAR_HEIGHT_OFFSET_MIN,
  DISCOUNT_BAR_HEIGHT_OFFSET_MAX,
  DISCOUNT_BAR_HEIGHT_OFFSET_STEP,
  RIDE_CONFIRM_OFFSET_MIN,
  RIDE_TRACKING_OFFSET_MIN,
  RIDE_TRACKING_OFFSET_MAX,
  RIDE_TRACKING_OFFSET_STEP,
  RIDE_CONFIRM_OFFSET_MAX,
  RIDE_CONFIRM_OFFSET_STEP,
  DEFAULT_USER_MENU_ITEMS,
  DEFAULT_PARTNER_MENU_ITEMS,
  SIDE_MENU_ICONS,
  SideMenuKey,
  PROFILE_MENU_ITEM_ID,
  PARTNER_MODE_MENU_ITEM_ID,
  PASSENGER_MODE_MENU_ITEM_ID,
  PARTNER_MODE_DEFAULT_LABEL,
  PASSENGER_MODE_DEFAULT_LABEL,
  AVAILABLE_MENU_ROUTES,
  DEFAULT_MENU_ROUTES,
  getMenuItemOrder,
} from "@/contexts/DisplaySettingsContext";
import { TextInput } from "react-native";
import { useAdminData } from "@/contexts/AdminDataContext";

const ICON_MAP: Record<string, LucideIcon> = {
  ShoppingBag,
  Car,
  Building2,
  Package,
  Truck,
  Bike,
  Bus,
  Plane,
  MapPin,
  Navigation,
  Clock,
  Bell,
  BookOpen,
  FileText,
  Gift,
  HelpCircle,
  Heart,
  Mail,
  MessageCircle,
  Phone,
  Settings,
  Shield,
  Star,
  Tag,
  User,
  Wallet,
};

type PickerMode =
  | { kind: "service"; index: number }
  | { kind: "icon"; index: number }
  | { kind: "vehicle-bar-services" }
  | { kind: "vehicle-bar-list"; serviceName: string }
  | { kind: "vehicle-bar-arrangement" }
  | { kind: "sidemenu"; menu: SideMenuKey }
  | { kind: "sidemenu-rename"; menu: SideMenuKey; itemId: string; currentLabel: string; isCustom: boolean }
  | { kind: "sidemenu-add"; menu: SideMenuKey }
  | { kind: "sidemenu-icon"; menu: SideMenuKey; selected: string }
  | { kind: "sidemenu-route"; menu: SideMenuKey; target: "new" | { itemId: string; isCustom: boolean } }
  | { kind: "box-route"; index: number };

export default function AdminSettingsDisplayScreen() {
  const router = useRouter();
  const Colors = useColors();
  const {
    settings,
    update,
    updateServiceBox,
    setRecentLocationsCount,
    setNumeric,
    setVehicleServiceVisibility,
    moveVehicleInBar,
    renameMenuItem,
    addCustomMenuItem,
    setMenuItemRoute,
    setMenuItemVisibility,
    setMenuItemComingSoon,
    moveMenuItem,
    removeCustomMenuItem,
    reset,
  } = useDisplaySettings();

  const DEFAULT_MENU_ICON_NAMES: Record<SideMenuKey, Record<string, string>> = {
    user: {
      city: "Car",
      "request-history": "Clock",
      freight: "Truck",
      notifications: "Bell",
      safety: "Shield",
      settings: "Settings",
      "user-guide": "BookOpen",
      support: "MessageCircle",
      logout: "User",
    },
    partner: {
      dashboard: "Settings",
      earnings: "Wallet",
      "trip-history": "Clock",
      vehicle: "Car",
      documents: "FileText",
      notifications: "Bell",
      safety: "Shield",
      support: "HelpCircle",
      settings: "Settings",
      "sign-out": "User",
    },
  };

  const [renameDraft, setRenameDraft] = useState<string>("");
  const [routeDraft, setRouteDraft] = useState<string>("");
  const [newItemLabel, setNewItemLabel] = useState<string>("");
  const [newItemIcon, setNewItemIcon] = useState<string>("Star");
  const [newItemRoute, setNewItemRoute] = useState<string>("");

  const routeLabelFor = (path: string | undefined): string => {
    if (!path) return "Not linked";
    const found = AVAILABLE_MENU_ROUTES.find((r) => r.path === path);
    return found ? found.label : path;
  };

  type LayoutKey = "recenterButtonBottom" | "mapHeightOffset" | "dropPinTopOffset" | "dropPinHorizontalOffset" | "addressBarTopOffset" | "discountBarHeightOffset" | "rcBackVertical" | "rcBackHorizontal" | "rcRecenterVertical" | "rcRecenterHorizontal" | "rcDisclaimerVertical" | "rcDisclaimerHorizontal" | "rcAddressVertical" | "rcAddressHorizontal" | "rtRecenterVertical" | "rtRecenterHorizontal" | "prRecenterVertical" | "prRecenterHorizontal";
  const layoutItems: { key: LayoutKey; label: string; description: string; min: number; max: number; step: number; unit: string }[] = [
    {
      key: "recenterButtonBottom",
      label: "Recenter button height",
      description: "Distance from the bottom of the screen",
      min: RECENTER_BUTTON_BOTTOM_MIN,
      max: RECENTER_BUTTON_BOTTOM_MAX,
      step: RECENTER_BUTTON_BOTTOM_STEP,
      unit: "px",
    },
    {
      key: "mapHeightOffset",
      label: "Map height",
      description: "Extra map height extending above the screen",
      min: MAP_HEIGHT_OFFSET_MIN,
      max: MAP_HEIGHT_OFFSET_MAX,
      step: MAP_HEIGHT_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "dropPinTopOffset",
      label: "Drop pin height",
      description: "Vertical offset of the pin (negative = up, positive = down)",
      min: DROP_PIN_OFFSET_MIN,
      max: DROP_PIN_OFFSET_MAX,
      step: DROP_PIN_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "dropPinHorizontalOffset",
      label: "Drop pin left/right",
      description: "Horizontal offset of the pin (negative = left, positive = right)",
      min: DROP_PIN_OFFSET_MIN,
      max: DROP_PIN_OFFSET_MAX,
      step: DROP_PIN_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "addressBarTopOffset",
      label: "Address bar height",
      description: "Vertical offset of the top address pill (negative = up, positive = down)",
      min: ADDRESS_BAR_TOP_OFFSET_MIN,
      max: ADDRESS_BAR_TOP_OFFSET_MAX,
      step: ADDRESS_BAR_TOP_OFFSET_STEP,
      unit: "px",
    },
  ];

  const rideConfirmItems: { key: LayoutKey; label: string; description: string; min: number; max: number; step: number; unit: string }[] = [
    {
      key: "discountBarHeightOffset",
      label: "Discount bar height",
      description: "Vertical offset of the promo/discount bar (negative = up, positive = down)",
      min: DISCOUNT_BAR_HEIGHT_OFFSET_MIN,
      max: DISCOUNT_BAR_HEIGHT_OFFSET_MAX,
      step: DISCOUNT_BAR_HEIGHT_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcBackVertical",
      label: "Back button height",
      description: "Vertical offset of the back button (negative = up, positive = down)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcBackHorizontal",
      label: "Back button left/right",
      description: "Horizontal offset of the back button (negative = left, positive = right)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcRecenterVertical",
      label: "Recenter button height",
      description: "Vertical offset of the recenter button (negative = up, positive = down)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcRecenterHorizontal",
      label: "Recenter button left/right",
      description: "Horizontal offset of the recenter button (negative = left, positive = right)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcDisclaimerVertical",
      label: "Disclaimer box height",
      description: "Vertical offset of the disclaimer box (negative = up, positive = down)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcDisclaimerHorizontal",
      label: "Disclaimer box left/right",
      description: "Horizontal offset of the disclaimer box (negative = left, positive = right)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcAddressVertical",
      label: "Address box height",
      description: "Vertical offset of the address box (negative = up, positive = down)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rcAddressHorizontal",
      label: "Address box left/right",
      description: "Horizontal offset of the address box (negative = left, positive = right)",
      min: RIDE_CONFIRM_OFFSET_MIN,
      max: RIDE_CONFIRM_OFFSET_MAX,
      step: RIDE_CONFIRM_OFFSET_STEP,
      unit: "px",
    },
  ];
  const rideTrackingItems: { key: LayoutKey; label: string; description: string; min: number; max: number; step: number; unit: string }[] = [
    {
      key: "rtRecenterVertical",
      label: "User: recenter height",
      description: "Vertical offset of the recenter button on the user ride-tracking map (negative = up, positive = down)",
      min: RIDE_TRACKING_OFFSET_MIN,
      max: RIDE_TRACKING_OFFSET_MAX,
      step: RIDE_TRACKING_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "rtRecenterHorizontal",
      label: "User: recenter left/right",
      description: "Horizontal offset of the recenter button on the user ride-tracking map (negative = left, positive = right)",
      min: RIDE_TRACKING_OFFSET_MIN,
      max: RIDE_TRACKING_OFFSET_MAX,
      step: RIDE_TRACKING_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "prRecenterVertical",
      label: "Partner: recenter height",
      description: "Vertical offset of the recenter button on the partner ride map (negative = up, positive = down)",
      min: RIDE_TRACKING_OFFSET_MIN,
      max: RIDE_TRACKING_OFFSET_MAX,
      step: RIDE_TRACKING_OFFSET_STEP,
      unit: "px",
    },
    {
      key: "prRecenterHorizontal",
      label: "Partner: recenter left/right",
      description: "Horizontal offset of the recenter button on the partner ride map (negative = left, positive = right)",
      min: RIDE_TRACKING_OFFSET_MIN,
      max: RIDE_TRACKING_OFFSET_MAX,
      step: RIDE_TRACKING_OFFSET_STEP,
      unit: "px",
    },
  ];

  const { getEntries } = useAdminData();
  const serviceEntries = getEntries("service-settings");
  const vehicleServiceEntries = getEntries("vehicle-services");
  const hiddenVehicleSet = useMemo(
    () => new Set(settings.hiddenVehicleServiceIds ?? []),
    [settings.hiddenVehicleServiceIds]
  );
  const vehiclesForService = (serviceName: string) =>
    vehicleServiceEntries.filter((e) => {
      const types = Array.isArray(e.values.serviceTypes) ? (e.values.serviceTypes as string[]) : [];
      return types.includes(serviceName);
    });

  const arrangementVehicles = useMemo(() => {
    const visible = vehicleServiceEntries.filter((e) => {
      const v = e.values;
      const status = v.status === undefined ? true : Boolean(v.status);
      return status && !hiddenVehicleSet.has(e.id);
    });
    const order = settings.vehicleBarOrder ?? [];
    const orderIndex = new Map<string, number>();
    order.forEach((id, idx) => orderIndex.set(id, idx));
    return visible.slice().sort((a, b) => {
      const ai = orderIndex.has(a.id) ? (orderIndex.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.id) ? (orderIndex.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      return pa - pb;
    });
  }, [vehicleServiceEntries, hiddenVehicleSet, settings.vehicleBarOrder]);

  const [picker, setPicker] = useState<PickerMode | null>(null);

  const sortedServices = useMemo(() => {
    return [...serviceEntries].sort((a, b) => {
      const pa = Number(a.values.displayPriority ?? 9999);
      const pb = Number(b.values.displayPriority ?? 9999);
      return pa - pb;
    });
  }, [serviceEntries]);

  const handleReset = () => {
    Alert.alert("Reset Display Settings", "Restore all defaults?", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => reset() },
    ]);
  };

  const pickImageForBox = async (index: number) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access to upload an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64
          ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`
          : a.uri;
        updateServiceBox(index, { imageUri: uri });
      }
    } catch (e) {
      console.log("[DisplaySettings] image pick error", e);
      Alert.alert("Error", "Could not pick image.");
    }
  };

  const getBoxLabel = (index: number): string => {
    const cfg = settings.serviceBoxes[index];
    if (cfg.name && cfg.name.trim()) return cfg.name.trim();
    if (cfg.serviceId) {
      const svc = sortedServices.find((s) => s.id === cfg.serviceId);
      if (svc) return String(svc.values.name ?? `Box ${index + 1}`);
    }
    return `Box ${index + 1}`;
  };

  const getBoxIconName = (index: number): string => {
    return settings.serviceBoxes[index]?.iconName ?? DEFAULT_SERVICE_BOXES[index]?.iconName ?? "MapPin";
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="display-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Eye color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Display Settings</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            Show or hide sections on the home screen
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleReset}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="display-reset"
          accessibilityRole="button"
          accessibilityLabel="Reset display settings"
        >
          <RotateCcw color={Colors.text} size={20} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Home Screen Sections</Text>
        <View style={styles.list}>
          {DISPLAY_SETTINGS_META.map((item) => {
            const value = settings[item.key] as boolean;
            return (
              <View
                key={item.key}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`display-row-${item.key}`}
              >
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
                </View>
                <Switch
                  value={value}
                  onValueChange={(v) => {
                    console.log(`[DisplaySettings] ${item.key} -> ${v}`);
                    update(item.key as keyof DisplaySettings, v as never);
                  }}
                  trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                  thumbColor="#fff"
                  testID={`display-switch-${item.key}`}
                  accessibilityLabel={item.label}
                />
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Connection Status Popups
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 12 }]}
          testID="display-row-connected-popup"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Show &quot;Connected&quot; popup</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              On app launch, show the success popup when Supabase is reachable
            </Text>
          </View>
          <Switch
            value={settings.connectedPopupEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] connectedPopupEnabled -> ${v}`);
              update("connectedPopupEnabled", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-connected-popup"
            accessibilityLabel="Show 'Connected' popup"
          />
        </View>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID="display-row-connection-failed-popup"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Show &quot;Not Connected&quot; popup</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              On app launch, show the failure popup when Supabase can&apos;t be reached
            </Text>
          </View>
          <Switch
            value={settings.connectionFailedPopupEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] connectionFailedPopupEnabled -> ${v}`);
              update("connectionFailedPopupEnabled", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-connection-failed-popup"
            accessibilityLabel="Show 'Not Connected' popup"
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Recent Locations
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID="display-row-recent-count"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Suggested locations count</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              How many recent places to suggest ({RECENT_LOCATIONS_MIN}-{RECENT_LOCATIONS_MAX})
            </Text>
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => setRecentLocationsCount(settings.recentLocationsCount - 1)}
              disabled={settings.recentLocationsCount <= RECENT_LOCATIONS_MIN}
              style={[
                styles.stepBtn,
                {
                  backgroundColor: Colors.background,
                  borderColor: Colors.border,
                  opacity: settings.recentLocationsCount <= RECENT_LOCATIONS_MIN ? 0.4 : 1,
                },
              ]}
              testID="display-recent-minus"
              accessibilityRole="button"
              accessibilityLabel="Show fewer recent locations"
            >
              <Minus color={Colors.text} size={16} />
            </TouchableOpacity>
            <Text style={[styles.stepValue, { color: Colors.text }]} testID="display-recent-value">
              {settings.recentLocationsCount}
            </Text>
            <TouchableOpacity
              onPress={() => setRecentLocationsCount(settings.recentLocationsCount + 1)}
              disabled={settings.recentLocationsCount >= RECENT_LOCATIONS_MAX}
              style={[
                styles.stepBtn,
                {
                  backgroundColor: Colors.background,
                  borderColor: Colors.border,
                  opacity: settings.recentLocationsCount >= RECENT_LOCATIONS_MAX ? 0.4 : 1,
                },
              ]}
              testID="display-recent-plus"
              accessibilityRole="button"
              accessibilityLabel="Show more recent locations"
            >
              <Plus color={Colors.text} size={16} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Map Layout
        </Text>
        <View style={[styles.list, { marginBottom: 4 }]}>
          {layoutItems.map((item) => {
            const value = settings[item.key] as number;
            const atMin = value <= item.min;
            const atMax = value >= item.max;
            return (
              <View
                key={item.key}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`display-row-${item.key}`}
              >
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value - item.step, item.min, item.max)}
                    disabled={atMin}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMin ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-minus`}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease"
                  >
                    <Minus color={Colors.text} size={16} />
                  </TouchableOpacity>
                  <Text style={[styles.stepValueWide, { color: Colors.text }]} testID={`display-${item.key}-value`}>
                    {value}
                    <Text style={[styles.stepUnit, { color: Colors.textSecondary }]}>{item.unit}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value + item.step, item.min, item.max)}
                    disabled={atMax}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMax ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-plus`}
                    accessibilityRole="button"
                    accessibilityLabel="Increase"
                  >
                    <Plus color={Colors.text} size={16} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Ride Confirm Layout
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          testID="display-row-discount-bar"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Show discount bar</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Toggle the promo/discount bar on the ride-confirm screen
            </Text>
          </View>
          <Switch
            value={settings.discountBar}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] discountBar -> ${v}`);
              update("discountBar", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-discountBar"
            accessibilityLabel="Show discount bar"
          />
        </View>

        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 12 }]}
          testID="display-row-discount-front"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Discount bar in front</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              On = promo bar sits in front of the bottom sheet. Off = sent behind it.
            </Text>
          </View>
          <Switch
            value={settings.discountBarInFront}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] discountBarInFront -> ${v}`);
              update("discountBarInFront", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-discountBarInFront"
            accessibilityLabel="Discount bar in front"
          />
        </View>

        <View style={[styles.list, { marginBottom: 4, marginTop: 12 }]}>
          {rideConfirmItems.map((item) => {
            const value = settings[item.key] as number;
            const atMin = value <= item.min;
            const atMax = value >= item.max;
            return (
              <View
                key={item.key}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`display-row-${item.key}`}
              >
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value - item.step, item.min, item.max)}
                    disabled={atMin}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMin ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-minus`}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease"
                  >
                    <Minus color={Colors.text} size={16} />
                  </TouchableOpacity>
                  <Text style={[styles.stepValueWide, { color: Colors.text }]} testID={`display-${item.key}-value`}>
                    {value}
                    <Text style={[styles.stepUnit, { color: Colors.textSecondary }]}>{item.unit}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value + item.step, item.min, item.max)}
                    disabled={atMax}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMax ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-plus`}
                    accessibilityRole="button"
                    accessibilityLabel="Increase"
                  >
                    <Plus color={Colors.text} size={16} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Ride Tracking Layout
        </Text>
        <View style={[styles.list, { marginBottom: 4 }]}>
          {rideTrackingItems.map((item) => {
            const value = settings[item.key] as number;
            const atMin = value <= item.min;
            const atMax = value >= item.max;
            return (
              <View
                key={item.key}
                style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`display-row-${item.key}`}
              >
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
                  <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value - item.step, item.min, item.max)}
                    disabled={atMin}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMin ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-minus`}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease"
                  >
                    <Minus color={Colors.text} size={16} />
                  </TouchableOpacity>
                  <Text style={[styles.stepValueWide, { color: Colors.text }]} testID={`display-${item.key}-value`}>
                    {value}
                    <Text style={[styles.stepUnit, { color: Colors.textSecondary }]}>{item.unit}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setNumeric(item.key, value + item.step, item.min, item.max)}
                    disabled={atMax}
                    style={[
                      styles.stepBtn,
                      {
                        backgroundColor: Colors.background,
                        borderColor: Colors.border,
                        opacity: atMax ? 0.4 : 1,
                      },
                    ]}
                    testID={`display-${item.key}-plus`}
                    accessibilityRole="button"
                    accessibilityLabel="Increase"
                  >
                    <Plus color={Colors.text} size={16} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Service
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 24 }]}
          testID="display-row-service-enabled"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Service available</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When off, booking actions on the home screen show a "Coming Soon" popup instead of opening ride confirmation
            </Text>
          </View>
          <Switch
            value={settings.serviceEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] serviceEnabled -> ${v}`);
              update("serviceEnabled", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-service-enabled"
            accessibilityLabel="Service available"
          />
        </View>

        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 24 }]}
          testID="display-row-registration"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Turn off Registration</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When on, phone numbers not already in the user list are blocked at login with a "contact Administrator" popup
            </Text>
          </View>
          <Switch
            value={!settings.registrationEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] registrationEnabled -> ${!v}`);
              update("registrationEnabled", !v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-registration"
            accessibilityLabel="Turn off Registration"
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>
          Demo / Mockup Data
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 12 }]}
          testID="display-row-user-mock"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Turn off Mockup (User)</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When on, passengers no longer see demo driver offers, bids, and "viewing" avatars while searching for a ride
            </Text>
          </View>
          <Switch
            value={!settings.userMockEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] userMockEnabled -> ${!v}`);
              update("userMockEnabled", !v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-user-mock"
            accessibilityLabel="Turn off Mockup (User)"
          />
        </View>

        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 24 }]}
          testID="display-row-partner-mock"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Turn off Mockup (Partner)</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              When on, drivers no longer receive demo/auto-generated incoming ride requests while online
            </Text>
          </View>
          <Switch
            value={!settings.partnerMockEnabled}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] partnerMockEnabled -> ${!v}`);
              update("partnerMockEnabled", !v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-partner-mock"
            accessibilityLabel="Turn off Mockup (Partner)"
          />
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>
          Service Boxes
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 12 }]}
          testID="display-row-new-badge"
        >
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Show "NEW" badge</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Toggle the NEW badge on the featured (large) service box
            </Text>
          </View>
          <Switch
            value={settings.serviceBoxBadge}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] serviceBoxBadge -> ${v}`);
              update("serviceBoxBadge", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-new-badge"
            accessibilityLabel="Show 'NEW' badge"
          />
        </View>

        <View style={styles.list}>
          {Array.from({ length: SERVICE_BOX_COUNT }).map((_, idx) => {
            const cfg = settings.serviceBoxes[idx];
            const Icon = ICON_MAP[getBoxIconName(idx)] ?? MapPin;
            const label = getBoxLabel(idx);
            const linkedSvc = cfg.serviceId
              ? sortedServices.find((s) => s.id === cfg.serviceId)
              : undefined;
            return (
              <View
                key={cfg.id}
                style={[styles.boxCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID={`display-box-${idx}`}
              >
                <View style={styles.boxHeader}>
                  <View style={[styles.boxPreview, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                    {cfg.imageUri ? (
                      <Image source={{ uri: cfg.imageUri }} style={styles.boxPreviewImg} resizeMode="cover" />
                    ) : (
                      <Icon color={Colors.accent} size={28} strokeWidth={1.6} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.boxIndex, { color: Colors.textSecondary }]}>Box {idx + 1}</Text>
                    <Text style={[styles.boxTitle, { color: Colors.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.fieldBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                  onPress={() => setPicker({ kind: "service", index: idx })}
                  testID={`display-box-${idx}-service`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Service</Text>
                  <View style={styles.fieldValueRow}>
                    <Text style={[styles.fieldValue, { color: Colors.text }]} numberOfLines={1}>
                      {linkedSvc ? String(linkedSvc.values.name ?? "Unnamed") : "Default"}
                    </Text>
                    <ChevronDown color={Colors.textSecondary} size={16} />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.fieldBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                  onPress={() => setPicker({ kind: "icon", index: idx })}
                  testID={`display-box-${idx}-icon`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Icon</Text>
                  <View style={styles.fieldValueRow}>
                    <Icon color={Colors.text} size={18} />
                    <Text style={[styles.fieldValue, { color: Colors.text, marginLeft: 8 }]} numberOfLines={1}>
                      {getBoxIconName(idx)}
                    </Text>
                    <ChevronDown color={Colors.textSecondary} size={16} />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.fieldBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                  onPress={() => setPicker({ kind: "box-route", index: idx })}
                  testID={`display-box-${idx}-route`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Opens</Text>
                  <View style={styles.fieldValueRow}>
                    <Text
                      style={[styles.fieldValue, { color: cfg.route ? Colors.text : Colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {cfg.route ? routeLabelFor(cfg.route) : "Nothing yet — shows Coming Soon"}
                    </Text>
                    <ChevronDown color={Colors.textSecondary} size={16} />
                  </View>
                </TouchableOpacity>

                <View style={[styles.boxSwitchRow, { borderColor: Colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: Colors.text }]}>Coming soon</Text>
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                      {cfg.route
                        ? "Show the Coming Soon notice instead of opening the page"
                        : "Always on while no page is linked"}
                    </Text>
                  </View>
                  <Switch
                    value={cfg.comingSoon === true || !cfg.route}
                    disabled={!cfg.route}
                    onValueChange={(v) => {
                      updateServiceBox(idx, { comingSoon: v });
                    }}
                    trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                    thumbColor="#fff"
                    accessibilityLabel={`Box ${idx + 1} coming soon`}
                    testID={`display-box-${idx}-coming-soon`}
                  />
                </View>

                <View style={styles.imageActions}>
                  <TouchableOpacity
                    style={[styles.imageBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                    onPress={() => pickImageForBox(idx)}
                    testID={`display-box-${idx}-upload`}
                    accessibilityRole="button"
                  >
                    <Upload color={Colors.text} size={16} />
                    <Text style={[styles.imageBtnText, { color: Colors.text }]}>
                      {cfg.imageUri ? "Replace image" : "Upload image"}
                    </Text>
                  </TouchableOpacity>
                  {cfg.imageUri ? (
                    <TouchableOpacity
                      style={[styles.imageBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                      onPress={() => updateServiceBox(idx, { imageUri: undefined })}
                      testID={`display-box-${idx}-remove-image`}
                      accessibilityRole="button"
                    >
                      <X color={Colors.error} size={16} />
                      <Text style={[styles.imageBtnText, { color: Colors.error }]}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.imageHint, { borderColor: Colors.border }]}>
                      <ImageIcon color={Colors.textSecondary} size={14} />
                      <Text style={[styles.imageHintText, { color: Colors.textSecondary }]}>
                        Image overrides icon
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>
          Vehicle Type Bar
        </Text>
        <View
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 10 }]}
          testID="display-row-vehicle-markers"
        >
          <View style={[styles.rowIconWrap, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <Car color={Colors.accent} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>On-map vehicle icons</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Show available vehicle markers on the map
            </Text>
          </View>
          <Switch
            value={settings.showVehicleMarkers}
            onValueChange={(v) => {
              console.log(`[DisplaySettings] showVehicleMarkers -> ${v}`);
              update("showVehicleMarkers", v);
            }}
            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
            thumbColor="#fff"
            testID="display-switch-vehicle-markers"
            accessibilityLabel="On-map vehicle icons"
          />
        </View>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 10 }]}
          onPress={() => setPicker({ kind: "vehicle-bar-services" })}
          testID="display-row-vehicle-bar"
          accessibilityRole="button"
        >
          <View style={[styles.rowIconWrap, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <Layers color={Colors.accent} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Manage vehicles in bar</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Pick a service to toggle which vehicles appear on the home bar
            </Text>
          </View>
          <ChevronRight color={Colors.textSecondary} size={18} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 24 }]}
          onPress={() => setPicker({ kind: "vehicle-bar-arrangement" })}
          testID="display-row-vehicle-bar-arrangement"
          accessibilityRole="button"
        >
          <View style={[styles.rowIconWrap, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <ArrowUpDown color={Colors.accent} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Icon in bar arrangement</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Reorder how visible vehicle icons appear on the home bar
            </Text>
          </View>
          <ChevronRight color={Colors.textSecondary} size={18} />
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Side Menus</Text>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginBottom: 10 }]}
          onPress={() => setPicker({ kind: "sidemenu", menu: "user" })}
          testID="display-row-user-menu"
          accessibilityRole="button"
        >
          <View style={[styles.rowIconWrap, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <UserRound color={Colors.accent} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>User side menu</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Rename items or add custom entries
            </Text>
          </View>
          <ChevronRight color={Colors.textSecondary} size={18} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
          onPress={() => setPicker({ kind: "sidemenu", menu: "partner" })}
          testID="display-row-partner-menu"
          accessibilityRole="button"
        >
          <View style={[styles.rowIconWrap, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <Briefcase color={Colors.accent} size={20} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowLabel, { color: Colors.text }]}>Partner side menu</Text>
            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
              Rename items or add custom entries
            </Text>
          </View>
          <ChevronRight color={Colors.textSecondary} size={18} />
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: Colors.text, marginTop: 24 }]}>Ride Confirm Screen</Text>
        <View style={[styles.list, { marginBottom: 4 }]}>
          <View
            style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            testID="display-row-showAiTollBooths"
          >
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: Colors.text }]}>Est. Toll Booth Count</Text>
              <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                Show AI-estimated number of toll booths on the route
              </Text>
            </View>
            <Switch
              value={settings.showAiTollBooths}
              onValueChange={(v) => {
                console.log(`[DisplaySettings] showAiTollBooths -> ${v}`);
                update("showAiTollBooths", v);
              }}
              trackColor={{ false: Colors.gray[300], true: Colors.accent }}
              thumbColor="#fff"
              testID="display-switch-showAiTollBooths"
              accessibilityLabel="Est. Toll Booth Count"
            />
          </View>
          <View
            style={[styles.row, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
            testID="display-row-showAiTollCharges"
          >
            <View style={styles.rowInfo}>
              <Text style={[styles.rowLabel, { color: Colors.text }]}>Est. Toll Charges</Text>
              <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                Show AI-estimated total toll cost on the route
              </Text>
            </View>
            <Switch
              value={settings.showAiTollCharges}
              onValueChange={(v) => {
                console.log(`[DisplaySettings] showAiTollCharges -> ${v}`);
                update("showAiTollCharges", v);
              }}
              trackColor={{ false: Colors.gray[300], true: Colors.accent }}
              thumbColor="#fff"
              testID="display-switch-showAiTollCharges"
              accessibilityLabel="Est. Toll Charges"
            />
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal
        visible={picker !== null}
        transparent
        animationType={Platform.OS === "ios" ? "slide" : "fade"}
        onRequestClose={() => setPicker(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: Colors.background,
                borderColor: Colors.border,
                maxHeight: Dimensions.get("window").height * 0.85,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              {picker?.kind === "vehicle-bar-list" ? (
                <TouchableOpacity
                  onPress={() => setPicker({ kind: "vehicle-bar-services" })}
                  style={styles.modalClose}
                  testID="display-picker-back"
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <ArrowLeft color={Colors.text} size={20} />
                </TouchableOpacity>
              ) : null}
              {picker?.kind === "sidemenu-rename" || picker?.kind === "sidemenu-add" || picker?.kind === "sidemenu-icon" ? (
                <TouchableOpacity
                  onPress={() => setPicker({ kind: "sidemenu", menu: picker.menu })}
                  style={styles.modalClose}
                  testID="display-sidemenu-back"
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <ArrowLeft color={Colors.text} size={20} />
                </TouchableOpacity>
              ) : null}
              {picker?.kind === "sidemenu-route" ? (
                <TouchableOpacity
                  onPress={() => {
                    if (picker.target === "new") {
                      setPicker({ kind: "sidemenu-add", menu: picker.menu });
                    } else {
                      setPicker({ kind: "sidemenu-rename", menu: picker.menu, itemId: picker.target.itemId, currentLabel: renameDraft, isCustom: picker.target.isCustom });
                    }
                  }}
                  style={styles.modalClose}
                  testID="display-sidemenu-route-back"
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <ArrowLeft color={Colors.text} size={20} />
                </TouchableOpacity>
              ) : null}
              <Text style={[styles.modalTitle, { color: Colors.text, flex: 1 }]} numberOfLines={1}>
                {picker?.kind === "service"
                  ? "Choose Service"
                  : picker?.kind === "icon"
                  ? "Choose Icon"
                  : picker?.kind === "vehicle-bar-services"
                  ? "Vehicle Type Bar"
                  : picker?.kind === "vehicle-bar-list"
                  ? picker.serviceName
                  : picker?.kind === "vehicle-bar-arrangement"
                  ? "Icon in Bar Arrangement"
                  : picker?.kind === "sidemenu"
                  ? picker.menu === "user" ? "User Side Menu" : "Partner Side Menu"
                  : picker?.kind === "sidemenu-rename"
                  ? "Rename Item"
                  : picker?.kind === "sidemenu-add"
                  ? "Add Menu Item"
                  : picker?.kind === "sidemenu-icon"
                  ? "Choose Icon"
                  : picker?.kind === "sidemenu-route"
                  ? "Link to Page"
                  : picker?.kind === "box-route"
                  ? "Box Opens"
                  : ""}
              </Text>
              <TouchableOpacity onPress={() => setPicker(null)} style={styles.modalClose} testID="display-picker-close" accessibilityRole="button">
                <X color={Colors.text} size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {picker?.kind === "sidemenu" ? (() => {
                const menu = picker.menu;
                const defaults = menu === "user" ? DEFAULT_USER_MENU_ITEMS : DEFAULT_PARTNER_MENU_ITEMS;
                const cfg = menu === "user" ? settings.userMenu : settings.partnerMenu;
                const ordered = getMenuItemOrder(defaults, cfg);
                const orderedIds = ordered.map((o) => o.id);
                const hiddenSet = new Set(cfg.hidden ?? []);
                const comingSoonSet = new Set(cfg.comingSoon ?? []);
                const customById = new Map(cfg.customItems.map((c) => [c.id, c]));
                const defaultById = new Map(defaults.map((d) => [d.id, d]));
                const defaultIcons = DEFAULT_MENU_ICON_NAMES[menu];
                return (
                  <View>
                    <Text style={[styles.rowDesc, { color: Colors.textSecondary, marginBottom: 12 }]}>
                      Live preview of the {menu === "user" ? "user" : "partner"} side menu. Toggle items off to hide them, use the arrows to reorder, and tap the pencil to rename or link a page. New items added in future updates appear here automatically.
                    </Text>
                    {(() => {
                      const profileVisible = !hiddenSet.has(PROFILE_MENU_ITEM_ID);
                      const profileComingSoon = comingSoonSet.has(PROFILE_MENU_ITEM_ID);
                      return (
                        <View
                          style={[styles.optionRow, { borderColor: Colors.border, opacity: profileVisible ? 1 : 0.5 }]}
                          testID={`display-sidemenu-${menu}-profile`}
                        >
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            <User color={Colors.accent} size={18} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                              Profile
                            </Text>
                            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                              Profile header at the top of the sheet
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                console.log(`[DisplaySettings] ${menu} menu profile comingSoon -> ${!profileComingSoon}`);
                                setMenuItemComingSoon(menu, PROFILE_MENU_ITEM_ID, !profileComingSoon);
                              }}
                              style={[
                                styles.comingSoonChip,
                                {
                                  backgroundColor: profileComingSoon ? Colors.accent + "1A" : Colors.background,
                                  borderColor: profileComingSoon ? Colors.accent : Colors.border,
                                },
                              ]}
                              testID={`display-sidemenu-comingsoon-${menu}-profile`}
                              accessibilityRole="button"
                            >
                              {profileComingSoon ? <Check color={Colors.accent} size={13} /> : null}
                              <Text
                                style={[
                                  styles.comingSoonChipText,
                                  { color: profileComingSoon ? Colors.accent : Colors.textSecondary },
                                ]}
                              >
                                Coming Soon
                              </Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.arrangeBtns}>
                            <Switch
                              value={profileVisible}
                              onValueChange={(v) => {
                                console.log(`[DisplaySettings] ${menu} menu profile visible -> ${v}`);
                                setMenuItemVisibility(menu, PROFILE_MENU_ITEM_ID, v);
                              }}
                              trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                              thumbColor="#fff"
                              testID={`display-sidemenu-toggle-${menu}-profile`}
                              accessibilityLabel="Profile header at the top of the sheet"
                            />
                          </View>
                        </View>
                      );
                    })()}
                    {ordered.map((o, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === ordered.length - 1;
                      const visible = !hiddenSet.has(o.id);
                      const isComingSoon = comingSoonSet.has(o.id);
                      let label: string;
                      let iconName: string;
                      let route: string | undefined;
                      let defaultRoute: string | undefined;
                      if (o.isCustom) {
                        const c = customById.get(o.id);
                        label = c?.label ?? "Item";
                        iconName = c?.iconName ?? "Star";
                        route = c?.route;
                      } else {
                        const d = defaultById.get(o.id);
                        label = cfg.renames[o.id] ?? d?.label ?? o.id;
                        iconName = defaultIcons[o.id] ?? "Settings";
                        route = cfg.routes[o.id];
                        defaultRoute = DEFAULT_MENU_ROUTES[menu][o.id];
                      }
                      const effectiveRoute = route ?? defaultRoute;
                      const usesDefaultLink = !route && !!defaultRoute;
                      const Icon = ICON_MAP[iconName] ?? Star;
                      return (
                        <View
                          key={o.id}
                          style={[styles.optionRow, { borderColor: Colors.border, opacity: visible ? 1 : 0.5 }]}
                          testID={`display-sidemenu-${menu}-${o.id}`}
                        >
                          <View style={styles.sidemenuArrange}>
                            <TouchableOpacity
                              disabled={isFirst}
                              onPress={() => moveMenuItem(menu, o.id, -1, orderedIds)}
                              style={[styles.arrangeBtnSm, { backgroundColor: Colors.background, borderColor: Colors.border, opacity: isFirst ? 0.4 : 1 }]}
                              testID={`display-sidemenu-up-${menu}-${o.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Move up"
                            >
                              <ChevronUp color={isFirst ? Colors.textSecondary : Colors.accent} size={14} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={isLast}
                              onPress={() => moveMenuItem(menu, o.id, 1, orderedIds)}
                              style={[styles.arrangeBtnSm, { backgroundColor: Colors.background, borderColor: Colors.border, opacity: isLast ? 0.4 : 1 }]}
                              testID={`display-sidemenu-down-${menu}-${o.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Move down"
                            >
                              <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={14} />
                            </TouchableOpacity>
                          </View>
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            <Icon color={Colors.accent} size={18} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                              {label}
                            </Text>
                            <Text style={[styles.rowDesc, { color: effectiveRoute ? Colors.accent : Colors.textSecondary }]} numberOfLines={1}>
                              Page: {routeLabelFor(effectiveRoute)}{usesDefaultLink ? "  ·  Default" : ""}{o.isCustom ? "  ·  Custom" : ""}
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                console.log(`[DisplaySettings] ${menu} menu ${o.id} comingSoon -> ${!isComingSoon}`);
                                setMenuItemComingSoon(menu, o.id, !isComingSoon);
                              }}
                              style={[
                                styles.comingSoonChip,
                                {
                                  backgroundColor: isComingSoon ? Colors.accent + "1A" : Colors.background,
                                  borderColor: isComingSoon ? Colors.accent : Colors.border,
                                },
                              ]}
                              testID={`display-sidemenu-comingsoon-${menu}-${o.id}`}
                              accessibilityRole="button"
                            >
                              {isComingSoon ? (
                                <Check color={Colors.accent} size={13} />
                              ) : null}
                              <Text
                                style={[
                                  styles.comingSoonChipText,
                                  { color: isComingSoon ? Colors.accent : Colors.textSecondary },
                                ]}
                              >
                                Coming Soon
                              </Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.arrangeBtns}>
                            <TouchableOpacity
                              onPress={() => {
                                setRenameDraft(label);
                                setRouteDraft(route ?? "");
                                setPicker({ kind: "sidemenu-rename", menu, itemId: o.id, currentLabel: label, isCustom: o.isCustom });
                              }}
                              style={[styles.arrangeBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                              testID={`display-sidemenu-rename-${menu}-${o.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Rename"
                            >
                              <Pencil color={Colors.accent} size={16} />
                            </TouchableOpacity>
                            {o.isCustom ? (
                              <TouchableOpacity
                                onPress={() => {
                                  Alert.alert("Remove item", `Remove \"${label}\"?`, [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Remove",
                                      style: "destructive",
                                      onPress: () => removeCustomMenuItem(menu, o.id),
                                    },
                                  ]);
                                }}
                                style={[styles.arrangeBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                                testID={`display-sidemenu-remove-${menu}-${o.id}`}
                                accessibilityRole="button"
                                accessibilityLabel="Remove display sidemenu"
                              >
                                <Trash2 color={Colors.error} size={16} />
                              </TouchableOpacity>
                            ) : null}
                            <Switch
                              value={visible}
                              onValueChange={(v) => {
                                console.log(`[DisplaySettings] ${menu} menu ${o.id} visible -> ${v}`);
                                setMenuItemVisibility(menu, o.id, v);
                              }}
                              trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                              thumbColor="#fff"
                              testID={`display-sidemenu-toggle-${menu}-${o.id}`}
                              accessibilityLabel={`Show ${label}`}
                            />
                          </View>
                        </View>
                      );
                    })}
                    {(() => {
                      const footerId = menu === "user" ? PARTNER_MODE_MENU_ITEM_ID : PASSENGER_MODE_MENU_ITEM_ID;
                      const footerDefault = menu === "user" ? PARTNER_MODE_DEFAULT_LABEL : PASSENGER_MODE_DEFAULT_LABEL;
                      const footerLabel = cfg.renames[footerId] ?? footerDefault;
                      const footerVisible = !hiddenSet.has(footerId);
                      const footerComingSoon = comingSoonSet.has(footerId);
                      const FooterIcon = menu === "user" ? Car : UserRound;
                      return (
                        <View
                          style={[styles.optionRow, { borderColor: Colors.border, opacity: footerVisible ? 1 : 0.5 }]}
                          testID={`display-sidemenu-${menu}-footer-mode`}
                        >
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            <FooterIcon color={Colors.accent} size={18} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                              {footerLabel}
                            </Text>
                            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                              {menu === "user" ? "Partner mode button in the footer" : "Passenger mode button in the footer"}
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                console.log(`[DisplaySettings] ${menu} menu footer-mode comingSoon -> ${!footerComingSoon}`);
                                setMenuItemComingSoon(menu, footerId, !footerComingSoon);
                              }}
                              style={[
                                styles.comingSoonChip,
                                {
                                  backgroundColor: footerComingSoon ? Colors.accent + "1A" : Colors.background,
                                  borderColor: footerComingSoon ? Colors.accent : Colors.border,
                                },
                              ]}
                              testID={`display-sidemenu-comingsoon-${menu}-footer-mode`}
                              accessibilityRole="button"
                            >
                              {footerComingSoon ? <Check color={Colors.accent} size={13} /> : null}
                              <Text
                                style={[
                                  styles.comingSoonChipText,
                                  { color: footerComingSoon ? Colors.accent : Colors.textSecondary },
                                ]}
                              >
                                Coming Soon
                              </Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.arrangeBtns}>
                            <TouchableOpacity
                              onPress={() => {
                                setRenameDraft(footerLabel);
                                setRouteDraft("");
                                setPicker({ kind: "sidemenu-rename", menu, itemId: footerId, currentLabel: footerLabel, isCustom: false });
                              }}
                              style={[styles.arrangeBtn, { backgroundColor: Colors.background, borderColor: Colors.border }]}
                              testID={`display-sidemenu-rename-${menu}-footer-mode`}
                              accessibilityRole="button"
                              accessibilityLabel="Rename"
                            >
                              <Pencil color={Colors.accent} size={16} />
                            </TouchableOpacity>
                            <Switch
                              value={footerVisible}
                              onValueChange={(v) => {
                                console.log(`[DisplaySettings] ${menu} menu footer-mode visible -> ${v}`);
                                setMenuItemVisibility(menu, footerId, v);
                              }}
                              trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                              thumbColor="#fff"
                              testID={`display-sidemenu-toggle-${menu}-footer-mode`}
                              accessibilityLabel="Coming Soon"
                            />
                          </View>
                        </View>
                      );
                    })()}
                    <TouchableOpacity
                      style={[styles.addItemBtn, { backgroundColor: Colors.accent }]}
                      onPress={() => {
                        setNewItemLabel("");
                        setNewItemIcon("Star");
                        setNewItemRoute("");
                        setPicker({ kind: "sidemenu-add", menu });
                      }}
                      testID={`display-sidemenu-add-${menu}`}
                      accessibilityRole="button"
                    >
                      <Plus color={Colors.onAccent} size={18} />
                      <Text style={[styles.addItemBtnText, { color: Colors.onAccent }]}>
                        Add new item
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })() : picker?.kind === "sidemenu-rename" ? (
                <View style={{ paddingTop: 8 }}>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginBottom: 6 }]}>
                    Label
                  </Text>
                  <TextInput
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    placeholder="Item name"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.textInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                    testID="display-sidemenu-rename-input"
                    accessibilityLabel="Label"
                  />
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginBottom: 6, marginTop: 12 }]}>
                    Linked page
                  </Text>
                  <TouchableOpacity
                    style={[styles.fieldBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                    onPress={() => setPicker({ kind: "sidemenu-route", menu: picker.menu, target: { itemId: picker.itemId, isCustom: picker.isCustom } })}
                    testID="display-sidemenu-rename-route"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Page</Text>
                    <View style={styles.fieldValueRow}>
                      <Text style={[styles.fieldValue, { color: routeDraft ? Colors.text : Colors.textSecondary }]} numberOfLines={1}>
                        {routeLabelFor(routeDraft || undefined)}
                      </Text>
                      <ChevronDown color={Colors.textSecondary} size={16} />
                    </View>
                  </TouchableOpacity>
                  {routeDraft ? (
                    <TouchableOpacity
                      onPress={() => setRouteDraft("")}
                      style={{ alignSelf: "flex-start", marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 }}
                      testID="display-sidemenu-rename-route-clear"
                      accessibilityRole="button"
                    >
                      <X color={Colors.error} size={14} />
                      <Text style={[styles.rowDesc, { color: Colors.error }]}>Clear page link</Text>
                    </TouchableOpacity>
                  ) : null}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.modalBtn, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                      onPress={() => setPicker({ kind: "sidemenu", menu: picker.menu })}
                      testID="display-sidemenu-rename-cancel"
                      accessibilityRole="button"
                    >
                      <Text style={[styles.modalBtnText, { color: Colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                      onPress={() => {
                        renameMenuItem(picker.menu, picker.itemId, renameDraft);
                        setMenuItemRoute(picker.menu, picker.itemId, routeDraft ? routeDraft : null);
                        setPicker({ kind: "sidemenu", menu: picker.menu });
                      }}
                      testID="display-sidemenu-rename-save"
                      accessibilityRole="button"
                    >
                      <Text style={[styles.modalBtnText, { color: Colors.onAccent }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : picker?.kind === "sidemenu-route" ? (
                <View style={{ paddingTop: 4 }}>
                  <TouchableOpacity
                    style={[styles.optionRow, { borderColor: Colors.border }]}
                    onPress={() => {
                      if (picker.target === "new") {
                        setNewItemRoute("");
                        setPicker({ kind: "sidemenu-add", menu: picker.menu });
                      } else {
                        setRouteDraft("");
                        setPicker({ kind: "sidemenu-rename", menu: picker.menu, itemId: picker.target.itemId, currentLabel: renameDraft, isCustom: picker.target.isCustom });
                      }
                    }}
                    testID="display-sidemenu-route-none"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.optionText, { color: Colors.text }]}>None (no navigation)</Text>
                    {!(picker.target === "new" ? newItemRoute : routeDraft) ? (
                      <Check color={Colors.accent} size={18} />
                    ) : null}
                  </TouchableOpacity>
                  {AVAILABLE_MENU_ROUTES.map((r) => {
                    const selected = (picker.target === "new" ? newItemRoute : routeDraft) === r.path;
                    return (
                      <TouchableOpacity
                        key={r.path}
                        style={[styles.optionRow, { borderColor: Colors.border }]}
                        onPress={() => {
                          if (picker.target === "new") {
                            setNewItemRoute(r.path);
                            setPicker({ kind: "sidemenu-add", menu: picker.menu });
                          } else {
                            setRouteDraft(r.path);
                            setPicker({ kind: "sidemenu-rename", menu: picker.menu, itemId: picker.target.itemId, currentLabel: renameDraft, isCustom: picker.target.isCustom });
                          }
                        }}
                        testID={`display-sidemenu-route-${r.path}`}
                        accessibilityRole="button"
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                            {r.label}
                          </Text>
                          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                            {r.path}
                          </Text>
                        </View>
                        {selected ? <Check color={Colors.accent} size={18} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : picker?.kind === "box-route" ? (
                <View style={{ paddingTop: 4 }}>
                  <TouchableOpacity
                    style={[styles.optionRow, { borderColor: Colors.border }]}
                    onPress={() => {
                      updateServiceBox(picker.index, { route: undefined });
                      setPicker(null);
                    }}
                    testID="display-box-route-none"
                    accessibilityRole="button"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, { color: Colors.text }]}>None</Text>
                      <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                        Tapping the box shows the Coming Soon notice
                      </Text>
                    </View>
                    {!settings.serviceBoxes[picker.index]?.route ? (
                      <Check color={Colors.accent} size={18} />
                    ) : null}
                  </TouchableOpacity>
                  {AVAILABLE_MENU_ROUTES.map((r) => {
                    const selected = settings.serviceBoxes[picker.index]?.route === r.path;
                    return (
                      <TouchableOpacity
                        key={r.path}
                        style={[styles.optionRow, { borderColor: Colors.border }]}
                        onPress={() => {
                              updateServiceBox(picker.index, { route: r.path, comingSoon: false });
                          setPicker(null);
                        }}
                        testID={`display-box-route-${r.path}`}
                        accessibilityRole="button"
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                            {r.label}
                          </Text>
                          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]} numberOfLines={1}>
                            {r.path}
                          </Text>
                        </View>
                        {selected ? <Check color={Colors.accent} size={18} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : picker?.kind === "sidemenu-add" ? (
                <View style={{ paddingTop: 8 }}>
                  <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginBottom: 6 }]}>
                    Label
                  </Text>
                  <TextInput
                    value={newItemLabel}
                    onChangeText={setNewItemLabel}
                    placeholder="e.g. Refer a friend"
                    placeholderTextColor={Colors.textSecondary}
                    style={[styles.textInput, { color: Colors.text, borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                    testID="display-sidemenu-add-input"
                    accessibilityLabel="Label"
                  />
                  <TouchableOpacity
                    style={[styles.fieldBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 12 }]}
                    onPress={() => setPicker({ kind: "sidemenu-icon", menu: picker.menu, selected: newItemIcon })}
                    testID="display-sidemenu-add-icon"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Icon</Text>
                    <View style={styles.fieldValueRow}>
                      {(() => {
                        const Icon = ICON_MAP[newItemIcon] ?? Star;
                        return <Icon color={Colors.text} size={18} />;
                      })()}
                      <Text style={[styles.fieldValue, { color: Colors.text, marginLeft: 8 }]} numberOfLines={1}>
                        {newItemIcon}
                      </Text>
                      <ChevronDown color={Colors.textSecondary} size={16} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.fieldBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border, marginTop: 12 }]}
                    onPress={() => setPicker({ kind: "sidemenu-route", menu: picker.menu, target: "new" })}
                    testID="display-sidemenu-add-route"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Linked page</Text>
                    <View style={styles.fieldValueRow}>
                      <Text style={[styles.fieldValue, { color: newItemRoute ? Colors.text : Colors.textSecondary }]} numberOfLines={1}>
                        {routeLabelFor(newItemRoute || undefined)}
                      </Text>
                      <ChevronDown color={Colors.textSecondary} size={16} />
                    </View>
                  </TouchableOpacity>
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.modalBtn, { borderColor: Colors.border, backgroundColor: Colors.gray[100] }]}
                      onPress={() => setPicker({ kind: "sidemenu", menu: picker.menu })}
                      testID="display-sidemenu-add-cancel"
                      accessibilityRole="button"
                    >
                      <Text style={[styles.modalBtnText, { color: Colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalBtn,
                        {
                          backgroundColor: Colors.accent,
                          borderColor: Colors.accent,
                          opacity: newItemLabel.trim() ? 1 : 0.5,
                        },
                      ]}
                      disabled={!newItemLabel.trim()}
                      onPress={() => {
                        addCustomMenuItem(picker.menu, newItemLabel, newItemIcon, newItemRoute || undefined);
                        setPicker({ kind: "sidemenu", menu: picker.menu });
                      }}
                      testID="display-sidemenu-add-save"
                      accessibilityRole="button"
                    >
                      <Text style={[styles.modalBtnText, { color: Colors.onAccent }]}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : picker?.kind === "sidemenu-icon" ? (
                <View style={styles.iconGrid}>
                  {SIDE_MENU_ICONS.map((opt) => {
                    const Comp = ICON_MAP[opt.name] ?? Star;
                    const selected = picker.selected === opt.name;
                    return (
                      <TouchableOpacity
                        key={opt.name}
                        style={[
                          styles.iconCell,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: selected ? Colors.accent : Colors.border,
                          },
                        ]}
                        onPress={() => {
                          setNewItemIcon(opt.name);
                          setPicker({ kind: "sidemenu-add", menu: picker.menu });
                        }}
                        testID={`display-sidemenu-icon-${opt.name}`}
                        accessibilityRole="button"
                      >
                        <Comp color={selected ? Colors.accent : Colors.text} size={24} strokeWidth={1.6} />
                        <Text
                          style={[styles.iconCellLabel, { color: selected ? Colors.accent : Colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : picker?.kind === "vehicle-bar-arrangement" ? (
                <View>
                  {arrangementVehicles.length === 0 ? (
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                      No visible vehicles. Turn some on in "Manage vehicles in bar".
                    </Text>
                  ) : (
                    arrangementVehicles.map((e, idx) => {
                      const v = e.values;
                      const name = String(v.name ?? "Unnamed");
                      const img = String(v.heroImageUri ?? v.iconUri ?? "");
                      const isFirst = idx === 0;
                      const isLast = idx === arrangementVehicles.length - 1;
                      const ids = arrangementVehicles.map((x) => x.id);
                      return (
                        <View
                          key={e.id}
                          style={[styles.optionRow, { borderColor: Colors.border }]}
                          testID={`display-vbar-arrange-${e.id}`}
                        >
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            {img ? (
                              <Image source={{ uri: img }} style={styles.svcIconImg} resizeMode="cover" />
                            ) : (
                              <Car color={Colors.accent} size={18} />
                            )}
                          </View>
                          <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                            {name}
                          </Text>
                          <View style={styles.arrangeBtns}>
                            <TouchableOpacity
                              disabled={isFirst}
                              onPress={() => moveVehicleInBar(e.id, -1, ids)}
                              style={[
                                styles.arrangeBtn,
                                {
                                  backgroundColor: Colors.background,
                                  borderColor: Colors.border,
                                  opacity: isFirst ? 0.4 : 1,
                                },
                              ]}
                              testID={`display-vbar-arrange-up-${e.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Move up"
                            >
                              <ChevronUp color={isFirst ? Colors.textSecondary : Colors.accent} size={16} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              disabled={isLast}
                              onPress={() => moveVehicleInBar(e.id, 1, ids)}
                              style={[
                                styles.arrangeBtn,
                                {
                                  backgroundColor: Colors.background,
                                  borderColor: Colors.border,
                                  opacity: isLast ? 0.4 : 1,
                                },
                              ]}
                              testID={`display-vbar-arrange-down-${e.id}`}
                              accessibilityRole="button"
                              accessibilityLabel="Move down"
                            >
                              <ChevronDown color={isLast ? Colors.textSecondary : Colors.accent} size={16} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              ) : picker?.kind === "vehicle-bar-services" ? (
                <View>
                  {sortedServices.length === 0 ? (
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                      No record. Add services in Service Settings.
                    </Text>
                  ) : (
                    sortedServices.map((svc) => {
                      const svcName = String(svc.values.name ?? "");
                      const linked = vehiclesForService(svcName);
                      const visibleCount = linked.filter((e) => !hiddenVehicleSet.has(e.id)).length;
                      const iconUri = svc.values.iconUri ? String(svc.values.iconUri) : "";
                      return (
                        <TouchableOpacity
                          key={svc.id}
                          style={[styles.optionRow, { borderColor: Colors.border }]}
                          onPress={() => setPicker({ kind: "vehicle-bar-list", serviceName: svcName })}
                          testID={`display-vbar-service-${svc.id}`}
                          accessibilityRole="button"
                        >
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            {iconUri ? (
                              <Image source={{ uri: iconUri }} style={styles.svcIconImg} resizeMode="cover" />
                            ) : (
                              <Layers color={Colors.accent} size={18} />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                              {svcName || "Unnamed"}
                            </Text>
                            <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>
                              {linked.length === 0
                                ? "No vehicles linked"
                                : `${visibleCount}/${linked.length} visible`}
                            </Text>
                          </View>
                          <ChevronRight color={Colors.textSecondary} size={18} />
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              ) : picker?.kind === "vehicle-bar-list" ? (
                <View>
                  {(() => {
                    const list = vehiclesForService(picker.serviceName);
                    if (list.length === 0) {
                      return (
                        <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                          No vehicles linked to this service.
                        </Text>
                      );
                    }
                    return list.map((e) => {
                      const v = e.values;
                      const name = String(v.name ?? "Unnamed");
                      const img = String(v.heroImageUri ?? v.iconUri ?? "");
                      const visible = !hiddenVehicleSet.has(e.id);
                      return (
                        <View
                          key={e.id}
                          style={[styles.optionRow, { borderColor: Colors.border }]}
                          testID={`display-vbar-veh-${e.id}`}
                        >
                          <View style={[styles.svcIconWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                            {img ? (
                              <Image source={{ uri: img }} style={styles.svcIconImg} resizeMode="cover" />
                            ) : (
                              <Car color={Colors.accent} size={18} />
                            )}
                          </View>
                          <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                            {name}
                          </Text>
                          <Switch
                            value={visible}
                            onValueChange={(val) => {
                              console.log(`[DisplaySettings] vehicle ${e.id} visible -> ${val}`);
                              setVehicleServiceVisibility(e.id, val);
                            }}
                            trackColor={{ false: Colors.gray[300], true: Colors.accent }}
                            thumbColor="#fff"
                            testID={`display-vbar-veh-switch-${e.id}`}
                            accessibilityLabel={name}
                          />
                        </View>
                      );
                    });
                  })()}
                </View>
              ) : picker?.kind === "service" ? (
                <View>
                  <TouchableOpacity
                    style={[styles.optionRow, { borderColor: Colors.border }]}
                    onPress={() => {
                      if (picker) {
                        updateServiceBox(picker.index, { serviceId: undefined, name: undefined });
                        setPicker(null);
                      }
                    }}
                    testID="display-service-option-default"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.optionText, { color: Colors.text }]}>Default (Box {(picker?.index ?? 0) + 1})</Text>
                    {!settings.serviceBoxes[picker?.index ?? 0]?.serviceId && (
                      <Check color={Colors.accent} size={18} />
                    )}
                  </TouchableOpacity>
                  {sortedServices.length === 0 ? (
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                      No services found. Add some in Service Settings.
                    </Text>
                  ) : (
                    sortedServices.map((svc) => {
                      const selected = settings.serviceBoxes[picker?.index ?? 0]?.serviceId === svc.id;
                      return (
                        <TouchableOpacity
                          key={svc.id}
                          style={[styles.optionRow, { borderColor: Colors.border }]}
                          onPress={() => {
                            if (picker) {
                              updateServiceBox(picker.index, {
                                serviceId: svc.id,
                                name: String(svc.values.name ?? ""),
                              });
                              setPicker(null);
                            }
                          }}
                          testID={`display-service-option-${svc.id}`}
                          accessibilityRole="button"
                        >
                          <Text style={[styles.optionText, { color: Colors.text }]} numberOfLines={1}>
                            {String(svc.values.name ?? "Unnamed")}
                          </Text>
                          {selected && <Check color={Colors.accent} size={18} />}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              ) : (
                <View style={styles.iconGrid}>
                  {SERVICE_BOX_ICONS.map((opt) => {
                    const Comp = ICON_MAP[opt.name] ?? MapPin;
                    const selected = getBoxIconName(picker?.index ?? 0) === opt.name;
                    return (
                      <TouchableOpacity
                        key={opt.name}
                        style={[
                          styles.iconCell,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: selected ? Colors.accent : Colors.border,
                          },
                        ]}
                        onPress={() => {
                          if (picker) {
                            updateServiceBox(picker.index, { iconName: opt.name });
                            setPicker(null);
                          }
                        }}
                        testID={`display-icon-option-${opt.name}`}
                        accessibilityRole="button"
                      >
                        <Comp color={selected ? Colors.accent : Colors.text} size={26} strokeWidth={1.6} />
                        <Text
                          style={[
                            styles.iconCellLabel,
                            { color: selected ? Colors.accent : Colors.textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 10 },
  list: { gap: 10 },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
  stepper: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  stepValue: {
    minWidth: 22,
    textAlign: "center" as const,
    fontSize: 16,
    fontWeight: "800" as const,
  },
  stepValueWide: {
    minWidth: 64,
    textAlign: "center" as const,
    fontSize: 14,
    fontWeight: "800" as const,
  },
  stepUnit: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  boxCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  boxSwitchRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  boxHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  boxPreview: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  boxPreviewImg: { width: "100%" as const, height: "100%" as const },
  boxIndex: { fontSize: 11, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 0.6 },
  boxTitle: { fontSize: 15, fontWeight: "700" as const, marginTop: 2 },
  fieldBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600" as const },
  fieldValueRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flexShrink: 1 },
  fieldValue: { fontSize: 14, fontWeight: "600" as const, maxWidth: 180 },
  imageActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  },
  imageBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  imageBtnText: { fontSize: 13, fontWeight: "700" as const },
  imageHint: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed" as const,
  },
  imageHintText: { fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end" as const,
  },
  modalSheetInner: {
    flexShrink: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: "800" as const },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  optionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  optionText: { fontSize: 15, fontWeight: "600" as const, flex: 1, paddingRight: 12 },
  comingSoonChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "flex-start" as const,
    gap: 4,
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  comingSoonChipText: { fontSize: 11, fontWeight: "700" as const },
  emptyText: { fontSize: 13, textAlign: "center" as const, paddingVertical: 20 },
  iconGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
    paddingTop: 8,
  },
  iconCell: {
    width: "30%" as const,
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 4,
  },
  iconCellLabel: { fontSize: 11, fontWeight: "600" as const },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  svcIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginRight: 12,
    overflow: "hidden" as const,
  },
  svcIconImg: { width: "100%" as const, height: "100%" as const },
  arrangeBtns: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  arrangeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  sidemenuArrange: {
    marginRight: 10,
    gap: 4,
  },
  arrangeBtnSm: {
    width: 28,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  sidemenuGroupLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
    marginTop: 4,
    marginBottom: 6,
  },
  addItemBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  addItemBtnText: { fontSize: 14, fontWeight: "700" as const },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: "600" as const,
  },
  modalActions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  modalBtnText: { fontSize: 14, fontWeight: "700" as const },
});
