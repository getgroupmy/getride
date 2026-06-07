import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Platform,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ArrowLeft,
  Zap,
  Palette,
  Sofa,
  CircleDot,
  ListChecks,
  CreditCard,
  UserCheck,
  Wallet,
  FileSignature,
  ShieldCheck,
  KeyRound,
  Check,
  ChevronRight,
  Phone,
  Mail,
  MapPin,
  Hash,
  Banknote,
  Sparkles,
  Package,
  Lock,
  Unlock,
  User,
  Users,
  Building2,
  IdCard,
  Globe,
  Sparkle,
  Camera,
  Ticket,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  resolveOrderFee,
  ORDER_FEE_STORAGE_KEY,
  DEFAULT_ORDER_FEE_COUNTRY,
} from "@/app/admin-settings-ev-order-fee";
import {
  resolveDefaultGateway,
  PAYMENT_GATEWAY_STORAGE_KEY,
} from "@/app/admin-settings-payment-gateway";

type StepKey =
  | "model"
  | "specification"
  | "deposit"
  | "ownership"
  | "plate"
  | "financing"
  | "advisor"
  | "schedule"
  | "delivery";

type FinanceType = "cash" | "hp" | "leasing" | "rental";

const FINANCE_TYPE_LABELS: Record<FinanceType, string> = {
  cash: "Cash",
  leasing: "Leasing",
  hp: "Hire Purchase",
  rental: "Rental",
};

const mapAdminTypeToFinanceType = (raw: string): FinanceType | null => {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === "cash") return "cash";
  if (t === "leasing" || t.startsWith("leas")) return "leasing";
  if (t === "hire purchase" || t === "hp" || t.includes("hire")) return "hp";
  if (t === "rental" || t.includes("rent")) return "rental";
  return null;
};

type OwnerType = "self" | "other" | "company";
type IdType = "national" | "passport";

interface StepDef {
  key: StepKey;
  title: string;
  short: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
}

const STEPS: StepDef[] = [
  { key: "model", title: "Choose Model", short: "Model", Icon: Palette },
  { key: "specification", title: "Specification", short: "Spec", Icon: ListChecks },
  { key: "deposit", title: "Initial Payment", short: "Order Fee", Icon: CreditCard },
  { key: "ownership", title: "Ownership", short: "Owner", Icon: User },
  { key: "plate", title: "Licence Plate", short: "Plate", Icon: Hash },
  { key: "financing", title: "Financing", short: "Finance", Icon: Wallet },
  { key: "advisor", title: "Delivery Advisor", short: "Advisor", Icon: UserCheck },
  { key: "schedule", title: "Schedule Delivery", short: "Schedule", Icon: FileSignature },
  { key: "delivery", title: "Delivery Checklist", short: "Deliver", Icon: KeyRound },
];

const ID_COUNTRIES: string[] = [
  "Malaysia",
  "Singapore",
  "Indonesia",
  "Thailand",
  "Philippines",
  "Vietnam",
  "China",
  "India",
  "United Kingdom",
  "United States",
  "Australia",
  "Other",
];


const SCREEN_W = Dimensions.get("window").width;
const HERO_SLIDE_W = SCREEN_W - 32;

export default function TeksiEvScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { getEntries, addEntry, updateEntry } = useAdminData();
  const { authState } = useAuth();

  const vehicleDetails = getEntries("ev-vehicle-details");
  const inventory = getEntries("ev-vehicle-inventory");
  const advisors = getEntries("ev-delivery-advisors");
  const financeOptions = getEntries("ev-finance-options");
  const orderFeeEntries = getEntries(ORDER_FEE_STORAGE_KEY);
  const gatewayEntries = getEntries(PAYMENT_GATEWAY_STORAGE_KEY);
  const orders = getEntries("ev-orders");

  const [stepIdx, setStepIdx] = useState<number>(0);
  const step = STEPS[stepIdx];

  const [orderMode, setOrderMode] = useState<"custom" | "inventory">("custom");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("");
  const [selectedColorExt, setSelectedColorExt] = useState<string>("");
  const [selectedColorInt, setSelectedColorInt] = useState<string>("");
  const [selectedWheel, setSelectedWheel] = useState<string>("19\" Aero");
  const [wheelsUnlocked, setWheelsUnlocked] = useState<boolean>(false);
  const [factoryWheels, setFactoryWheels] = useState<string>("19\" Aero");
  const [accessories, setAccessories] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<"card" | "fpx">("card");
  const [cardNumber, setCardNumber] = useState<string>("");
  const [cardName, setCardName] = useState<string>("");
  const [cardExpiry, setCardExpiry] = useState<string>("");
  const [cardCvv, setCardCvv] = useState<string>("");
  const [fpxBank, setFpxBank] = useState<string>("");
  const [depositPaid, setDepositPaid] = useState<boolean>(false);
  const [financeChoice, setFinanceChoice] = useState<string>("");
  const [financeType, setFinanceType] = useState<FinanceType | "">("");
  const [cashBalancePaid, setCashBalancePaid] = useState<boolean>(false);
  const [leasingAddonRequired, setLeasingAddonRequired] = useState<"yes" | "no" | "">("");
  const [leasingAddonAmount, setLeasingAddonAmount] = useState<string>("");
  const [leasingAddonPaid, setLeasingAddonPaid] = useState<boolean>(false);
  const [plateTransfer, setPlateTransfer] = useState<"yes" | "no" | "">("");
  const [plateNumber, setPlateNumber] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [checklistAccepted, setChecklistAccepted] = useState<boolean>(false);
  const [myOrderId, setMyOrderId] = useState<string>("");

  // ----- Agent / DA code lookup (collected after model selection) -----
  const [agentCodeModalOpen, setAgentCodeModalOpen] = useState<boolean>(false);
  const [agentCodeInput, setAgentCodeInput] = useState<string>("");
  const [agentCodeApplied, setAgentCodeApplied] = useState<string>("");
  const [matchedAdvisorId, setMatchedAdvisorId] = useState<string>("");
  const [agentPromptedForId, setAgentPromptedForId] = useState<string>("");

  const findAdvisorByDaNumber = (code: string): SettingEntry | null => {
    const norm = code.trim().toLowerCase();
    if (!norm) return null;
    return (
      advisors.find(
        (a) => String(a.values.daNumber ?? "").trim().toLowerCase() === norm,
      ) ?? null
    );
  };

  const matchedAdvisor = useMemo<SettingEntry | null>(
    () => (matchedAdvisorId ? advisors.find((a) => a.id === matchedAdvisorId) ?? null : null),
    [advisors, matchedAdvisorId],
  );

  const openAgentCodePromptFor = (vehicleKey: string) => {
    if (!vehicleKey) return;
    if (agentPromptedForId === vehicleKey) return;
    setAgentPromptedForId(vehicleKey);
    setAgentCodeInput(agentCodeApplied);
    setAgentCodeModalOpen(true);
  };

  const handlePickVehicle = (id: string) => {
    setSelectedVehicleId(id);
    openAgentCodePromptFor(`v:${id}`);
  };
  const handlePickInventory = (id: string) => {
    setSelectedInventoryId(id);
    openAgentCodePromptFor(`i:${id}`);
  };

  const applyAgentCode = () => {
    const code = agentCodeInput.trim();
    if (!code) {
      // Treat empty as skip
      setAgentCodeApplied("");
      setMatchedAdvisorId("");
      setAgentCodeModalOpen(false);
      return;
    }
    const adv = findAdvisorByDaNumber(code);
    setAgentCodeApplied(code);
    if (adv) {
      setMatchedAdvisorId(adv.id);
      setAgentCodeModalOpen(false);
      Alert.alert(
        "Delivery Advisor linked",
        `${String(adv.values.name ?? "Advisor")} (${String(adv.values.daNumber ?? code)}) will be assigned automatically after your financing step.`,
      );
    } else {
      setMatchedAdvisorId("");
      setAgentCodeModalOpen(false);
      Alert.alert(
        "No advisor found",
        "We couldn't find a Delivery Advisor with that code. You'll continue without an assigned advisor and admin will assign one for you.",
      );
    }
  };
  const skipAgentCode = () => {
    setAgentCodeApplied("");
    setMatchedAdvisorId("");
    setAgentCodeModalOpen(false);
  };

  // ----- Ownership step state -----
  const [ownerType, setOwnerType] = useState<OwnerType>("self");
  const [idType, setIdType] = useState<IdType>("national");
  const [idCountry, setIdCountry] = useState<string>(DEFAULT_ORDER_FEE_COUNTRY);
  const [idImageUri, setIdImageUri] = useState<string>("");
  const [extractedPhoto, setExtractedPhoto] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [idNumber, setIdNumber] = useState<string>("");
  const [ownerAddress, setOwnerAddress] = useState<string>("");
  const [relationship, setRelationship] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [companyRegNo, setCompanyRegNo] = useState<string>("");
  const [companyAddress, setCompanyAddress] = useState<string>("");
  const [extracting, setExtracting] = useState<boolean>(false);
  const [extracted, setExtracted] = useState<boolean>(false);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState<boolean>(false);

  type EditKey =
    | "fullName"
    | "idNumber"
    | "ownerAddress"
    | "companyName"
    | "companyRegNo"
    | "companyAddress";
  const [editKey, setEditKey] = useState<EditKey | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");

  const editMeta: Record<EditKey, { title: string; placeholder: string; multiline?: boolean; keyboardType?: "default" | "number-pad" }> = {
    fullName: { title: "Full name", placeholder: "As shown on ID" },
    idNumber: { title: idType === "passport" ? "Passport number" : "ID number", placeholder: "e.g. A12345678" },
    ownerAddress: { title: "Address", placeholder: "Full residential address", multiline: true },
    companyName: { title: "Company name", placeholder: "e.g. TEKSI Mobility Sdn Bhd" },
    companyRegNo: { title: "Company registration number", placeholder: "e.g. 202301012345" },
    companyAddress: { title: "Company address", placeholder: "Registered business address", multiline: true },
  };

  const openEdit = (key: EditKey, current: string) => {
    setEditKey(key);
    setEditDraft(current);
  };
  const closeEdit = () => {
    setEditKey(null);
    setEditDraft("");
  };
  const saveEdit = () => {
    if (!editKey) return;
    const v = editDraft;
    switch (editKey) {
      case "fullName": setFullName(v); break;
      case "idNumber": setIdNumber(v); break;
      case "ownerAddress": setOwnerAddress(v); break;
      case "companyName": setCompanyName(v); break;
      case "companyRegNo": setCompanyRegNo(v); break;
      case "companyAddress": setCompanyAddress(v); break;
    }
    setOwnershipConfirmed(false);
    closeEdit();
  };

  const vehicleById = useMemo<Map<string, SettingEntry>>(() => {
    const m = new Map<string, SettingEntry>();
    vehicleDetails.forEach((v) => m.set(v.id, v));
    return m;
  }, [vehicleDetails]);

  const selectedVehicle = useMemo<SettingEntry | null>(
    () => vehicleDetails.find((v) => v.id === selectedVehicleId) ?? null,
    [vehicleDetails, selectedVehicleId]
  );
  const selectedInventory = useMemo<SettingEntry | null>(
    () => inventory.find((v) => v.id === selectedInventoryId) ?? null,
    [inventory, selectedInventoryId]
  );
  // The vehicle-details record this inventory unit was built from.
  const inventoryVehicle = useMemo<SettingEntry | null>(() => {
    const vid = selectedInventory?.values.vehicleId ? String(selectedInventory.values.vehicleId) : "";
    if (!vid) return null;
    return vehicleById.get(vid) ?? null;
  }, [selectedInventory, vehicleById]);

  // Active vehicle drives pricing / colour palette in either mode.
  const activeVehicle = orderMode === "inventory" ? inventoryVehicle : selectedVehicle;

  const parseStringList = (raw: string | number | boolean | undefined): string[] => {
    if (!raw || typeof raw !== "string") return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  // Build a unified gallery list from the active vehicle's stored images.
  const galleryImages = useMemo<{ uri: string; label: string }[]>(() => {
    if (!activeVehicle) return [];
    const ext = parseStringList(activeVehicle.values.exteriorImages).map((uri) => ({ uri, label: "Exterior" }));
    const intr = parseStringList(activeVehicle.values.interiorImages).map((uri) => ({ uri, label: "Interior" }));
    const stor = parseStringList(activeVehicle.values.storageImages).map((uri) => ({ uri, label: "Storage" }));
    return [...ext, ...intr, ...stor];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicle]);

  // When user picks (or switches) an inventory unit, sync the factory wheels from
  // that unit's record so we can detect swaps. Falls back to the design default.
  useEffect(() => {
    if (orderMode !== "inventory") return;
    const factory =
      (selectedInventory?.values.wheels ? String(selectedInventory.values.wheels) : "") ||
      "19\" Aero";
    setFactoryWheels(factory);
    setSelectedWheel(factory);
    setWheelsUnlocked(false);
  }, [orderMode, selectedInventory]);

  const wheelsSwapped: boolean = orderMode === "inventory" && selectedWheel !== factoryWheels;

  // Resolve the order fee using, in priority order:
  //   1) the vehicle's country (set on the inventory unit or vehicle-details record),
  //   2) the signed-in user's account country (whenever a profile field is populated),
  //   3) the ID country selected during ownership as a final fallback.
  // Once a stronger source is collected up-front, the fee tracks it automatically and
  // we stop relying on the ID country, which can differ from where the car is sold.
  const vehicleCountry = useMemo<string>(() => {
    const fromInventory = selectedInventory?.values.country;
    const fromVehicle = activeVehicle?.values.country;
    const v = String(fromInventory ?? fromVehicle ?? "").trim();
    return v;
  }, [selectedInventory, activeVehicle]);

  const accountCountry = useMemo<string>(() => {
    const s = authState as unknown as { country?: unknown };
    const v = typeof s?.country === "string" ? s.country.trim() : "";
    return v;
  }, [authState]);

  const feeCountry = vehicleCountry || accountCountry || idCountry;

  const orderFee = useMemo(
    () => resolveOrderFee(orderFeeEntries, feeCountry),
    [orderFeeEntries, feeCountry],
  );
  const DEPOSIT_AMOUNT = orderFee.amount;
  const DEPOSIT_CURRENCY = orderFee.currency;

  /** Active default payment gateway shown during checkout. */
  const defaultGateway = useMemo(
    () => resolveDefaultGateway(gatewayEntries),
    [gatewayEntries],
  );

  const parsePriced = (raw: string | number | boolean | undefined): { id: string; name: string; price: number; enabled: boolean }[] => {
    if (!raw || typeof raw !== "string") return [];
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v)) return [];
      return v.map((x) => ({
        id: String(x?.id ?? ""),
        name: String(x?.name ?? ""),
        price: typeof x?.price === "number" ? x.price : parseFloat(String(x?.price ?? "0")) || 0,
        enabled: x?.enabled !== false,
      }));
    } catch {
      return [];
    }
  };
  const parseIdList = (raw: string | number | boolean | undefined): string[] => {
    if (!raw || typeof raw !== "string") return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  };

  // For inventory unit: list of pre-configured features + accessories with prices, resolved from the linked vehicle details.
  const inventoryFeatures = useMemo<{ name: string; price: number }[]>(() => {
    if (!selectedInventory || !inventoryVehicle) return [];
    const ids = parseIdList(selectedInventory.values.featureIds);
    const lib = parsePriced(inventoryVehicle.values.features);
    return lib.filter((x) => ids.includes(x.id)).map(({ name, price }) => ({ name, price }));
  }, [selectedInventory, inventoryVehicle]);
  const inventoryAccessories = useMemo<{ name: string; price: number }[]>(() => {
    if (!selectedInventory || !inventoryVehicle) return [];
    const ids = parseIdList(selectedInventory.values.accessoryIds);
    const lib = parsePriced(inventoryVehicle.values.accessories);
    return lib.filter((x) => ids.includes(x.id)).map(({ name, price }) => ({ name, price }));
  }, [selectedInventory, inventoryVehicle]);

  // Pull assigned advisor from this user's order (set by admin). Fallback to none until admin assigns.
  const myOrder = useMemo<SettingEntry | null>(
    () => orders.find((o) => o.id === myOrderId) ?? null,
    [orders, myOrderId]
  );
  const assignedAdvisor = useMemo<SettingEntry | null>(() => {
    const advisorId = myOrder?.values.advisorId ? String(myOrder.values.advisorId) : "";
    if (!advisorId) return null;
    return advisors.find((a) => a.id === advisorId) ?? null;
  }, [myOrder, advisors]);

  const exteriorColors = useMemo<string[]>(() => {
    // Try structured colours from EV details first, fall back to legacy CSV.
    const structured = parsePriced(selectedVehicle?.values.exteriorColors);
    if (structured.length > 0) return structured.filter((c) => c.enabled).map((c) => c.name);
    const raw = String(selectedVehicle?.values.exteriorColor ?? "Pearl White,Solid Black,Midnight Blue,Red");
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [selectedVehicle]);
  const interiorColors = useMemo<string[]>(() => {
    const structured = parsePriced(selectedVehicle?.values.interiorColors);
    if (structured.length > 0) return structured.filter((c) => c.enabled).map((c) => c.name);
    const raw = String(selectedVehicle?.values.interiorColor ?? "Black,White,Cream");
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [selectedVehicle]);
  const accessoryList = useMemo<{ name: string; cost: number }[]>(() => {
    const structured = parsePriced(selectedVehicle?.values.accessories);
    if (structured.length > 0) return structured.filter((a) => a.enabled).map((a) => ({ name: a.name, cost: a.price }));
    const raw = String(selectedVehicle?.values.accessories ?? "Roof Rack:300,Floor Mats:120,Tow Hitch:850,Tinted Windows:450");
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((pair) => {
        const [name, cost] = pair.split(":");
        return { name: String(name).trim(), cost: parseFloat(String(cost ?? "0")) || 0 };
      });
  }, [selectedVehicle]);

  const basePrice = Number(activeVehicle?.values.price ?? 0);
  const tax = Number(activeVehicle?.values.tax ?? 0);
  const accessoriesCost =
    orderMode === "inventory"
      ? inventoryFeatures.reduce((s, x) => s + x.price, 0) +
        inventoryAccessories.reduce((s, x) => s + x.price, 0)
      : accessories.reduce((sum, name) => {
          const a = accessoryList.find((x) => x.name === name);
          return sum + (a?.cost ?? 0);
        }, 0);
  const totalPrice = basePrice + tax + accessoriesCost;

  const goNext = () => {
    // After financing, if user keyed in a valid agent code, auto-assign DA and skip advisor step.
    if (step.key === "financing" && matchedAdvisor && myOrderId) {
      updateEntry("ev-orders", myOrderId, { advisorId: matchedAdvisor.id, status: "ready_for_delivery" });
      const scheduleIdx = STEPS.findIndex((s) => s.key === "schedule");
      if (scheduleIdx >= 0) {
        setStepIdx(scheduleIdx);
        return;
      }
    }
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  };
  const goPrev = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  const canProceed = (): boolean => {
    switch (step.key) {
      case "model":
        return orderMode === "custom" ? !!selectedVehicleId : !!selectedInventoryId;
      case "specification":
        return orderMode === "custom" ? !!selectedColorExt && !!selectedColorInt : true;
      case "deposit":
        return depositPaid;
      case "ownership":
        return ownershipConfirmed;
      case "plate":
        if (plateTransfer === "") return false;
        if (plateTransfer === "yes" && !plateNumber.trim()) return false;
        return true;
      case "financing":
        if (!financeType) return false;
        if (!financeChoice) return false;
        if (financeType === "cash") return cashBalancePaid;
        if (financeType === "hp") return true;
        if (financeType === "rental") return true;
        if (financeType === "leasing") {
          if (leasingAddonRequired === "") return false;
          return leasingAddonRequired === "no" || leasingAddonPaid;
        }
        return false;
      case "advisor":
        return !!assignedAdvisor;
      case "schedule":
        return !!deliveryDate.trim();
      case "delivery":
        return checklistAccepted;
      default:
        return true;
    }
  };

  const proceedPayDeposit = () => {
    setDepositPaid(true);

    // Create an order so admin can review and assign a Delivery Advisor.
    const v = orderMode === "custom" ? selectedVehicle : selectedInventory;
    const created = addEntry("ev-orders", {
      customerName: cardName || "TEKSI Customer",
      customerPhone: String(authState.phoneNumber ?? ""),
      customerEmail: "",
      mode: orderMode,
      vehicle:
        orderMode === "inventory" && inventoryVehicle
          ? `${String(inventoryVehicle.values.make ?? "")} ${String(inventoryVehicle.values.model ?? "")}`.trim()
          : v
          ? `${String(v.values.make ?? "")} ${String(v.values.model ?? "")}`.trim()
          : "TEKSI EV",
      inventoryId: orderMode === "inventory" ? String(v?.id ?? "") : "",
      vehicleId: orderMode === "inventory" ? String(v?.values.vehicleId ?? "") : String(selectedVehicleId ?? ""),
      exteriorColor: orderMode === "custom" ? selectedColorExt : String(v?.values.exteriorColor ?? ""),
      interiorColor: orderMode === "custom" ? selectedColorInt : String(v?.values.interiorColor ?? ""),
      wheels: selectedWheel,
      factoryWheels: orderMode === "inventory" ? factoryWheels : "",
      wheelsSwapped: wheelsSwapped,
      refitRequired: wheelsSwapped,
      buildFlags: wheelsSwapped ? "Re-fit wheels" : "",
      accessories:
        orderMode === "inventory"
          ? [...inventoryFeatures, ...inventoryAccessories].map((x) => x.name).join(", ")
          : accessories.join(", "),
      vin: orderMode === "inventory" ? String(v?.values.vin ?? "") : "",
      basePrice,
      tax,
      accessoriesCost,
      total: totalPrice,
      depositPaid: true,
      depositAmount: DEPOSIT_AMOUNT,
      paymentMethod: payMethod,
      gatewayId: defaultGateway?.id ?? "",
      gatewayProvider: defaultGateway?.providerName ?? "",
      gatewayAccount: defaultGateway?.accountName ?? "",
      gatewayMode: defaultGateway?.mode ?? "",
      status: "pending",
    });
    setMyOrderId(created.id);
    Alert.alert("Payment received", `Order Fee of ${DEPOSIT_CURRENCY}${DEPOSIT_AMOUNT.toLocaleString()} has been received. Your order is now pending DA assignment.`);
  };

  const payDeposit = () => {
    if (!defaultGateway) {
      Alert.alert(
        "Payment gateway unavailable",
        "No active payment gateway is configured. Please contact support before proceeding.",
      );
      return;
    }
    if (payMethod === "card") {
      if (!cardNumber || !cardName || !cardExpiry || !cardCvv) {
        Alert.alert("Card details", "Please complete all card fields.");
        return;
      }
    } else {
      if (!fpxBank) {
        Alert.alert("FPX", "Please select a bank.");
        return;
      }
    }
    const gwLine = defaultGateway
      ? `\n\nProcessed by ${defaultGateway.providerName}${defaultGateway.mode === "Sandbox" ? " (Sandbox)" : ""}.`
      : "";
    Alert.alert(
      "Non-refundable Order Fee",
      `The order fee of ${DEPOSIT_CURRENCY}${DEPOSIT_AMOUNT.toLocaleString()} is non-refundable. Do you want to proceed with payment?${gwLine}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Proceed", style: "destructive", onPress: proceedPayDeposit },
      ],
    );
  };

  const toggleAcc = (name: string) => {
    setAccessories((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  // ---------- step renderers ----------

  const renderModel = () => (
    <View style={{ gap: 14 }}>
      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[
            styles.segment,
            {
              backgroundColor: orderMode === "custom" ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          onPress={() => setOrderMode("custom")}
          testID="ev-mode-custom"
        >
          <Sparkles color={orderMode === "custom" ? Colors.secondary : Colors.text} size={16} />
          <Text style={[styles.segmentText, { color: orderMode === "custom" ? Colors.secondary : Colors.text }]}>
            Custom Build
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segment,
            {
              backgroundColor: orderMode === "inventory" ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          onPress={() => setOrderMode("inventory")}
          testID="ev-mode-inventory"
        >
          <Package color={orderMode === "inventory" ? Colors.secondary : Colors.text} size={16} />
          <Text style={[styles.segmentText, { color: orderMode === "inventory" ? Colors.secondary : Colors.text }]}>
            Existing Inventory
          </Text>
        </TouchableOpacity>
      </View>

      {orderMode === "custom" ? (
        <>
          <Text style={[styles.sectionLabel, { color: Colors.text }]}>Choose your model</Text>
          {vehicleDetails.length === 0 ? (
            <EmptyHint Colors={Colors} text="No vehicles configured yet. Ask an admin to add EV vehicle details." />
          ) : (
            <TrimPicker
              Colors={Colors}
              items={vehicleDetails.map((v) => ({
                id: v.id,
                title: `${String(v.values.make ?? "")} ${String(v.values.model ?? "")}`.trim() || "TEKSI EV",
                subtitle:
                  Number(v.values.price ?? 0) > 0
                    ? `From RM${Number(v.values.price ?? 0).toLocaleString()}${
                        Number(v.values.tax ?? 0) > 0 ? ` · Tax RM${Number(v.values.tax ?? 0).toLocaleString()}` : ""
                      }`
                    : "Configure your build",
                imageUri: String(v.values.imageUri ?? ""),
              }))}
              selectedId={selectedVehicleId}
              onSelect={handlePickVehicle}
              testIDPrefix="ev-vehicle"
            />
          )}

        </>
      ) : (
        <>
          <View style={[styles.fastBanner, { backgroundColor: Colors.success + "15", borderColor: Colors.success }]}>
            <Package color={Colors.success} size={18} />
            <Text style={[styles.fastBannerText, { color: Colors.text }]}>
              Fast delivery — ready units assigned with a VIN.
            </Text>
          </View>
          <Text style={[styles.sectionLabel, { color: Colors.text }]}>Available now</Text>
          {inventory.length === 0 ? (
            <EmptyHint Colors={Colors} text="No vehicles in inventory. Switch to Custom Build or check back later." />
          ) : (
            <TrimPicker
              Colors={Colors}
              items={inventory.map((v) => {
                const linked = v.values.vehicleId ? vehicleById.get(String(v.values.vehicleId)) ?? null : null;
                const make = linked ? String(linked.values.make ?? "") : String(v.values.make ?? "");
                const model = linked ? String(linked.values.model ?? "") : String(v.values.model ?? "");
                const price = Number(linked?.values.price ?? 0);
                const taxAmt = Number(linked?.values.tax ?? 0);
                const imageUri = linked ? String(linked.values.imageUri ?? "") : "";
                return {
                  id: v.id,
                  title: `${make} ${model}`.trim() || "TEKSI EV",
                  subtitle:
                    price > 0
                      ? `From RM${price.toLocaleString()}${taxAmt > 0 ? ` + RM${taxAmt.toLocaleString()} tax` : ""}`
                      : `VIN: ${String(v.values.vin ?? "—")}`,
                  imageUri,
                  badge: "In stock",
                };
              })}
              selectedId={selectedInventoryId}
              onSelect={handlePickInventory}
              testIDPrefix="ev-inv"
            />
          )}
        </>
      )}
    </View>
  );

  const renderSpecification = () => (
    <View style={{ gap: 14 }}>
      {orderMode === "custom" ? (
        !selectedVehicle ? (
          <EmptyHint Colors={Colors} text="Pick a model first, then return to specify it." />
        ) : (
          <>
              {galleryImages.length > 0 && (
                <GalleryStrip Colors={Colors} images={galleryImages} testIDPrefix="ev-custom-gallery" />
              )}
              <Text style={[styles.sectionLabel, { color: Colors.text }]}>Exterior color</Text>
              <View style={styles.chipRow}>
                {exteriorColors.map((c) => {
                  const sel = c === selectedColorExt;
                  return (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setSelectedColorExt(c)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: sel ? Colors.accent : Colors.gray[100],
                          borderColor: Colors.border,
                        },
                      ]}
                      testID={`ev-ext-${c}`}
                    >
                      <Palette color={sel ? Colors.secondary : Colors.text} size={14} />
                      <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, { color: Colors.text }]}>Interior color</Text>
              <View style={styles.chipRow}>
                {interiorColors.map((c) => {
                  const sel = c === selectedColorInt;
                  return (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setSelectedColorInt(c)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: sel ? Colors.accent : Colors.gray[100],
                          borderColor: Colors.border,
                        },
                      ]}
                      testID={`ev-int-${c}`}
                    >
                      <Sofa color={sel ? Colors.secondary : Colors.text} size={14} />
                      <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, { color: Colors.text }]}>Wheels</Text>
              <View style={styles.chipRow}>
                {["18\" Standard", "19\" Aero", "20\" Performance"].map((w) => {
                  const sel = w === selectedWheel;
                  return (
                    <TouchableOpacity
                      key={w}
                      onPress={() => setSelectedWheel(w)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: sel ? Colors.accent : Colors.gray[100],
                          borderColor: Colors.border,
                        },
                      ]}
                      testID={`ev-wheel-${w}`}
                    >
                      <CircleDot color={sel ? Colors.secondary : Colors.text} size={14} />
                      <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{w}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {accessoryList.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: Colors.text }]}>Optional accessories</Text>
                  {accessoryList.map((a) => {
                    const sel = accessories.includes(a.name);
                    return (
                      <TouchableOpacity
                        key={a.name}
                        onPress={() => toggleAcc(a.name)}
                        style={[
                          styles.accRow,
                          {
                            backgroundColor: Colors.gray[100],
                            borderColor: sel ? Colors.accent : Colors.border,
                            borderWidth: sel ? 2 : 1,
                          },
                        ]}
                        testID={`ev-acc-${a.name}`}
                      >
                        <View
                          style={[
                            styles.checkBox,
                            {
                              backgroundColor: sel ? Colors.accent : "transparent",
                              borderColor: sel ? Colors.accent : Colors.border,
                            },
                          ]}
                        >
                          {sel && <Check color={Colors.secondary} size={14} />}
                        </View>
                        <Text style={[styles.accName, { color: Colors.text }]}>{a.name}</Text>
                        <Text style={[styles.accCost, { color: Colors.accent }]}>+RM{a.cost.toLocaleString()}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}

              <View style={[styles.totalBox, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
                <Text style={[styles.totalLabel, { color: Colors.text }]}>Estimated total</Text>
                <Text style={[styles.totalValue, { color: Colors.accent }]}>RM{totalPrice.toLocaleString()}</Text>
              </View>
              <View style={[styles.breakdownBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <BreakdownRow Colors={Colors} label="Base" value={basePrice} />
                <BreakdownRow Colors={Colors} label="Tax" value={tax} />
                <BreakdownRow Colors={Colors} label="Extras" value={accessoriesCost} />
              </View>
          </>
        )
      ) : (
        !selectedInventory ? (
          <EmptyHint Colors={Colors} text="Pick an inventory unit first, then return to specify it." />
        ) : (
          <>
              {galleryImages.length > 0 && (
                <GalleryStrip Colors={Colors} images={galleryImages} testIDPrefix="ev-inv-gallery" />
              )}

              <View style={[styles.invSpecs, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <InfoRow Colors={Colors} Icon={Palette} label="Exterior" value={String(selectedInventory.values.exteriorColor ?? "—")} />
                <InfoRow Colors={Colors} Icon={Sofa} label="Interior" value={String(selectedInventory.values.interiorColor ?? "—")} />
                <InfoRow Colors={Colors} Icon={Hash} label="VIN" value={String(selectedInventory.values.vin ?? "—")} />
              </View>

              {inventoryFeatures.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: Colors.text }]}>Included features</Text>
                  {inventoryFeatures.map((f) => (
                    <View
                      key={f.name}
                      style={[styles.accRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border, borderWidth: 1 }]}
                    >
                      <View style={[styles.checkBox, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}>
                        <Check color={Colors.secondary} size={14} />
                      </View>
                      <Text style={[styles.accName, { color: Colors.text }]}>{f.name}</Text>
                      {f.price > 0 && (
                        <Text style={[styles.accCost, { color: Colors.accent }]}>+RM{f.price.toLocaleString()}</Text>
                      )}
                    </View>
                  ))}
                </>
              )}

              {inventoryAccessories.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: Colors.text }]}>Included accessories</Text>
                  {inventoryAccessories.map((a) => (
                    <View
                      key={a.name}
                      style={[styles.accRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border, borderWidth: 1 }]}
                    >
                      <View style={[styles.checkBox, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}>
                        <Check color={Colors.secondary} size={14} />
                      </View>
                      <Text style={[styles.accName, { color: Colors.text }]}>{a.name}</Text>
                      {a.price > 0 && (
                        <Text style={[styles.accCost, { color: Colors.accent }]}>+RM{a.price.toLocaleString()}</Text>
                      )}
                    </View>
                  ))}
                </>
              )}

              <Text style={[styles.sectionLabel, { color: Colors.text }]}>Wheels</Text>
              <TouchableOpacity
                onPress={() => setWheelsUnlocked((p) => !p)}
                style={[
                  styles.lockRow,
                  {
                    backgroundColor: wheelsUnlocked ? Colors.accent + "15" : Colors.gray[100],
                    borderColor: wheelsUnlocked ? Colors.accent : Colors.border,
                  },
                ]}
                testID="ev-wheels-lock"
              >
                {wheelsUnlocked ? (
                  <Unlock color={Colors.accent} size={16} />
                ) : (
                  <Lock color={Colors.textSecondary} size={16} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lockTitle, { color: Colors.text }]}>
                    {wheelsUnlocked ? "Wheels unlocked" : "Pre-built configuration"}
                  </Text>
                  <Text style={[styles.lockSub, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {wheelsUnlocked
                      ? "Changing wheels may delay delivery while we re-fit your unit."
                      : `Comes fitted with ${factoryWheels}. Tap to swap.`}
                  </Text>
                </View>
              </TouchableOpacity>
              {wheelsUnlocked && (
                <View style={styles.chipRow}>
                  {Array.from(new Set([factoryWheels, "18\" Standard", "19\" Aero", "20\" Performance"])).map((w) => {
                    const sel = w === selectedWheel;
                    return (
                      <TouchableOpacity
                        key={w}
                        onPress={() => setSelectedWheel(w)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: sel ? Colors.accent : Colors.gray[100],
                            borderColor: Colors.border,
                          },
                        ]}
                        testID={`ev-inv-wheel-${w}`}
                      >
                        <CircleDot color={sel ? Colors.secondary : Colors.text} size={14} />
                        <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{w}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {basePrice > 0 && (
                <View style={[styles.totalBox, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
                  <Text style={[styles.totalLabel, { color: Colors.text }]}>Drive-away total</Text>
                  <Text style={[styles.totalValue, { color: Colors.accent }]}>RM{totalPrice.toLocaleString()}</Text>
                </View>
              )}
              {basePrice > 0 && (
                <View style={[styles.breakdownBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                  <BreakdownRow Colors={Colors} label="Base" value={basePrice} />
                  <BreakdownRow Colors={Colors} label="Tax" value={tax} />
                  <BreakdownRow Colors={Colors} label="Extras" value={accessoriesCost} />
                </View>
              )}
              {wheelsSwapped && (
                <View style={[styles.refitNotice, { backgroundColor: Colors.warning ? Colors.warning + "20" : "#F59E0B20", borderColor: Colors.warning ?? "#F59E0B" }]} testID="ev-refit-notice">
                  <Unlock color={Colors.warning ?? "#F59E0B"} size={14} />
                  <Text style={[styles.refitText, { color: Colors.warning ?? "#F59E0B" }]} numberOfLines={3}>
                    Wheels changed from {factoryWheels} to {selectedWheel}. Your build will be flagged for re-fitting before delivery.
                  </Text>
                </View>
              )}
          </>
        )
      )}
    </View>
  );

  const renderDeposit = () => (
    <View style={{ gap: 14 }}>
      <View style={[styles.depositHero, { backgroundColor: Colors.accent }]}>
        <Banknote color={Colors.secondary} size={28} />
        <Text style={[styles.depositLabel, { color: Colors.secondary }]}>Order Fee</Text>
        <Text style={[styles.depositValue, { color: Colors.secondary }]}>{DEPOSIT_CURRENCY} {DEPOSIT_AMOUNT.toLocaleString()}</Text>
        <Text style={[styles.depositSub, { color: Colors.secondary }]}>Refundable Order Fee to secure your build</Text>
      </View>

      {defaultGateway ? (
        <View
          style={[
            styles.gatewayBanner,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
          testID="ev-checkout-gateway"
        >
          <View style={[styles.gatewayIcon, { backgroundColor: Colors.accent + "20" }]}>
            <ShieldCheck color={Colors.accent} size={16} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gatewayLabel, { color: Colors.textSecondary }]}>
              Secure payment by
            </Text>
            <Text style={[styles.gatewayName, { color: Colors.text }]} numberOfLines={1}>
              {defaultGateway.providerName}
              {defaultGateway.accountName ? `  ·  ${defaultGateway.accountName}` : ""}
            </Text>
          </View>
          <View
            style={[
              styles.gatewayPill,
              {
                backgroundColor:
                  defaultGateway.mode === "Live"
                    ? (Colors.success ?? "#10B981") + "30"
                    : (Colors.warning ?? "#F59E0B") + "30",
              },
            ]}
          >
            <Text
              style={[
                styles.gatewayPillText,
                {
                  color:
                    defaultGateway.mode === "Live"
                      ? Colors.success ?? "#10B981"
                      : Colors.warning ?? "#F59E0B",
                },
              ]}
            >
              {defaultGateway.mode}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.gatewayBanner,
            {
              backgroundColor: (Colors.warning ?? "#F59E0B") + "15",
              borderColor: Colors.warning ?? "#F59E0B",
            },
          ]}
          testID="ev-checkout-gateway-missing"
        >
          <View style={[styles.gatewayIcon, { backgroundColor: (Colors.warning ?? "#F59E0B") + "30" }]}>
            <ShieldCheck color={Colors.warning ?? "#F59E0B"} size={16} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gatewayLabel, { color: Colors.textSecondary }]}>
              Payment gateway
            </Text>
            <Text style={[styles.gatewayName, { color: Colors.warning ?? "#F59E0B" }]} numberOfLines={2}>
              Not configured — contact support before paying.
            </Text>
          </View>
        </View>
      )}

      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[
            styles.segment,
            {
              backgroundColor: payMethod === "card" ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          onPress={() => setPayMethod("card")}
          testID="ev-pay-card"
        >
          <CreditCard color={payMethod === "card" ? Colors.secondary : Colors.text} size={16} />
          <Text style={[styles.segmentText, { color: payMethod === "card" ? Colors.secondary : Colors.text }]}>
            Credit / Debit
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segment,
            {
              backgroundColor: payMethod === "fpx" ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          onPress={() => setPayMethod("fpx")}
          testID="ev-pay-fpx"
        >
          <Banknote color={payMethod === "fpx" ? Colors.secondary : Colors.text} size={16} />
          <Text style={[styles.segmentText, { color: payMethod === "fpx" ? Colors.secondary : Colors.text }]}>
            FPX
          </Text>
        </TouchableOpacity>
      </View>

      {payMethod === "card" ? (
        <View style={{ gap: 10 }}>
          <Field Colors={Colors} label="Card number" value={cardNumber} onChange={setCardNumber} placeholder="1234 5678 9012 3456" keyboardType="number-pad" testID="ev-card-number" />
          <Field Colors={Colors} label="Cardholder name" value={cardName} onChange={setCardName} placeholder="As shown on card" testID="ev-card-name" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field Colors={Colors} label="Expiry" value={cardExpiry} onChange={setCardExpiry} placeholder="MM/YY" testID="ev-card-exp" />
            </View>
            <View style={{ flex: 1 }}>
              <Field Colors={Colors} label="CVV" value={cardCvv} onChange={setCardCvv} placeholder="123" keyboardType="number-pad" testID="ev-card-cvv" />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionLabel, { color: Colors.text }]}>Select your bank</Text>
          <View style={styles.chipRow}>
            {["Maybank2u", "CIMB Clicks", "Public Bank", "RHB", "Hong Leong", "Bank Islam"].map((b) => {
              const sel = b === fpxBank;
              return (
                <TouchableOpacity
                  key={b}
                  onPress={() => setFpxBank(b)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: sel ? Colors.accent : Colors.gray[100],
                      borderColor: Colors.border,
                    },
                  ]}
                  testID={`ev-bank-${b}`}
                >
                  <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{b}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={payDeposit}
        disabled={depositPaid}
        style={[
          styles.primaryBtn,
          {
            backgroundColor: depositPaid ? Colors.success : Colors.accent,
            opacity: depositPaid ? 0.9 : 1,
          },
        ]}
        testID="ev-pay-now"
      >
        {depositPaid ? (
          <>
            <Check color={Colors.secondary} size={18} />
            <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Order Fee paid</Text>
          </>
        ) : (
          <>
            <CreditCard color={Colors.secondary} size={18} />
            <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>
              Pay {DEPOSIT_CURRENCY}{DEPOSIT_AMOUNT.toLocaleString()} now
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderAdvisor = () => (
    <View style={{ gap: 12 }}>
      {assignedAdvisor ? (
        <View style={[styles.advisorCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={[styles.advisorBadge, { backgroundColor: Colors.accent }]}>
            <UserCheck color={Colors.secondary} size={20} />
          </View>
          <Text style={[styles.advisorName, { color: Colors.text }]}>
            {String(assignedAdvisor.values.name ?? "Advisor")}
          </Text>
          <Text style={[styles.advisorRole, { color: Colors.textSecondary }]}>
            {String(assignedAdvisor.values.dealership ?? "Dealership")}
          </Text>

          <InfoRow Colors={Colors} Icon={Hash} label="DA Number" value={String(assignedAdvisor.values.daNumber ?? assignedAdvisor.id)} />
          <InfoRow Colors={Colors} Icon={Phone} label="Contact" value={String(assignedAdvisor.values.contact ?? "")} />
          <InfoRow Colors={Colors} Icon={Mail} label="Email" value={String(assignedAdvisor.values.email ?? "")} />
          <InfoRow Colors={Colors} Icon={MapPin} label="Location" value={`${String(assignedAdvisor.values.city ?? "")}, ${String(assignedAdvisor.values.state ?? "")}, ${String(assignedAdvisor.values.country ?? "")}`} />
        </View>
      ) : (
        <View style={[styles.advisorCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border, alignItems: "center" }]}>
          <UserCheck color={Colors.textSecondary} size={28} />
          <Text style={[styles.advisorName, { color: Colors.text, marginTop: 8 }]}>Awaiting assignment</Text>
          <Text style={[styles.advisorRole, { color: Colors.textSecondary, textAlign: "center" }]}>
            A Delivery Advisor will be assigned within a few days. You'll get a notification once available.
          </Text>
        </View>
      )}
    </View>
  );

  const persistOrder = (patch: Record<string, string | number | boolean>) => {
    if (!myOrderId) return;
    const existing = orders.find((o) => o.id === myOrderId);
    updateEntry("ev-orders", myOrderId, { ...(existing?.values ?? {}), ...patch });
  };

  const outstandingBalance = Math.max(0, totalPrice - DEPOSIT_AMOUNT);

  const renderPlate = () => (
    <View style={{ gap: 14 }}>
      <Text style={[styles.sectionLabel, { color: Colors.text }]}>
        Will you be transferring an existing licence plate?
      </Text>
      <View style={styles.ownerTypeRow}>
        {([
          { k: "yes" as const, label: "Yes, transfer" },
          { k: "no" as const, label: "No, issue new" },
        ]).map((opt) => {
          const sel = plateTransfer === opt.k;
          return (
            <TouchableOpacity
              key={opt.k}
              onPress={() => {
                setPlateTransfer(opt.k);
                if (opt.k === "no") setPlateNumber("");
                persistOrder({ plateTransfer: opt.k, plateNumber: opt.k === "yes" ? plateNumber : "" });
              }}
              style={[
                styles.ownerTypeBtn,
                {
                  backgroundColor: sel ? Colors.accent : Colors.gray[100],
                  borderColor: sel ? Colors.accent : Colors.border,
                },
              ]}
              testID={`ev-plate-${opt.k}`}
            >
              <Hash color={sel ? Colors.secondary : Colors.text} size={18} />
              <Text style={[styles.ownerTypeText, { color: sel ? Colors.secondary : Colors.text }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {plateTransfer === "yes" && (
        <View style={[styles.ownerCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <View style={[styles.vsoBox, { backgroundColor: Colors.warning + "15", borderColor: Colors.warning }]} testID="ev-plate-disclaimer">
            <FileSignature color={Colors.warning} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.vsoTitle, { color: Colors.text }]}>Disclaimer</Text>
              <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
                You must be the registered owner of the previous plates.
              </Text>
            </View>
          </View>
          <Field
            Colors={Colors}
            label="Existing licence plate number"
            value={plateNumber}
            onChange={(v) => {
              setPlateNumber(v);
              persistOrder({ plateNumber: v });
            }}
            placeholder="e.g. WXY 1234"
            testID="ev-plate-number"
          />
          <Text style={[styles.lockSub, { color: Colors.textSecondary }]}>
            Your advisor will guide you through the JPJ transfer paperwork during handover.
          </Text>
        </View>
      )}

      {plateTransfer === "no" && (
        <View style={[styles.vsoBox, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
          <FileSignature color={Colors.accent} size={18} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.vsoTitle, { color: Colors.text }]}>New plate will be issued</Text>
            <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
              JPJ will issue a fresh plate number on delivery.
            </Text>
          </View>
        </View>
      )}
    </View>
  );

  const setFinanceTypeAndPersist = (t: FinanceType) => {
    setFinanceType(t);
    setCashBalancePaid(false);
    setLeasingAddonRequired("");
    setLeasingAddonPaid(false);
    persistOrder({ financeType: t });
  };

  const renderFinancing = () => {
    const TYPE_META: Record<FinanceType, { sub: string; Icon: React.ComponentType<{ color?: string; size?: number }> }> = {
      cash: { sub: "Pay the full outstanding balance now to proceed.", Icon: Banknote },
      hp: { sub: "Bank-financed monthly instalments. No further payment here.", Icon: Wallet },
      leasing: { sub: "Lease the vehicle. Add-on payment only if required by your lessor.", Icon: FileSignature },
      rental: { sub: "Pay-per-period rental. No vehicle ownership transfer.", Icon: KeyRound },
    };

    const activeOptions = financeOptions.filter((f) => f.values.active !== false);
    const availableTypes: FinanceType[] = (["cash", "hp", "leasing", "rental"] as FinanceType[]).filter((t) =>
      activeOptions.some((f) => mapAdminTypeToFinanceType(String(f.values.type ?? "")) === t)
    );

    const formatPlanMeta = (v: Record<string, string | number | boolean>): string => {
      const bits: string[] = [];
      const mode = String(v.paymentMode ?? "");
      const amount = Number(v.paymentAmount ?? 0);
      if (mode === "Full Balance") bits.push("Full balance");
      else if (amount > 0) bits.push(`RM${amount.toLocaleString()}`);
      const rate = Number(v.rate ?? 0);
      if (rate > 0) bits.push(`${rate}%`);
      const termVal = Number(v.termValue ?? 0);
      const termUnit = String(v.termUnit ?? "");
      if (termVal > 0 && termUnit) bits.push(`${termVal} ${termUnit}${termVal > 1 ? "s" : ""}`);
      return bits.join(" \u00b7 ");
    };

    const FinanceCard = ({ value }: { value: FinanceType }) => {
      const meta = TYPE_META[value];
      const sel = financeType === value;
      const Icon = meta.Icon;
      return (
        <TouchableOpacity
          onPress={() => setFinanceTypeAndPersist(value)}
          style={[
            styles.card,
            {
              backgroundColor: Colors.gray[100],
              borderColor: sel ? Colors.accent : Colors.border,
              borderWidth: sel ? 2 : 1,
            },
          ]}
          testID={`ev-fintype-${value}`}
        >
          <View style={[styles.cardIcon, { backgroundColor: Colors.accent + "20" }]}>
            <Icon color={Colors.accent} size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: Colors.text }]}>{FINANCE_TYPE_LABELS[value]}</Text>
            <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={2}>{meta.sub}</Text>
          </View>
          {sel && <Check color={Colors.accent} size={20} />}
        </TouchableOpacity>
      );
    };

    const plansForType = activeOptions.filter(
      (f) => mapAdminTypeToFinanceType(String(f.values.type ?? "")) === financeType
    );

    return (
      <View style={{ gap: 12 }}>
        <View style={[styles.vsoBox, { backgroundColor: Colors.accent + "15", borderColor: Colors.accent }]}>
          <FileSignature color={Colors.accent} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.vsoTitle, { color: Colors.text }]}>Vehicle Sales Order issued</Text>
            <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
              Choose how you'd like to finance your TEKSI EV.
            </Text>
          </View>
        </View>

        {availableTypes.length === 0 ? (
          <View style={[styles.vsoBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <FileSignature color={Colors.textSecondary} size={20} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.vsoTitle, { color: Colors.text }]}>No financing options available</Text>
              <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
                Please contact your Delivery Advisor to enable financing for your region.
              </Text>
            </View>
          </View>
        ) : (
          availableTypes.map((t) => <FinanceCard key={t} value={t} />)
        )}

        {plansForType.length > 0 && financeType !== "" && (
          <View style={[styles.ownerCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.sectionLabel, { color: Colors.text }]}>Available plans</Text>
            {plansForType.map((f) => {
              const sel = f.id === financeChoice;
              const metaLine = formatPlanMeta(f.values as Record<string, string | number | boolean>);
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => {
                    setFinanceChoice(f.id);
                    persistOrder({ financeChoice: f.id, financePlan: String(f.values.name ?? "") });
                  }}
                  style={[
                    styles.card,
                    {
                      backgroundColor: Colors.background,
                      borderColor: sel ? Colors.accent : Colors.border,
                      borderWidth: sel ? 2 : 1,
                    },
                  ]}
                  testID={`ev-fin-${f.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: Colors.text }]}>{String(f.values.name ?? "")}</Text>
                    {!!f.values.details && (
                      <Text style={[styles.cardSub, { color: Colors.textSecondary }]} numberOfLines={2}>
                        {String(f.values.details)}
                      </Text>
                    )}
                    {!!metaLine && (
                      <Text style={[styles.cardMeta, { color: Colors.textSecondary }]}>{metaLine}</Text>
                    )}
                  </View>
                  {sel && <Check color={Colors.accent} size={20} />}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {financeType === "cash" && (
          <View style={{ gap: 10 }}>
            <View style={[styles.totalBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Text style={[styles.totalLabel, { color: Colors.text }]}>Outstanding balance</Text>
              <Text style={[styles.totalValue, { color: Colors.accent }]}>RM{outstandingBalance.toLocaleString()}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setCashBalancePaid(true);
                persistOrder({ cashBalancePaid: true, balancePaidAmount: outstandingBalance });
              }}
              disabled={cashBalancePaid}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: cashBalancePaid ? Colors.success : Colors.accent,
                  opacity: cashBalancePaid ? 0.9 : 1,
                },
              ]}
              testID="ev-cash-pay"
            >
              {cashBalancePaid ? (
                <>
                  <Check color={Colors.secondary} size={18} />
                  <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Full balance paid</Text>
                </>
              ) : (
                <>
                  <CreditCard color={Colors.secondary} size={18} />
                  <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Pay RM{outstandingBalance.toLocaleString()} now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {financeType === "hp" && (
          <View style={[styles.vsoBox, { backgroundColor: Colors.success + "15", borderColor: Colors.success }]}>
            <Check color={Colors.success} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.vsoTitle, { color: Colors.text }]}>Proceed to advisor</Text>
              <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
                Your bank will handle disbursement. No additional payment is required here.
              </Text>
            </View>
          </View>
        )}

        {financeType === "rental" && (
          <View style={[styles.vsoBox, { backgroundColor: Colors.success + "15", borderColor: Colors.success }]}>
            <Check color={Colors.success} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.vsoTitle, { color: Colors.text }]}>Proceed to advisor</Text>
              <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
                Rental terms will be confirmed with your Delivery Advisor before handover.
              </Text>
            </View>
          </View>
        )}

        {financeType === "leasing" && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: Colors.text }]}>Is an add-on payment required?</Text>
            <View style={styles.ownerTypeRow}>
              {([
                { k: "no" as const, label: "No add-on" },
                { k: "yes" as const, label: "Yes, pay add-on" },
              ]).map((opt) => {
                const sel = leasingAddonRequired === opt.k;
                return (
                  <TouchableOpacity
                    key={opt.k}
                    onPress={() => {
                      setLeasingAddonRequired(opt.k);
                      setLeasingAddonPaid(false);
                      persistOrder({ leasingAddonRequired: opt.k });
                    }}
                    style={[
                      styles.ownerTypeBtn,
                      {
                        backgroundColor: sel ? Colors.accent : Colors.gray[100],
                        borderColor: sel ? Colors.accent : Colors.border,
                      },
                    ]}
                    testID={`ev-lease-addon-${opt.k}`}
                  >
                    <Banknote color={sel ? Colors.secondary : Colors.text} size={18} />
                    <Text style={[styles.ownerTypeText, { color: sel ? Colors.secondary : Colors.text }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {leasingAddonRequired === "yes" && (
              <View style={[styles.ownerCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Field
                  Colors={Colors}
                  label="Add-on amount (RM)"
                  value={leasingAddonAmount}
                  onChange={setLeasingAddonAmount}
                  placeholder="e.g. 5000"
                  keyboardType="number-pad"
                  testID="ev-lease-addon-amount"
                />
                <TouchableOpacity
                  onPress={() => {
                    const amt = parseFloat(leasingAddonAmount);
                    if (!leasingAddonAmount.trim() || isNaN(amt) || amt <= 0) {
                      Alert.alert("Enter amount", "Please enter the add-on amount.");
                      return;
                    }
                    setLeasingAddonPaid(true);
                    persistOrder({ leasingAddonPaid: true, leasingAddonAmount: amt });
                  }}
                  disabled={leasingAddonPaid}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: leasingAddonPaid ? Colors.success : Colors.accent,
                      opacity: leasingAddonPaid ? 0.9 : 1,
                    },
                  ]}
                  testID="ev-lease-pay"
                >
                  {leasingAddonPaid ? (
                    <>
                      <Check color={Colors.secondary} size={18} />
                      <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Add-on paid</Text>
                    </>
                  ) : (
                    <>
                      <CreditCard color={Colors.secondary} size={18} />
                      <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Pay add-on</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
            {leasingAddonRequired === "no" && (
              <View style={[styles.vsoBox, { backgroundColor: Colors.success + "15", borderColor: Colors.success }]}>
                <Check color={Colors.success} size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.vsoTitle, { color: Colors.text }]}>No add-on required</Text>
                  <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>You can proceed to your Delivery Advisor.</Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderSchedule = () => {
    const today = new Date();
    const slots: { iso: string; label: string }[] = [];
    for (let i = 3; i < 18; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      slots.push({ iso, label });
    }
    const readyForDelivery = String(myOrder?.values.status ?? "") === "ready_for_delivery";
    return (
      <View style={{ gap: 14 }}>
        <View
          style={[
            styles.vsoBox,
            {
              backgroundColor: readyForDelivery ? Colors.success + "15" : Colors.accent + "15",
              borderColor: readyForDelivery ? Colors.success : Colors.accent,
            },
          ]}
        >
          <FileSignature color={readyForDelivery ? Colors.success : Colors.accent} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.vsoTitle, { color: Colors.text }]}>
              {readyForDelivery ? "Ready for delivery" : "Awaiting vehicle assignment"}
            </Text>
            <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
              {readyForDelivery
                ? "Your advisor has assigned a vehicle from inventory. Pick your preferred delivery date."
                : "Your advisor will assign a vehicle from inventory shortly. You can still pre-select a date."}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: Colors.text }]}>Preferred delivery date</Text>
        <View style={styles.chipRow}>
          {slots.map((s) => {
            const sel = deliveryDate === s.iso;
            return (
              <TouchableOpacity
                key={s.iso}
                onPress={() => {
                  setDeliveryDate(s.iso);
                  persistOrder({ deliveryDate: s.iso });
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: sel ? Colors.accent : Colors.gray[100],
                    borderColor: sel ? Colors.accent : Colors.border,
                  },
                ]}
                testID={`ev-date-${s.iso}`}
              >
                <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {!!deliveryDate && (
          <View style={[styles.totalBox, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.totalLabel, { color: Colors.text }]}>Selected date</Text>
            <Text style={[styles.totalValue, { color: Colors.accent }]}>{deliveryDate}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderDelivery = () => {
    const checklistItems = getEntries("ev-delivery-checklist");
    const submittedRaw = String(myOrder?.values.checklistSubmitted ?? "");
    const submitted = submittedRaw === "true" || submittedRaw === "1";
    let advisorChecks: { name: string; done: boolean; note: string }[] = [];
    try {
      const raw = String(myOrder?.values.checklistResults ?? "");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          advisorChecks = parsed.map((x) => ({
            name: String(x?.name ?? ""),
            done: x?.done !== false,
            note: String(x?.note ?? ""),
          }));
        }
      }
    } catch {
      advisorChecks = [];
    }
    const items: { name: string; done: boolean; note: string }[] =
      advisorChecks.length > 0
        ? advisorChecks
        : checklistItems.map((c) => ({
            name: String(c.values.name ?? c.values.title ?? "Item"),
            done: submitted,
            note: "",
          }));

    return (
      <View style={{ gap: 12 }}>
        <View style={[styles.vsoBox, { backgroundColor: (submitted ? Colors.success : Colors.accent) + "15", borderColor: submitted ? Colors.success : Colors.accent }]}>
          <ListChecks color={submitted ? Colors.success : Colors.accent} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.vsoTitle, { color: Colors.text }]}>
              {submitted ? "Advisor submitted checklist" : "Waiting for advisor submission"}
            </Text>
            <Text style={[styles.vsoSub, { color: Colors.textSecondary }]}>
              {submitted
                ? "Review and accept to complete handover."
                : "Your advisor will complete the delivery checklist and submit it for your acceptance."}
            </Text>
          </View>
        </View>

        {items.length === 0 ? (
          <EmptyHint Colors={Colors} text="No delivery checklist configured yet. Ask admin to add items." />
        ) : (
          items.map((it, idx) => (
            <View
              key={`${it.name}-${idx}`}
              style={[styles.accRow, { backgroundColor: Colors.gray[100], borderColor: Colors.border, borderWidth: 1 }]}
            >
              <View
                style={[
                  styles.checkBox,
                  {
                    backgroundColor: it.done ? Colors.success : "transparent",
                    borderColor: it.done ? Colors.success : Colors.border,
                  },
                ]}
              >
                {it.done && <Check color={Colors.secondary} size={14} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.accName, { color: Colors.text }]}>{it.name}</Text>
                {!!it.note && (
                  <Text style={[styles.lockSub, { color: Colors.textSecondary }]} numberOfLines={2}>{it.note}</Text>
                )}
              </View>
            </View>
          ))
        )}

        <TouchableOpacity
          onPress={() => {
            if (!submitted) {
              Alert.alert("Not submitted yet", "Please wait for your advisor to submit the delivery checklist.");
              return;
            }
            setChecklistAccepted(true);
            persistOrder({ checklistAccepted: true, status: "delivered" });
          }}
          disabled={checklistAccepted}
          style={[
            styles.primaryBtn,
            {
              backgroundColor: checklistAccepted ? Colors.success : submitted ? Colors.accent : Colors.gray[100],
              opacity: checklistAccepted ? 0.9 : 1,
            },
          ]}
          testID="ev-accept-delivery"
        >
          {checklistAccepted ? (
            <>
              <Check color={Colors.secondary} size={18} />
              <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Delivery accepted</Text>
            </>
          ) : (
            <>
              <ShieldCheck color={submitted ? Colors.secondary : Colors.textSecondary} size={18} />
              <Text style={[styles.primaryBtnText, { color: submitted ? Colors.secondary : Colors.textSecondary }]}>
                {submitted ? "Accept & complete delivery" : "Waiting for advisor"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const pickIdImage = async () => {
    try {
      if (Platform.OS === "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Please allow camera access to capture your ID image.");
          return;
        }
        const webResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          quality: 0.7,
          base64: true,
        });
        if (!webResult.canceled && webResult.assets && webResult.assets[0]) {
          const a = webResult.assets[0];
          const uri = a.base64 ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}` : a.uri;
          setIdImageUri(uri);
          setExtracted(false);
          setOwnershipConfirmed(false);
        }
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow camera access to capture your ID image.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.7,
        base64: true,
        cameraType: ImagePicker.CameraType.back,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const a = result.assets[0];
        const uri = a.base64 ? `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}` : a.uri;
        setIdImageUri(uri);
        setExtracted(false);
        setOwnershipConfirmed(false);
      }
    } catch (e) {
      console.log("id image capture error", e);
      Alert.alert("Error", "Could not capture image.");
    }
  };

  const runExtraction = async () => {
    if (!idImageUri) {
      Alert.alert("Capture required", "Please take a photo of your ID first.");
      return;
    }
    setExtracting(true);
    try {
      const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com";
      const res = await fetch(`${toolkitUrl}/text/llm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You extract identity information from photos of ID cards or passports. Respond ONLY with valid compact JSON: {\"fullName\":string,\"idNumber\":string,\"address\":string}. Use empty strings for fields you cannot read.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `Extract the full legal name, ID/passport number and full address from this ${idType === "passport" ? "passport" : "national ID"} (${idCountry}). Return JSON only.` },
                { type: "image", image: idImageUri },
              ],
            },
          ],
        }),
      });
      const data = (await res.json()) as { completion?: string };
      const raw = String(data.completion ?? "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = match ? (JSON.parse(match[0]) as { fullName?: string; idNumber?: string; address?: string }) : null;
      if (parsed) {
        if (parsed.fullName) setFullName(String(parsed.fullName));
        if (parsed.idNumber) setIdNumber(String(parsed.idNumber));
        if (parsed.address) setOwnerAddress(String(parsed.address));
      }
      // The photo of the ID itself is our best stand-in for an extracted face crop.
      setExtractedPhoto(idImageUri);
      setExtracted(true);
    } catch (e) {
      console.log("extract error", e);
      setExtractedPhoto(idImageUri);
      setExtracted(true);
      Alert.alert("Auto-detect unavailable", "We couldn't read the ID automatically. Please fill the details manually and confirm.");
    } finally {
      setExtracting(false);
    }
  };

  const confirmOwnership = () => {
    if (!fullName.trim() || !idNumber.trim() || !ownerAddress.trim()) {
      Alert.alert("Missing details", "Please complete name, ID number and address.");
      return;
    }
    if (ownerType === "other" && !relationship.trim()) {
      Alert.alert("Relationship required", "Please enter your relationship to this person.");
      return;
    }
    if (ownerType === "company" && (!companyName.trim() || !companyRegNo.trim() || !companyAddress.trim())) {
      Alert.alert("Company details required", "Please complete company name, registration number and address.");
      return;
    }
    setOwnershipConfirmed(true);
    if (myOrderId) {
      const existing = orders.find((o) => o.id === myOrderId);
      const merged: Record<string, string | number | boolean> = {
        ...(existing?.values ?? {}),
        ownerType,
        ownerIdType: ownerType === "company" ? `company+${idType}` : idType,
        ownerIdCountry: idCountry,
        ownerIdImage: idImageUri,
        ownerPhoto: extractedPhoto,
        ownerFullName: fullName,
        ownerIdNumber: idNumber,
        ownerAddress,
        ownerRelationship: ownerType === "other" ? relationship : "",
        companyName: ownerType === "company" ? companyName : "",
        companyRegNo: ownerType === "company" ? companyRegNo : "",
        companyAddress: ownerType === "company" ? companyAddress : "",
      };
      updateEntry("ev-orders", myOrderId, merged);
    }
  };

  const renderOwnership = () => {
    const OwnerTypeBtn = ({ value, label, Icon }: { value: OwnerType; label: string; Icon: React.ComponentType<{ color?: string; size?: number }> }) => {
      const sel = ownerType === value;
      return (
        <TouchableOpacity
          onPress={() => {
            setOwnerType(value);
            setOwnershipConfirmed(false);
          }}
          style={[
            styles.ownerTypeBtn,
            {
              backgroundColor: sel ? Colors.accent : Colors.gray[100],
              borderColor: sel ? Colors.accent : Colors.border,
            },
          ]}
          testID={`ev-owner-${value}`}
        >
          <Icon color={sel ? Colors.secondary : Colors.text} size={18} />
          <Text style={[styles.ownerTypeText, { color: sel ? Colors.secondary : Colors.text }]}>{label}</Text>
        </TouchableOpacity>
      );
    };

    return (
      <View style={{ gap: 14 }}>
        <Text style={[styles.sectionLabel, { color: Colors.text }]}>Who will own this vehicle?</Text>
        <View style={styles.ownerTypeRow}>
          <OwnerTypeBtn value="self" label="My Self" Icon={User} />
          <OwnerTypeBtn value="other" label="Other Individual" Icon={Users} />
          <OwnerTypeBtn value="company" label="Company" Icon={Building2} />
        </View>

        {ownerType === "company" && (
          <View style={[styles.ownerCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
            <Text style={[styles.sectionLabel, { color: Colors.text }]}>Company details</Text>
            <TapField Colors={Colors} label="Company name" value={companyName} placeholder="e.g. TEKSI Mobility Sdn Bhd" onPress={() => openEdit("companyName", companyName)} testID="ev-company-name" />
            <TapField Colors={Colors} label="Company registration number" value={companyRegNo} placeholder="e.g. 202301012345" onPress={() => openEdit("companyRegNo", companyRegNo)} testID="ev-company-reg" />
            <TapField Colors={Colors} label="Company address" value={companyAddress} placeholder="Registered business address" multiline onPress={() => openEdit("companyAddress", companyAddress)} testID="ev-company-addr" />
          </View>
        )}

        <View style={[styles.ownerCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
          <Text style={[styles.sectionLabel, { color: Colors.text }]}>
            {ownerType === "company" ? "Person in charge — ID verification" : ownerType === "other" ? "Owner — ID verification" : "Your ID verification"}
          </Text>

          {ownerType === "other" && (
            <Field Colors={Colors} label="Relationship to you" value={relationship} onChange={setRelationship} placeholder="e.g. Spouse, Parent, Sibling" testID="ev-relationship" />
          )}

          <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 4 }]}>Select ID type</Text>
          <View style={styles.chipRow}>
            {[{ k: "national" as const, label: "National ID" }, { k: "passport" as const, label: "Passport" }].map((opt) => {
              const sel = idType === opt.k;
              return (
                <TouchableOpacity
                  key={opt.k}
                  onPress={() => setIdType(opt.k)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: sel ? Colors.accent : Colors.background,
                      borderColor: sel ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`ev-idtype-${opt.k}`}
                >
                  <IdCard color={sel ? Colors.secondary : Colors.text} size={14} />
                  <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.fieldLabel, { color: Colors.textSecondary, marginTop: 8 }]}>Country of issuance</Text>
          <View style={styles.chipRow}>
            {ID_COUNTRIES.map((c) => {
              const sel = idCountry === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setIdCountry(c)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: sel ? Colors.accent : Colors.background,
                      borderColor: sel ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`ev-country-${c}`}
                >
                  <Globe color={sel ? Colors.secondary : Colors.text} size={12} />
                  <Text style={[styles.chipText, { color: sel ? Colors.secondary : Colors.text }]}>{c}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={pickIdImage}
            style={[
              styles.idUploadBox,
              {
                backgroundColor: idImageUri ? Colors.background : Colors.background,
                borderColor: idImageUri ? Colors.accent : Colors.border,
              },
            ]}
            testID="ev-id-upload"
          >
            {idImageUri ? (
              <Image source={{ uri: idImageUri }} style={styles.idUploadImg} resizeMode="cover" />
            ) : (
              <View style={styles.idUploadEmpty}>
                <Camera color={Colors.textSecondary} size={22} />
                <Text style={[styles.uploadText, { color: Colors.text }]}>Take a photo of your ID</Text>
                <Text style={[styles.uploadHint, { color: Colors.textSecondary }]}>Use your camera to capture the {idType === "passport" ? "passport" : "ID"}</Text>
              </View>
            )}
            {idImageUri && (
              <View style={[styles.idReupload, { backgroundColor: Colors.background + "E6" }]}>
                <Camera color={Colors.text} size={12} />
                <Text style={[styles.idReuploadText, { color: Colors.text }]}>Retake</Text>
              </View>
            )}
          </TouchableOpacity>

          {idImageUri && !extracted && (
            <TouchableOpacity
              onPress={runExtraction}
              disabled={extracting}
              style={[styles.extractBtn, { backgroundColor: Colors.accent, opacity: extracting ? 0.7 : 1 }]}
              testID="ev-extract"
            >
              {extracting ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Sparkle color={Colors.secondary} size={16} />
              )}
              <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>
                {extracting ? "Extracting details…" : "Auto-detect details"}
              </Text>
            </TouchableOpacity>
          )}

          {extracted && (
            <View style={{ gap: 10, marginTop: 4 }}>
              <View style={[styles.extractedHeader, { backgroundColor: Colors.success + "15", borderColor: Colors.success }]}>
                <Check color={Colors.success} size={14} />
                <Text style={[styles.extractedHeaderText, { color: Colors.text }]}>Review and edit before confirming</Text>
              </View>
              {!!extractedPhoto && (
                <View style={styles.photoRow}>
                  <Image source={{ uri: extractedPhoto }} style={styles.photoThumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>Captured photo</Text>
                    <Text style={[styles.photoHint, { color: Colors.text }]} numberOfLines={2}>
                      Stored securely with your order for verification.
                    </Text>
                  </View>
                </View>
              )}
              <TapField Colors={Colors} label="Full name" value={fullName} placeholder="As shown on ID" onPress={() => openEdit("fullName", fullName)} testID="ev-owner-name" />
              <TapField Colors={Colors} label={idType === "passport" ? "Passport number" : "ID number"} value={idNumber} placeholder="e.g. A12345678" onPress={() => openEdit("idNumber", idNumber)} testID="ev-owner-id" />
              <TapField Colors={Colors} label="Address" value={ownerAddress} placeholder="Full residential address" multiline onPress={() => openEdit("ownerAddress", ownerAddress)} testID="ev-owner-addr" />

              <TouchableOpacity
                onPress={confirmOwnership}
                disabled={ownershipConfirmed}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: ownershipConfirmed ? Colors.success : Colors.accent,
                    opacity: ownershipConfirmed ? 0.9 : 1,
                  },
                ]}
                testID="ev-owner-confirm"
              >
                {ownershipConfirmed ? (
                  <>
                    <Check color={Colors.secondary} size={18} />
                    <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Ownership confirmed</Text>
                  </>
                ) : (
                  <>
                    <ShieldCheck color={Colors.secondary} size={18} />
                    <Text style={[styles.primaryBtnText, { color: Colors.secondary }]}>Confirm & proceed</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  const stepBody = () => {
    switch (step.key) {
      case "model":
        return renderModel();
      case "specification":
        return renderSpecification();
      case "deposit":
        return renderDeposit();
      case "ownership":
        return renderOwnership();
      case "plate":
        return renderPlate();
      case "financing":
        return renderFinancing();
      case "advisor":
        return renderAdvisor();
      case "schedule":
        return renderSchedule();
      case "delivery":
        return renderDelivery();
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="ev-back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Zap color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>TEKSI EV</Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {`Step ${stepIdx + 1} of ${STEPS.length} · ${step.title}`}
          </Text>
        </View>
        <View style={[styles.iconBtn]} />
      </View>

      {/* Tesla-style minimal stepper */}
      <View style={styles.stepperWrap}>
        <View style={[styles.stepperTrack, { backgroundColor: Colors.border }]} />
        <View
          style={[
            styles.stepperFill,
            {
              backgroundColor: Colors.accent,
              width: `${(stepIdx / (STEPS.length - 1)) * 100}%`,
            },
          ]}
        />
        <View style={styles.stepperRow}>
          {STEPS.map((s, i) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            const bg = done || active ? Colors.accent : Colors.background;
            const borderColor = done || active ? Colors.accent : Colors.border;
            const fg = done || active ? Colors.secondary : Colors.textSecondary;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => {
                  if (i <= stepIdx) setStepIdx(i);
                }}
                style={styles.stepNodeWrap}
                testID={`ev-step-${s.key}`}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.stepNode,
                    {
                      backgroundColor: bg,
                      borderColor,
                      transform: [{ scale: active ? 1.15 : 1 }],
                    },
                  ]}
                >
                  {done ? (
                    <Check color={Colors.secondary} size={12} />
                  ) : (
                    <Text style={[styles.stepNodeNum, { color: fg }]}>{i + 1}</Text>
                  )}
                </View>
                {active && (
                  <Text
                    style={[
                      styles.stepNodeLabel,
                      {
                        color: Colors.textSecondary,
                        fontWeight: "600",
                      },
                    ]}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {s.short}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.stepHeader}>
          <Text style={[styles.stepBigTitle, { color: Colors.text }]}>{step.title}</Text>
          <Text style={[styles.stepBigSub, { color: Colors.textSecondary }]}>{stepHelp(step.key, DEPOSIT_CURRENCY, DEPOSIT_AMOUNT)}</Text>
        </View>
        {stepBody()}
        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: Colors.background, borderTopColor: Colors.border }]}>
        <TouchableOpacity
          onPress={goPrev}
          disabled={stepIdx === 0}
          style={[
            styles.footerBtn,
            {
              backgroundColor: Colors.gray[100],
              borderColor: Colors.border,
              opacity: stepIdx === 0 ? 0.4 : 1,
            },
          ]}
          testID="ev-prev"
        >
          <Text style={[styles.footerBtnText, { color: Colors.text }]}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={goNext}
          disabled={!canProceed() || stepIdx === STEPS.length - 1}
          style={[
            styles.footerBtn,
            styles.footerNext,
            {
              backgroundColor: canProceed() && stepIdx < STEPS.length - 1 ? Colors.accent : Colors.gray[100],
              borderColor: Colors.border,
            },
          ]}
          testID="ev-next"
        >
          <Text
            style={[
              styles.footerBtnText,
              {
                color:
                  canProceed() && stepIdx < STEPS.length - 1 ? Colors.secondary : Colors.textSecondary,
              },
            ]}
          >
            {stepIdx === STEPS.length - 1 ? "Complete" : "Continue"}
          </Text>
          {stepIdx < STEPS.length - 1 && (
            <ChevronRight
              color={canProceed() ? Colors.secondary : Colors.textSecondary}
              size={18}
            />
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={agentCodeModalOpen}
        transparent
        animationType="slide"
        onRequestClose={skipAgentCode}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={skipAgentCode} />
          <View style={[styles.modalSheet, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Ticket color={Colors.accent} size={18} />
              <Text style={[styles.modalTitle, { color: Colors.text, marginBottom: 0 }]}>Agent code</Text>
            </View>
            <Text style={{ color: Colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
              If a Delivery Advisor gave you a DA code, enter it now. We'll link them to your order automatically. Leave blank to skip.
            </Text>
            <View style={[styles.modalInputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border, minHeight: 52 }]}>
              <TextInput
                value={agentCodeInput}
                onChangeText={setAgentCodeInput}
                placeholder="e.g. DA-0001"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                style={[styles.modalInput, { color: Colors.text, textAlignVertical: "center" }]}
                testID="ev-agent-code-input"
              />
            </View>
            <View style={styles.modalRow}>
              <TouchableOpacity
                onPress={skipAgentCode}
                style={[styles.modalBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID="ev-agent-code-skip"
              >
                <Text style={[styles.modalBtnText, { color: Colors.text }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={applyAgentCode}
                style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                testID="ev-agent-code-apply"
              >
                <Text style={[styles.modalBtnText, { color: Colors.secondary }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editKey !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={closeEdit} />
          <View style={[styles.modalSheet, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: Colors.text }]}>
              {editKey ? editMeta[editKey].title : ""}
            </Text>
            <View style={[styles.modalInputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border, minHeight: editKey && editMeta[editKey].multiline ? 110 : 52 }]}>
              <TextInput
                value={editDraft}
                onChangeText={setEditDraft}
                placeholder={editKey ? editMeta[editKey].placeholder : ""}
                placeholderTextColor={Colors.textSecondary}
                multiline={editKey ? !!editMeta[editKey].multiline : false}
                autoFocus
                style={[styles.modalInput, { color: Colors.text, textAlignVertical: editKey && editMeta[editKey].multiline ? "top" : "center" }]}
                testID="ev-edit-input"
              />
            </View>
            <View style={styles.modalRow}>
              <TouchableOpacity
                onPress={closeEdit}
                style={[styles.modalBtn, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}
                testID="ev-edit-cancel"
              >
                <Text style={[styles.modalBtnText, { color: Colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveEdit}
                style={[styles.modalBtn, { backgroundColor: Colors.accent, borderColor: Colors.accent }]}
                testID="ev-edit-save"
              >
                <Text style={[styles.modalBtnText, { color: Colors.secondary }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function stepHelp(k: StepKey, depositCurrency: string, depositAmount: number): string {
  switch (k) {
    case "model":
      return "Pick your TEKSI EV — custom build or an inventory unit.";
    case "specification":
      return "Configure colors, wheels and accessories for your chosen model.";
    case "deposit":
      return `Pay a non-refundable order fee of ${depositCurrency}${depositAmount.toLocaleString()} to secure your build.`;
    case "ownership":
      return "Tell us who will own this vehicle and verify their identity.";
    case "plate":
      return "Will you be transferring an existing licence plate to this vehicle?";
    case "financing":
      return "Choose your financing — Cash, Hire Purchase, Leasing or Rental, based on what's enabled for your region.";
    case "advisor":
      return "Your Delivery Advisor will assign a vehicle from inventory and mark it ready.";
    case "schedule":
      return "Pick your preferred delivery date. Your DA will confirm shortly.";
    case "delivery":
      return "Review the delivery checklist submitted by your advisor and accept handover.";
  }
}

function TrimPicker({
  Colors,
  items,
  selectedId,
  onSelect,
  testIDPrefix,
}: {
  Colors: ReturnType<typeof useColors>;
  items: { id: string; title: string; subtitle: string; imageUri: string; badge?: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={{ gap: 10 }} testID={`${testIDPrefix}-trim-picker`}>
      {items.map((it) => {
        const sel = it.id === selectedId;
        return (
          <TouchableOpacity
            key={it.id}
            activeOpacity={0.9}
            onPress={() => onSelect(it.id)}
            style={[
              styles.trimRowItem,
              {
                backgroundColor: Colors.gray[100],
                borderColor: sel ? Colors.accent : Colors.border,
                borderWidth: sel ? 2 : 1,
              },
            ]}
            testID={`${testIDPrefix}-${it.id}`}
          >
            {it.imageUri ? (
              <Image source={{ uri: it.imageUri }} style={styles.trimRowImg} resizeMode="cover" />
            ) : (
              <View style={[styles.trimRowImg, { alignItems: "center", justifyContent: "center", backgroundColor: Colors.accent + "15" }]}>
                <Zap color={Colors.accent} size={28} />
              </View>
            )}
            <View style={styles.trimRowBody}>
              <Text style={[styles.trimTitle, { color: Colors.text }]} numberOfLines={1}>{it.title}</Text>
              <Text style={[styles.trimSub, { color: Colors.textSecondary }]} numberOfLines={2}>{it.subtitle}</Text>
              {!!it.badge && (
                <View style={[styles.trimRowBadge, { backgroundColor: Colors.accent }]}>
                  <Text style={[styles.trimBadgeText, { color: Colors.secondary }]}>{it.badge}</Text>
                </View>
              )}
            </View>
            <View
              style={[
                styles.trimRowCheck,
                {
                  backgroundColor: sel ? Colors.accent : "transparent",
                  borderColor: sel ? Colors.accent : Colors.border,
                },
              ]}
            >
              {sel && <Check color={Colors.secondary} size={14} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function GalleryStrip({
  Colors,
  images,
  testIDPrefix,
}: {
  Colors: ReturnType<typeof useColors>;
  images: { uri: string; label: string }[];
  testIDPrefix: string;
}) {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  return (
    <View style={{ gap: 6 }} testID={`${testIDPrefix}-strip`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.galleryRow}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / 124);
          if (idx !== activeIdx && idx >= 0 && idx < images.length) setActiveIdx(idx);
        }}
        scrollEventThrottle={16}
      >
        {images.map((img, i) => (
          <View
            key={`${img.uri}-${i}`}
            style={[styles.galleryItem, { borderColor: i === activeIdx ? Colors.accent : Colors.border }]}
            testID={`${testIDPrefix}-${i}`}
          >
            <Image source={{ uri: img.uri }} style={styles.galleryImg} />
            <View style={[styles.galleryTag, { backgroundColor: Colors.background + "E6" }]}>
              <Text style={[styles.galleryTagText, { color: Colors.text }]}>{img.label}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={[styles.galleryCount, { color: Colors.textSecondary }]}>
        {`${activeIdx + 1} / ${images.length} · ${images[activeIdx]?.label ?? ""}`}
      </Text>
    </View>
  );
}

function EmptyHint({ Colors, text }: { Colors: ReturnType<typeof useColors>; text: string }) {
  return (
    <View style={[styles.empty, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
      <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

function Field({
  Colors,
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  testID,
}: {
  Colors: ReturnType<typeof useColors>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  testID?: string;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          keyboardType={keyboardType ?? "default"}
          style={[styles.input, { color: Colors.text }]}
          testID={testID}
        />
      </View>
    </View>
  );
}

function TapField({
  Colors,
  label,
  value,
  placeholder,
  onPress,
  multiline,
  testID,
}: {
  Colors: ReturnType<typeof useColors>;
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
  multiline?: boolean;
  testID?: string;
}) {
  const hasValue = !!value && value.length > 0;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} testID={testID}>
      <Text style={[styles.fieldLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: Colors.gray[100],
            borderColor: Colors.border,
            height: multiline ? 72 : 48,
            paddingVertical: multiline ? 10 : 0,
          },
        ]}
      >
        <Text
          style={[
            styles.input,
            { color: hasValue ? Colors.text : Colors.textSecondary },
          ]}
          numberOfLines={multiline ? 3 : 1}
        >
          {hasValue ? value : (placeholder ?? "Tap to enter")}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function BreakdownRow({
  Colors,
  label,
  value,
}: {
  Colors: ReturnType<typeof useColors>;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.breakdownValue, { color: Colors.text }]}>RM{Number(value || 0).toLocaleString()}</Text>
    </View>
  );
}

function InfoRow({
  Colors,
  Icon,
  label,
  value,
}: {
  Colors: ReturnType<typeof useColors>;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: Colors.accent + "15" }]}>
        <Icon color={Colors.accent} size={14} />
      </View>
      <Text style={[styles.infoLabel, { color: Colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: Colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Suppress unused-import warnings on web */
void Image;
void Platform;

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
  headerTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  stepperWrap: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 10,
    position: "relative" as const,
  },
  stepperTrack: {
    position: "absolute" as const,
    left: 36,
    right: 36,
    top: 28,
    height: 2,
    borderRadius: 1,
  },
  stepperFill: {
    position: "absolute" as const,
    left: 36,
    top: 28,
    height: 2,
    borderRadius: 1,
  },
  stepperRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
  },
  stepNodeWrap: {
    alignItems: "center" as const,
    gap: 6,
    flex: 1,
    position: "relative" as const,
  },
  stepNode: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  stepNodeNum: { fontSize: 11, fontWeight: "800" as const },
  stepNodeLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
    position: "absolute" as const,
    top: 28,
    left: -40,
    right: -40,
    textAlign: "center" as const,
  },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  stepHeader: { marginBottom: 14 },
  stepBigTitle: { fontSize: 22, fontWeight: "800" as const },
  stepBigSub: { fontSize: 13, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: "800" as const, marginTop: 4 },
  fastBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  fastBannerText: { flex: 1, fontSize: 12, fontWeight: "700" as const },
  invThumb: { width: 56, height: 56, borderRadius: 12 },
  invHero: { width: "100%" as const, height: 180, borderRadius: 16, marginTop: 4 },
  trimRow: { gap: 12, paddingVertical: 4 },
  trimSlide: {
    height: 240,
    borderRadius: 18,
    overflow: "hidden" as const,
    position: "relative" as const,
  },
  trimImg: { width: "100%" as const, height: 168 },
  trimFooter: { paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  trimRowItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 10,
    borderRadius: 16,
  },
  trimRowImg: { width: 84, height: 84, borderRadius: 12, overflow: "hidden" as const },
  trimRowBody: { flex: 1, gap: 4 },
  trimRowBadge: {
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginTop: 2,
  },
  trimRowCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  trimTitle: { fontSize: 17, fontWeight: "800" as const, letterSpacing: 0.2 },
  trimSub: { fontSize: 12, fontWeight: "600" as const },
  trimBadge: {
    position: "absolute" as const,
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  trimBadgeText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.4 },
  trimSelected: {
    position: "absolute" as const,
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  trimDots: {
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  trimDot: { height: 6, borderRadius: 3 },
  galleryRow: { gap: 8, paddingVertical: 4 },
  galleryItem: {
    width: 116,
    height: 84,
    borderRadius: 12,
    borderWidth: 2,
    overflow: "hidden" as const,
    position: "relative" as const,
  },
  galleryImg: { width: "100%" as const, height: "100%" as const },
  galleryTag: {
    position: "absolute" as const,
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  galleryTagText: { fontSize: 10, fontWeight: "700" as const },
  galleryCount: { fontSize: 11, fontWeight: "600" as const, marginTop: 2 },
  invSpecs: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  segmentWrap: {
    flexDirection: "row" as const,
    gap: 8,
  },
  segment: {
    flex: 1,
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  segmentText: { fontSize: 13, fontWeight: "700" as const },
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 14,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  cardTitle: { fontSize: 15, fontWeight: "800" as const },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardMeta: { fontSize: 11, marginTop: 2 },
  chipRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  chip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "700" as const },
  accRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  accName: { flex: 1, fontSize: 13, fontWeight: "600" as const },
  accCost: { fontSize: 13, fontWeight: "800" as const },
  totalBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  totalLabel: { fontSize: 13, fontWeight: "700" as const },
  totalValue: { fontSize: 20, fontWeight: "800" as const },
  breakdownBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  breakdownRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingVertical: 4,
  },
  breakdownLabel: { fontSize: 12, fontWeight: "600" as const },
  breakdownValue: { fontSize: 13, fontWeight: "800" as const },
  refitNotice: {
    marginTop: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  refitText: { flex: 1, fontSize: 12, fontWeight: "700" as const },
  lockRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  lockTitle: { fontSize: 13, fontWeight: "800" as const },
  lockSub: { fontSize: 11, marginTop: 2 },
  depositHero: {
    padding: 18,
    borderRadius: 16,
    gap: 4,
    alignItems: "flex-start" as const,
  },
  depositLabel: { fontSize: 12, fontWeight: "700" as const, opacity: 0.9 },
  depositValue: { fontSize: 30, fontWeight: "800" as const },
  depositSub: { fontSize: 12, opacity: 0.9 },
  gatewayBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  gatewayIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  gatewayLabel: { fontSize: 11, fontWeight: "600" as const, marginBottom: 2 },
  gatewayName: { fontSize: 13, fontWeight: "800" as const },
  gatewayPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  gatewayPillText: { fontSize: 11, fontWeight: "800" as const },
  primaryBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    height: 52,
    borderRadius: 14,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "800" as const },
  fieldLabel: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6 },
  inputWrap: {
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center" as const,
  },
  input: { fontSize: 14 },
  advisorCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  advisorBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 4,
  },
  advisorName: { fontSize: 18, fontWeight: "800" as const },
  advisorRole: { fontSize: 12, marginBottom: 6 },
  infoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 6,
  },
  infoIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  infoLabel: { fontSize: 12, fontWeight: "600" as const, width: 90 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: "700" as const },
  vsoBox: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  vsoTitle: { fontSize: 14, fontWeight: "800" as const },
  vsoSub: { fontSize: 12, marginTop: 2 },
  uploadBox: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  uploadText: { fontSize: 14, fontWeight: "700" as const },
  uploadHint: { fontSize: 11 },
  vinHero: {
    padding: 18,
    borderRadius: 16,
    alignItems: "flex-start" as const,
    gap: 4,
  },
  vinValue: { fontSize: 22, fontWeight: "800" as const, letterSpacing: 1.5 },
  empty: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center" as const,
  },
  emptyText: { fontSize: 13, textAlign: "center" as const },
  ownerTypeRow: { flexDirection: "row" as const, gap: 8 },
  ownerTypeBtn: {
    flex: 1,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  ownerTypeText: { fontSize: 12, fontWeight: "800" as const, textAlign: "center" as const },
  ownerCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  idUploadBox: {
    marginTop: 4,
    height: 180,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    position: "relative" as const,
  },
  idUploadImg: { width: "100%" as const, height: "100%" as const },
  idUploadEmpty: { alignItems: "center" as const, justifyContent: "center" as const, gap: 6 },
  idReupload: {
    position: "absolute" as const,
    top: 10,
    right: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  idReuploadText: { fontSize: 11, fontWeight: "700" as const },
  extractBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  extractedHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  extractedHeaderText: { fontSize: 12, fontWeight: "700" as const, flex: 1 },
  photoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  photoThumb: { width: 64, height: 64, borderRadius: 12 },
  photoHint: { fontSize: 12, fontWeight: "600" as const, marginTop: 2 },
  footer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderTopWidth: 1,
  },
  footerBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
  },
  footerNext: {},
  footerBtnText: { fontSize: 14, fontWeight: "800" as const },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end" as const,
  },
  modalSheet: {
    padding: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    gap: 14,
  },
  modalHandle: {
    alignSelf: "center" as const,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 4,
  },
  modalTitle: { fontSize: 16, fontWeight: "800" as const },
  modalInputWrap: {
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center" as const,
  },
  modalInput: { fontSize: 15, paddingVertical: 10 },
  modalRow: {
    flexDirection: "row" as const,
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  modalBtnText: { fontSize: 15, fontWeight: "800" as const },
});
