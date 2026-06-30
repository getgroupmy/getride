import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  Mail,
  Phone,
  Shield,
  KeyRound,
  Check,
  ShieldCheck,
  AlertTriangle,
  ScanFace,
  Globe2,
  IdCard,
  MapPin,
  Lock,
  ScanLine,
  X,
  Search,
} from "lucide-react-native";
import { Country } from "country-state-city";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, isSupabaseConfigured } from "@/utils/supabase";
import * as FileSystem from "expo-file-system/legacy";
import { decode as decodeBase64 } from "base64-arraybuffer";

type GenderValue = "male" | "female" | "other" | "";
type IdTypeValue = "passport" | "national_id" | "driver_license" | "other" | "";

interface ProfileForm {
  name: string;
  email: string;
  avatar: string;
  country: string;
  idNumber: string;
  address: string;
  idImage: string;
  gender: GenderValue;
  idType: IdTypeValue;
  birthDate: string;
}

/**
 * Edit profile screen. Reached by tapping the avatar on the profile screen.
 * Lets the signed-in user update their name, email, and avatar.
 */
export default function EditProfileScreen() {
  const router = useRouter();
  const Colors = useColors();
  const styles = makeStyles(Colors);
  const {
    authState,
    profile,
    updateProfile,
    refreshProfile,
    isSupabaseSession,
    signInTestAccountToSupabase,
    isTestAccountPhone,
    hasPinSet,
    forgotPin,
  } = useAuth();
  const { numberChanged, verified, phoneNumber: changedPhone } = useLocalSearchParams<{ numberChanged?: string; verified?: string; phoneNumber?: string }>();
  const showNumberChangedBanner = numberChanged === "true";
  const numberWasPinVerified = verified === "true";
  const [phonePersisted, setPhonePersisted] = useState<boolean>(false);
  const [phonePersistError, setPhonePersistError] = useState<string | null>(null);

  // Seed from the cached profile so the form renders instantly with whatever
  // we already know, then the Supabase fetch below refines it.
  const normalizeGender = (g: unknown): GenderValue => {
    const v = String(g ?? "").trim().toLowerCase();
    if (v === "male" || v === "m") return "male";
    if (v === "female" || v === "f") return "female";
    if (v === "other" || v === "x") return "other";
    return "";
  };
  const normalizeBirthDate = (d: unknown): string => {
    const s = String(d ?? "").trim();
    if (!s) return "";
    // Already ISO
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    // YYYY/MM/DD
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    // DD MMM YYYY (e.g. 12 JAN 1990)
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
    };
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})$/);
    if (m) {
      const mo = months[m[2].toLowerCase()];
      if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, "0")}`;
    }
    return "";
  };
  const normalizeIdType = (t: unknown): IdTypeValue => {
    const v = String(t ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (v === "passport") return "passport";
    if (v === "national_id" || v === "nric" || v === "ic" || v === "id_card") return "national_id";
    if (v === "driver_license" || v === "drivers_license" || v === "driving_license" || v === "dl") return "driver_license";
    if (v === "other") return "other";
    return "";
  };
  const seed: ProfileForm = {
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    avatar: profile?.avatar_url ?? profile?.profile_image ?? "",
    country: profile?.nationality ?? "",
    idNumber: profile?.ic ?? "",
    address: profile?.address ?? "",
    idImage: profile?.id_image ?? "",
    gender: normalizeGender((profile as unknown as { gender?: string } | null)?.gender),
    idType: normalizeIdType((profile as unknown as { id_type?: string } | null)?.id_type),
    birthDate: normalizeBirthDate((profile as unknown as { birth_date?: string } | null)?.birth_date),
  };
  const [form, setForm] = useState<ProfileForm>(seed);
  const [initial, setInitial] = useState<ProfileForm>(seed);
  const [loading, setLoading] = useState<boolean>(!profile);
  const [saving, setSaving] = useState<boolean>(false);
  const [verifyingFace, setVerifyingFace] = useState<boolean>(false);
  const [challengeStep, setChallengeStep] = useState<"idle" | "neutral" | "challenge" | "verifying">("idle");
  const [challengeLabel, setChallengeLabel] = useState<string>("");
  const [countryPickerOpen, setCountryPickerOpen] = useState<boolean>(false);
  const [countryQuery, setCountryQuery] = useState<string>("");
  const [scanningId, setScanningId] = useState<boolean>(false);
  const [scanStep, setScanStep] = useState<string>("");

  const allCountries = React.useMemo(() => Country.getAllCountries(), []);
  const filteredCountries = React.useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter((c) => c.name.toLowerCase().includes(q));
  }, [countryQuery, allCountries]);

  const loadProfile = React.useCallback(async () => {
    try {
      // Refresh the shared profile cache so values stay in sync across screens.
      await refreshProfile();
      if (isSupabaseConfigured && supabase && authState.userId) {
        const { data, error } = await supabase
          .from("profiles")
          .select("name, email, avatar_url, nationality, ic, address, id_image, gender, id_type, birth_date")
          .eq("id", authState.userId)
          .maybeSingle();
        if (!error && data) {
          const row = data as {
            name?: string | null;
            email?: string | null;
            avatar_url?: string | null;
            nationality?: string | null;
            ic?: string | null;
            address?: string | null;
            id_image?: string | null;
            gender?: string | null;
            id_type?: string | null;
            birth_date?: string | null;
          };
          const next: ProfileForm = {
            name: row.name ?? "",
            email: row.email ?? "",
            avatar: row.avatar_url ?? "",
            country: row.nationality ?? "",
            idNumber: row.ic ?? "",
            address: row.address ?? "",
            idImage: row.id_image ?? "",
            gender: normalizeGender(row.gender),
            idType: normalizeIdType(row.id_type),
            birthDate: normalizeBirthDate(row.birth_date),
          };
          setForm((prev) => (prev.name || prev.email || prev.avatar || prev.country || prev.idNumber ? prev : next));
          setInitial(next);
        }
      }
    } catch (e) {
      console.log("[edit-profile] load error", e);
    } finally {
      setLoading(false);
    }
  }, [authState.userId, refreshProfile]);

  useEffect(() => {
    if (!showNumberChangedBanner || !changedPhone || phonePersisted) return;
    let cancelled = false;
    (async () => {
      try {
        const ok = await updateProfile({ phone: changedPhone });
        if (cancelled) return;
        if (ok) {
          setPhonePersisted(true);
          setPhonePersistError(null);
          // Re-run profile load so the displayed phone reflects the new value
          // immediately, without the user having to back out and return.
          await loadProfile();
          try {
            await AsyncStorage.setItem(
              "profile.phoneSyncToast",
              JSON.stringify({ phone: changedPhone, ts: Date.now() })
            );
          } catch (err) {
            console.log("[edit-profile] toast flag set error", err);
          }
        } else {
          setPhonePersistError("Couldn't sync new number. Tap to retry.");
        }
      } catch (e) {
        if (!cancelled) setPhonePersistError("Couldn't sync new number. Tap to retry.");
        console.log("[edit-profile] persist phone error", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNumberChangedBanner, changedPhone, phonePersisted, updateProfile, loadProfile]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // When the cached profile updates (e.g. refreshProfile() resolves), reflect
  // any new values into the form — but only fields the user hasn't edited yet.
  useEffect(() => {
    if (!profile) return;
    const cachedGender = normalizeGender((profile as unknown as { gender?: string }).gender);
    const cachedIdType = normalizeIdType((profile as unknown as { id_type?: string }).id_type);
    const cachedBirthDate = normalizeBirthDate((profile as unknown as { birth_date?: string }).birth_date);
    setInitial({
      name: profile.name ?? "",
      email: profile.email ?? "",
      avatar: profile.avatar_url ?? profile.profile_image ?? "",
      country: profile.nationality ?? "",
      idNumber: profile.ic ?? "",
      address: profile.address ?? "",
      idImage: profile.id_image ?? "",
      gender: cachedGender,
      idType: cachedIdType,
      birthDate: cachedBirthDate,
    });
    setForm((prev) => ({
      name: prev.name || (profile.name ?? ""),
      email: prev.email || (profile.email ?? ""),
      avatar: prev.avatar || (profile.avatar_url ?? profile.profile_image ?? ""),
      country: prev.country || (profile.nationality ?? ""),
      idNumber: prev.idNumber || (profile.ic ?? ""),
      address: prev.address || (profile.address ?? ""),
      idImage: prev.idImage || (profile.id_image ?? ""),
      gender: prev.gender || cachedGender,
      idType: prev.idType || cachedIdType,
      birthDate: prev.birthDate || cachedBirthDate,
    }));
  }, [profile]);

  const dirty =
    form.name !== initial.name ||
    form.email !== initial.email ||
    form.avatar !== initial.avatar ||
    form.country !== initial.country ||
    form.idNumber !== initial.idNumber ||
    form.address !== initial.address ||
    form.idImage !== initial.idImage ||
    form.gender !== initial.gender ||
    form.idType !== initial.idType ||
    form.birthDate !== initial.birthDate;

  /**
   * Capture a photo of the user's passport or national ID, then call the
   * Toolkit LLM to OCR the document. We extract the ID/passport number plus
   * (when present) the printed address, and verify the document looks real.
   * On success we lock the ID number + address into the form — they can only
   * be changed by re-running this scan.
   */
  const scanIdDocument = async () => {
    try {
      if (Platform.OS === "web") {
        Alert.alert("Camera required", "ID scanning isn't supported on web. Please use the mobile app.");
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission needed", "Allow camera access to scan your passport or ID.");
        return;
      }
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Scan your ID or Passport",
          "Place your passport or government-issued ID on a flat, well-lit surface. Make sure ALL edges are visible and text is sharp.\n\nThe number and address will be extracted and locked once verified.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Open camera", onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) return;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.5,
        base64: true,
        exif: false,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      const mime = asset.mimeType ?? "image/jpeg";
      const dataUri = asset.base64 ? `data:${mime};base64,${asset.base64}` : asset.uri;

      setScanningId(true);
      setScanStep("Reading document…");

      const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com";
      const res = await fetch(`${toolkitUrl}/text/llm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are an OCR + validator for passport / national-ID photos. Reject anything that isn't a real, photographed government-issued identity document (no screens, no printouts of digital scans, no hand-drawn fakes). When valid, extract the document number EXACTLY as printed, the holder's printed address if present, the holder's gender / sex as printed on the document (map M/Male -> \"male\", F/Female -> \"female\", anything else / X -> \"other\", or null if not printed), the holder's date of birth in ISO 8601 format YYYY-MM-DD (convert from any printed format such as DD/MM/YYYY, DD MMM YYYY, or YYYY-MM-DD; return null if not printed or unreadable), and the holder's name EXACTLY as printed on the document. If the document shows separate \"First Name\" / \"Given Names\" and \"Last Name\" / \"Surname\" / \"Family Name\" fields, return them separately as firstName and lastName (do NOT swap the order even if surname appears first on the document). Also return the combined name as firstName + space + lastName in \"First Last\" order (e.g. last name Jones + first name Indiana -> name \"Indiana Jones\"). If only a single full-name line is printed, put the whole thing in name and leave firstName/lastName null. Use normal capitalization; preserve diacritics; do NOT include titles, document labels, or machine-readable zone characters; return null for any unreadable field. Respond ONLY with compact JSON: {\"isIdDocument\":boolean,\"documentType\":\"passport\"|\"national_id\"|\"driver_license\"|\"other\"|null,\"idNumber\":string|null,\"firstName\":string|null,\"lastName\":string|null,\"name\":string|null,\"address\":string|null,\"country\":string|null,\"gender\":\"male\"|\"female\"|\"other\"|null,\"birthDate\":string|null,\"confidence\":number,\"reason\":string}. confidence is 0..1.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the document type, holder's full name, number, address, gender and date of birth from this ID photo. Return JSON only." },
                { type: "image", image: dataUri },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.log("[edit-profile] id scan non-OK", res.status, body.slice(0, 200));
        Alert.alert("Couldn't read document", `Scanner returned ${res.status}. Please try again in better light.`);
        return;
      }
      const raw = await res.text();
      let completion = "";
      try {
        completion = String(((JSON.parse(raw) as { completion?: string }).completion ?? "")).trim();
      } catch {
        Alert.alert("Couldn't read document", "Scanner returned an unexpected response. Please try again.");
        return;
      }
      const match = completion.match(/\{[\s\S]*\}/);
      if (!match) {
        Alert.alert("Couldn't read document", "Could not parse scanner response. Please retry.");
        return;
      }
      const parsed = JSON.parse(match[0]) as {
        isIdDocument?: boolean;
        documentType?: string | null;
        idNumber?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        name?: string | null;
        address?: string | null;
        country?: string | null;
        gender?: string | null;
        birthDate?: string | null;
        confidence?: number;
        reason?: string;
      };
      const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
      if (!parsed.isIdDocument || conf < 0.5) {
        Alert.alert(
          "Document not accepted",
          parsed.reason || "This doesn't look like a valid passport or ID. Please retake in good light with all edges visible."
        );
        return;
      }
      const idNumber = (parsed.idNumber || "").trim();
      if (!idNumber) {
        Alert.alert("Number not found", "Couldn't read the document number. Please retake with better lighting.");
        return;
      }
      setScanStep("Validating details…");

      const detectedGender = normalizeGender(parsed.gender);
      const detectedIdType = normalizeIdType(parsed.documentType);
      const detectedBirthDate = normalizeBirthDate(parsed.birthDate);
      const cleanPart = (s: string | null | undefined) =>
        (s || "").replace(/\s+/g, " ").trim();
      const detectedFirstName = cleanPart(parsed.firstName);
      const detectedLastName = cleanPart(parsed.lastName);
      const combinedFromParts = [detectedFirstName, detectedLastName]
        .filter((p) => p.length > 0)
        .join(" ");
      const detectedName = combinedFromParts || cleanPart(parsed.name);

      const detectedAddress = (parsed.address || "").trim();
      const detectedCountry = (parsed.country || "").trim();

      setForm((f) => ({
        ...f,
        idImage: asset.uri,
        idNumber,
        name: detectedName || f.name,
        address: detectedAddress || f.address,
        country: f.country || detectedCountry,
        gender: detectedGender || f.gender,
        idType: detectedIdType || f.idType,
        birthDate: detectedBirthDate || f.birthDate,
      }));

      const prettyIdType = detectedIdType
        ? detectedIdType.replace("_", " ").toUpperCase()
        : "Document";
      const prettyGender = detectedGender
        ? detectedGender.charAt(0).toUpperCase() + detectedGender.slice(1)
        : null;
      Alert.alert(
        "ID verified",
        `${prettyIdType} captured.\n\nNumber: ${idNumber}${detectedName ? `\nName: ${detectedName}` : ""}${parsed.address ? `\nAddress: ${parsed.address}` : ""}${prettyGender ? `\nGender: ${prettyGender}` : ""}${detectedBirthDate ? `\nDate of birth: ${detectedBirthDate}` : ""}\n\nTap Save to keep these details.`
      );
    } catch (e) {
      console.log("[edit-profile] scanIdDocument error", e);
      Alert.alert("Couldn't scan document", "Please try again.");
    } finally {
      setScanningId(false);
      setScanStep("");
    }
  };

  const confirmRescan = () => {
    Alert.alert(
      "Re-scan ID?",
      "To change your ID number or address, you must re-scan your passport or ID. The current values will be replaced after verification.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Re-scan", onPress: () => scanIdDocument() },
      ]
    );
  };

  /**
   * Two-shot liveness challenge. We capture a neutral selfie and a second
   * selfie matching a randomized expression/pose challenge, then send BOTH
   * frames to the vision LLM in a single call. The model must confirm:
   *  - both frames are real, live humans (no screens/photos/masks/AI faces)
   *  - the same person appears in both frames
   *  - frame 2 actually performs the requested challenge
   *  - the two frames are visibly different (not duplicates)
   *
   * Best-effort: any network/parse/low-confidence path fails closed.
   */
  const CHALLENGES: { key: string; label: string; instruction: string }[] = [
    { key: "smile", label: "Smile clearly with teeth showing", instruction: "the subject is smiling clearly with teeth visible" },
    { key: "left", label: "Turn your head to your LEFT", instruction: "the subject's head is rotated to their own left (camera-right)" },
    { key: "right", label: "Turn your head to your RIGHT", instruction: "the subject's head is rotated to their own right (camera-left)" },
    { key: "brows", label: "Raise your eyebrows", instruction: "the subject is raising both eyebrows noticeably" },
    { key: "mouth", label: "Open your mouth wide", instruction: "the subject's mouth is open wide" },
  ];

  const verifyTwoShotChallenge = async (
    neutralImage: string,
    challengeImage: string,
    challengeInstruction: string
  ): Promise<{ ok: boolean; reason?: string }> => {
    const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com";
    const res = await fetch(`${toolkitUrl}/text/llm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a strict two-shot face-liveness gate for a profile-photo upload. You receive TWO images: image 1 is a neutral selfie, image 2 is a challenge selfie. Accept ONLY when ALL are true: (a) both images are real living human faces captured directly by a camera (REJECT screens, printed/scanned photos, drawings, AI-generated faces, masks, dolls, mannequins, statues, animals); (b) the SAME person appears in both; (c) image 2 visibly performs the challenge described by the user; (d) the two frames are clearly different (not the same frame twice). Respond ONLY with compact JSON: {\"bothHuman\":boolean,\"bothLive\":boolean,\"samePerson\":boolean,\"challengePassed\":boolean,\"framesDiffer\":boolean,\"confidence\":number,\"reason\":string}. confidence is 0..1.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Two-shot liveness check. Image 1 = neutral selfie. Image 2 = challenge selfie where ${challengeInstruction}. Verify and return JSON only.`,
              },
              { type: "image", image: neutralImage },
              { type: "image", image: challengeImage },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const snippet = bodyText ? bodyText.slice(0, 300) : "<empty body>";
      console.log("[edit-profile] verifier non-OK", res.status, snippet);
      const hint =
        res.status === 413 || /payload|too large|entity too large/i.test(bodyText)
          ? " \u2014 photos may be too large; try again in better light."
          : res.status === 401 || res.status === 403
          ? " \u2014 verifier rejected the request (auth)."
          : "";
      return { ok: false, reason: `Verifier error ${res.status}${hint}\n${snippet}` };
    }
    const rawText = await res.text();
    let data: { completion?: string } = {};
    try {
      data = JSON.parse(rawText) as { completion?: string };
    } catch (e) {
      console.log("[edit-profile] verifier JSON parse error", e, rawText.slice(0, 300));
      return { ok: false, reason: `Verifier returned non-JSON (${res.status})\n${rawText.slice(0, 300)}` };
    }
    const raw = String(data.completion ?? "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, reason: `Couldn't parse verifier response\n${raw.slice(0, 300)}` };
    const parsed = JSON.parse(match[0]) as {
      bothHuman?: boolean;
      bothLive?: boolean;
      samePerson?: boolean;
      challengePassed?: boolean;
      framesDiffer?: boolean;
      confidence?: number;
      reason?: string;
    };
    const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (
      parsed.bothHuman &&
      parsed.bothLive &&
      parsed.samePerson &&
      parsed.challengePassed &&
      parsed.framesDiffer &&
      conf >= 0.6
    ) {
      return { ok: true };
    }
    if (!parsed.bothHuman || !parsed.bothLive) {
      return { ok: false, reason: parsed.reason || "One or both photos don't look like a real, live person." };
    }
    if (!parsed.samePerson) {
      return { ok: false, reason: parsed.reason || "The two photos don't appear to be the same person." };
    }
    if (!parsed.framesDiffer) {
      return { ok: false, reason: parsed.reason || "The two photos look identical — please move between shots." };
    }
    if (!parsed.challengePassed) {
      return { ok: false, reason: parsed.reason || "Couldn't detect the requested action in shot 2." };
    }
    return { ok: false, reason: parsed.reason || "Liveness check didn't pass." };
  };

  /**
   * Capture a front-camera selfie and return BOTH a local file URI (for
   * preview/upload) and a small base64 data URI (for the verifier call).
   * Lower JPEG quality + base64 keeps the LLM payload well under typical
   * 1\u20132 MB limits so we don't get vague 413/500 errors from the proxy.
   */
  const captureSelfie = async (): Promise<{ uri: string; dataUri: string } | null> => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.uri) return null;
    const a = result.assets[0];
    const mime = a.mimeType ?? "image/jpeg";
    const dataUri = a.base64 ? `data:${mime};base64,${a.base64}` : a.uri;
    return { uri: a.uri, dataUri };
  };

  const pickAvatar = async () => {
    try {
      if (Platform.OS === "web") {
        Alert.alert("Camera required", "Selfie capture isn't supported on web. Please use the mobile app.");
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera permission needed", "Allow camera access to take a selfie for your profile photo.");
        return;
      }

      // Pick a random challenge for shot 2 so it can't be pre-recorded.
      const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];

      // Intro
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Two-shot liveness check",
          `We'll take 2 quick selfies to confirm it's really you.\n\n1) Neutral face looking at the camera\n2) ${challenge.label}`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Start", onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) return;

      // Shot 1 — neutral
      setChallengeStep("neutral");
      setChallengeLabel("Shot 1 of 2 \u00b7 Neutral face");
      const neutral = await captureSelfie();
      if (!neutral) {
        setChallengeStep("idle");
        return;
      }

      // Bridge to shot 2 with the specific instruction
      const continueToChallenge = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Now the challenge shot",
          `${challenge.label}.\n\nHold the pose, then tap Continue to open the camera.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Continue", onPress: () => resolve(true) },
          ]
        );
      });
      if (!continueToChallenge) {
        setChallengeStep("idle");
        return;
      }

      // Shot 2 — challenge
      setChallengeStep("challenge");
      setChallengeLabel(`Shot 2 of 2 \u00b7 ${challenge.label}`);
      const challengeShot = await captureSelfie();
      if (!challengeShot) {
        setChallengeStep("idle");
        return;
      }

      // Verify both frames in a single call
      setChallengeStep("verifying");
      setChallengeLabel("Verifying it\u2019s really you\u2026");
      setVerifyingFace(true);
      try {
        const neutralKB = Math.round((neutral.dataUri.length * 3) / 4 / 1024);
        const challengeKB = Math.round((challengeShot.dataUri.length * 3) / 4 / 1024);
        console.log(
          `[edit-profile] verifier payload \u2248 ${neutralKB}KB + ${challengeKB}KB`
        );
        const verdict = await verifyTwoShotChallenge(
          neutral.dataUri,
          challengeShot.dataUri,
          challenge.instruction
        );
        if (!verdict.ok) {
          Alert.alert(
            "Liveness check failed",
            `${verdict.reason ?? "Please try again."}\n\nUse the front camera in good lighting, no screens or printed photos, and follow the on-screen action.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Retry", onPress: () => pickAvatar() },
            ]
          );
          return;
        }
        // Use the neutral shot as the profile photo (cleaner for an avatar)
        setForm((f) => ({ ...f, avatar: neutral.uri }));
      } catch (err) {
        console.log("[edit-profile] two-shot verify error", err);
        Alert.alert(
          "Couldn't verify selfie",
          "We couldn't run the liveness check. Check your connection and try again."
        );
      } finally {
        setVerifyingFace(false);
        setChallengeStep("idle");
        setChallengeLabel("");
      }
    } catch (e) {
      console.log("[edit-profile] pickAvatar error", e);
      Alert.alert("Couldn't open camera", "Please try again.");
      setChallengeStep("idle");
      setChallengeLabel("");
      setVerifyingFace(false);
    }
  };

  /**
   * Upload the locally captured ID image into the `ID_Image` bucket so the
   * raw photo is preserved server-side. Path layout:
   *   {country}/{phone}_{idNumber}_{ddmmyyyy}.png
   * Returns the public URL on success, or null if the upload could not be
   * performed (missing fields / not configured / network error). The original
   * local URI is preserved by the caller as a fallback in that case.
   */
  const uploadIdImageToStorage = async (
    localUri: string,
    phone: string,
    idNumber: string,
    country: string
  ): Promise<{ url: string | null; error: string | null }> => {
    if (!isSupabaseConfigured || !supabase) {
      return { url: null, error: "Supabase not configured" };
    }
    if (!localUri || !phone || !idNumber) {
      return { url: null, error: "Missing localUri / phone / idNumber" };
    }
    // Already a remote URL — nothing to upload.
    if (/^https?:\/\//i.test(localUri)) return { url: localUri, error: null };
    try {
      const safeSeg = (s: string): string =>
        s.replace(/[^A-Za-z0-9_+\-]/g, "_").replace(/_+/g, "_");
      const folder = safeSeg((country || "Unknown").trim());
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = String(d.getFullYear());
      const fileName = `${safeSeg(phone)}_${safeSeg(idNumber)}_${dd}${mm}${yyyy}.png`;
      const path = `${folder}/${fileName}`;

      // React Native / Hermes does not implement Response.blob() reliably for
      // file:// URIs. The Supabase-recommended pattern on RN is:
      //   read file as base64 (expo-file-system) -> decode via base64-arraybuffer
      //   -> upload the resulting ArrayBuffer.
      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decodeBase64(base64);
      const { error: upErr } = await supabase.storage
        .from("ID_Image")
        .upload(path, arrayBuffer, {
          contentType: "image/png",
          upsert: true,
          cacheControl: "3600",
        });
      if (upErr) {
        // Surface the raw error so policy / bucket-missing issues are visible.
        const raw = upErr as unknown as {
          message?: string;
          statusCode?: string | number;
          error?: string;
          name?: string;
        };
        const detail = [
          raw.statusCode ? `[${raw.statusCode}]` : null,
          raw.error ?? raw.name ?? null,
          raw.message ?? null,
        ]
          .filter(Boolean)
          .join(" ");
        console.log("[edit-profile] id image upload error", raw);
        return { url: null, error: detail || "Unknown storage error" };
      }
      const { data: pub } = supabase.storage.from("ID_Image").getPublicUrl(path);
      return { url: pub?.publicUrl ?? null, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("[edit-profile] id image upload exception", e);
      return { url: null, error: msg };
    }
  };

  /**
   * Upload the local avatar selfie to the public `avatars` bucket under
   * `{country}/{phone}_{name}_{ddmmyyyy}.png`. Supabase Storage creates the
   * country folder automatically on first upload. Returns the resulting public
   * URL, or an error string the caller can surface to the user.
   */
  const uploadAvatarToStorage = async (
    localUri: string,
    phone: string,
    name: string,
    country: string
  ): Promise<{ url: string | null; error: string | null }> => {
    if (!isSupabaseConfigured || !supabase) {
      return { url: null, error: "Supabase not configured" };
    }
    if (!localUri || !phone) {
      return { url: null, error: "Missing localUri / phone" };
    }
    if (/^https?:\/\//i.test(localUri)) return { url: localUri, error: null };
    try {
      const safeSeg = (s: string): string =>
        s.replace(/[^A-Za-z0-9_+\-]/g, "_").replace(/_+/g, "_");
      const folder = safeSeg((country || "Unknown").trim());
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = String(d.getFullYear());
      const safeName = safeSeg((name || "user").trim().toLowerCase()) || "user";
      const fileName = `${safeSeg(phone)}_${safeName}_${dd}${mm}${yyyy}.png`;
      const path = `${folder}/${fileName}`;

      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decodeBase64(base64);
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, arrayBuffer, {
          contentType: "image/png",
          upsert: true,
          cacheControl: "3600",
        });
      if (upErr) {
        const raw = upErr as unknown as {
          message?: string;
          statusCode?: string | number;
          error?: string;
          name?: string;
        };
        const detail = [
          raw.statusCode ? `[${raw.statusCode}]` : null,
          raw.error ?? raw.name ?? null,
          raw.message ?? null,
        ]
          .filter(Boolean)
          .join(" ");
        console.log("[edit-profile] avatar upload error", raw);
        return { url: null, error: detail || "Unknown storage error" };
      }
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      return { url: pub?.publicUrl ?? null, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("[edit-profile] avatar upload exception", e);
      return { url: null, error: msg };
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    setSaving(true);
    try {
      let supabaseOk = false;
      let saveErrorMsg: string | null = null;

      if (isSupabaseConfigured && supabase) {
        // Test account / legacy session has no real auth.uid(), so RLS-protected
        // updates will silently fail. Bridge into a real Supabase session first.
        if (
          !isSupabaseSession &&
          authState.phoneNumber &&
          isTestAccountPhone(authState.phoneNumber)
        ) {
          const bridged = await signInTestAccountToSupabase();
          if (!bridged) {
            console.log("[edit-profile] test account bridge failed");
          }
        }

        // Resolve the user id even if the AuthContext hasn't hydrated yet.
        // Falls back to the live Supabase session, then to a phone lookup.
        let resolvedUserId: string | null = null;
        try {
          const { data: userData } = await supabase.auth.getUser();
          resolvedUserId = userData.user?.id ?? null;
        } catch (e) {
          console.log("[edit-profile] getUser error", e);
        }
        if (!resolvedUserId) {
          resolvedUserId = authState.userId ?? null;
        }
        if (!resolvedUserId && authState.phoneNumber) {
          try {
            const { data: byPhone } = await supabase
              .from("profiles")
              .select("id")
              .eq("phone", authState.phoneNumber)
              .maybeSingle();
            resolvedUserId = byPhone?.id ?? null;
          } catch (e) {
            console.log("[edit-profile] phone lookup error", e);
          }
        }

        if (!resolvedUserId) {
          saveErrorMsg = "Not signed in";
        } else {
          // If the ID image is still a local URI (newly scanned), push it to
          // the ID_Image storage bucket first so the column stores a durable
          // public URL instead of a device-only file path.
          let idImageForDb: string | null = form.idImage || null;
          if (
            form.idImage &&
            !/^https?:\/\//i.test(form.idImage) &&
            form.idNumber.trim() &&
            authState.phoneNumber
          ) {
            const uploaded = await uploadIdImageToStorage(
              form.idImage,
              authState.phoneNumber,
              form.idNumber.trim(),
              form.country.trim()
            );
            if (uploaded.url) {
              idImageForDb = uploaded.url;
              setForm((f) => ({ ...f, idImage: uploaded.url as string }));
            } else if (uploaded.error) {
              // Don't silently fall back — show the user exactly why the bucket
              // upload failed (policy denial, bucket missing, network, etc.).
              Alert.alert(
                "ID image upload failed",
                `${uploaded.error}\n\nThe profile will still save, but the ID image is kept only on this device. Check that the \"ID_Image\" bucket exists and its storage policies allow this user to upload.`
              );
            }
          }

          // If the avatar is still a local URI (newly captured selfie), push
          // it to the `avatars` bucket so the column stores a durable public
          // URL instead of a device-only file path.
          let avatarForDb: string | null = form.avatar || null;
          if (
            form.avatar &&
            !/^https?:\/\//i.test(form.avatar) &&
            authState.phoneNumber
          ) {
            const uploadedAvatar = await uploadAvatarToStorage(
              form.avatar,
              authState.phoneNumber,
              form.name.trim(),
              form.country.trim()
            );
            if (uploadedAvatar.url) {
              avatarForDb = uploadedAvatar.url;
              setForm((f) => ({ ...f, avatar: uploadedAvatar.url as string }));
            } else if (uploadedAvatar.error) {
              Alert.alert(
                "Avatar upload failed",
                `${uploadedAvatar.error}\n\nThe profile will still save, but the avatar is kept only on this device. Check that the \"avatars\" bucket exists and its storage policies allow this user to upload.`
              );
            }
          }

          const payload = {
            name: form.name.trim(),
            email: form.email.trim() || null,
            avatar_url: avatarForDb,
            nationality: form.country.trim() || null,
            ic: form.idNumber.trim() || null,
            address: form.address.trim() || null,
            id_image: idImageForDb,
            gender: form.gender || null,
            id_type: form.idType || null,
            birth_date: form.birthDate || null,
          };

          // 1) Try update first and ask Postgrest to return affected rows so we
          //    can detect the silent "0 rows updated" case (missing profile or
          //    RLS mismatch).
          const { data: updated, error: updateErr } = await supabase
            .from("profiles")
            .update(payload)
            .eq("id", resolvedUserId)
            .select("id");

          if (updateErr) {
            console.log("[edit-profile] update error", updateErr.message);
            saveErrorMsg = updateErr.message;
          } else if (!updated || updated.length === 0) {
            // 2) No row updated -> upsert so a missing profile row is created.
            console.log("[edit-profile] no row updated, upserting");
            const { error: upsertErr } = await supabase
              .from("profiles")
              .upsert(
                { id: resolvedUserId, ...payload },
                { onConflict: "id" }
              );
            if (upsertErr) {
              console.log("[edit-profile] upsert error", upsertErr.message);
              saveErrorMsg = upsertErr.message;
            } else {
              supabaseOk = true;
            }
          } else {
            supabaseOk = true;
          }
        }
      } else {
        const ok = await updateProfile({ name: form.name.trim() });
        supabaseOk = ok;
        if (!ok) saveErrorMsg = "Not signed in";
      }

      if (supabaseOk) {
        setInitial(form);
        // Sync the new name into shared auth state so side sheets and other
        // surfaces update without a re-mount.
        await refreshProfile();
        Alert.alert("Saved", "Your profile has been updated.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert(
          "Couldn't save",
          saveErrorMsg
            ? `Please try again.\n\n${saveErrorMsg}`
            : "Please try again in a moment."
        );
      }
    } finally {
      setSaving(false);
    }
  };

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
                firstName: form.name ?? "",
              },
            });
          },
        },
      ]
    );
  };

  const firstChar = (form.name || authState.phoneNumber || "U").trim().charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <SafeAreaView edges={["top"]} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="edit-profile-back"
          >
            <ChevronLeft color={Colors.text} size={26} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!dirty || saving}
            testID="edit-profile-save"
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <Check color={dirty ? Colors.accent : Colors.textSecondary} size={22} />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {!isSupabaseSession && (
        <View style={styles.warnBanner} testID="edit-profile-test-account-banner">
          <AlertTriangle color={Colors.warning ?? "#B45309"} size={16} strokeWidth={2.5} />
          <Text style={styles.warnBannerText}>
            Test account — changes won&apos;t sync
          </Text>
        </View>
      )}
      {showNumberChangedBanner && (
        <TouchableOpacity
          style={styles.successBanner}
          activeOpacity={phonePersistError ? 0.7 : 1}
          disabled={!phonePersistError}
          onPress={() => {
            setPhonePersistError(null);
            setPhonePersisted(false);
          }}
          testID="edit-profile-number-changed-banner"
        >
          <ShieldCheck color={Colors.success} size={16} strokeWidth={2.5} />
          <Text style={styles.successBannerText}>
            {numberWasPinVerified ? "PIN verified · " : ""}Phone updated{changedPhone ? ` to ${changedPhone}` : ""}
            {phonePersistError ? ` · ${phonePersistError}` : phonePersisted ? " · synced" : ""}
          </Text>
        </TouchableOpacity>
      )}
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
              onPress={pickAvatar}
              disabled={verifyingFace}
              testID="edit-profile-avatar"
            >
              <View style={[styles.avatar, { backgroundColor: Colors.accent + "25" }]}>
                {form.avatar ? (
                  <Image source={{ uri: form.avatar }} style={styles.avatarImage} />
                ) : (
                  <Text style={[styles.avatarText, { color: Colors.accent }]}>{firstChar}</Text>
                )}
                {verifyingFace && (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </View>
              <View style={[styles.cameraBadge, { backgroundColor: Colors.accent }]}>
                <Camera color={Colors.onAccent} size={14} />
              </View>
            </TouchableOpacity>
            <View style={styles.avatarHintRow}>
              <ScanFace color={Colors.textSecondary} size={14} />
              <Text style={styles.avatarHint}>
                {challengeStep !== "idle" && challengeLabel
                  ? challengeLabel
                  : "Tap to start a 2-shot liveness check \u00b7 AI verified"}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
                placeholder="Your full name"
                placeholderTextColor={Colors.textSecondary}
                testID="edit-profile-name"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputRow}>
                <Mail color={Colors.textSecondary} size={18} />
                <TextInput
                  style={[styles.input, styles.inputInline]}
                  value={form.email}
                  onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="edit-profile-email"
                />
              </View>
            </View>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => {
                if (isSupabaseSession) {
                  router.push("/change-number" as any);
                  return;
                }
                router.push({
                  pathname: "/pin-verify" as any,
                  params: {
                    phoneNumber: authState.phoneNumber ?? "",
                    nextRoute: "/change-number",
                    mode: "changeNumber",
                  },
                });
              }}
              testID="edit-profile-change-number"
            >
              <Phone color={Colors.textSecondary} size={18} />
              <View style={styles.linkBody}>
                <Text style={styles.linkLabel}>Phone</Text>
                <Text style={styles.linkValue}>{authState.phoneNumber ?? "—"}</Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Identity</Text>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => setCountryPickerOpen(true)}
              testID="edit-profile-country"
            >
              <Globe2 color={Colors.textSecondary} size={18} />
              <View style={styles.linkBody}>
                <Text style={styles.linkLabel}>Country</Text>
                <Text style={[styles.linkValue, !form.country && { color: Colors.textSecondary }]}>
                  {form.country || "Select country"}
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>

            {!form.idImage ? (
              <TouchableOpacity
                style={[styles.scanCta, { borderColor: Colors.accent }]}
                onPress={scanIdDocument}
                disabled={scanningId}
                testID="edit-profile-scan-id"
              >
                {scanningId ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <ScanLine color={Colors.accent} size={20} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.scanCtaTitle, { color: Colors.accent }]}>
                    {scanningId ? scanStep || "Scanning…" : "Scan Passport or ID"}
                  </Text>
                  <Text style={styles.scanCtaSub}>
                    We&apos;ll extract your number and address
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.idCard}>
                <Image source={{ uri: form.idImage }} style={styles.idCardImage} resizeMode="cover" />
                {scanningId && (
                  <View style={styles.idCardOverlay}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.idCardOverlayText}>{scanStep || "Scanning…"}</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.field}>
              <View style={styles.lockRow}>
                <IdCard color={Colors.textSecondary} size={14} />
                <Text style={styles.fieldLabel}>Passport / ID Number</Text>
                <Lock color={Colors.textSecondary} size={11} />
              </View>
              <Text style={[styles.lockedValue, !form.idNumber && { color: Colors.textSecondary }]}>
                {form.idNumber || "Scan your ID to fill"}
              </Text>
            </View>

            <View style={styles.field}>
              <View style={styles.lockRow}>
                <MapPin color={Colors.textSecondary} size={14} />
                <Text style={styles.fieldLabel}>Address</Text>
                <Lock color={Colors.textSecondary} size={11} />
              </View>
              <Text style={[styles.lockedValue, !form.address && { color: Colors.textSecondary }]}>
                {form.address || "Extracted from your ID"}
              </Text>
            </View>

            {form.idImage ? (
              <TouchableOpacity
                style={styles.rescanBtn}
                onPress={confirmRescan}
                disabled={scanningId}
                testID="edit-profile-rescan-id"
              >
                <ScanLine color={Colors.accent} size={16} />
                <Text style={[styles.rescanBtnText, { color: Colors.accent }]}>
                  Re-scan to change number or address
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Security</Text>
            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => {
                const pinExists = hasPinSet(authState.phoneNumber ?? "");
                if (pinExists) {
                  router.push("/change-pin" as any);
                } else {
                  router.push({
                    pathname: "/pin-setup" as any,
                    params: {
                      phoneNumber: authState.phoneNumber ?? "",
                      firstName: form.name ?? "",
                    },
                  });
                }
              }}
              testID="edit-profile-pin"
            >
              <Shield color={Colors.textSecondary} size={18} />
              <View style={styles.linkBody}>
                <Text style={styles.linkLabel}>
                  {hasPinSet(authState.phoneNumber ?? "") ? "Change PIN" : "Set PIN"}
                </Text>
                <Text style={styles.linkValue}>
                  {hasPinSet(authState.phoneNumber ?? "")
                    ? "Update your sign-in PIN"
                    : "Create a 6-digit sign-in PIN"}
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>

            {hasPinSet(authState.phoneNumber ?? "") && (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={handleForgotPin}
                testID="edit-profile-forgot-pin"
              >
                <KeyRound color={Colors.textSecondary} size={18} />
                <View style={styles.linkBody}>
                  <Text style={styles.linkLabel}>Forgot PIN</Text>
                  <Text style={styles.linkValue}>Reset and create a new sign-in PIN</Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            )}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      <Modal
        visible={countryPickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <SafeAreaView edges={["top"]} style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select country</Text>
            <TouchableOpacity
              onPress={() => setCountryPickerOpen(false)}
              style={styles.modalClose}
              testID="country-picker-close"
            >
              <X color={Colors.text} size={22} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrap}>
            <Search color={Colors.textSecondary} size={18} />
            <TextInput
              style={styles.searchInput}
              value={countryQuery}
              onChangeText={setCountryQuery}
              placeholder="Search country…"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              testID="country-picker-search"
            />
          </View>
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.isoCode}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const selected = form.country === item.name;
              return (
                <TouchableOpacity
                  style={styles.countryRow}
                  onPress={() => {
                    setForm((f) => ({ ...f, country: item.name }));
                    setCountryPickerOpen(false);
                    setCountryQuery("");
                  }}
                  testID={`country-${item.isoCode}`}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  {selected ? <Check color={Colors.accent} size={18} /> : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No countries match “{countryQuery}”.</Text>
            }
          />
        </SafeAreaView>
      </Modal>
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
    saveBtn: { width: 44, height: 44, alignItems: "center" as const, justifyContent: "center" as const },
    saveBtnDisabled: { opacity: 0.5 },
    loadingWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
    successBanner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginHorizontal: 20,
      marginTop: 4,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: "rgba(16,185,129,0.12)",
    },
    successBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600" as const,
      color: Colors.success,
    },
    warnBanner: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginHorizontal: 20,
      marginTop: 4,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: "rgba(245,158,11,0.12)",
      borderWidth: 1,
      borderColor: "rgba(245,158,11,0.35)",
    },
    warnBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600" as const,
      color: Colors.warning ?? "#B45309",
    },
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
    cameraBadge: {
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
    avatarHint: { fontSize: 13, color: Colors.textSecondary },
    avatarHintRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginTop: 10,
    },
    avatarOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    section: { marginTop: 24 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700" as const,
      color: Colors.textSecondary,
      letterSpacing: 1,
      textTransform: "uppercase" as const,
      marginBottom: 10,
    },
    field: {
      backgroundColor: Colors.gray[50],
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 10,
    },
    fieldLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4 },
    input: {
      fontSize: 16,
      color: Colors.text,
      paddingVertical: Platform.OS === "ios" ? 4 : 2,
    },
    inputRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
    inputInline: { flex: 1 },
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
    linkBody: { flex: 1 },
    linkLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 2 },
    linkValue: { fontSize: 15, fontWeight: "600" as const, color: Colors.text },
    scanCta: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      borderStyle: "dashed" as const,
      paddingHorizontal: 14,
      paddingVertical: 16,
      marginBottom: 10,
      backgroundColor: Colors.gray[50],
    },
    scanCtaTitle: { fontSize: 15, fontWeight: "700" as const },
    scanCtaSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
    idCard: {
      borderRadius: 12,
      overflow: "hidden" as const,
      borderWidth: 1,
      borderColor: Colors.border,
      marginBottom: 10,
      backgroundColor: Colors.gray[50],
    },
    idCardImage: { width: "100%" as const, height: 180 },
    idCardOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: "rgba(0,0,0,0.5)",
      gap: 8,
    },
    idCardOverlayText: { color: "#fff", fontSize: 13, fontWeight: "600" as const },
    lockRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginBottom: 4,
    },
    lockedValue: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: Colors.text,
      paddingVertical: Platform.OS === "ios" ? 4 : 2,
    },
    rescanBtn: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      paddingVertical: 12,
      marginTop: 2,
      marginBottom: 4,
    },
    rescanBtnText: { fontSize: 13, fontWeight: "700" as const },
    modalSafe: { flex: 1, backgroundColor: Colors.background },
    modalHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    modalTitle: { flex: 1, fontSize: 18, fontWeight: "700" as const, color: Colors.text },
    modalClose: { width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const },
    searchWrap: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: Colors.gray[50],
      borderWidth: 1,
      borderColor: Colors.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 0 },
    countryRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: Colors.border,
    },
    countryFlag: { fontSize: 22 },
    countryName: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: "500" as const },
    emptyText: { textAlign: "center" as const, color: Colors.textSecondary, paddingVertical: 24, fontSize: 14 },
  });
