import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Settings,
  ChevronRight,
  Wrench,
  Car,
  FileCheck2,
  Layers,
  Eye,
  Globe,
  Gift,
  GitBranch,
  ShieldCheck,
  MapPinned,
  Building2,
  Plane,
  Share2,
  CreditCard,
  TrendingUp,
  Trophy,
  Route,
  Map,
  Ticket,
  ShieldAlert,
  Sparkles,
  Tag,
  Crown,
  Megaphone,
  Bell,
  Coins,
  AppWindow,
  Radius,
  FileText,
  Mail,
  KeyRound,
  Link2,
  Users2,
  FileBadge2,
  Zap,
  Package,
  UserCheck,
  Wallet,
  Banknote,
  Database,
  Image as ImageIconLucide,
  Smartphone,
  BrainCircuit,
  Bot,
  FlaskConical,
  Percent,
  ClipboardList,
  Gauge,
  Sun,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface SettingItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  tone?: "accent" | "success" | "warning" | "error" | "neutral";
}

interface SettingSection {
  title: string;
  items: SettingItem[];
}

export default function AdminSettingsScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [active, setActive] = useState<string | null>(null);

  const sections = useMemo<SettingSection[]>(
    () => [
      {
        title: "Service",
        items: [
          { id: "service-settings", label: "Service Settings", description: "Core service configuration", icon: Wrench, tone: "accent" },
          { id: "vehicle-type", label: "Vehicle Make & Model", description: "Manage vehicle makes and models", icon: Car, tone: "neutral" },
          { id: "required-documents", label: "Required Documents", description: "Partner onboarding docs", icon: FileCheck2, tone: "warning" },
          { id: "document-type", label: "Document Type", description: "Categorize required documents", icon: FileBadge2, tone: "neutral" },
          { id: "vehicle-services", label: "Vehicle Services", description: "Services per vehicle type", icon: Layers, tone: "neutral" },
          { id: "display-settings", label: "Display Settings", description: "Show/hide sections on home screen", icon: Eye, tone: "accent" },
          { id: "partner-type", label: "Partner Type", description: "Categories & sub-services for partners", icon: Users2, tone: "success" },
        ],
      },
      {
        title: "General",
        items: [
          { id: "site-settings", label: "App Settings", description: "Theme, icons, splash & default location", icon: Globe, tone: "accent" },
          { id: "splash-screen", label: "Splash Screen", description: "Edit splash image & background color", icon: ImageIconLucide, tone: "accent" },
          { id: "app-icon", label: "App Icon", description: "Change app icon for all users", icon: Smartphone, tone: "warning" },
          { id: "referral-settings", label: "Referral Settings", description: "Configure referral rewards", icon: Gift, tone: "success" },
          { id: "referral-tree", label: "Referral Tree", description: "Visualize referral network", icon: GitBranch, tone: "neutral" },
          { id: "sub-admin", label: "Sub Admin", description: "Manage admin staff", icon: ShieldCheck, tone: "accent" },
          { id: "ip-access", label: "IP Whitelist / Blacklist", description: "Allow trusted IPs, block others", icon: ShieldAlert, tone: "warning" },
        ],
      },
      {
        title: "Geography",
        items: [
          { id: "geo-fencing", label: "Geo Fencing", description: "Define operating zones", icon: MapPinned, tone: "accent" },
          { id: "multi-gate-places", label: "Multi-Gate Places", description: "Places with multiple gates", icon: Building2, tone: "neutral" },
          { id: "airport-areas", label: "Airport Areas", description: "Airport pickup zones", icon: Plane, tone: "neutral" },
          { id: "country-states-cities", label: "Country/States/Cities", description: "Region hierarchy", icon: Map, tone: "neutral" },
          { id: "api-keys", label: "API Keys", description: "Maps & geography providers", icon: KeyRound, tone: "warning" },
          { id: "assign-service", label: "Assign Service", description: "Map pages to provider services", icon: Link2, tone: "accent" },
        ],
      },
      {
        title: "Payments & Promos",
        items: [
          { id: "payment-type", label: "Payment Type", description: "Available payment methods", icon: CreditCard, tone: "accent" },
          { id: "payment-gateway", label: "Payment Gateway", description: "Stripe, Fiuu, PayPal & more", icon: Wallet, tone: "success" },
          { id: "driver-incentive", label: "Partner Incentive", description: "Bonus & incentive rules", icon: TrendingUp, tone: "success" },
          { id: "commission-rates", label: "Commission Rates", description: "Master rate + country/state/city/suburb & user overrides", icon: Percent, tone: "success" },
          { id: "meter-digital", label: "Meter Digital Setting", description: "Taxi meter sensors, console panels & fare rates per region", icon: Gauge, tone: "accent" },
          { id: "get-coin", label: "Get Coin", description: "GET.coin exchange rate — GC per RM", icon: Coins, tone: "warning" },
          { id: "leaderboard", label: "Leaderboard", description: "Top partner rankings", icon: Trophy, tone: "warning" },
          { id: "rides", label: "Rides", description: "Ride configuration", icon: Route, tone: "neutral" },
          { id: "fare-ai", label: "Fare AI Provider", description: "Choose Gemini, Grok or ChatGPT for fare calc", icon: BrainCircuit, tone: "accent" },
          { id: "promocode-list", label: "Promocode List", description: "Active promo codes", icon: Ticket, tone: "warning" },
          { id: "insurance-providers", label: "Insurance Providers", description: "Partnered insurers", icon: ShieldAlert, tone: "neutral" },
          { id: "free-ride", label: "Free Ride", description: "Free ride campaigns", icon: Sparkles, tone: "success" },
          { id: "fixed-price", label: "Fixed Price", description: "Fixed-fare routes", icon: Tag, tone: "accent" },
          { id: "subscription-plan", label: "Subscription Plan", description: "Partner subscription tiers", icon: Crown, tone: "warning" },
        ],
      },
      {
        title: "Marketing & Notifications",
        items: [
          { id: "advertisement-banners", label: "Advertisement Banners", description: "In-app banner ads", icon: Megaphone, tone: "accent" },
          { id: "push-notification", label: "Push Notification", description: "Send push messages", icon: Bell, tone: "warning" },
          { id: "social-links", label: "Social Links", description: "Manage social profiles", icon: Share2, tone: "neutral" },
        ],
      },
      {
        title: "TEKSI EV",
        items: [
          { id: "ev-vehicle-details", label: "EV Vehicle Details", description: "Models, colours, pricing & accessories", icon: Zap, tone: "accent" },
          { id: "ev-vehicle-inventory", label: "EV Vehicle Inventory", description: "Units available for fast delivery (with VIN)", icon: Package, tone: "success" },
          { id: "ev-delivery-advisors", label: "Delivery Advisors", description: "Assign DAs across countries & dealerships", icon: UserCheck, tone: "warning" },
          { id: "ev-finance-options", label: "Finance Options", description: "Cash, Leasing & Financing plans", icon: Wallet, tone: "neutral" },
          { id: "ev-order-fee", label: "Order Fee", description: "Non-refundable order fee per country", icon: Banknote, tone: "warning" },
          { id: "ev-delivery-checklist", label: "Delivery Checklist", description: "Handover items advisors confirm at delivery", icon: ClipboardList, tone: "success" },
        ],
      },
      {
        title: "System",
        items: [
          { id: "world-currency", label: "World Currency", description: "Supported currencies", icon: Coins, tone: "neutral" },
          { id: "app-version-setting", label: "App Version Setting", description: "Force update controls", icon: AppWindow, tone: "accent" },
          { id: "search-radius", label: "Search Radius", description: "Partner search range", icon: Radius, tone: "neutral" },
          { id: "page-list", label: "Page List", description: "Static content pages", icon: FileText, tone: "neutral" },
          { id: "email-templates", label: "Email Templates", description: "Manage email content", icon: Mail, tone: "accent" },
          { id: "rork-chat", label: "Rork AI Chat", description: "AI assistant to manage your platform", icon: Bot, tone: "accent" },
          { id: "always-on", label: "Always ON", description: "Pages where the screen never sleeps or dims", icon: Sun, tone: "warning" },
          { id: "mock-settings", label: "Mock / Simulation", description: "Turn off demo & simulated behavior per feature", icon: FlaskConical, tone: "warning" },
          { id: "supabase", label: "Supabase", description: "Connection, project URL, keys & health", icon: Database, tone: "success" },
        ],
      },
    ],
    []
  );

  const toneColor = (tone?: SettingItem["tone"]) => {
    switch (tone) {
      case "success":
        return Colors.success;
      case "warning":
        return Colors.warning ?? "#F59E0B";
      case "error":
        return Colors.error;
      case "neutral":
        return Colors.textSecondary;
      case "accent":
      default:
        return Colors.accent;
    }
  };

  const routeMap: Record<string, string> = {
    "service-settings": "/admin-settings-service",
    "vehicle-type": "/admin-settings-vehicle-make-model",
    "required-documents": "/admin-settings-required-documents",
    "document-type": "/admin-settings-document-type",
    "vehicle-services": "/admin-settings-vehicle-services",
    "display-settings": "/admin-settings-display",
    "partner-type": "/admin-settings-partner-type",
    "site-settings": "/admin-settings-site",
    "referral-settings": "/admin-settings-referral",
    "referral-tree": "/admin-settings-referral-tree",
    "sub-admin": "/admin-settings-sub-admin",
    "ip-access": "/admin-settings-ip-access",
    "geo-fencing": "/admin-settings-geo-fencing",
    "multi-gate-places": "/admin-settings-multi-gate-places",
    "airport-areas": "/admin-settings-airport-areas",
    "country-states-cities": "/admin-settings-country-states-cities",
    "api-keys": "/admin-settings-api-keys",
    "assign-service": "/admin-settings-assign-service",
    "payment-type": "/admin-settings-payment-type",
    "payment-gateway": "/admin-settings-payment-gateway",
    "driver-incentive": "/admin-settings-driver-incentive",
    "commission-rates": "/admin-settings-commission",
    "meter-digital": "/admin-settings-meter-digital",
    "get-coin": "/admin-settings-get-coin",
    leaderboard: "/admin-settings-leaderboard",
    rides: "/admin-settings-rides",
    "fare-ai": "/admin-settings-fare-ai",
    "promocode-list": "/admin-settings-promocode",
    "insurance-providers": "/admin-settings-insurance-providers",
    "free-ride": "/admin-settings-free-ride",
    "fixed-price": "/admin-settings-fixed-price",
    "subscription-plan": "/admin-settings-subscription-plan",
    "advertisement-banners": "/admin-settings-advertisement-banners",
    "push-notification": "/admin-settings-push-notification",
    "social-links": "/admin-settings-social-links",
    "world-currency": "/admin-settings-world-currency",
    "app-version-setting": "/admin-settings-app-version",
    "search-radius": "/admin-settings-search-radius",
    "page-list": "/admin-settings-page-list",
    "email-templates": "/admin-settings-email-templates",
    "ev-vehicle-details": "/admin-settings-ev-vehicle-details",
    "ev-vehicle-inventory": "/admin-settings-ev-vehicle-inventory",
    "ev-delivery-advisors": "/admin-settings-ev-delivery-advisors",
    "ev-finance-options": "/admin-settings-ev-finance-options",
    "ev-order-fee": "/admin-settings-ev-order-fee",
    "ev-delivery-checklist": "/admin-settings-ev-delivery-checklist",
    supabase: "/admin-settings-supabase",
    "always-on": "/admin-settings-always-on",
    "mock-settings": "/admin-settings-mock",
    "rork-chat": "/admin-settings-rork-chat",
    "splash-screen": "/admin-settings-splash",
    "app-icon": "/admin-settings-app-icon",
  };

  const handlePress = (item: SettingItem) => {
    setActive(item.id);
    const path = routeMap[item.id];
    if (path) router.push(path as any);
  };

  const renderRow = (item: SettingItem) => {
    const Icon = item.icon;
    const color = toneColor(item.tone);
    const isActive = active === item.id;
    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.row,
          {
            backgroundColor: Colors.gray[100],
            borderColor: isActive ? color : Colors.border,
            borderWidth: isActive ? 1.5 : 1,
          },
        ]}
        onPress={() => handlePress(item)}
        testID={`setting-row-${item.id}`}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[styles.rowIcon, { backgroundColor: color + "20" }]}>
          <Icon color={color} size={20} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowLabel, { color: Colors.text }]}>{item.label}</Text>
          <Text style={[styles.rowDesc, { color: Colors.textSecondary }]}>{item.description}</Text>
        </View>
        <ChevronRight color={Colors.textSecondary} size={18} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="settings-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Settings color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Settings</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>Configure platform and services</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {sections.map((section, idx) => (
          <View key={section.title} style={{ marginTop: idx === 0 ? 0 : 22 }}>
            <Text style={[styles.sectionTitle, { color: Colors.text }]}>{section.title}</Text>
            <View style={styles.list}>{section.items.map(renderRow)}</View>
          </View>
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
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
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "700" as const },
  rowDesc: { fontSize: 12, marginTop: 2 },
});
