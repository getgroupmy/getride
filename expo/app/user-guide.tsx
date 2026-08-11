import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  ArrowLeft,
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  Home,
  MapPin,
  Navigation,
  Car,
  Clock,
  CreditCard,
  Bell,
  Shield,
  Settings as SettingsIcon,
  HelpCircle,
  User,
  Phone,
  Lock,
  Globe,
  Moon,
  FileText,
  LogIn,
  Smartphone,
  Truck,
  Receipt,
  Printer,
  Mail,
  Wifi,
  type LucideIcon,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface ScreenSection {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  features: { title: string; detail: string }[];
  image?: string;
}

interface ScreenCategory {
  id: string;
  title: string;
  screens: ScreenSection[];
}

const CATEGORIES: ScreenCategory[] = [
  {
    id: "auth",
    title: "Getting Started",
    screens: [
      {
        id: "onboarding",
        title: "Onboarding",
        icon: LogIn,
        description: "Welcome screens that introduce you to the app's main features.",
        features: [
          { title: "Swipe through slides", detail: "Browse the introduction carousel to learn what you can do." },
          { title: "Skip or Get Started", detail: "Skip the intro or tap Get Started to move to login." },
        ],
      },
      {
        id: "phone-auth",
        title: "Phone Authentication",
        icon: Phone,
        description: "Sign in or sign up using your mobile phone number.",
        image: "https://r2-pub.rork.com/generated-images/0b30969d-3e9b-4a1b-a31f-cf0101c41a78.png",
        features: [
          { title: "Country code picker", detail: "Select your country dial code from the list." },
          { title: "Send OTP", detail: "We send a one-time password to your phone via SMS." },
        ],
      },
      {
        id: "otp-verify",
        title: "OTP Verification",
        icon: Lock,
        description: "Enter the 6-digit code sent to your phone to verify your identity.",
        features: [
          { title: "Auto-focus inputs", detail: "Code boxes auto-advance as you type." },
          { title: "Resend code", detail: "Tap resend if you didn't receive the SMS." },
        ],
      },
      {
        id: "pin-setup",
        title: "PIN Setup",
        icon: Lock,
        description: "Create a secure 4-6 digit PIN to protect your account.",
        features: [
          { title: "Set PIN", detail: "Enter and confirm your new PIN." },
          { title: "Quick access", detail: "Use this PIN to log in faster next time." },
        ],
      },
      {
        id: "pin-verify",
        title: "PIN Verification",
        icon: Lock,
        description: "Enter your PIN to securely access the app.",
        features: [
          { title: "Forgot PIN", detail: "Reset your PIN using phone OTP verification." },
        ],
      },
      {
        id: "name-entry",
        title: "Name Entry",
        icon: User,
        description: "Enter your full name to personalize your account.",
        features: [
          { title: "Profile setup", detail: "Your name is displayed across the app." },
        ],
      },
      {
        id: "role-selection",
        title: "Role Selection",
        icon: User,
        description: "Choose whether you want to use the app as a Passenger or Driver.",
        features: [
          { title: "Passenger", detail: "Book rides, freight, and other services." },
          { title: "Driver", detail: "Accept rides and earn from TEKSI or eHailing." },
        ],
      },
      {
        id: "rules-terms",
        title: "Rules & Terms",
        icon: FileText,
        description: "Review and accept the app's terms of service and rules.",
        features: [
          { title: "Read terms", detail: "Scroll through the full agreement." },
          { title: "Accept to continue", detail: "Required before using the app." },
        ],
      },
    ],
  },
  {
    id: "passenger",
    title: "Passenger",
    screens: [
      {
        id: "home",
        title: "Home (City)",
        icon: Home,
        description: "Main map screen where you can plan and book rides.",
        image: "https://r2-pub.rork.com/generated-images/f5690765-8302-4f8b-b3b8-2ab1325894f9.png",
        features: [
          { title: "Where to?", detail: "Tap to search for your destination." },
          { title: "Side menu", detail: "Tap the menu icon to access all features." },
          { title: "Quick actions", detail: "Access saved places and recent trips." },
        ],
      },
      {
        id: "search",
        title: "Search Destination",
        icon: Search,
        description: "Find and select your pickup and drop-off locations.",
        features: [
          { title: "Live suggestions", detail: "Type to see place suggestions instantly." },
          { title: "Map picker", detail: "Tap on the map to set a precise location." },
          { title: "Recent & saved", detail: "Quickly reuse recent or favorite places." },
        ],
      },
      {
        id: "map-picker",
        title: "Map Picker",
        icon: MapPin,
        description: "Pin a location on the map for pickup or drop-off.",
        features: [
          { title: "Drag map", detail: "Move the map to position the pin." },
          { title: "Confirm", detail: "Tap confirm to set the chosen point." },
        ],
      },
      {
        id: "ride-confirm",
        title: "Ride Confirmation",
        icon: Car,
        description: "Review trip details and choose vehicle type before booking.",
        image: "https://r2-pub.rork.com/generated-images/27b2a6de-2843-4258-af4f-f29a93ce089a.png",
        features: [
          { title: "Vehicle types", detail: "Pick from economy, comfort, or freight." },
          { title: "Fare estimate", detail: "See the estimated fare and ETA." },
          { title: "Promo code", detail: "Apply a discount or promo." },
        ],
      },
      {
        id: "offer-fare",
        title: "Offer Your Fare",
        icon: CreditCard,
        description: "Propose a custom fare to nearby drivers.",
        features: [
          { title: "Adjust price", detail: "Increase or decrease your offer." },
          { title: "Quick presets", detail: "Use suggested fare amounts." },
        ],
      },
      {
        id: "ride-tracking",
        title: "Ride Tracking",
        icon: Navigation,
        description: "Watch your driver approach in real time.",
        image: "https://r2-pub.rork.com/generated-images/6160f384-80ab-4ac9-96cb-10bb6bc6ac6c.png",
        features: [
          { title: "Live driver location", detail: "See the driver moving on the map." },
          { title: "Driver details", detail: "Name, plate number, vehicle, and rating." },
          { title: "Call or message", detail: "Contact the driver directly." },
        ],
      },
      {
        id: "ride-running",
        title: "Ride In Progress",
        icon: Car,
        description: "Live status while you are on the trip.",
        features: [
          { title: "Route preview", detail: "See your journey on the map." },
          { title: "ETA updates", detail: "Live arrival time updates as you move." },
          { title: "Safety tools", detail: "Share trip or trigger an SOS." },
        ],
      },
      {
        id: "ride-detail",
        title: "Ride Details / Receipt",
        icon: Receipt,
        description: "Full breakdown of a completed ride with map snapshot.",
        image: "https://r2-pub.rork.com/generated-images/d8e34c46-a136-4982-97cc-1999cd1aee10.png",
        features: [
          { title: "Map snapshot", detail: "Static map image showing the route." },
          { title: "Print receipt", detail: "Send a receipt to a connected Bluetooth printer." },
          { title: "Email receipt", detail: "Send a PDF receipt with the GET.ride logo to any email." },
          { title: "Back to home", detail: "Return to the driver TEKSI screen." },
        ],
      },
    ],
  },
  {
    id: "driver",
    title: "Driver",
    screens: [
      {
        id: "driver-mode-select",
        title: "Driver Mode Select",
        icon: Car,
        description: "Choose between TEKSI (traditional metered) and eHailing (on-demand) driving modes.",
        features: [
          { title: "Open from logo", detail: "Tap the TEKSI logo at the top center of the driver screen to open the mode selector." },
          { title: "TEKSI mode", detail: "Traditional taxi mode with on-street pickups and a manual fare meter." },
          { title: "eHailing mode", detail: "App-based on-demand requests dispatched to you in real time." },
          { title: "Switch any time", detail: "You can switch between modes whenever you are not on an active trip." },
        ],
      },
      {
        id: "partner-teksi",
        title: "Driver TEKSI Mode",
        icon: Car,
        description: "Traditional TEKSI dashboard for street-hail / metered trips.",
        image: "https://r2-pub.rork.com/generated-images/3429e8fa-9e96-4617-9d84-50c7ea8f0b31.png",
        features: [
          { title: "TEKSI logo (center top)", detail: "Tap to open the Driver Mode Select sheet and switch to eHailing." },
          { title: "Side menu", detail: "Access settings, history, user guide, and support from the menu icon." },
          { title: "Map & current location", detail: "Live Google map with your vehicle position and traffic." },
          { title: "Start meter", detail: "Begin a metered trip — fare is calculated by distance and waiting time." },
          { title: "Pause / Resume meter", detail: "Pause the meter during stops and resume when moving again." },
          { title: "Stop meter", detail: "End the trip and generate a final fare and receipt." },
          { title: "Print / Email receipt", detail: "Print to a paired Bluetooth printer or email a PDF receipt to the passenger." },
          { title: "Today's earnings", detail: "Quick summary of trips completed and total earnings for the day." },
          { title: "Trip history", detail: "Open Distances & Trips to review past metered rides." },
        ],
      },
      {
        id: "partner-ehailing",
        title: "Driver eHailing Mode",
        icon: Smartphone,
        description: "On-demand dashboard that receives ride requests dispatched from passengers in the app.",
        image: "https://r2-pub.rork.com/generated-images/dc0ea8b9-e082-4445-b234-5899f3d3c90a.png",
        features: [
          { title: "Online / Offline toggle", detail: "Go online to start receiving requests; go offline to stop. Status is shown clearly at the top." },
          { title: "Live map", detail: "Shows your live position so the dispatch system can match nearby riders." },
          { title: "Incoming request popup", detail: "A full-screen card appears when a new request arrives with a 30-45 second countdown timer." },
          { title: "Request details", detail: "See passenger name, pickup point, drop-off, distance, estimated time, and fare before accepting." },
          { title: "Accept / Decline", detail: "Accept to start the job, or decline to pass it to the next driver. Ignoring lets the timer auto-decline." },
          { title: "Auto-decline timer", detail: "If you don't respond within 30-45 seconds the request is automatically passed on." },
          { title: "Navigate to pickup", detail: "After accepting, turn-by-turn navigation guides you to the passenger." },
          { title: "Start / Complete trip", detail: "Start the trip on arrival and complete it at the destination to finalize fare." },
          { title: "Earnings & history", detail: "Each completed eHailing job is added to your trip history and daily earnings." },
          { title: "Switch back to TEKSI", detail: "Tap the TEKSI logo to reopen the mode selector and return to TEKSI mode." },
        ],
      },
      {
        id: "navigation",
        title: "Navigation",
        icon: Navigation,
        description: "Turn-by-turn navigation while driving to or with a passenger.",
        features: [
          { title: "Live route", detail: "Updated route based on current traffic." },
          { title: "Voice guidance", detail: "Listen to upcoming turns hands-free." },
        ],
      },
      {
        id: "distances",
        title: "Distances & Trips",
        icon: Truck,
        description: "Log of distances traveled and completed trips.",
        features: [
          { title: "Daily totals", detail: "Total distance and earnings per day." },
          { title: "Trip history", detail: "Tap a trip to see full details." },
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account & Settings",
    screens: [
      {
        id: "settings",
        title: "Settings",
        icon: SettingsIcon,
        description: "Manage your account preferences and app behavior.",
        image: "https://r2-pub.rork.com/generated-images/d8688a1f-d436-459f-8895-541d842c1f60.png",
        features: [
          { title: "Profile", detail: "Update your name and personal details." },
          { title: "Security", detail: "Change PIN or phone number." },
          { title: "Preferences", detail: "Language, dark mode, notifications." },
        ],
      },
      {
        id: "change-number",
        title: "Change Phone Number",
        icon: Phone,
        description: "Update the phone number linked to your account.",
        features: [
          { title: "Verify new number", detail: "OTP confirmation for the new number." },
        ],
      },
      {
        id: "language",
        title: "Language",
        icon: Globe,
        description: "Choose your preferred language for the app interface.",
        features: [
          { title: "Multiple languages", detail: "Pick from supported languages." },
        ],
      },
      {
        id: "dark-mode",
        title: "Dark Mode",
        icon: Moon,
        description: "Switch between light, dark, or system theme.",
        features: [
          { title: "Auto", detail: "Match your device's appearance setting." },
          { title: "Light / Dark", detail: "Force a specific theme." },
        ],
      },
      {
        id: "notifications",
        title: "Notifications",
        icon: Bell,
        description: "Control which notifications you receive.",
        features: [
          { title: "Push", detail: "Ride updates, promotions, and account alerts." },
        ],
      },
      {
        id: "safety",
        title: "Safety",
        icon: Shield,
        description: "Tools to keep you safe during rides.",
        features: [
          { title: "Emergency contacts", detail: "Add trusted contacts for SOS sharing." },
          { title: "Share trip", detail: "Send live trip status to a contact." },
        ],
      },
      {
        id: "help",
        title: "Help & Support",
        icon: HelpCircle,
        description: "Find answers and contact support.",
        features: [
          { title: "FAQ", detail: "Browse frequently asked questions." },
          { title: "Contact us", detail: "Reach support via chat or email." },
        ],
      },
    ],
  },
  {
    id: "extras",
    title: "Extras",
    screens: [
      {
        id: "printer",
        title: "Bluetooth Printer",
        icon: Printer,
        description: "Connect a Bluetooth printer to print ride receipts.",
        features: [
          { title: "Pair device", detail: "Discover and connect a nearby printer." },
          { title: "Print receipt", detail: "Print directly from the ride detail screen." },
        ],
      },
      {
        id: "email-receipt",
        title: "Email Receipt",
        icon: Mail,
        description: "Send a PDF copy of any receipt to an email address.",
        features: [
          { title: "Email validation", detail: "We check the email format before sending." },
          { title: "PDF with logo", detail: "Receipt includes the GET.ride logo and fits one page." },
        ],
      },
      {
        id: "connectivity",
        title: "Connectivity",
        icon: Wifi,
        description: "The app works best with a stable internet connection.",
        features: [
          { title: "Offline indicator", detail: "Banner appears if you lose connection." },
        ],
      },
      {
        id: "history",
        title: "Request History",
        icon: Clock,
        description: "List of every ride and request you've made.",
        features: [
          { title: "Search & filter", detail: "Find past trips by date or status." },
          { title: "Reorder", detail: "Quickly book a similar trip again." },
        ],
      },
    ],
  },
];

export default function UserGuideScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [query, setQuery] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<boolean>(false);

  const buildGuideHtml = (): string => {
    const accent = "#2dabe2";
    const logoUrl = "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/9i4ujpszilk1s08krecs3.png";
    const dateStr = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sections = CATEGORIES.map((cat) => {
      const screensHtml = cat.screens.map((s) => {
        const featuresHtml = s.features
          .map((f) => `<li><span class=\"f-title\">${escape(f.title)}</span><span class=\"f-detail\">${escape(f.detail)}</span></li>`)
          .join("");
        const imageHtml = s.image
          ? `<div class=\"s-img-wrap\"><img class=\"s-img\" src=\"${s.image}\" alt=\"${escape(s.title)} screenshot\"/></div>`
          : "";
        return `<div class=\"screen ${s.image ? "screen-with-img" : ""}\">
          <div class=\"screen-text\">
            <h3 class=\"s-title\">${escape(s.title)}</h3>
            <p class=\"s-desc\">${escape(s.description)}</p>
            <ul class=\"f-list\">${featuresHtml}</ul>
          </div>
          ${imageHtml}
        </div>`;
      }).join("");
      return `<section class=\"cat\">
        <h2 class=\"c-title\">${escape(cat.title)}</h2>
        ${screensHtml}
      </section>`;
    }).join("");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TEKSI User Guide</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:0;color:#111827;background:#ffffff;-webkit-font-smoothing:antialiased}
  .cover{padding:32px 28px;background:${accent};color:#ffffff;text-align:center}
  .logo-wrap{display:inline-block;background:#ffffff;border-radius:16px;padding:8px;margin-bottom:14px}
  .logo-wrap img{width:84px;height:84px;display:block;border-radius:10px;object-fit:contain}
  .cover h1{margin:0;font-size:26px;font-weight:900;letter-spacing:.5px}
  .cover p{margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.9);font-weight:500}
  .container{padding:20px 24px}
  .toc{background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:14px 18px;margin-bottom:18px}
  .toc h2{margin:0 0 8px;font-size:14px;color:${accent};letter-spacing:.5px;text-transform:uppercase}
  .toc ul{margin:0;padding-left:18px}
  .toc li{font-size:12px;line-height:1.6;color:#374151}
  .cat{margin-bottom:18px;page-break-inside:avoid}
  .c-title{font-size:16px;font-weight:800;color:${accent};text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;border-bottom:2px solid ${accent};padding-bottom:4px}
  .screen{padding:10px 0;border-bottom:1px solid #f3f4f6;page-break-inside:avoid}
  .screen:last-child{border-bottom:none}
  .screen-with-img{display:flex;gap:14px;align-items:flex-start}
  .screen-text{flex:1;min-width:0}
  .s-img-wrap{flex:0 0 110px;width:110px}
  .s-img{width:110px;height:auto;border-radius:14px;border:1px solid #e5e7eb;display:block;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
  .s-title{font-size:13px;font-weight:700;margin:0 0 2px;color:#111827}
  .s-desc{font-size:11px;color:#4b5563;margin:0 0 4px;line-height:1.45}
  .f-list{margin:0;padding-left:14px;list-style:disc}
  .f-list li{font-size:10.5px;line-height:1.45;color:#374151;margin:2px 0}
  .f-title{font-weight:700;color:#111827}
  .f-detail{color:#6b7280}
  .f-title:after{content:\" — \"}
  .footer{padding:14px 24px;text-align:center;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;margin-top:14px}
  @page{size:A4;margin:14mm}
</style>
</head>
<body>
  <div class="cover">
    <div class="logo-wrap"><img src="${logoUrl}" alt="GET.ride"/></div>
    <h1>GET.ride USER GUIDE</h1>
    <p>Complete walkthrough of every screen and feature</p>
    <p style="margin-top:10px;font-size:11px;opacity:.85">Generated · ${dateStr}</p>
  </div>
  <div class="container">
    <div class="toc">
      <h2>Contents</h2>
      <ul>
        ${CATEGORIES.map((c) => `<li><b>${escape(c.title)}</b> — ${c.screens.length} screens</li>`).join("")}
      </ul>
    </div>
    ${sections}
  </div>
  <div class="footer">TEKSI · User Guide · This document is auto-generated.</div>
</body>
</html>`;
  };

  const onDownload = async () => {
    if (downloading) return;
    try {
      setDownloading(true);
      console.log("[user-guide] download start");
      const html = buildGuideHtml();

      if (Platform.OS === "web") {
        const w = typeof window !== "undefined" ? window.open("", "_blank") : null;
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
          setTimeout(() => {
            try { w.print(); } catch (e) { console.log("[user-guide] web print err", e); }
          }, 400);
        } else {
          Alert.alert("Download", "Please allow pop-ups to download the guide.");
        }
        return;
      }

      const file = await Print.printToFileAsync({ html, base64: false, width: 595, height: 842 });
      console.log("[user-guide] pdf created", file?.uri);
      if (!file?.uri) {
        Alert.alert("Download failed", "Could not generate the PDF. Please try again.");
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: "Save or share TEKSI User Guide",
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Saved", `Guide saved to: ${file.uri}`);
      }
    } catch (e) {
      console.log("[user-guide] download error", e);
      Alert.alert("Download failed", "Could not download the user guide. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const filtered = useMemo<ScreenCategory[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((c) => ({
      ...c,
      screens: c.screens.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.features.some(
            (f) =>
              f.title.toLowerCase().includes(q) ||
              f.detail.toLowerCase().includes(q),
          ),
      ),
    })).filter((c) => c.screens.length > 0);
  }, [query]);

  return (
    <View style={[styles.root, { backgroundColor: Colors.background }]} testID="user-guide-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={[styles.header, { borderBottomColor: Colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            testID="user-guide-back"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={Colors.text} size={24} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: Colors.text }]}>User Guide</Text>
            <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
              Learn every screen and feature
            </Text>
          </View>
          <TouchableOpacity
            onPress={onDownload}
            disabled={downloading}
            style={[styles.headerBtn, { backgroundColor: Colors.accent + "18" }]}
            testID="user-guide-download"
            accessibilityLabel="Download user guide as PDF"
            accessibilityRole="button"
          >
            {downloading ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <Download color={Colors.accent} size={22} />
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.searchBar, { backgroundColor: Colors.secondary, borderColor: Colors.border }]}>
          <Search color={Colors.textSecondary} size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search guide..."
            placeholderTextColor={Colors.textSecondary}
            style={[styles.searchInput, { color: Colors.text }]}
            testID="user-guide-search"
            accessibilityLabel="Search the guide"
          />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
              No results for "{query}"
            </Text>
          </View>
        ) : null}

        {filtered.map((category) => (
          <View key={category.id} style={styles.categoryBlock}>
            <Text style={[styles.categoryTitle, { color: Colors.textSecondary }]}>
              {category.title.toUpperCase()}
            </Text>
            <View style={[styles.categoryCard, { backgroundColor: Colors.secondary, borderColor: Colors.border }]}>
              {category.screens.map((screen, idx) => {
                const isOpen = expandedId === screen.id;
                const Icon = screen.icon;
                return (
                  <View key={screen.id}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setExpandedId(isOpen ? null : screen.id)}
                      style={[
                        styles.row,
                        idx < category.screens.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: Colors.border,
                        },
                      ]}
                      testID={`guide-row-${screen.id}`}
                      accessibilityRole="button"
                    >
                      <View style={[styles.iconBubble, { backgroundColor: Colors.accent + "22" }]}>
                        <Icon color={Colors.accent} size={20} />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={[styles.rowTitle, { color: Colors.text }]}>{screen.title}</Text>
                        <Text
                          style={[styles.rowDesc, { color: Colors.textSecondary }]}
                          numberOfLines={isOpen ? undefined : 2}
                        >
                          {screen.description}
                        </Text>
                      </View>
                      {isOpen ? (
                        <ChevronUp color={Colors.textSecondary} size={20} />
                      ) : (
                        <ChevronDown color={Colors.textSecondary} size={20} />
                      )}
                    </TouchableOpacity>

                    {isOpen ? (
                      <View style={[styles.featuresWrap, { borderTopColor: Colors.border }]}>
                        {screen.image ? (
                          <View style={styles.previewWrap}>
                            <Image
                              source={{ uri: screen.image }}
                              style={styles.previewImg}
                              resizeMode="contain"
                              testID={`guide-img-${screen.id}`}
                            />
                          </View>
                        ) : null}
                        {screen.features.map((f, i) => (
                          <View key={i} style={styles.featureRow}>
                            <View style={[styles.bullet, { backgroundColor: Colors.accent }]} />
                            <View style={styles.featureTextWrap}>
                              <Text style={[styles.featureTitle, { color: Colors.text }]}>{f.title}</Text>
                              <Text style={[styles.featureDetail, { color: Colors.textSecondary }]}>
                                {f.detail}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <TouchableOpacity
          onPress={onDownload}
          disabled={downloading}
          activeOpacity={0.85}
          style={[styles.downloadBtn, { backgroundColor: Colors.accent }]}
          testID="user-guide-download-cta"
          accessibilityRole="button"
        >
          {downloading ? (
            <ActivityIndicator size="small" color={"#000000"} />
          ) : (
            <Download color={"#000000"} size={18} />
          )}
          <Text style={styles.downloadBtnText}>
            {downloading ? "Preparing PDF..." : "Download / Share PDF"}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.footerNote, { color: Colors.textSecondary }]}>
          Need more help? Visit Support from the side menu.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeTop: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTextWrap: { marginLeft: 4, flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: "700" as const },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  categoryBlock: { marginTop: 18 },
  categoryTitle: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 1,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  categoryCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: "600" as const },
  rowDesc: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  featuresWrap: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  featureTextWrap: { flex: 1 },
  featureTitle: { fontSize: 14, fontWeight: "600" as const },
  featureDetail: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  previewWrap: {
    alignItems: "center",
    marginBottom: 6,
  },
  previewImg: {
    width: 160,
    height: 320,
    borderRadius: 16,
    backgroundColor: "#00000008",
  },
  emptyWrap: { alignItems: "center", paddingVertical: 60 },
  emptyText: { fontSize: 14 },
  footerNote: {
    textAlign: "center",
    fontSize: 12,
    marginTop: 16,
    marginHorizontal: 24,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  downloadBtnText: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
});
