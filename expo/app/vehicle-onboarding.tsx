import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CarFront,
  Hash,
  Palette,
  User as UserIcon,
  ShieldCheck,
  FileCheck2,
  Camera,
} from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminData } from "@/contexts/AdminDataContext";
import VehicleMakeModelPicker, {
  formatVehicleLabel,
  type VehicleSelection,
} from "@/components/VehicleMakeModelPicker";
import VehicleDocsUploader from "@/components/VehicleDocsUploader";
import VehiclePhotosUploader from "@/components/VehiclePhotosUploader";
import {
  fetchUserProfile,
  findOrCreatePartner,
  type PartnerProfileRow,
  type UserProfileRow,
} from "@/utils/partnerOnboardingStore";
import {
  assignVehicleToPartner,
  computeFirstVehicleStep,
  createVehicleStub,
  fetchPartnerIc,
  fetchPartnerVehicle,
  fetchVehicleById,
  findVehicleByPlate,
  patchVehicle,
  type VehicleOnboardingStep,
  type VehiclePhotoSlot,
  type VehicleRow,
} from "@/utils/vehicleOnboardingStore";

const STEPS: { key: VehicleOnboardingStep; label: string }[] = [
  { key: "plate", label: "Plate number" },
  { key: "make-model", label: "Make & model" },
  { key: "year-color", label: "Year & colour" },
  { key: "photos", label: "Photos" },
  { key: "owner", label: "Owner details" },
  { key: "documents", label: "Documents" },
];

export default function VehicleOnboardingScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { authState } = useAuth();
  const { getEntries } = useAdminData();
  const params = useLocalSearchParams<{
    partnerType?: string;
    vehicleId?: string;
    viewStatus?: string;
    addNew?: string;
    resume?: string;
    role?: string;
  }>();

  /** When the screen is opened from the picker for an Incomplete vehicle,
   *  we resume onboarding from the first incomplete step. For non-owners we
   *  first require the owner-ID verification step. */
  const resumeVehicleId = useMemo<string | null>(() => {
    const id = typeof params.vehicleId === "string" ? params.vehicleId.trim() : "";
    const flag = typeof params.resume === "string" && params.resume.length > 0;
    return id && flag ? id : null;
  }, [params.vehicleId, params.resume]);

  const resumeRole = useMemo<"owner" | "driver" | "co-driver" | null>(() => {
    const r = typeof params.role === "string" ? params.role.trim().toLowerCase() : "";
    if (r === "owner" || r === "driver" || r === "co-driver") return r;
    return null;
  }, [params.role]);

  /** When the screen is opened from the vehicle picker's "Add a new vehicle"
   *  button, skip the resume-existing-vehicle logic and start a fresh flow. */
  const isAddNewFlow = useMemo<boolean>(
    () =>
      typeof params.addNew === "string" && params.addNew.trim().length > 0,
    [params.addNew]
  );

  /** When the screen is opened to view an existing vehicle's review status
   *  (from the vehicle picker), we skip the normal onboarding resume logic
   *  and render the status view directly. */
  const viewStatusVehicleId = useMemo<string | null>(() => {
    const id = typeof params.vehicleId === "string" ? params.vehicleId.trim() : "";
    const flag =
      typeof params.viewStatus === "string" && params.viewStatus.length > 0;
    return id && flag ? id : null;
  }, [params.vehicleId, params.viewStatus]);

  /** Resolve the "Vehicle" document-type ids so the docs step only shows
   *  required-documents tagged with Document Type = Vehicle. */
  const vehicleDocTypeIds = useMemo<string[] | undefined>(() => {
    const entries = getEntries("document-type");
    const ids = entries
      .filter((e) => {
        const name = String(e.values.name ?? "").trim().toLowerCase();
        const enabled = Boolean(e.values.enabled ?? true);
        return enabled && name === "vehicle";
      })
      .map((e) => e.id);
    return ids.length > 0 ? ids : undefined;
  }, [getEntries]);

  const partnerTypeParam = useMemo<string>(
    () => (typeof params.partnerType === "string" ? params.partnerType : ""),
    [params.partnerType]
  );

  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [partner, setPartner] = useState<PartnerProfileRow | null>(null);
  const [step, setStep] = useState<VehicleOnboardingStep>("plate");
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);

  // working fields
  const [plateInput, setPlateInput] = useState<string>("");
  const [matchedVehicle, setMatchedVehicle] = useState<VehicleRow | null>(null);
  const [ownerIcOnRecord, setOwnerIcOnRecord] = useState<string | null>(null);
  const [icInput, setIcInput] = useState<string>("");
  const [selection, setSelection] = useState<VehicleSelection | null>(null);
  const [yearInput, setYearInput] = useState<string>("");
  const [colorInput, setColorInput] = useState<string>("");
  const [ownerName, setOwnerName] = useState<string>("");
  const [ownerPhone, setOwnerPhone] = useState<string>("");
  const [ownerIc, setOwnerIc] = useState<string>("");
  const [isOwnVehicle, setIsOwnVehicle] = useState<boolean | null>(null);
  const [docsComplete, setDocsComplete] = useState<boolean>(false);
  const [photosComplete, setPhotosComplete] = useState<boolean>(false);

  const stepIndex = useMemo(
    () => Math.max(0, STEPS.findIndex((s) => s.key === step)),
    [step]
  );

  /** Normalize an IC string for equality comparison (strips spaces/dashes,
   *  lower-cases). */
  const normalizeIc = (s: string | null | undefined): string =>
    (s ?? "").replace(/\s|-/g, "").toLowerCase();

  /** Load profile + partner, decide if we should resume an existing vehicle. */
  const load = useCallback(async () => {
    if (!authState.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const prof = await fetchUserProfile(authState.userId);
      setProfile(prof);
      const part = await findOrCreatePartner(authState.userId, prof);
      setPartner(part);
      setOwnerName(part?.name ?? prof?.name ?? "");
      setOwnerPhone(part?.phone ?? prof?.phone ?? "");

      // View-status mode: load the specific vehicle and jump to the status
      // screen (no resume, no auto-route).
      if (viewStatusVehicleId) {
        const v = await fetchVehicleById(viewStatusVehicleId);
        if (v) {
          hydrateFromVehicle(v);
          setStep("status");
          return;
        }
        // Fall through to normal flow if the vehicle couldn't be loaded.
      }

      // Resume mode (Incomplete vehicle tapped in the picker): jump back
      // into the onboarding flow at the first unfinished step. Non-owners
      // must first verify the owner ID; owners skip that step entirely.
      if (resumeVehicleId) {
        const v = await fetchVehicleById(resumeVehicleId);
        if (v) {
          hydrateFromVehicle(v);
          if (resumeRole && resumeRole !== "owner") {
            // Pre-populate verify-owner state so the existing handler works.
            setMatchedVehicle(v);
            let ic: string | null = null;
            if (v.owner_ic && v.owner_ic.trim()) {
              ic = v.owner_ic.trim();
            } else if (v.owner_partner_id) {
              ic = await fetchPartnerIc(v.owner_partner_id);
            }
            const trimmedIc = ic && ic.trim() ? ic.trim() : null;
            // Skip verify-owner entirely when (a) there's no owner IC on
            // record, or (b) the signed-in user's profile IC matches the
            // owner IC on the vehicle.
            const profileIc = normalizeIc(prof?.ic);
            const matchesProfile =
              !!trimmedIc && !!profileIc && normalizeIc(trimmedIc) === profileIc;
            setOwnerIcOnRecord(matchesProfile ? null : trimmedIc);
            if (trimmedIc && !matchesProfile) {
              console.log("[vehicle-onboarding] resume non-owner -> verify-owner");
              setStep("verify-owner");
              return;
            }
            console.log("[vehicle-onboarding] resume non-owner -> skip verify-owner", {
              hasOwnerIc: !!trimmedIc,
              matchesProfile,
            });
          }
          const next = computeFirstVehicleStep(v);
          console.log("[vehicle-onboarding] resume", { role: resumeRole, next });
          setStep(next === "done" ? "status" : next);
          return;
        }
        // Fall through to normal flow if the vehicle couldn't be loaded.
      }

      // If the partner already has a vehicle assigned, resume from wherever
      // that vehicle's record stopped. Skipped when the user explicitly
      // chose "Add a new vehicle" from the picker.
      if (part && !isAddNewFlow && !resumeVehicleId) {
        const existing = await fetchPartnerVehicle(part.id);
        if (existing) {
          hydrateFromVehicle(existing);
          const next = computeFirstVehicleStep(existing);
          setStep(next);
          if (next === "done") {
            // Already has a complete vehicle — bounce straight to mode.
            routeByPartnerType();
            return;
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [authState.userId, viewStatusVehicleId, isAddNewFlow, resumeVehicleId, resumeRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const hydrateFromVehicle = (v: VehicleRow) => {
    setVehicle(v);
    setPlateInput(v.plate ?? "");
    setSelection(
      v.make || v.model
        ? {
            vehicleType: v.vehicle_type ?? "",
            energyType: "",
            make: v.make ?? "",
            model: v.model ?? "",
            yearFrom: "",
            yearTo: "",
          }
        : null
    );
    setYearInput(v.year ?? "");
    setColorInput(v.color ?? "");
    setOwnerName((prev) => v.owner_name || prev);
    setOwnerPhone((prev) => v.owner_phone || prev);
    setOwnerIc((prev) => v.owner_ic || prev);
    setPhotosComplete(
      Boolean(
        v.image_front?.trim() &&
          v.image_left?.trim() &&
          v.image_right?.trim() &&
          v.image_back?.trim()
      )
    );
  };

  const routeByPartnerType = () => {
    const normalized = partnerTypeParam.trim().toLowerCase();
    // If partnerType wasn't passed through, fall back to the main page
    // (router.back, or replace to "/" if there's nothing to go back to).
    if (!normalized) {
      console.log("[vehicle-onboarding] routeByPartnerType missing partnerType -> back/index");
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/" as never);
      }
      return;
    }
    const target =
      normalized === "teksi" || normalized.includes("taxi")
        ? "/partner-teksi"
        : "/partner-ehailing";
    console.log("[vehicle-onboarding] routeByPartnerType", {
      partnerTypeParam,
      normalized,
      target,
    });
    router.replace(target as never);
  };

  /** Pending-review "Continue": only route to the partner-type screen when
   *  the current vehicle is fully approved. Otherwise fall back to the main
   *  page (router.back, or "/" if there's nothing to go back to). */
  const onPendingContinue = async () => {
    // Always re-fetch the vehicle from the DB before deciding — local state
    // can be stale (e.g. documents_ok set true but a later step still pending),
    // and we want the authoritative answer for resume vs. continue.
    const local = vehicle ?? matchedVehicle;
    let v: VehicleRow | null = local ?? null;
    if (local?.id) {
      setBusy(true);
      try {
        const fresh = await fetchVehicleById(local.id);
        if (fresh) v = fresh;
      } finally {
        setBusy(false);
      }
    }
    const status = String(v?.status ?? "").trim().toLowerCase();
    const permit = String(v?.permit ?? "").trim().toLowerCase();
    const isApproved =
      status === "approved" &&
      (permit === "" || permit === "approved" || permit === "permit-verified");
    // If onboarding isn't actually finished (e.g. stopped at documents),
    // resume at the first incomplete step instead of leaving the flow.
    const next = computeFirstVehicleStep(v);
    console.log("[vehicle-onboarding] onPendingContinue", {
      vehicleId: v?.id,
      status,
      permit,
      isApproved,
      documents_ok: v?.documents_ok,
      image_front: Boolean(v?.image_front),
      image_left: Boolean(v?.image_left),
      image_right: Boolean(v?.image_right),
      image_back: Boolean(v?.image_back),
      next,
    });
    if (next !== "done") {
      if (v) hydrateFromVehicle(v);
      setStep(next);
      return;
    }
    if (isApproved) {
      routeByPartnerType();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/" as never);
    }
  };

  /* -------------------- Step handlers -------------------- */

  const onCheckPlate = async () => {
    const plate = plateInput.trim().toUpperCase();
    if (!plate) {
      Alert.alert("Missing plate", "Please enter a vehicle plate number.");
      return;
    }
    if (!partner) {
      Alert.alert("Not ready", "Couldn't load your partner profile yet.");
      return;
    }
    setBusy(true);
    try {
      const match = await findVehicleByPlate(plate);
      if (match) {
        setMatchedVehicle(match);
        // Look up the IC of the owner (if any partner is on record).
        let ic: string | null = null;
        if (match.owner_ic && match.owner_ic.trim()) {
          ic = match.owner_ic.trim();
        } else if (match.owner_partner_id) {
          ic = await fetchPartnerIc(match.owner_partner_id);
        }
        const trimmedIc = ic && ic.trim() ? ic.trim() : null;
        // If the signed-in user's profile IC matches the owner IC on the
        // vehicle, treat it as "no verification needed" so the claim path
        // bypasses verify-owner.
        const profileIc = normalizeIc(profile?.ic);
        const matchesProfile =
          !!trimmedIc && !!profileIc && normalizeIc(trimmedIc) === profileIc;
        setOwnerIcOnRecord(matchesProfile ? null : trimmedIc);
        if (matchesProfile) {
          console.log("[vehicle-onboarding] onCheckPlate -> profile IC matches, will skip verify-owner");
        }
        setStep("confirm-existing");
        return;
      }
      // No record → create a stub and start registration at make-model.
      const { row: stub, error: stubError } = await createVehicleStub(
        plate,
        partner.name ?? "",
        partner.phone ?? "",
        partner.id,
        partner.display_id ?? null,
        authState.userId ?? null
      );
      if (!stub) {
        Alert.alert(
          "Couldn't start",
          stubError
            ? `Failed to create a vehicle record.\n\n${stubError}`
            : "Failed to create a vehicle record. Please try again."
        );
        return;
      }
      hydrateFromVehicle(stub);
      setStep("make-model");
    } finally {
      setBusy(false);
    }
  };

  const onUseExistingYes = async () => {
    if (!matchedVehicle || !partner) return;
    if (ownerIcOnRecord) {
      setStep("verify-owner");
      return;
    }
    // No owner IC on record — claim and resume where it stopped.
    setBusy(true);
    try {
      const ok = await assignVehicleToPartner(
        matchedVehicle.id,
        partner.id,
        partner.display_id ?? null,
        authState.userId ?? null
      );
      if (!ok) {
        Alert.alert("Couldn't assign", "Please try again.");
        return;
      }
      const claimed: VehicleRow = {
        ...matchedVehicle,
        owner_partner_id: partner.id,
        owner_partner_display_id: partner.display_id ?? null,
        auth_user_id: authState.userId ?? null,
      };
      hydrateFromVehicle(claimed);
      const next = computeFirstVehicleStep(claimed);
      setStep(next);
      if (next === "done") finalize(claimed);
    } finally {
      setBusy(false);
    }
  };

  const onUseExistingNo = () => {
    // User said no — go back to plate entry.
    setMatchedVehicle(null);
    setOwnerIcOnRecord(null);
    setStep("plate");
  };

  const onVerifyOwner = async () => {
    if (!matchedVehicle || !partner) return;
    const typed = icInput.trim();
    const expected = (ownerIcOnRecord ?? "").trim();
    if (!typed) {
      Alert.alert("Missing ID", "Please enter the owner's ID number.");
      return;
    }
    if (typed.replace(/\s|-/g, "").toLowerCase() !== expected.replace(/\s|-/g, "").toLowerCase()) {
      Alert.alert(
        "ID doesn't match",
        "The ID number you entered doesn't match the owner of this vehicle."
      );
      return;
    }
    setBusy(true);
    try {
      const ok = await assignVehicleToPartner(
        matchedVehicle.id,
        partner.id,
        partner.display_id ?? null,
        authState.userId ?? null
      );
      if (!ok) {
        Alert.alert("Couldn't assign", "Please try again.");
        return;
      }
      const claimed: VehicleRow = {
        ...matchedVehicle,
        owner_partner_id: partner.id,
        owner_partner_display_id: partner.display_id ?? null,
        owner_ic: typed,
        auth_user_id: authState.userId ?? null,
      };
      hydrateFromVehicle(claimed);
      // Resume at the first incomplete step instead of jumping to the
      // "Pending review" done screen — that screen is only valid when the
      // whole onboarding is finished.
      const next = computeFirstVehicleStep(claimed);
      console.log("[vehicle-onboarding] onVerifyOwner resume step", next);
      setStep(next);
      if (next === "done") finalize(claimed);
    } finally {
      setBusy(false);
    }
  };

  const onSaveMakeModel = async () => {
    if (!vehicle) return;
    if (!selection) {
      Alert.alert("Pick a vehicle", "Please select a make and model.");
      return;
    }
    setBusy(true);
    try {
      const patch = {
        make: selection.make,
        model: selection.model,
        vehicle_type: selection.vehicleType || null,
        onboarding_step: "year-color",
      };
      const ok = await patchVehicle(vehicle.id, patch);
      if (!ok) return;
      const next = { ...vehicle, ...patch } as VehicleRow;
      setVehicle(next);
      setStep("year-color");
    } finally {
      setBusy(false);
    }
  };

  const onSaveYearColor = async () => {
    if (!vehicle) return;
    const y = yearInput.trim();
    const c = colorInput.trim();
    if (!y || !c) {
      Alert.alert("Missing info", "Please enter both year and colour.");
      return;
    }
    setBusy(true);
    try {
      const ok = await patchVehicle(vehicle.id, { year: y, color: c, onboarding_step: "photos" });
      if (!ok) return;
      const next = { ...vehicle, year: y, color: c } as VehicleRow;
      setVehicle(next);
      setStep("photos");
    } finally {
      setBusy(false);
    }
  };

  const onSaveOwner = async () => {
    if (!vehicle || !partner) return;
    if (isOwnVehicle === null) {
      Alert.alert("Select an option", "Please tell us whether this is your own vehicle.");
      return;
    }
    const n = ownerName.trim();
    const p = ownerPhone.trim();
    const ic = ownerIc.trim();
    if (!n || !p || !ic) {
      Alert.alert("Missing info", "Please enter owner name, phone and ID number.");
      return;
    }
    setBusy(true);
    try {
      const patch: Partial<VehicleRow> = {
        owner_name: n,
        owner_phone: p,
        owner_ic: ic,
        owner_partner_id: partner.id,
        owner_partner_display_id: partner.display_id ?? null,
        auth_user_id: authState.userId ?? null,
        onboarding_step: "documents",
      };
      const ok = await patchVehicle(vehicle.id, patch);
      if (!ok) {
        Alert.alert("Couldn't save", "Failed to save owner details. Please try again.");
        return;
      }
      // Re-fetch to confirm the record is committed and hydrate the latest row.
      const fresh = await fetchVehicleById(vehicle.id);
      if (fresh) {
        hydrateFromVehicle(fresh);
      } else {
        setVehicle((prev) => (prev ? ({ ...prev, ...patch } as VehicleRow) : prev));
      }
      console.log("[vehicle-onboarding] onSaveOwner committed vehicle", vehicle.id);
      setStep("documents");
    } finally {
      setBusy(false);
    }
  };

  /** Toggle the "is this your own vehicle?" question. Yes -> autofill from
   *  the partner/profile record. No -> clear the fields so the user types
   *  the actual owner's details. */
  const onSelectOwnVehicle = (own: boolean) => {
    setIsOwnVehicle(own);
    if (own) {
      setOwnerName((partner?.name ?? profile?.name ?? "").trim());
      setOwnerPhone((partner?.phone ?? profile?.phone ?? "").trim());
      setOwnerIc((partner?.ic ?? profile?.ic ?? "").trim());
    } else {
      setOwnerName("");
      setOwnerPhone("");
      setOwnerIc("");
    }
  };

  const onSaveDocuments = async () => {
    if (!vehicle) return;
    setBusy(true);
    try {
      const patch: Partial<VehicleRow> = {
        documents_ok: true,
        onboarding_step: "done",
      };
      const ok = await patchVehicle(vehicle.id, patch);
      if (!ok) {
        Alert.alert("Couldn't save", "Failed to save documents. Please try again.");
        return;
      }
      // Re-fetch to confirm the record is committed before finalizing.
      const fresh = await fetchVehicleById(vehicle.id);
      const next = fresh ?? ({ ...vehicle, ...patch } as VehicleRow);
      if (fresh) hydrateFromVehicle(fresh);
      else setVehicle(next);
      console.log("[vehicle-onboarding] onSaveDocuments committed vehicle", vehicle.id);
      finalize(next);
    } finally {
      setBusy(false);
    }
  };

  const onPhotoUploaded = useCallback(
    async (slot: VehiclePhotoSlot, url: string) => {
      if (!vehicle) return;
      const column =
        slot === "front"
          ? "image_front"
          : slot === "left"
          ? "image_left"
          : slot === "right"
          ? "image_right"
          : "image_back";
      const patch: Partial<VehicleRow> = { [column]: url } as Partial<VehicleRow>;
      await patchVehicle(vehicle.id, patch);
      setVehicle((prev) => (prev ? ({ ...prev, ...patch } as VehicleRow) : prev));
    },
    [vehicle]
  );

  const onSavePhotos = async () => {
    if (!vehicle) return;
    const front = (vehicle.image_front ?? "").trim();
    const left = (vehicle.image_left ?? "").trim();
    const right = (vehicle.image_right ?? "").trim();
    const back = (vehicle.image_back ?? "").trim();
    if (!front || !left || !right || !back) {
      Alert.alert(
        "Missing photos",
        "Please upload all four vehicle photos (front, left, right, back) before continuing."
      );
      return;
    }
    setBusy(true);
    try {
      // Commit the full photo set + onboarding_step to Supabase in a single
      // write so the vehicle record is persisted before moving to owner details.
      const patch: Partial<VehicleRow> = {
        image_front: front,
        image_left: left,
        image_right: right,
        image_back: back,
        onboarding_step: "owner",
      };
      const ok = await patchVehicle(vehicle.id, patch);
      if (!ok) {
        Alert.alert(
          "Couldn't save",
          "Failed to save vehicle photos. Please try again."
        );
        return;
      }
      // Re-fetch to confirm the record is committed and hydrate the latest row.
      const fresh = await fetchVehicleById(vehicle.id);
      if (fresh) {
        hydrateFromVehicle(fresh);
      } else {
        setVehicle((prev) => (prev ? ({ ...prev, ...patch } as VehicleRow) : prev));
      }
      console.log("[vehicle-onboarding] onSavePhotos committed vehicle", vehicle.id);
      setStep("owner");
    } finally {
      setBusy(false);
    }
  };

  const finalize = (_v: VehicleRow) => {
    setStep("done");
  };

  /** Friendly approval state derived from the vehicle row. */
  const approvalState = useMemo<{
    label: string;
    tone: "approved" | "pending" | "rejected" | "blocked";
    description: string;
  }>(() => {
    const v = vehicle;
    const s = String(v?.status ?? "").toLowerCase();
    const p = String(v?.permit ?? "").toLowerCase();
    if (s === "blocked") {
      return {
        label: "Blocked",
        tone: "blocked",
        description: "This vehicle has been blocked. Please contact support.",
      };
    }
    if (s === "rejected" || p === "rejected") {
      return {
        label: "Rejected",
        tone: "rejected",
        description:
          "Your vehicle submission was rejected. Please review the rejected documents below and re-upload them.",
      };
    }
    if (s === "approved" && (p === "approved" || p === "verified") && v?.documents_ok) {
      return {
        label: "Approved",
        tone: "approved",
        description:
          "This vehicle has been approved and is ready to use.",
      };
    }
    return {
      label: "Pending admin review",
      tone: "pending",
      description:
        "Our team is reviewing your vehicle details and documents. You'll be notified once it's approved.",
    };
  }, [vehicle]);

  /* -------------------- Render helpers -------------------- */

  const renderStepper = () => (
    <View style={styles.stepper}>
      {STEPS.map((s, idx) => {
        const done = idx < stepIndex;
        const active = idx === stepIndex;
        const color = done ? Colors.accent : active ? Colors.accent : Colors.border;
        return (
          <React.Fragment key={s.key}>
            <View style={styles.stepDotWrap}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: done ? Colors.accent : active ? Colors.accent + "20" : "transparent",
                    borderColor: color,
                  },
                ]}
              >
                {done ? (
                  <Check color={Colors.secondary} size={12} />
                ) : (
                  <Text style={[styles.stepDotText, { color: active ? Colors.accent : Colors.textSecondary }]}>
                    {idx + 1}
                  </Text>
                )}
              </View>
            </View>
            {idx < STEPS.length - 1 ? (
              <View style={[styles.stepLine, { backgroundColor: done ? Colors.accent : Colors.border }]} />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );

  const renderBody = () => {
    switch (step) {
      case "plate":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Vehicle plate number</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              We&apos;ll check if this vehicle already exists in our records.
            </Text>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Plate number</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Hash color={Colors.textSecondary} size={16} />
              <TextInput
                value={plateInput}
                onChangeText={setPlateInput}
                placeholder="e.g. WPK 1234"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                autoCapitalize="characters"
                testID="veh-onboard-plate"
              />
            </View>
            <TouchableOpacity
              onPress={onCheckPlate}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="veh-onboard-check-plate"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "confirm-existing":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>This vehicle exists</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              We found a record matching plate {plateInput.trim().toUpperCase()}.
            </Text>
            <View style={[styles.vehCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <View style={[styles.vehIcon, { backgroundColor: Colors.accent + "20" }]}>
                <CarFront color={Colors.accent} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.vehTitle, { color: Colors.text }]} numberOfLines={1}>
                  {[matchedVehicle?.make, matchedVehicle?.model].filter(Boolean).join(" ") || "Unnamed vehicle"}
                </Text>
                <Text style={[styles.vehMeta, { color: Colors.textSecondary }]} numberOfLines={2}>
                  {matchedVehicle?.plate}
                  {matchedVehicle?.color ? ` · ${matchedVehicle.color}` : ""}
                  {matchedVehicle?.year ? ` · ${matchedVehicle.year}` : ""}
                </Text>
                {matchedVehicle?.owner_name ? (
                  <Text style={[styles.vehMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    Owner: {matchedVehicle.owner_name}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={[styles.questionText, { color: Colors.text }]}>
              Do you want to use this vehicle?
            </Text>
            <TouchableOpacity
              onPress={onUseExistingYes}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="veh-onboard-use-yes"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Yes, use this vehicle</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onUseExistingNo}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: Colors.border }]}
              testID="veh-onboard-use-no"
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>No, enter a different plate</Text>
            </TouchableOpacity>
          </View>
        );
      case "verify-owner":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Verify owner ID</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              This vehicle has an owner on record. Enter the owner&apos;s ID number to claim it.
            </Text>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Owner ID number</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <ShieldCheck color={Colors.textSecondary} size={16} />
              <TextInput
                value={icInput}
                onChangeText={setIcInput}
                placeholder="e.g. 900101-10-1234"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                autoCapitalize="characters"
                testID="veh-onboard-owner-ic"
              />
            </View>
            <TouchableOpacity
              onPress={onVerifyOwner}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="veh-onboard-verify"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Verify & claim</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onUseExistingNo}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: Colors.border, marginTop: 8 }]}
              testID="veh-onboard-verify-cancel"
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );
      case "make-model":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Make &amp; model</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Tell us what kind of vehicle this is.
            </Text>
            <VehicleMakeModelPicker
              value={selection}
              onChange={setSelection}
              testID="veh-onboard-makemodel"
            />
            {selection ? (
              <Text style={[styles.helperText, { color: Colors.textSecondary, marginTop: 8 }]}>
                Selected: {formatVehicleLabel(selection)}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={onSaveMakeModel}
              disabled={busy || !selection}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy || !selection ? 0.5 : 1, marginTop: 16 }]}
              testID="veh-onboard-save-makemodel"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "year-color":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Year &amp; colour</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              These help riders recognise your vehicle.
            </Text>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Year</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <CarFront color={Colors.textSecondary} size={16} />
              <TextInput
                value={yearInput}
                onChangeText={setYearInput}
                placeholder="e.g. 2023"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                keyboardType="number-pad"
                maxLength={4}
                testID="veh-onboard-year"
              />
            </View>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Colour</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <Palette color={Colors.textSecondary} size={16} />
              <TextInput
                value={colorInput}
                onChangeText={setColorInput}
                placeholder="e.g. White"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                testID="veh-onboard-color"
              />
            </View>
            <TouchableOpacity
              onPress={onSaveYearColor}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent, opacity: busy ? 0.6 : 1 }]}
              testID="veh-onboard-save-yearcolor"
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "documents":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Vehicle documents</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Upload the registration, road tax, insurance, and any other required documents for this vehicle.
            </Text>
            {vehicle && partner ? (
              <VehicleDocsUploader
                vehicleId={vehicle.id}
                partnerId={partner.id}
                authUserId={authState.userId ?? null}
                countries={partner.service_countries ?? []}
                states={(partner.service_states ?? []).map((s) => {
                  const [country, state] = String(s).split("|");
                  return { country: country ?? "", state: state ?? "" };
                })}
                docTypeIds={vehicleDocTypeIds}
                onCompletionChange={setDocsComplete}
                title="Required vehicle documents"
                testID="veh-onboard-docs"
              />
            ) : (
              <View style={[styles.vehCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <FileCheck2 color={Colors.textSecondary} size={20} />
                <Text style={[styles.vehMeta, { color: Colors.textSecondary, flex: 1 }]}>
                  Loading vehicle…
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={onSaveDocuments}
              disabled={busy || !docsComplete}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: busy || !docsComplete ? 0.5 : 1,
                  marginTop: 16,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save documents"
              testID="veh-onboard-save-docs"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>
                  {docsComplete ? "Finish" : "Upload required documents to continue"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "photos":
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Vehicle photos</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Add a clear photo for each side of the vehicle: front, left, right and back.
            </Text>
            {vehicle ? (
              <VehiclePhotosUploader
                vehicleId={vehicle.id}
                initial={vehicle}
                onPhotoUploaded={onPhotoUploaded}
                onCompletionChange={setPhotosComplete}
                testID="veh-onboard-photos"
              />
            ) : (
              <View style={[styles.vehCard, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
                <Camera color={Colors.textSecondary} size={20} />
                <Text style={[styles.vehMeta, { color: Colors.textSecondary, flex: 1 }]}>
                  Loading vehicle…
                </Text>
              </View>
            )}
            <TouchableOpacity
              onPress={onSavePhotos}
              disabled={busy || !photosComplete}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: busy || !photosComplete ? 0.5 : 1,
                  marginTop: 16,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save photos"
              testID="veh-onboard-save-photos"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>
                  {photosComplete ? "Continue" : "Add all four photos to continue"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        );
      case "owner": {
        const allFilled =
          ownerName.trim().length > 0 &&
          ownerPhone.trim().length > 0 &&
          ownerIc.trim().length > 0;
        const canContinue = isOwnVehicle !== null && allFilled;
        return (
          <View>
            <Text style={[styles.title, { color: Colors.text }]}>Owner details</Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>
              Confirm who owns and operates this vehicle.
            </Text>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Is this your own vehicle?</Text>
            <View style={styles.row2}>
              <TouchableOpacity
                onPress={() => onSelectOwnVehicle(true)}
                style={[
                  styles.choiceBtn,
                  {
                    backgroundColor:
                      isOwnVehicle === true ? Colors.accent + "20" : Colors.gray[100],
                    borderColor:
                      isOwnVehicle === true ? Colors.accent : Colors.border,
                  },
                ]}
                testID="veh-onboard-own-yes"
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.choiceText,
                    { color: isOwnVehicle === true ? Colors.accent : Colors.text },
                  ]}
                >
                  Yes, it&apos;s mine
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onSelectOwnVehicle(false)}
                style={[
                  styles.choiceBtn,
                  {
                    backgroundColor:
                      isOwnVehicle === false ? Colors.accent + "20" : Colors.gray[100],
                    borderColor:
                      isOwnVehicle === false ? Colors.accent : Colors.border,
                  },
                ]}
                testID="veh-onboard-own-no"
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.choiceText,
                    { color: isOwnVehicle === false ? Colors.accent : Colors.text },
                  ]}
                >
                  No, someone else
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Owner name</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <UserIcon color={Colors.textSecondary} size={16} />
              <TextInput
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="Full name"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                testID="veh-onboard-owner-name"
              />
            </View>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Owner phone</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <UserIcon color={Colors.textSecondary} size={16} />
              <TextInput
                value={ownerPhone}
                onChangeText={setOwnerPhone}
                placeholder="+60 12-345 6789"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                keyboardType="phone-pad"
                testID="veh-onboard-owner-phone"
              />
            </View>
            <Text style={[styles.label, { color: Colors.textSecondary }]}>Owner ID number</Text>
            <View style={[styles.inputWrap, { backgroundColor: Colors.gray[100], borderColor: Colors.border }]}>
              <ShieldCheck color={Colors.textSecondary} size={16} />
              <TextInput
                value={ownerIc}
                onChangeText={setOwnerIc}
                placeholder="e.g. 900101-10-1234"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.inputFlex, { color: Colors.text }]}
                autoCapitalize="characters"
                testID="veh-onboard-owner-ic"
              />
            </View>
            <TouchableOpacity
              onPress={onSaveOwner}
              disabled={busy || !canContinue}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: Colors.accent,
                  opacity: busy || !canContinue ? 0.5 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save owner details"
              testID="veh-onboard-save-owner"
            >
              {busy ? (
                <ActivityIndicator color={Colors.secondary} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>
                  {isOwnVehicle === null
                    ? "Select an option to continue"
                    : allFilled
                    ? "Continue"
                    : "Fill in all fields to continue"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        );
      }
      case "status": {
        const toneColor =
          approvalState.tone === "approved"
            ? "#10b981"
            : approvalState.tone === "rejected" || approvalState.tone === "blocked"
            ? "#ef4444"
            : "#f59e0b";
        return (
          <View>
            <View style={[styles.doneIconWrap, { backgroundColor: toneColor + "20", alignSelf: "center" }]}>
              <ShieldCheck color={toneColor} size={32} />
            </View>
            <Text style={[styles.title, { color: Colors.text, textAlign: "center" }]}>
              {vehicle?.plate || "Vehicle"}
            </Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary, textAlign: "center" }]}>
              {[vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "\u2014"}
              {vehicle?.color ? `  \u00b7  ${vehicle.color}` : ""}
              {vehicle?.year ? `  \u00b7  ${vehicle.year}` : ""}
            </Text>
            <View
              style={[
                styles.approvalCard,
                { backgroundColor: toneColor + "12", borderColor: toneColor + "55" },
              ]}
            >
              <View style={[styles.approvalDot, { backgroundColor: toneColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.approvalLabel, { color: toneColor }]}>
                  {approvalState.label}
                </Text>
                <Text style={[styles.approvalDesc, { color: Colors.textSecondary }]}>
                  {approvalState.description}
                </Text>
              </View>
            </View>
            {vehicle && partner ? (
              <VehicleDocsUploader
                vehicleId={vehicle.id}
                partnerId={partner.id}
                authUserId={authState.userId ?? null}
                countries={partner.service_countries ?? []}
                states={(partner.service_states ?? []).map((s) => {
                  const [country, state] = String(s).split("|");
                  return { country: country ?? "", state: state ?? "" };
                })}
                docTypeIds={vehicleDocTypeIds}
                title="Uploaded documents"
                subtitle="Tap any rejected or missing document to re-upload."
                testID="veh-status-docs"
              />
            ) : null}
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.secondaryBtn, { borderColor: Colors.border, marginTop: 16 }]}
              testID="veh-status-back"
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Close</Text>
            </TouchableOpacity>
          </View>
        );
      }
      case "done":
      default:
        return (
          <View style={styles.center}>
            <View style={[styles.doneIconWrap, { backgroundColor: Colors.accent + "20" }]}>
              <ShieldCheck color={Colors.accent} size={36} />
            </View>
            <Text style={[styles.title, { color: Colors.text, textAlign: "center" }]}>
              Pending admin review & approval
            </Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary, textAlign: "center" }]}>
              {vehicle?.plate || matchedVehicle?.plate} has been submitted. Our team will review your vehicle details, documents and photos. You&apos;ll be notified once it&apos;s approved.
            </Text>
            <TouchableOpacity
              onPress={onPendingContinue}
              style={[styles.primaryBtn, { backgroundColor: Colors.accent }]}
              testID="veh-onboard-continue"
              accessibilityRole="button"
            >
              <View style={styles.row}>
                <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Continue</Text>
                <ChevronRight color={Colors.secondary} size={18} />
              </View>
            </TouchableOpacity>
          </View>
        );
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
          <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>
            Loading vehicle setup…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!authState.userId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}>
          <Text style={[styles.title, { color: Colors.text }]}>Please sign in first</Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: Colors.accent }]} accessibilityRole="button">
            <Text style={[styles.primaryBtnText, { color: Colors.onAccent }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentLabel = STEPS[stepIndex]?.label ?? "All done";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="veh-onboard-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={20} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Add vehicle</Text>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            {step === "done"
              ? "All done"
              : `Step ${Math.min(stepIndex + 1, STEPS.length)} of ${STEPS.length} · ${currentLabel}`}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {renderStepper()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderBody()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  loadingText: { fontSize: 13, marginTop: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  stepDotWrap: { alignItems: "center" },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: { fontSize: 11, fontWeight: "700" as const },
  stepLine: { flex: 1, height: 2, marginHorizontal: 4 },
  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: "800" as const, marginBottom: 6 },
  subtitle: { fontSize: 13, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600" as const, marginBottom: 6, marginTop: 4 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  inputFlex: { flex: 1, fontSize: 15, paddingVertical: 0 },
  helperText: { fontSize: 12 },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "800" as const },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed" as const,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" as const },
  vehCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  vehIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  vehTitle: { fontSize: 15, fontWeight: "700" as const, marginBottom: 2 },
  vehMeta: { fontSize: 12 },
  questionText: { fontSize: 15, fontWeight: "700" as const, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  row2: { flexDirection: "row", gap: 10, marginBottom: 8 },
  choiceBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: { fontSize: 14, fontWeight: "700" as const },
  doneIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  approvalCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    marginBottom: 16,
  },
  approvalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  approvalLabel: {
    fontSize: 14,
    fontWeight: "800" as const,
    marginBottom: 4,
  },
  approvalDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
});
