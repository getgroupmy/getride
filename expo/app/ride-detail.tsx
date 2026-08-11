import React, { useEffect, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Platform,
  Dimensions,
  Share,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as Print from "expo-print";
import * as MailComposer from "expo-mail-composer";
import * as Linking from "expo-linking";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import {
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Clock,
  Route as RouteIcon,
  Receipt,
  Hash,
  Share2,
  Home,
  Wallet,
  Printer,
  Mail,
  X,
  CreditCard,
  Banknote,
  QrCode,
  Building2,
  Smartphone,
  Coins,
  Plus,
  Car,
  Smartphone as PhoneIcon,
  Flag,
  Timer,
  Calculator,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "@/contexts/LocationContext";
import { GOOGLE_STATIC_MAPS_KEY } from "@/constants/googleKeys";
import { getMappingKey } from "@/utils/mappingClient";

const { width } = Dimensions.get("window");

let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
let PROVIDER_GOOGLE: any = undefined;
if (Platform.OS !== "web") {
  const Maps = require("react-native-maps");
  MapView = Maps.default;
  Marker = Maps.Marker;
  Polyline = Maps.Polyline;
  PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
}

export default function RideDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const Colors = useColors();
  const { colorScheme } = useTheme();
  const { currency } = useLocation();
  const insets = useSafeAreaInsets();

  const bookingNo =
    (params.bookingNo as string) ||
    `TKS${Math.floor(100000 + Math.random() * 900000)}`;
  const fare = parseFloat((params.fare as string) || "0");
  const pickupName = (params.pickupName as string) || "Pickup location";
  const pickupAddress = (params.pickupAddress as string) || "";
  const dropName = (params.dropName as string) || "Drop location";
  const dropAddress = (params.dropAddress as string) || "";
  const pickupLat = parseFloat((params.pickupLat as string) || "3.139");
  const pickupLng = parseFloat((params.pickupLng as string) || "101.6869");
  const dropLat = parseFloat((params.dropLat as string) || "3.139");
  const dropLng = parseFloat((params.dropLng as string) || "101.6869");
  const distance = parseFloat((params.distance as string) || "0");
  const duration = parseFloat((params.duration as string) || "0");
  const pickupTime = (params.pickupTime as string) || new Date().toISOString();
  const dropTime = (params.dropTime as string) || new Date().toISOString();
  const status = ((params.status as string) || "completed") as
    | "completed"
    | "ended_early";
  const paymentMethod = (params.paymentMethod as string) || "";
  const baseFare = parseFloat((params.baseFare as string) || String(parseFloat((params.fare as string) || "0")));
  const tolls = parseFloat((params.tolls as string) || "0");
  const extras = parseFloat((params.extras as string) || "0");
  const extrasNote = (params.extrasNote as string) || "";
  const hasExtras = tolls > 0 || extras > 0;
  const driverModeRaw = ((params.driverMode as string) || "TEKSI").toLowerCase();
  const tariff = (((params.tariff as string) || "old") as "new" | "old");
  const isEhailing = driverModeRaw === "ehailing";
  const rideModeLabel = isEhailing ? "eHailing" : "TEKSI";
  const rideModeColor = isEhailing ? "#8b5cf6" : "#f59e0b";
  const RideModeIcon = isEhailing ? PhoneIcon : Car;

  const isCompleted = status === "completed";

  const tariffBreakdown = useMemo(() => {
    const FLAG_FALL = 4.0;
    const INCREMENT = 0.35;
    const safeDistance = Math.max(0, distance);
    const safeDuration = Math.max(0, duration);
    if (safeDistance <= 1) {
      return {
        flagFall: FLAG_FALL,
        distanceUnits: 0,
        timeUnits: 0,
        billedUnits: 0,
        billedSource: "distance" as "distance" | "time",
        incrementsAmount: 0,
        computedBase: FLAG_FALL,
        extraMeters: 0,
        extraSeconds: 0,
      };
    }
    const extraMeters = (safeDistance - 1) * 1000;
    const extraSeconds = safeDuration * 60 * (1 - 1 / safeDistance);
    const distanceUnits = Math.ceil(extraMeters / 200);
    const timeUnits = Math.ceil(extraSeconds / 36);
    const billedUnits = Math.max(distanceUnits, timeUnits);
    const billedSource: "distance" | "time" = distanceUnits >= timeUnits ? "distance" : "time";
    const incrementsAmount = +(billedUnits * INCREMENT).toFixed(2);
    const computedBase = +(FLAG_FALL + incrementsAmount).toFixed(2);
    return {
      flagFall: FLAG_FALL,
      distanceUnits,
      timeUnits,
      billedUnits,
      billedSource,
      incrementsAmount,
      computedBase,
      extraMeters,
      extraSeconds,
    };
  }, [distance, duration]);

  const newTariffBreakdown = useMemo(() => {
    const BASE = 4.0;
    const PER_KM = 1.0;
    const PER_MIN = 0.3;
    const safeDistance = Math.max(0, distance);
    const safeDuration = Math.max(0, duration);
    const distanceAmount = +(safeDistance * PER_KM).toFixed(2);
    const timeAmount = +(safeDuration * PER_MIN).toFixed(2);
    const computedBase = +(BASE + distanceAmount + timeAmount).toFixed(2);
    return { base: BASE, perKm: PER_KM, perMin: PER_MIN, distanceAmount, timeAmount, computedBase };
  }, [distance, duration]);

  const paymentInfo = useMemo(() => {
    switch (paymentMethod) {
      case "cash":
        return { label: "Cash", Icon: Banknote, color: "#10b981" };
      case "card":
        return { label: "Card", Icon: CreditCard, color: "#3b82f6" };
      case "qr":
      case "qr_pay":
        return { label: "QR Pay", Icon: QrCode, color: "#8b5cf6" };
      case "online":
      case "online_transfer":
        return { label: "Online Transfer", Icon: Building2, color: "#0ea5e9" };
      case "tng":
      case "touch_n_go":
      case "touchngo":
        return { label: "Touch 'n Go", Icon: Smartphone, color: "#f97316" };
      default:
        return paymentMethod
          ? { label: paymentMethod, Icon: Wallet, color: Colors.accent }
          : null;
    }
  }, [paymentMethod, Colors.accent]);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "—";
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  const formatDuration = (min: number) => {
    if (min < 60) return `${Math.max(1, Math.round(min))} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  };

  const [resolvedMapKey, setResolvedMapKey] = useState<string>(GOOGLE_STATIC_MAPS_KEY);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const k = await getMappingKey("ride-detail", "maps");
        if (!cancelled && k?.key && k.key.trim().length > 0) setResolvedMapKey(k.key);
      } catch (e) {
        console.log("[ride-detail] resolve map key error", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mapUrl = useMemo(() => {
    const w = Math.round(width - 32);
    const h = 200;
    const mapStyle =
      colorScheme === "dark"
        ? "&style=feature:all|element:geometry|color:0x1a1a1a&style=feature:road|element:geometry.fill|color:0x2c2c2c&style=feature:water|element:geometry|color:0x000000&style=element:labels.text.fill|color:0x9e9e9e&style=element:labels.text.stroke|color:0x1a1a1a"
        : "&style=feature:all|element:geometry|color:0xf5f5f5&style=feature:road|element:geometry.fill|color:0xffffff&style=feature:water|element:geometry|color:0xb3e5fc&style=feature:poi.park|element:geometry|color:0xc8e6c9";
    const pathColor = isCompleted ? "0x10b981FF" : "0xef4444FF";
    return `https://maps.googleapis.com/maps/api/staticmap?size=${w}x${h}&scale=2&maptype=roadmap${mapStyle}&markers=color:0x10b981%7Clabel:A%7C${pickupLat},${pickupLng}&markers=color:0xef4444%7Clabel:B%7C${dropLat},${dropLng}&path=color:${pathColor}%7Cweight:4%7C${pickupLat},${pickupLng}%7C${dropLat},${dropLng}&key=${resolvedMapKey}`;
  }, [
    colorScheme,
    isCompleted,
    pickupLat,
    pickupLng,
    dropLat,
    dropLng,
    resolvedMapKey,
  ]);

  const onShare = async () => {
    try {
      await Share.share({
        message: `GET.ride Ride ${bookingNo}\nFrom: ${pickupName}\nTo: ${dropName}\nFare: ${currency.symbol}${Math.ceil(fare)}\nStatus: ${isCompleted ? "Completed" : "Ended early"}`,
      });
    } catch (e) {
      console.log("[ride-detail] share error", e);
    }
  };

  const goHome = () => {
    const target = (isEhailing ? "/partner-ehailing" : "/partner-teksi") as any;
    try {
      if (typeof (router as any).dismissTo === "function") {
        (router as any).dismissTo(target);
        return;
      }
    } catch (e) {
      console.log("[ride-detail] dismissTo unavailable", e);
    }
    try {
      router.navigate(target);
    } catch (e) {
      console.log("[ride-detail] navigate failed, falling back to replace", e);
      router.replace(target);
    }
  };

  const [emailVisible, setEmailVisible] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [sendingEmail, setSendingEmail] = useState<boolean>(false);
  const [printing, setPrinting] = useState<boolean>(false);

  const buildReceiptHtml = () => {
    const statusLabel = isCompleted ? "Completed" : "Ended early";
    const statusBgHex = isCompleted ? "#d1fae5" : "#fee2e2";
    const statusFgHex = isCompleted ? "#065f46" : "#991b1b";
    const accent = "#2dabe2";
    const logoUrl = "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/9i4ujpszilk1s08krecs3.png";
    const fareStr = `${currency.symbol}${Math.ceil(fare)}`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>Get Ride Receipt ${bookingNo}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body,table,td,div,p,a{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  body{margin:0;padding:0;background:#f3f4f6;color:#111827;width:100%}
  a{color:${accent};text-decoration:none}
  .wrap{width:100%;background:#f3f4f6;padding:24px 12px}
  .card{max-width:600px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(17,24,39,0.08)}
  .head{background:${accent};padding:20px;color:#ffffff;text-align:center}
  .logo{width:72px;height:72px;border-radius:16px;background:#ffffff;display:inline-block;line-height:0;padding:6px;margin-bottom:10px}
  .logo img{width:100%;height:100%;display:block;border-radius:12px;object-fit:contain}
  .brand{font-size:20px;font-weight:800;letter-spacing:.5px;margin:0;color:#ffffff}
  .brand-sub{margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);font-weight:500}
  .status-pill{display:inline-block;margin-top:12px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:800;background:${statusBgHex};color:${statusFgHex};letter-spacing:.4px;text-transform:uppercase}
  .body{padding:20px}
  .meta{font-size:12px;color:#6b7280;text-align:center;margin:0 0 14px;font-weight:500}
  .fare-card{background:#111827;color:#ffffff;border-radius:16px;padding:18px;text-align:center;margin-bottom:14px}
  .fare-label{font-size:11px;letter-spacing:.8px;text-transform:uppercase;color:rgba(255,255,255,0.7);margin:0 0 6px;font-weight:700}
  .fare-value{font-size:32px;font-weight:900;letter-spacing:-.5px;margin:0;color:#ffffff}
  .booking{margin-top:6px;font-size:12px;color:rgba(255,255,255,0.85);font-weight:600}
  .section{border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin-bottom:12px}
  .label{font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:#9ca3af;font-weight:700;margin:0 0 4px}
  .addr{font-size:14px;font-weight:700;color:#111827;margin:0}
  .addr-sub{font-size:12px;color:#6b7280;margin:3px 0 0;line-height:1.4}
  .divider{height:1px;background:#f3f4f6;margin:10px 0}
  .row{font-size:13px;color:#374151;margin:0;padding:5px 0}
  .row .v{font-weight:800;color:#111827;float:right}
  .grid{width:100%;border-collapse:separate;border-spacing:10px;margin-bottom:12px}
  .grid td{width:50%;padding:12px;background:#f9fafb;border-radius:14px;vertical-align:top}
  .metric-v{font-size:20px;font-weight:900;color:#111827;margin:4px 0 2px;letter-spacing:-.3px}
  .metric-l{font-size:11px;color:#6b7280;font-weight:600;margin:0;text-transform:uppercase;letter-spacing:.5px}
  .pin{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle}
  .pin-pickup{background:#10b981}
  .pin-drop{background:${isCompleted ? "#10b981" : "#ef4444"}}
  .footer{padding:14px 20px;text-align:center;background:#f9fafb;color:#6b7280;font-size:11px;line-height:1.5}
  .footer b{color:#111827}
  @media only screen and (max-width:480px){
    .wrap{padding:12px 8px}
    .head{padding:18px 16px}
    .body{padding:16px}
    .fare-value{font-size:28px}
    .grid{border-spacing:0}
    .grid td{display:block;width:100%;padding:12px;margin-bottom:8px}
  }
  @page{size:A4;margin:0}
  @media print{
    html,body{background:#ffffff!important;width:210mm;height:297mm}
    .wrap{background:#ffffff;padding:0}
    .card{max-width:100%;width:100%;margin:0;border-radius:0;box-shadow:none;page-break-inside:avoid;break-inside:avoid}
    .head{padding:14px}
    .logo{width:56px;height:56px;margin-bottom:6px;padding:4px}
    .brand{font-size:16px}
    .brand-sub{font-size:10px}
    .status-pill{margin-top:8px;padding:4px 10px;font-size:10px}
    .body{padding:14px 18px}
    .meta{margin:0 0 10px;font-size:11px}
    .fare-card{padding:12px;margin-bottom:10px;border-radius:12px}
    .fare-label{font-size:9px}
    .fare-value{font-size:24px}
    .booking{font-size:10px}
    .section{padding:10px 12px;margin-bottom:8px;border-radius:10px}
    .label{font-size:9px}
    .addr{font-size:12px}
    .addr-sub{font-size:10px}
    .row{font-size:11px;padding:3px 0}
    .divider{margin:6px 0}
    .grid{border-spacing:6px;margin-bottom:8px}
    .grid td{padding:8px 10px;border-radius:10px}
    .metric-v{font-size:16px}
    .metric-l{font-size:9px}
    .footer{padding:10px;font-size:10px}
  }
</style>
</head>
<body>
  <div class="wrap">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
      <div class="card">
        <div class="head">
          <div class="logo"><img src="${logoUrl}" alt="Get Ride"/></div>
          <p class="brand">GET RIDE</p>
          <p class="brand-sub">Trip receipt</p>
          <div class="status-pill">${statusLabel}</div>
        </div>
        <div class="body">
          <p class="meta">${formatDate(dropTime)} · ${formatTime(dropTime)}</p>

          <div class="fare-card">
            <p class="fare-label">Total fare</p>
            <p class="fare-value">${fareStr}</p>
            <div class="booking">Booking · ${bookingNo}</div>
          </div>

          ${hasExtras ? `
          <div class="section">
            <p class="row"><span>Base fare</span><span class="v">${currency.symbol}${Math.ceil(baseFare)}</span></p>
            ${tolls > 0 ? `<div class="divider"></div><p class="row"><span>Tolls</span><span class="v">${currency.symbol}${tolls.toFixed(2)}</span></p>` : ""}
            ${extras > 0 ? `<div class="divider"></div><p class="row"><span>Other charges${extrasNote ? ` (${extrasNote})` : ""}</span><span class="v">${currency.symbol}${extras.toFixed(2)}</span></p>` : ""}
          </div>` : ""}

          <div class="section">
            <p class="label"><span class="pin pin-pickup"></span>Pickup · ${formatTime(pickupTime)}</p>
            <p class="addr">${pickupName}</p>
            ${pickupAddress ? `<p class="addr-sub">${pickupAddress}</p>` : ""}
          </div>

          <div class="section">
            <p class="label"><span class="pin pin-drop"></span>${isCompleted ? "Drop" : "Drop (ended)"} · ${formatTime(dropTime)}</p>
            <p class="addr">${dropName}</p>
            ${dropAddress ? `<p class="addr-sub">${dropAddress}</p>` : ""}
          </div>

          <table class="grid" role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td>
              <p class="metric-l">Distance</p>
              <p class="metric-v">${distance.toFixed(1)} km</p>
            </td>
            <td>
              <p class="metric-l">Duration</p>
              <p class="metric-v">${formatDuration(duration)}</p>
            </td>
          </tr></table>

          <div class="section">
            <p class="row"><span>Booking No.</span><span class="v">${bookingNo}</span></p>
            <div class="divider"></div>
            <p class="row"><span>Date</span><span class="v">${formatDate(dropTime)}</span></p>
            <div class="divider"></div>
            <p class="row"><span>Status</span><span class="v">${statusLabel}</span></p>
            <div class="divider"></div><p class="row"><span>Ride type</span><span class="v">${rideModeLabel}</span></p>
            ${paymentInfo ? `<div class="divider"></div><p class="row"><span>Payment</span><span class="v">${paymentInfo.label}</span></p>` : ""}
          </div>
        </div>
        <div class="footer">
          <b>Get Ride</b> · Thank you for riding with us<br/>
          This is an automated receipt. Please do not reply.
        </div>
      </div>
    </td></tr></table>
  </div>
</body>
</html>`;
  };

  const onPrint = async () => {
    try {
      setPrinting(true);
      console.log("[ride-detail] print start");
      if (Platform.OS === "web") {
        const html = buildReceiptHtml();
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
          setTimeout(() => {
            try { w.print(); } catch (e) { console.log("[ride-detail] web print err", e); }
          }, 300);
        }
      } else {
        await Print.printAsync({ html: buildReceiptHtml() });
      }
      console.log("[ride-detail] print sent");
    } catch (e) {
      console.log("[ride-detail] print error", e);
      Alert.alert("Print failed", "Could not send to printer. Make sure your bluetooth printer is paired and try again.");
    } finally {
      setPrinting(false);
    }
  };

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const buildPlainBody = () => {
    const statusLabel = isCompleted ? "Completed" : "Ended early";
    return [
      `GET.ride Receipt`,
      `Booking: ${bookingNo}`,
      `Status: ${statusLabel}`,
      ``,
      `Fare: ${currency.symbol}${Math.ceil(fare)}`,
      hasExtras ? `  Base fare: ${currency.symbol}${Math.ceil(baseFare)}` : ``,
      tolls > 0 ? `  Tolls: ${currency.symbol}${tolls.toFixed(2)}` : ``,
      extras > 0 ? `  Other charges${extrasNote ? ` (${extrasNote})` : ""}: ${currency.symbol}${extras.toFixed(2)}` : ``,
      `Distance: ${distance.toFixed(1)} km`,
      `Duration: ${formatDuration(duration)}`,
      ``,
      `Pickup (${formatTime(pickupTime)})`,
      `${pickupName}`,
      pickupAddress ? `${pickupAddress}` : ``,
      ``,
      `${isCompleted ? "Drop" : "Drop (ended)"} (${formatTime(dropTime)})`,
      `${dropName}`,
      dropAddress ? `${dropAddress}` : ``,
      ``,
      `Date: ${formatDate(dropTime)}`,
      `Ride type: ${rideModeLabel}`,
      paymentInfo ? `Payment: ${paymentInfo.label}` : ``,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const onSendEmail = async () => {
    const target = email.trim();
    if (!isValidEmail(target)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    try {
      setSendingEmail(true);
      console.log("[ride-detail] sending receipt email to", target);
      const subject = `GET.ride Receipt ${bookingNo}`;
      const body = buildPlainBody();
      const html = buildReceiptHtml();

      if (Platform.OS === "web") {
        const mailto = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const win = typeof window !== "undefined" ? window.open(mailto, "_self") : null;
        if (!win) {
          await Linking.openURL(mailto);
        }
        setEmailVisible(false);
        setEmail("");
        return;
      }

      const isAvailable = await MailComposer.isAvailableAsync();
      if (!isAvailable) {
        const mailto = `mailto:${encodeURIComponent(target)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const supported = await Linking.canOpenURL(mailto);
        if (supported) {
          await Linking.openURL(mailto);
          setEmailVisible(false);
          setEmail("");
          return;
        }
        Alert.alert("No email account", "Please set up an email account on this device to send receipts.");
        return;
      }

      let attachments: string[] = [];
      try {
        const file = await Print.printToFileAsync({ html, base64: false, width: 595, height: 842 });
        if (file?.uri) attachments = [file.uri];
      } catch (pe) {
        console.log("[ride-detail] pdf gen error", pe);
      }

      const result = await MailComposer.composeAsync({
        recipients: [target],
        subject,
        body: html,
        isHtml: true,
        attachments,
      });
      console.log("[ride-detail] mail composer result", result.status);

      if (result.status === MailComposer.MailComposerStatus.SENT) {
        setEmailVisible(false);
        setEmail("");
        Alert.alert("Receipt sent", `Receipt for ${bookingNo} has been emailed to ${target}.`);
      } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
        setEmailVisible(false);
        setEmail("");
        Alert.alert("Saved as draft", "Your receipt email was saved to drafts.");
      } else {
        console.log("[ride-detail] email cancelled or undetermined");
      }
    } catch (e) {
      console.log("[ride-detail] email error", e);
      Alert.alert("Send failed", "Could not send the receipt. Please try again.");
    } finally {
      setSendingEmail(false);
    }
  };

  const statusColor = isCompleted ? Colors.success : Colors.warning ?? Colors.error;
  const statusBg = (isCompleted ? Colors.success : Colors.warning ?? Colors.error) + "1A";

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={[styles.header, { backgroundColor: Colors.background, borderBottomColor: Colors.gray[200] }]}>
        <TouchableOpacity
          testID="ride-detail-back"
          onPress={goHome}
          style={[styles.headerBtn, { backgroundColor: Colors.gray[100] }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: Colors.text }]}>Ride details</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Share this trip"
          testID="ride-detail-share"
          onPress={onShare}
          style={[styles.headerBtn, { backgroundColor: Colors.gray[100] }]}
        >
          <Share2 color={Colors.text} size={20} />
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.statusCard, { backgroundColor: statusBg, borderColor: statusColor + "33" }]}>
          <View style={[styles.statusIconWrap, { backgroundColor: statusColor }]}>
            {isCompleted ? (
              <CheckCircle2 color="#FFFFFF" size={26} />
            ) : (
              <AlertCircle color="#FFFFFF" size={26} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: statusColor }]}>
              {isCompleted ? "Trip completed" : "Trip ended early"}
            </Text>
            <Text style={[styles.statusSub, { color: Colors.textSecondary }]}>
              {formatDate(dropTime)} · {formatTime(dropTime)}
            </Text>
          </View>
        </View>

        <View style={[styles.mapCard, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
          {Platform.OS !== "web" && MapView ? (
            <MapView
              style={[styles.mapImage, { pointerEvents: "none" }]}
              provider={PROVIDER_GOOGLE}
              initialRegion={{
                latitude: (pickupLat + dropLat) / 2,
                longitude: (pickupLng + dropLng) / 2,
                latitudeDelta: Math.max(Math.abs(pickupLat - dropLat) * 1.8, 0.02),
                longitudeDelta: Math.max(Math.abs(pickupLng - dropLng) * 1.8, 0.02),
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
            >
              <Marker coordinate={{ latitude: pickupLat, longitude: pickupLng }} pinColor="green" title="Pickup" />
              <Marker coordinate={{ latitude: dropLat, longitude: dropLng }} pinColor={isCompleted ? "green" : "red"} title="Drop" />
              <Polyline
                coordinates={[
                  { latitude: pickupLat, longitude: pickupLng },
                  { latitude: dropLat, longitude: dropLng },
                ]}
                strokeColor={isCompleted ? "#10b981" : "#ef4444"}
                strokeWidth={4}
              />
            </MapView>
          ) : (
            <Image
              source={{ uri: mapUrl }}
              style={styles.mapImage}
              resizeMode="cover"
              onError={(e) => console.log("[ride-detail] map image error", e.nativeEvent)}
            />
          )}
        </View>

        <View style={[styles.fareCard, { backgroundColor: Colors.text }]}>
          <View style={styles.fareRow}>
            <View style={styles.fareIconWrap}>
              <Wallet color={Colors.background} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fareLabel, { color: Colors.background, opacity: 0.7 }]}>Total fare paid</Text>
              <Text style={[styles.fareValue, { color: Colors.background }]}>
                {currency.symbol}{Math.ceil(fare)}
              </Text>
            </View>
            <View style={[styles.bookingBadge, { backgroundColor: Colors.background + "22" }]}>
              <Hash color={Colors.background} size={12} />
              <Text style={[styles.bookingText, { color: Colors.background }]}>
                {bookingNo}
              </Text>
            </View>
          </View>
          {hasExtras ? (
            <View style={styles.fareBreakdown}>
              <View style={styles.fareBreakdownRow}>
                <Text style={[styles.fareBreakdownLabel, { color: Colors.background, opacity: 0.7 }]}>Base fare</Text>
                <Text style={[styles.fareBreakdownValue, { color: Colors.background }]}>
                  {currency.symbol}{Math.ceil(baseFare)}
                </Text>
              </View>
              {tolls > 0 ? (
                <View style={styles.fareBreakdownRow}>
                  <View style={styles.fareBreakdownLabelRow}>
                    <Coins color={Colors.background} size={13} />
                    <Text style={[styles.fareBreakdownLabel, { color: Colors.background, opacity: 0.7 }]}>Tolls</Text>
                  </View>
                  <Text style={[styles.fareBreakdownValue, { color: Colors.background }]}>
                    {currency.symbol}{tolls.toFixed(2)}
                  </Text>
                </View>
              ) : null}
              {extras > 0 ? (
                <View style={styles.fareBreakdownRow}>
                  <View style={styles.fareBreakdownLabelRow}>
                    <Plus color={Colors.background} size={13} />
                    <Text style={[styles.fareBreakdownLabel, { color: Colors.background, opacity: 0.7 }]} numberOfLines={1}>
                      {extrasNote ? `Other (${extrasNote})` : "Other charges"}
                    </Text>
                  </View>
                  <Text style={[styles.fareBreakdownValue, { color: Colors.background }]}>
                    {currency.symbol}{extras.toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={[styles.section, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
          <Text style={[styles.sectionTitle, { color: Colors.textSecondary }]}>Trip route</Text>

          <View style={styles.routeBlock}>
            <View style={styles.routeIconCol}>
              <View style={[styles.pickDot, { backgroundColor: Colors.success }]} />
              <View style={[styles.routeLine, { backgroundColor: Colors.gray[300] }]} />
              <View style={[styles.dropSquare, { backgroundColor: isCompleted ? Colors.success : Colors.error }]}>
                <MapPin color="#FFFFFF" size={12} />
              </View>
            </View>
            <View style={{ flex: 1, gap: 18 }}>
              <View>
                <View style={styles.locHeaderRow}>
                  <Text style={[styles.routeLabel, { color: Colors.textSecondary }]}>Pickup</Text>
                  <Text style={[styles.timeText, { color: Colors.text }]}>{formatTime(pickupTime)}</Text>
                </View>
                <Text style={[styles.locName, { color: Colors.text }]} numberOfLines={2}>
                  {pickupName}
                </Text>
                {pickupAddress ? (
                  <Text style={[styles.locAddress, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {pickupAddress}
                  </Text>
                ) : null}
              </View>
              <View>
                <View style={styles.locHeaderRow}>
                  <Text style={[styles.routeLabel, { color: Colors.textSecondary }]}>
                    {isCompleted ? "Drop" : "Drop (ended)"}
                  </Text>
                  <Text style={[styles.timeText, { color: Colors.text }]}>{formatTime(dropTime)}</Text>
                </View>
                <Text style={[styles.locName, { color: Colors.text }]} numberOfLines={2}>
                  {dropName}
                </Text>
                {dropAddress ? (
                  <Text style={[styles.locAddress, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {dropAddress}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
          <View style={styles.summaryHeader}>
            <Calculator color={Colors.accent} size={18} />
            <Text style={[styles.sectionTitleInline, { color: Colors.text }]}>Fare breakdown</Text>
          </View>
          <Text style={[styles.tariffNote, { color: Colors.textSecondary }]} testID="breakdown-tariff-note">
            {tariff === "new"
              ? "Tariff (NEW): RM4.00 base + RM1.00 per KM + RM0.30 per minute"
              : "Tariff (OLD): RM4.00 per KM or part · RM0.35 per 200 m · RM0.35 per 36 s (whichever comes first)"}
          </Text>

          {tariff === "new" ? (
            <>
              <View style={[styles.tariffRow]}>
                <View style={styles.tariffLabelRow}>
                  <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                    <Flag color={Colors.accent} size={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-base">Base fare</Text>
                    <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>RM4.00 flat</Text>
                  </View>
                </View>
                <Text style={[styles.tariffValue, { color: Colors.text }]}>
                  {currency.symbol}{newTariffBreakdown.base.toFixed(2)}
                </Text>
              </View>

              <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />

              <View style={[styles.tariffRow]}>
                <View style={styles.tariffLabelRow}>
                  <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                    <RouteIcon color={Colors.accent} size={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-distance">Distance</Text>
                    <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>
                      {distance.toFixed(1)} km × RM1.00
                    </Text>
                  </View>
                </View>
                <Text style={[styles.tariffValue, { color: Colors.text }]}>
                  {currency.symbol}{newTariffBreakdown.distanceAmount.toFixed(2)}
                </Text>
              </View>

              <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />

              <View style={[styles.tariffRow]}>
                <View style={styles.tariffLabelRow}>
                  <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                    <Timer color={Colors.accent} size={14} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-time">Time</Text>
                    <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>
                      {Math.max(0, Math.round(duration))} min × RM0.30
                    </Text>
                  </View>
                </View>
                <Text style={[styles.tariffValue, { color: Colors.text }]}>
                  {currency.symbol}{newTariffBreakdown.timeAmount.toFixed(2)}
                </Text>
              </View>

              <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
            </>
          ) : (
            <>
          <View style={[styles.tariffRow]}>
            <View style={styles.tariffLabelRow}>
              <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                <Flag color={Colors.accent} size={14} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-flag-fall">Flag fall (first 1 km)</Text>
                <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>RM4.00 base</Text>
              </View>
            </View>
            <Text style={[styles.tariffValue, { color: Colors.text }]}>
              {currency.symbol}{tariffBreakdown.flagFall.toFixed(2)}
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />

          <View style={[styles.tariffRow]}>
            <View style={styles.tariffLabelRow}>
              <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                <RouteIcon color={Colors.accent} size={14} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-distance-units">Distance increments</Text>
                <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>
                  {Math.max(0, tariffBreakdown.extraMeters).toFixed(0)} m after 1 km · {tariffBreakdown.distanceUnits} × RM0.35
                </Text>
              </View>
            </View>
            <Text style={[styles.tariffValue, { color: Colors.textSecondary }]}>
              {currency.symbol}{(tariffBreakdown.distanceUnits * 0.35).toFixed(2)}
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />

          <View style={[styles.tariffRow]}>
            <View style={styles.tariffLabelRow}>
              <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                <Timer color={Colors.accent} size={14} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-time-units">Time increments</Text>
                <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>
                  {Math.max(0, Math.round(tariffBreakdown.extraSeconds))} s after 1 km · {tariffBreakdown.timeUnits} × RM0.35
                </Text>
              </View>
            </View>
            <Text style={[styles.tariffValue, { color: Colors.textSecondary }]}>
              {currency.symbol}{(tariffBreakdown.timeUnits * 0.35).toFixed(2)}
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />

          <View style={[styles.tariffRow]}>
            <View style={styles.tariffLabelRow}>
              <View style={[styles.tariffIcon, { backgroundColor: Colors.success + "1A" }]}>
                <CheckCircle2 color={Colors.success} size={14} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tariffLabel, { color: Colors.text }]} testID="breakdown-billed-units">
                  Billed increments
                </Text>
                <Text style={[styles.tariffSub, { color: Colors.textSecondary }]}>
                  {tariffBreakdown.billedUnits} × RM0.35 · {tariffBreakdown.billedSource === "distance" ? "by distance" : "by time"} (higher of the two)
                </Text>
              </View>
            </View>
            <Text style={[styles.tariffValue, { color: Colors.text }]}>
              {currency.symbol}{tariffBreakdown.incrementsAmount.toFixed(2)}
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
            </>
          )}

          <View style={[styles.tariffTotalRow, { backgroundColor: Colors.accent + "12", borderColor: Colors.accent + "33" }]}>
            <Text style={[styles.tariffTotalLabel, { color: Colors.text }]}>Base fare</Text>
            <Text style={[styles.tariffTotalValue, { color: Colors.accent }]} testID="breakdown-base-fare">
              {currency.symbol}{Math.ceil(baseFare).toFixed(2)}
            </Text>
          </View>

          {tolls > 0 || extras > 0 ? (
            <>
              {tolls > 0 ? (
                <View style={[styles.tariffRow, { marginTop: 8 }]}>
                  <View style={styles.tariffLabelRow}>
                    <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                      <Coins color={Colors.accent} size={14} />
                    </View>
                    <Text style={[styles.tariffLabel, { color: Colors.text }]}>Tolls</Text>
                  </View>
                  <Text style={[styles.tariffValue, { color: Colors.text }]}>
                    {currency.symbol}{tolls.toFixed(2)}
                  </Text>
                </View>
              ) : null}
              {extras > 0 ? (
                <View style={[styles.tariffRow]}>
                  <View style={styles.tariffLabelRow}>
                    <View style={[styles.tariffIcon, { backgroundColor: Colors.accent + "1A" }]}>
                      <Plus color={Colors.accent} size={14} />
                    </View>
                    <Text style={[styles.tariffLabel, { color: Colors.text }]} numberOfLines={1}>
                      {extrasNote ? `Other (${extrasNote})` : "Other charges"}
                    </Text>
                  </View>
                  <Text style={[styles.tariffValue, { color: Colors.text }]}>
                    {currency.symbol}{extras.toFixed(2)}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
              <View style={[styles.tariffTotalRow, { backgroundColor: Colors.text + "08", borderColor: Colors.gray[300] }]}>
                <Text style={[styles.tariffTotalLabel, { color: Colors.text }]}>Total paid</Text>
                <Text style={[styles.tariffTotalValue, { color: Colors.text }]}>
                  {currency.symbol}{Math.ceil(fare).toFixed(2)}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={[styles.metricsRow]}>
          <View style={[styles.metricCard, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
            <View style={[styles.metricIcon, { backgroundColor: Colors.accent + "1A" }]}>
              <RouteIcon color={Colors.accent} size={18} />
            </View>
            <Text style={[styles.metricValue, { color: Colors.text }]}>
              {distance.toFixed(1)}
            </Text>
            <Text style={[styles.metricLabel, { color: Colors.textSecondary }]}>km travelled</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
            <View style={[styles.metricIcon, { backgroundColor: Colors.accent + "1A" }]}>
              <Clock color={Colors.accent} size={18} />
            </View>
            <Text style={[styles.metricValue, { color: Colors.text }]}>
              {formatDuration(duration)}
            </Text>
            <Text style={[styles.metricLabel, { color: Colors.textSecondary }]}>trip duration</Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}>
          <View style={styles.summaryHeader}>
            <Receipt color={Colors.accent} size={18} />
            <Text style={[styles.sectionTitleInline, { color: Colors.text }]}>Booking summary</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>Ride type</Text>
            <View style={[styles.statusChip, { backgroundColor: rideModeColor + "22" }]}>
              <RideModeIcon color={rideModeColor} size={12} />
              <Text style={[styles.statusChipText, { color: rideModeColor }]} testID="ride-detail-ride-mode">
                {rideModeLabel}
              </Text>
            </View>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>Booking No.</Text>
            <Text style={[styles.summaryValue, { color: Colors.text }]}>{bookingNo}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>Date</Text>
            <Text style={[styles.summaryValue, { color: Colors.text }]}>{formatDate(dropTime)}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>Status</Text>
            <View style={[styles.statusChip, { backgroundColor: statusColor + "22" }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusChipText, { color: statusColor }]}>
                {isCompleted ? "Completed" : "Ended early"}
              </Text>
            </View>
          </View>
          {paymentInfo ? (
            <>
              <View style={[styles.summaryDivider, { backgroundColor: Colors.gray[200] }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: Colors.textSecondary }]}>Payment</Text>
                <View style={[styles.statusChip, { backgroundColor: paymentInfo.color + "22" }]}>
                  <paymentInfo.Icon color={paymentInfo.color} size={12} />
                  <Text style={[styles.statusChipText, { color: paymentInfo.color }]} testID="ride-detail-payment-method">
                    {paymentInfo.label}
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: Colors.background,
            borderTopColor: Colors.gray[200],
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.actionRow}>
          <TouchableOpacity
            testID="ride-detail-print"
            activeOpacity={0.85}
            onPress={onPrint}
            disabled={printing}
            style={[styles.actionBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}
            accessibilityRole="button"
          >
            {printing ? (
              <ActivityIndicator color={Colors.text} size="small" />
            ) : (
              <Printer color={Colors.text} size={18} />
            )}
            <Text style={[styles.actionBtnText, { color: Colors.text }]}>Print</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="ride-detail-email"
            activeOpacity={0.85}
            onPress={() => setEmailVisible(true)}
            style={[styles.actionBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200] }]}
            accessibilityRole="button"
          >
            <Mail color={Colors.text} size={18} />
            <Text style={[styles.actionBtnText, { color: Colors.text }]}>Email</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          testID="ride-detail-home"
          activeOpacity={0.9}
          onPress={goHome}
          style={[styles.homeBtn, { backgroundColor: Colors.text }]}
          accessibilityRole="button"
        >
          <Home color={Colors.background} size={20} />
          <Text style={[styles.homeBtnText, { color: Colors.background }]}>Back to home</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={emailVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEmailVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setEmailVisible(false)}
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
          />
          <View style={[styles.modalCard, { backgroundColor: Colors.background, borderColor: Colors.gray[200] }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, { backgroundColor: Colors.accent + "1A" }]}>
                <Mail color={Colors.accent} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: Colors.text }]}>Email receipt</Text>
                <Text style={[styles.modalSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                  Send {bookingNo} to your inbox
                </Text>
              </View>
              <TouchableOpacity
                testID="ride-detail-email-close"
                onPress={() => setEmailVisible(false)}
                style={[styles.headerBtn, { backgroundColor: Colors.gray[100], width: 32, height: 32, borderRadius: 16 }]}
                accessibilityRole="button"
              >
                <X color={Colors.text} size={16} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalLabel, { color: Colors.textSecondary }]}>Email address</Text>
            <TextInput
              testID="ride-detail-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={[styles.modalInput, { backgroundColor: Colors.gray[100], borderColor: Colors.gray[200], color: Colors.text }]}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Email the receipt"
              testID="ride-detail-email-send"
              onPress={onSendEmail}
              disabled={sendingEmail}
              activeOpacity={0.9}
              style={[styles.modalSend, { backgroundColor: Colors.text, opacity: sendingEmail ? 0.7 : 1 }]}
            >
              {sendingEmail ? (
                <ActivityIndicator color={Colors.background} size="small" />
              ) : (
                <Mail color={Colors.background} size={18} />
              )}
              <Text style={[styles.modalSendText, { color: Colors.background }]}>
                {sendingEmail ? "Sending…" : "Send receipt"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "800" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  statusIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
  },
  statusTitle: { fontSize: 17, fontWeight: "800" },
  statusSub: { fontSize: 13, fontWeight: "500", marginTop: 2 },
  mapCard: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
  },
  mapImage: { width: "100%", height: 200 },
  fareCard: {
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  fareRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  fareIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  fareLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  fareValue: { fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  bookingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  bookingText: { fontSize: 12, fontWeight: "700" },
  fareBreakdown: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.18)",
    gap: 6,
  },
  fareBreakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fareBreakdownLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  fareBreakdownLabel: { fontSize: 13, fontWeight: "600" },
  fareBreakdownValue: { fontSize: 14, fontWeight: "800" },
  section: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  sectionTitleInline: { fontSize: 15, fontWeight: "800" },
  routeBlock: {
    flexDirection: "row",
    gap: 14,
  },
  routeIconCol: { width: 22, alignItems: "center", paddingTop: 4 },
  pickDot: { width: 14, height: 14, borderRadius: 7 },
  routeLine: { width: 2, flex: 1, marginVertical: 6, minHeight: 36 },
  dropSquare: {
    width: 22,
    height: 22,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  locHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  routeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  timeText: { fontSize: 13, fontWeight: "700" },
  locName: { fontSize: 15, fontWeight: "700" },
  locAddress: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  metricsRow: { flexDirection: "row", gap: 12 },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  metricValue: { fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  metricLabel: { fontSize: 12, fontWeight: "600" },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  summaryLabel: { fontSize: 14, fontWeight: "500" },
  summaryValue: { fontSize: 14, fontWeight: "700" },
  summaryDivider: { height: 1 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 12, fontWeight: "800" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  homeBtnText: { fontSize: 16, fontWeight: "800" },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: "700" },
  tariffNote: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
    marginBottom: 12,
    marginTop: -6,
  },
  tariffRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 10,
  },
  tariffLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  tariffIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  tariffLabel: { fontSize: 13, fontWeight: "700" },
  tariffSub: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  tariffValue: { fontSize: 14, fontWeight: "800" },
  tariffTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  tariffTotalLabel: { fontSize: 14, fontWeight: "800" },
  tariffTotalValue: { fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  modalIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalSub: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  modalLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 4,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    fontSize: 15,
    fontWeight: "600",
  },
  modalSend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  modalSendText: { fontSize: 15, fontWeight: "800" },
});
