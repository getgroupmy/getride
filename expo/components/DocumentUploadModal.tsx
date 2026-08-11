import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Platform,
  Switch,
} from "react-native";
import {
  X,
  Camera,
  ImageIcon,
  Calendar as CalendarIcon,
  CalendarClock,
  Hash,
  ShieldAlert,
  Accessibility,
  ChevronRight,
  Check,
  RefreshCw,
  Sparkles,
  ShieldX,
  AlertTriangle,
  FileText,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { useAdminData, type SettingEntry } from "@/contexts/AdminDataContext";
import {
  uploadProviderDocFile,
  upsertProviderDocument,
  type ProviderDocumentRow,
  type ProviderDocumentAiVerification,
} from "@/utils/providerDocumentsStore";
import {
  uploadVehicleDocFile,
  upsertVehicleDocument,
  type VehicleDocumentRow,
} from "@/utils/vehicleDocumentsStore";
import {
  verifyDocumentWithAi,
  cropImageRegionToFile,
} from "@/utils/documentAiVerify";
import PdfRasterizer from "@/components/PdfRasterizer";

/**
 * Row shape used by the modal for both partner and vehicle documents.
 * Both row types share these fields (just keyed differently in the DB).
 */
export type AnyDocumentRow = ProviderDocumentRow | VehicleDocumentRow;

export interface DocumentRequirementFlags {
  requireStartDate: boolean;
  requireExpiryDate: boolean;
  requireDocumentNumber: boolean;
  requireInsuranceProvider: boolean;
  isPwd: boolean;
  requireFrontBack: boolean;
  /** When true, the source picker exposes an additional "Upload PDF" option. */
  allowPdfUpload?: boolean;
  /**
   * When true, this document is the partner-teksi taxi driver permit. The
   * uploaded image is scanned to capture the permit fields (ID number,
   * validity, driver type, licence reference & class, vehicle number,
   * company name, address, image-on-permit and QR-code presence).
   */
  isTaxiPermit?: boolean;
}

function isPdfUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const lower = uri.toLowerCase();
  if (lower.startsWith("data:application/pdf")) return true;
  // Strip query string before checking extension (Supabase public URLs include ?token=...)
  const qIdx = lower.indexOf("?");
  const path = qIdx >= 0 ? lower.slice(0, qIdx) : lower;
  return path.endsWith(".pdf");
}

export interface DocumentTarget {
  docId: string;
  docName: string;
  flags: DocumentRequirementFlags;
}

/**
 * Return a copy of the AI verification result with the cropped permit portrait
 * URL stored under `extracted.taxiPermit.photoUrl`, so the permit card can use
 * the separate cropped image file directly.
 */
function aiResultWithPermitPhoto(
  result: ProviderDocumentAiVerification | null,
  photoUrl: string
): ProviderDocumentAiVerification | null {
  if (!result) return result;
  const extracted = result.extracted ?? {};
  const taxiPermit = extracted.taxiPermit ?? {};
  return {
    ...result,
    extracted: {
      ...extracted,
      taxiPermit: { ...taxiPermit, photoUrl },
    },
  };
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Owning partner id. Required for partner-mode; passed through for vehicle docs too. */
  partnerId: string;
  authUserId: string | null;
  target: DocumentTarget | null;
  existing?: AnyDocumentRow | null;
  onSaved?: (row: AnyDocumentRow) => void;
  /**
   * Where to persist the upload. Defaults to "partner" (provider_documents +
   * provider-documents bucket). When set to "vehicle", writes to
   * vehicle_documents + vehicle-documents bucket and requires `vehicleId`.
   */
  kind?: "partner" | "vehicle";
  vehicleId?: string | null;
}

type Step =
  | "source"
  | "front"
  | "back"
  | "documentNumber"
  | "startDate"
  | "expiryDate"
  | "insuranceProvider"
  | "isPwd"
  | "review";

function toDateOnly(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(s: string): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

interface DateSpinnerProps {
  title: string;
  subtitle?: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
  Colors: ReturnType<typeof useColors>;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
}

function DateSpinner({
  title,
  subtitle,
  value,
  onChange,
  icon,
  Colors,
  minimumDate,
  maximumDate,
  testID,
}: DateSpinnerProps) {
  const initial = parseISODate(value) ?? new Date();
  const [androidOpen, setAndroidOpen] = useState<boolean>(false);

  const display = value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Select a date";

  return (
    <View>
      <View style={{ marginBottom: 14 }}>
        <Text style={[styles.stepTitle, { color: Colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.stepSubtitle, { color: Colors.textSecondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {Platform.OS === "web" ? (
        <View
          style={[
            styles.inputWrap,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          {icon}
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textSecondary}
            style={[styles.input, { color: Colors.text }]}
            testID={`${testID}-input`}
            accessibilityLabel="YYYY-MM-DD"
          />
        </View>
      ) : Platform.OS === "ios" ? (
        <View
          style={[
            styles.spinnerWrap,
            { backgroundColor: Colors.gray[100], borderColor: Colors.border },
          ]}
        >
          <DateTimePicker
            value={initial}
            mode="date"
            display="spinner"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_e, d) => {
              if (d) onChange(toDateOnly(d));
            }}
            textColor={Colors.text}
            testID={testID}
          />
        </View>
      ) : (
        <>
          <TouchableOpacity
            onPress={() => setAndroidOpen(true)}
            style={[
              styles.inputWrap,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
            testID={`${testID}-trigger`}
            accessibilityRole="button"
          >
            {icon}
            <Text style={[styles.input, { color: value ? Colors.text : Colors.textSecondary, paddingVertical: 14 }]}>
              {display}
            </Text>
          </TouchableOpacity>
          {androidOpen ? (
            <DateTimePicker
              value={initial}
              mode="date"
              display="spinner"
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onChange={(e, d) => {
                setAndroidOpen(false);
                if (e.type === "set" && d) onChange(toDateOnly(d));
              }}
            />
          ) : null}
        </>
      )}

      <TouchableOpacity
        onPress={() => onChange(toDateOnly(new Date()))}
        style={styles.helperBtn}
        testID={`${testID}-today`}
        accessibilityRole="button"
      >
        <Text style={[styles.helperBtnText, { color: Colors.accent }]}>Today</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DocumentUploadModal({
  visible,
  onClose,
  partnerId,
  authUserId,
  target,
  existing,
  onSaved,
  kind = "partner",
  vehicleId,
}: Props) {
  const Colors = useColors();
  const { getEntries } = useAdminData();
  const insuranceProviders = getEntries("insurance-providers");

  const [frontIsPdf, setFrontIsPdf] = useState<boolean>(false);

  const steps = useMemo<Step[]>(() => {
    if (!target) return [];
    const out: Step[] = ["source", "front"];
    // PDFs are single-file uploads, so suppress the back step.
    if (target.flags.requireFrontBack && !frontIsPdf) out.push("back");
    if (target.flags.requireDocumentNumber) out.push("documentNumber");
    if (target.flags.requireStartDate) out.push("startDate");
    if (target.flags.requireExpiryDate) out.push("expiryDate");
    if (target.flags.requireInsuranceProvider) out.push("insuranceProvider");
    if (target.flags.isPwd) out.push("isPwd");
    out.push("review");
    return out;
  }, [target, frontIsPdf]);

  const [stepIdx, setStepIdx] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [pickerSource, setPickerSource] = useState<"library" | "camera" | "pdf" | null>(null);

  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [documentNumber, setDocumentNumber] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(""); // ISO date string yyyy-mm-dd
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [insuranceProviderId, setInsuranceProviderId] = useState<string>("");
  const [isPwd, setIsPwd] = useState<boolean>(false);

  const [aiResult, setAiResult] = useState<ProviderDocumentAiVerification | null>(
    null
  );
  const [aiRunning, setAiRunning] = useState<boolean>(false);
  const [aiAttempted, setAiAttempted] = useState<boolean>(false);
  /** PNG data URL of the PDF's first page, populated by PdfRasterizer. The
   * uploaded file is converted to PNG (using this data URL) before being
   * written to storage — we never persist the raw PDF. */
  const [pdfPreviewUri, setPdfPreviewUri] = useState<string | null>(null);
  const [pdfRasterizing, setPdfRasterizing] = useState<boolean>(false);
  const [pdfRasterFailed, setPdfRasterFailed] = useState<boolean>(false);
  const [aiOverride, setAiOverride] = useState<boolean>(false);
  const [autofilledFields, setAutofilledFields] = useState<string[]>([]);
  const [candidateNumbers, setCandidateNumbers] = useState<string[]>([]);
  const [showNumberPicker, setShowNumberPicker] = useState<boolean>(false);

  // Re-init when target/existing changes or modal opens
  useEffect(() => {
    if (!visible) return;
    setStepIdx(0);
    setBusy(false);
    setPickerSource(null);
    setFrontUri(existing?.file_url ?? null);
    setBackUri(existing?.file_url_back ?? null);
    setFrontIsPdf(isPdfUri(existing?.file_url));
    setPdfPreviewUri(null);
    setPdfRasterizing(false);
    setPdfRasterFailed(false);
    setDocumentNumber(existing?.document_number ?? "");
    setStartDate(existing?.start_date ?? "");
    setExpiryDate(existing?.expiry_date ?? "");
    setInsuranceProviderId(existing?.insurance_provider_id ?? "");
    setIsPwd(Boolean(existing?.is_pwd ?? false));
    setAiResult(existing?.ai_verification ?? null);
    setAiRunning(false);
    setAiAttempted(Boolean(existing?.ai_verification));
    setAiOverride(false);
    setAutofilledFields([]);
    setCandidateNumbers([]);
    setShowNumberPicker(false);
  }, [visible, existing]);

  const currentStep = steps[stepIdx];

  const insuranceProviderName = useMemo(() => {
    const p = insuranceProviders.find((e) => e.id === insuranceProviderId);
    return p ? String(p.values.name ?? "") : "";
  }, [insuranceProviders, insuranceProviderId]);

  const runAiVerification = useCallback(async () => {
    if (!target || !frontUri) return;
    // PDFs are rasterized to a JPEG first page before being sent to the
    // image-only AI verifier. Wait for the rasterized preview before running.
    const aiFrontUri = frontIsPdf ? pdfPreviewUri : frontUri;
    if (!aiFrontUri) return;
    setAiRunning(true);
    setAiAttempted(true);
    try {
      const r = await verifyDocumentWithAi(
        aiFrontUri,
        target.flags.requireFrontBack && !frontIsPdf ? backUri : null,
        {
          docName: target.docName,
          documentNumber: documentNumber || null,
          insuranceProviderName: insuranceProviderName || null,
          isPwd: target.flags.isPwd ? isPwd : false,
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          isTaxiPermit: Boolean(target.flags.isTaxiPermit),
        }
      );
      setAiResult(r);

      // Auto-fill any required field the partner hasn't typed yet using data
      // the AI read directly off the document. We never overwrite a value the
      // user has already entered.
      if (r?.extracted) {
        const filled: string[] = [];
        // Collect every distinct candidate number the AI read off the doc.
        const candidates = Array.from(
          new Set(
            [
              r.extracted.documentNumber ?? "",
              ...((r.extracted.documentNumbers ?? []) as string[]),
            ]
              .map((v) => String(v ?? "").trim())
              .filter((v) => v.length > 0)
          )
        );
        setCandidateNumbers(candidates);
        if (
          target.flags.requireDocumentNumber &&
          !documentNumber.trim() &&
          r.extracted.documentNumber
        ) {
          setDocumentNumber(r.extracted.documentNumber);
          filled.push(
            candidates.length > 1
              ? "Document number (multiple found)"
              : "Document number"
          );
        }
        if (
          target.flags.requireStartDate &&
          !startDate &&
          r.extracted.startDate
        ) {
          setStartDate(r.extracted.startDate);
          filled.push("Start date");
        }
        if (
          target.flags.requireExpiryDate &&
          !expiryDate &&
          r.extracted.expiryDate
        ) {
          setExpiryDate(r.extracted.expiryDate);
          filled.push("Expiry date");
        }
        if (
          target.flags.requireInsuranceProvider &&
          !insuranceProviderId &&
          r.extracted.insuranceProviderName
        ) {
          const needle = r.extracted.insuranceProviderName
            .toLowerCase()
            .trim();
          const match = insuranceProviders.find((p) => {
            const name = String(p.values.name ?? "").toLowerCase().trim();
            if (!name) return false;
            return name === needle || name.includes(needle) || needle.includes(name);
          });
          if (match) {
            setInsuranceProviderId(match.id);
            filled.push("Insurance provider");
          }
        }
        if (
          target.flags.isPwd &&
          !isPwd &&
          r.extracted.isPwd === true
        ) {
          setIsPwd(true);
          filled.push("PWD flag");
        }
        if (filled.length > 0) setAutofilledFields(filled);
      }
    } finally {
      setAiRunning(false);
    }
  }, [
    target,
    frontUri,
    backUri,
    documentNumber,
    insuranceProviderName,
    insuranceProviderId,
    insuranceProviders,
    isPwd,
    startDate,
    expiryDate,
    frontIsPdf,
    pdfPreviewUri,
  ]);

  // Auto-open the candidate-number picker when the user lands on the document
  // number step and the AI has read one or more numbers off the document.
  useEffect(() => {
    if (currentStep !== "documentNumber") return;
    if (candidateNumbers.length === 0) return;
    setShowNumberPicker(true);
  }, [currentStep, candidateNumbers]);

  // Run AI check immediately once all required images are present.
  // Re-runs whenever the images change.
  useEffect(() => {
    if (!target) return;
    if (!frontUri) return;
    // For PDFs we wait until the first page has been rasterized to a JPEG.
    if (frontIsPdf && !pdfPreviewUri) return;
    if (!frontIsPdf && target.flags.requireFrontBack && !backUri) return;
    // Skip if these are pre-existing remote URLs with a stored verification result
    // and the user hasn't replaced them.
    if (
      existing &&
      frontUri === existing.file_url &&
      backUri === (existing.file_url_back ?? null) &&
      existing.ai_verification
    ) {
      return;
    }
    if (aiRunning) return;
    void runAiVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontUri, backUri, target?.docId, frontIsPdf, pdfPreviewUri]);

  // When a fresh PDF is picked, kick off rasterization of the first page.
  useEffect(() => {
    if (!frontIsPdf) {
      setPdfRasterizing(false);
      return;
    }
    if (!frontUri) return;
    if (pdfPreviewUri) return;
    setPdfRasterizing(true);
    setPdfRasterFailed(false);
  }, [frontIsPdf, frontUri, pdfPreviewUri]);

  const goNext = useCallback(() => {
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setStepIdx((i) => Math.max(i - 1, 0));
  }, []);

  const pickPdf = async (): Promise<void> => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const uri = res.assets[0].uri;
      setFrontUri(uri);
      setFrontIsPdf(true);
      setBackUri(null);
      setAiResult(null);
      setAiAttempted(false);
      setAutofilledFields([]);
      setCandidateNumbers([]);
      setPdfPreviewUri(null);
      setPdfRasterFailed(false);
    } catch (e) {
      console.log("[doc-upload] pdf pick threw", e);
    }
  };

  const pick = async (
    source: "library" | "camera",
    side: "front" | "back"
  ) => {
    try {
      let res: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Camera access needed", "Please allow camera access.");
          return;
        }
        res = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Photo access needed", "Please allow photo access.");
          return;
        }
        res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
        });
      }
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const uri = res.assets[0].uri;
      if (side === "front") {
        setFrontUri(uri);
        setFrontIsPdf(false);
        setPdfPreviewUri(null);
        setPdfRasterFailed(false);
      } else setBackUri(uri);
    } catch (e) {
      console.log("[doc-upload] pick threw", e);
    }
  };

  const onSelectSource = async (src: "library" | "camera" | "pdf") => {
    setPickerSource(src);
    if (src === "pdf") {
      await pickPdf();
    } else {
      await pick(src, "front");
    }
    goNext(); // move from "source" to "front"
  };

  const replaceFront = async () => {
    if (pickerSource === "pdf") {
      await pickPdf();
      return;
    }
    await pick(pickerSource ?? "library", "front");
  };

  const replaceBack = async () => {
    await pick(pickerSource === "pdf" ? "library" : pickerSource ?? "library", "back");
  };

  const canProceedFromCurrent = useMemo(() => {
    if (!currentStep || !target) return false;
    switch (currentStep) {
      case "source":
        return false; // requires explicit tap on Upload / Snap
      case "front": {
        if (!frontUri) return false;
        // For PDFs we MUST have a rasterized PNG before continuing — the PDF
        // is converted to PNG and that PNG is what we upload to storage.
        if (frontIsPdf) {
          if (!pdfPreviewUri) return false;
          if (aiRunning) return false;
          return true;
        }
        // Block continue while AI verification is in progress (only relevant
        // when this is the last image step, i.e. no back required).
        if (!target.flags.requireFrontBack && aiRunning) return false;
        return true;
      }
      case "back": {
        if (!backUri) return false;
        // AI runs on the back step when front+back is required.
        if (aiRunning) return false;
        return true;
      }
      case "documentNumber":
        return documentNumber.trim().length > 0;
      case "startDate":
        return !!parseISODate(startDate);
      case "expiryDate":
        return !!parseISODate(expiryDate);
      case "insuranceProvider":
        return insuranceProviderId.length > 0;
      case "isPwd":
        return true;
      case "review":
        return true;
      default:
        return false;
    }
  }, [
    currentStep,
    target,
    frontUri,
    backUri,
    documentNumber,
    startDate,
    expiryDate,
    insuranceProviderId,
    aiRunning,
    frontIsPdf,
    pdfPreviewUri,
    pdfRasterizing,
    pdfRasterFailed,
  ]);

  const handleSave = async () => {
    if (!target) return;
    if (!frontUri) {
      Alert.alert("Missing image", "Please upload the document image first.");
      return;
    }
    setBusy(true);
    try {
      const isVehicle = kind === "vehicle";
      if (isVehicle && !vehicleId) {
        Alert.alert("Missing vehicle", "No vehicle is selected for this upload.");
        return;
      }
      const ownerId = isVehicle ? (vehicleId as string) : partnerId;

      let frontUrl: string | null = frontUri;
      let backUrl: string | null = backUri;
      // For PDF uploads we substitute the rasterized PNG (first page) so the
      // bucket only ever stores image files. If rasterization didn't produce
      // a PNG we refuse to save — the user can retry rasterization or pick a
      // different file.
      const uploadFrontUri =
        frontIsPdf && frontUri && !frontUri.startsWith("http")
          ? pdfPreviewUri
          : frontUri;
      if (frontIsPdf && frontUri && !frontUri.startsWith("http") && !pdfPreviewUri) {
        Alert.alert(
          "PDF not converted",
          "Couldn't convert this PDF to an image. Please retry or upload a different file."
        );
        return;
      }
      // If they're local file uris, upload them.
      if (uploadFrontUri && !uploadFrontUri.startsWith("http")) {
        frontUrl = isVehicle
          ? await uploadVehicleDocFile(uploadFrontUri, ownerId, target.docId, "front")
          : await uploadProviderDocFile(uploadFrontUri, ownerId, target.docId, "front");
        if (!frontUrl) {
          Alert.alert("Upload failed", "Couldn't upload the document. Try again.");
          return;
        }
      }
      // For a tagged Taxi Driver Permit: if the AI detected the driver's
      // portrait, crop that region out of the front image and save it as a
      // SEPARATE image file. The permit card uses this cropped photo directly.
      let permitPhotoUrl: string | null = null;
      const permitBox = target.flags.isTaxiPermit
        ? aiResult?.extracted?.taxiPermit?.photoBox ?? null
        : null;
      if (!isVehicle && permitBox && uploadFrontUri) {
        const localCrop = await cropImageRegionToFile(uploadFrontUri, permitBox);
        if (localCrop) {
          permitPhotoUrl = await uploadProviderDocFile(
            localCrop,
            ownerId,
            target.docId,
            "permit-photo"
          );
          if (!permitPhotoUrl) {
            console.log("[doc-upload] permit portrait crop uploaded failed");
          }
        } else {
          console.log("[doc-upload] permit portrait crop produced no file");
        }
      }

      if (target.flags.requireFrontBack && backUri && !backUri.startsWith("http")) {
        backUrl = isVehicle
          ? await uploadVehicleDocFile(backUri, ownerId, target.docId, "back")
          : await uploadProviderDocFile(backUri, ownerId, target.docId, "back");
        if (!backUrl) {
          Alert.alert("Upload failed", "Couldn't upload the back image. Try again.");
          return;
        }
      }
      const sharedPayload = {
        authUserId,
        docId: target.docId,
        docName: target.docName,
        documentNumber: target.flags.requireDocumentNumber
          ? documentNumber.trim()
          : null,
        insuranceProviderId: target.flags.requireInsuranceProvider
          ? insuranceProviderId || null
          : null,
        insuranceProviderName: target.flags.requireInsuranceProvider
          ? insuranceProviderName || null
          : null,
        issuanceCountry: aiResult?.extracted?.issuanceCountry ?? null,
        detectedDocumentName:
          aiResult?.extracted?.documentName ??
          aiResult?.detectedTitle ??
          null,
        isPwd: target.flags.isPwd ? isPwd : false,
        startDate: target.flags.requireStartDate ? startDate || null : null,
        expiryDate: target.flags.requireExpiryDate ? expiryDate || null : null,
        fileUrl: frontUrl,
        fileUrlBack: target.flags.requireFrontBack ? backUrl : null,
        aiVerification: permitPhotoUrl
          ? aiResultWithPermitPhoto(aiResult, permitPhotoUrl)
          : aiResult,
      };
      const saved: AnyDocumentRow | null = isVehicle
        ? await upsertVehicleDocument({
            ...sharedPayload,
            vehicleId: ownerId,
            partnerId: partnerId || null,
          })
        : await upsertProviderDocument({
            ...sharedPayload,
            partnerId: ownerId,
          });
      if (!saved) {
        Alert.alert("Save failed", "Couldn't save the document. Try again.");
        return;
      }
      onSaved?.(saved);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;

  const StepHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.stepTitle, { color: Colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.stepSubtitle, { color: Colors.textSecondary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  const renderAiPanel = () => {
    const passed = aiResult?.matchesTitle === true;
    const failed = aiAttempted && !aiRunning && !!aiResult && !aiResult.matchesTitle;
    const unreachable = aiAttempted && !aiRunning && !aiResult;
    const pct = aiResult ? Math.round((aiResult.confidence ?? 0) * 100) : 0;
    const accent = passed
      ? "#059669"
      : failed
        ? "#dc2626"
        : unreachable
          ? "#d97706"
          : Colors.accent;
    const IconCmp = passed
      ? Check
      : failed
        ? ShieldX
        : unreachable
          ? AlertTriangle
          : Sparkles;
    return (
      <View>
        <View
          style={[
            styles.aiCard,
            { backgroundColor: accent + "12", borderColor: accent + "55" },
          ]}
        >
          <View style={[styles.aiIcon, { backgroundColor: accent }]}>
            {aiRunning ? (
              <ActivityIndicator color={Colors.secondary} />
            ) : (
              <IconCmp color={Colors.secondary} size={20} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.aiTitle, { color: Colors.text }]}>
              {aiRunning
                ? "Verifying your document\u2026"
                : passed
                  ? "Looks legit"
                  : failed
                    ? "This doesn't look right"
                    : unreachable
                      ? "Couldn't reach AI verifier"
                      : "Preparing AI check"}
            </Text>
            {!aiRunning && aiResult ? (
              <>
                <Text style={[styles.aiReason, { color: Colors.textSecondary }]}>
                  {aiResult.reason || "No additional details."}
                </Text>
                {aiResult.detectedTitle ? (
                  <Text style={[styles.aiMeta, { color: Colors.textSecondary }]}>
                    Detected: {aiResult.detectedTitle} \u00b7 Confidence {pct}%
                  </Text>
                ) : (
                  <Text style={[styles.aiMeta, { color: Colors.textSecondary }]}>
                    Confidence {pct}%
                  </Text>
                )}
              </>
            ) : null}
            {!aiRunning && unreachable ? (
              <Text style={[styles.aiReason, { color: Colors.textSecondary }]}>
                The AI service didn't respond. You can retry or continue \u2014 an admin will still review the upload manually.
              </Text>
            ) : null}
            {!aiRunning && autofilledFields.length > 0 ? (
              <View
                style={[
                  styles.autofillPill,
                  { backgroundColor: Colors.accent + "20", borderColor: Colors.accent + "55" },
                ]}
              >
                <Sparkles color={Colors.accent} size={12} />
                <Text style={[styles.autofillText, { color: Colors.accent }]} numberOfLines={2}>
                  Auto-filled: {autofilledFields.join(", ")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {!aiRunning ? (
          <View style={[styles.rowBtns, { marginTop: 10 }]}>
            <TouchableOpacity
              onPress={() => {
                setAiOverride(false);
                void runAiVerification();
              }}
              style={[styles.secondaryBtn, { borderColor: Colors.accent }]}
              testID="doc-ai-retry"
              accessibilityRole="button"
            >
              <RefreshCw color={Colors.accent} size={16} />
              <Text style={[styles.secondaryBtnText, { color: Colors.accent }]}>
                {aiAttempted ? "Re-run check" : "Run check"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!aiRunning && (failed || unreachable) ? (
          <TouchableOpacity
            onPress={() => setAiOverride((v) => !v)}
            activeOpacity={0.85}
            style={[
              styles.overrideRow,
              {
                backgroundColor: Colors.gray[100],
                borderColor: aiOverride ? accent : Colors.border,
              },
            ]}
            testID="doc-ai-override"
            accessibilityRole="button"
          >
            <View
              style={[
                styles.overrideBox,
                {
                  backgroundColor: aiOverride ? accent : "transparent",
                  borderColor: aiOverride ? accent : Colors.border,
                },
              ]}
            >
              {aiOverride ? <Check color={Colors.secondary} size={12} /> : null}
            </View>
            <Text style={[styles.overrideText, { color: Colors.text }]}>
              Continue anyway and ask an admin to review.
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const renderTaxiPermitCard = () => {
    const tp = aiResult?.extracted?.taxiPermit ?? null;
    const rows: { label: string; value: string }[] = [
      { label: "Name", value: tp?.name ?? "" },
      { label: "ID Number", value: tp?.idNumber ?? "" },
      { label: "Validity From", value: tp?.validityFrom ?? "" },
      { label: "Validity To", value: tp?.validityTo ?? "" },
      { label: "Driver Type", value: tp?.driverType ?? "" },
      { label: "Licence Reference No.", value: tp?.licenceReferenceNumber ?? "" },
      { label: "Vehicle Number", value: tp?.vehicleNumber ?? "" },
      { label: "Licence Class", value: tp?.licenceClass ?? "" },
      { label: "Company Name", value: tp?.companyName ?? "" },
      { label: "Address", value: tp?.address ?? "" },
      {
        label: "Image on Permit",
        value: tp?.hasImageOnPermit == null ? "" : tp.hasImageOnPermit ? "Detected" : "Not detected",
      },
      {
        label: "QR Code",
        value: tp?.hasQrCode == null ? "" : tp.hasQrCode ? "Detected" : "Not detected",
      },
    ];
    return (
      <View
        style={[
          styles.permitCard,
          { backgroundColor: Colors.gray[100], borderColor: Colors.border },
        ]}
      >
        <View style={styles.permitHeader}>
          <Sparkles color={Colors.accent} size={14} />
          <Text style={[styles.permitTitle, { color: Colors.text }]}>
            Taxi driver permit details
          </Text>
        </View>
        <Text style={[styles.permitSub, { color: Colors.textSecondary }]}>
          {tp
            ? "Read from the permit image. Blank fields couldn't be read clearly."
            : aiRunning
              ? "Scanning the permit\u2026"
              : "Upload a clear permit image to capture these fields."}
        </Text>
        {rows.map((r) => (
          <View key={r.label} style={styles.permitRow}>
            <Text
              style={[styles.permitLabel, { color: Colors.textSecondary }]}
              numberOfLines={1}
            >
              {r.label}
            </Text>
            <Text
              style={[
                styles.permitValue,
                { color: r.value ? Colors.text : Colors.textSecondary },
              ]}
              numberOfLines={2}
            >
              {r.value || "\u2014"}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderStep = () => {
    switch (currentStep) {
      case "source":
        return (
          <View>
            <StepHeader
              title={`Upload ${target.docName}`}
              subtitle="Choose how you'd like to add this document."
            />
            <TouchableOpacity
              onPress={() => onSelectSource("camera")}
              style={[
                styles.sourceCard,
                { borderColor: Colors.accent, backgroundColor: Colors.accent + "10" },
              ]}
              testID="doc-source-snap"
              accessibilityRole="button"
            >
              <View style={[styles.sourceIcon, { backgroundColor: Colors.accent }]}>
                <Camera color={Colors.onAccent} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sourceTitle, { color: Colors.text }]}>
                  Snap a photo
                </Text>
                <Text style={[styles.sourceDesc, { color: Colors.textSecondary }]}>
                  Use your camera to capture the document.
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSelectSource("library")}
              style={[
                styles.sourceCard,
                { borderColor: Colors.border, backgroundColor: Colors.gray[100] },
              ]}
              testID="doc-source-upload"
              accessibilityRole="button"
            >
              <View style={[styles.sourceIcon, { backgroundColor: Colors.gray[200] }]}>
                <ImageIcon color={Colors.text} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sourceTitle, { color: Colors.text }]}>
                  Upload from gallery
                </Text>
                <Text style={[styles.sourceDesc, { color: Colors.textSecondary }]}>
                  Pick an image you've already saved.
                </Text>
              </View>
              <ChevronRight color={Colors.textSecondary} size={18} />
            </TouchableOpacity>
            {target.flags.allowPdfUpload ? (
              <TouchableOpacity
                onPress={() => onSelectSource("pdf")}
                style={[
                  styles.sourceCard,
                  { borderColor: Colors.border, backgroundColor: Colors.gray[100] },
                ]}
                testID="doc-source-pdf"
                accessibilityRole="button"
              >
                <View style={[styles.sourceIcon, { backgroundColor: Colors.gray[200] }]}>
                  <FileText color={Colors.text} size={22} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sourceTitle, { color: Colors.text }]}>
                    Upload PDF document
                  </Text>
                  <Text style={[styles.sourceDesc, { color: Colors.textSecondary }]}>
                    Pick a PDF from your device. An admin will review it.
                  </Text>
                </View>
                <ChevronRight color={Colors.textSecondary} size={18} />
              </TouchableOpacity>
            ) : null}
          </View>
        );
      case "front":
      case "back": {
        const isBack = currentStep === "back";
        const uri = isBack ? backUri : frontUri;
        const showAsPdf = !isBack && frontIsPdf;
        // Show the AI panel on the LAST image step (back if required, else front).
        // For PDFs the AI panel lives on the front step (there is no back step).
        const showAi = frontIsPdf
          ? !isBack
          : target.flags.requireFrontBack
            ? isBack
            : !isBack;
        return (
          <View>
            <StepHeader
              title={
                showAsPdf
                  ? "PDF document"
                  : isBack
                    ? "Back of document"
                    : "Front of document"
              }
              subtitle={
                showAsPdf
                  ? "Your PDF will be reviewed by an admin."
                  : isBack
                    ? "Snap or upload the back side."
                    : "Make sure the photo is clear and all details are readable."
              }
            />
            {uri && showAsPdf ? (
              <View
                style={[
                  styles.previewEmpty,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border, borderStyle: "solid" as const },
                ]}
              >
                {pdfPreviewUri ? (
                  <Image
                    source={{ uri: pdfPreviewUri }}
                    style={styles.preview}
                    resizeMode="cover"
                  />
                ) : (
                  <FileText color={Colors.accent} size={42} />
                )}
                <Text style={[styles.previewEmptyText, { color: Colors.text, fontWeight: "700" as const }]} numberOfLines={1}>
                  PDF attached
                </Text>
                <Text style={[styles.previewEmptyText, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {uri.split("/").pop() ?? "document.pdf"}
                </Text>
                {pdfRasterizing && !pdfPreviewUri ? (
                  <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8, marginTop: 6 }}>
                    <ActivityIndicator color={Colors.accent} />
                    <Text style={[styles.previewEmptyText, { color: Colors.textSecondary }]}>
                      Preparing first page for AI check…
                    </Text>
                  </View>
                ) : null}
                {pdfRasterFailed ? (
                  <Text style={[styles.previewEmptyText, { color: "#d97706" }]} numberOfLines={2}>
                    Couldn't read this PDF on-device. An admin will still review it manually.
                  </Text>
                ) : null}
              </View>
            ) : uri ? (
              <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
            ) : (
              <View
                style={[
                  styles.previewEmpty,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
              >
                <ImageIcon color={Colors.textSecondary} size={36} />
                <Text style={[styles.previewEmptyText, { color: Colors.textSecondary }]}>
                  No image yet
                </Text>
              </View>
            )}
            <View style={styles.rowBtns}>
              <TouchableOpacity
                onPress={isBack ? replaceBack : replaceFront}
                style={[styles.secondaryBtn, { borderColor: Colors.accent }]}
                testID={`doc-replace-${isBack ? "back" : "front"}`}
                accessibilityRole="button"
              >
                <RefreshCw color={Colors.accent} size={16} />
                <Text style={[styles.secondaryBtnText, { color: Colors.accent }]}>
                  {uri ? "Replace" : "Add image"}
                </Text>
              </TouchableOpacity>
            </View>
            {showAi && uri ? <View style={{ height: 14 }} />: null}
            {showAi && uri ? renderAiPanel() : null}
            {frontIsPdf && frontUri && pdfRasterizing && !pdfPreviewUri && !pdfRasterFailed ? (
              <PdfRasterizer
                uri={frontUri}
                onResult={(dataUrl) => {
                  setPdfRasterizing(false);
                  if (dataUrl) {
                    setPdfPreviewUri(dataUrl);
                  } else {
                    setPdfRasterFailed(true);
                  }
                }}
              />
            ) : null}
          </View>
        );
      }
      case "documentNumber":
        return (
          <View>
            <StepHeader
              title="Document number"
              subtitle={
                candidateNumbers.length > 1
                  ? "We found more than one number on this document. Pick the right one or edit it below."
                  : "Enter the number printed on this document."
              }
            />
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <Hash color={Colors.textSecondary} size={16} />
              <TextInput
                value={documentNumber}
                onChangeText={setDocumentNumber}
                placeholder="e.g. ABC-123456"
                placeholderTextColor={Colors.textSecondary}
                style={[styles.input, { color: Colors.text }]}
                autoCapitalize="characters"
                testID="doc-number-input"
                accessibilityLabel="e.g. ABC-123456"
              />
            </View>

            {candidateNumbers.length > 1 ? (
              <TouchableOpacity
                onPress={() => setShowNumberPicker(true)}
                style={[
                  styles.candidateBanner,
                  {
                    backgroundColor: Colors.accent + "12",
                    borderColor: Colors.accent + "55",
                  },
                ]}
                testID="doc-number-open-picker"
                accessibilityRole="button"
              >
                <Sparkles color={Colors.accent} size={14} />
                <Text
                  style={[styles.candidateBannerText, { color: Colors.accent }]}
                  numberOfLines={2}
                >
                  {`AI found ${candidateNumbers.length} possible numbers — tap to choose`}
                </Text>
                <ChevronRight color={Colors.accent} size={16} />
              </TouchableOpacity>
            ) : null}
          </View>
        );
      case "startDate":
        return (
          <DateSpinner
            title="Start date"
            subtitle="When did this document become valid?"
            value={startDate}
            onChange={setStartDate}
            icon={<CalendarIcon color={Colors.textSecondary} size={16} />}
            Colors={Colors}
            testID="doc-start-date"
          />
        );
      case "expiryDate":
        return (
          <DateSpinner
            title="Expiry date"
            subtitle="The document is automatically marked expired after this date."
            value={expiryDate}
            onChange={setExpiryDate}
            icon={<CalendarClock color={Colors.textSecondary} size={16} />}
            Colors={Colors}
            minimumDate={parseISODate(startDate) ?? undefined}
            testID="doc-expiry-date"
          />
        );
      case "insuranceProvider":
        return (
          <View>
            <StepHeader
              title="Insurance provider"
              subtitle="Select the provider this document was issued by."
            />
            {insuranceProviders.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: Colors.gray[100], borderColor: Colors.border },
                ]}
              >
                <ShieldAlert color={Colors.textSecondary} size={18} />
                <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                  No insurance providers configured yet.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                {insuranceProviders.map((p: SettingEntry) => {
                  const selected = insuranceProviderId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => setInsuranceProviderId(p.id)}
                      style={[
                        styles.providerRow,
                        {
                          backgroundColor: selected
                            ? Colors.accent + "15"
                            : Colors.gray[100],
                          borderColor: selected ? Colors.accent : Colors.border,
                        },
                      ]}
                      testID={`doc-insurance-${p.id}`}
                      accessibilityRole="button"
                    >
                      <View
                        style={[
                          styles.providerIcon,
                          {
                            backgroundColor: selected
                              ? Colors.accent
                              : Colors.gray[200],
                          },
                        ]}
                      >
                        <ShieldAlert
                          color={selected ? Colors.secondary : Colors.textSecondary}
                          size={16}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.providerName, { color: Colors.text }]}
                          numberOfLines={1}
                        >
                          {String(p.values.name ?? "Unnamed")}
                        </Text>
                        {p.values.type ? (
                          <Text
                            style={[styles.providerType, { color: Colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            {String(p.values.type)}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? (
                        <Check color={Colors.accent} size={18} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        );
      case "isPwd":
        return (
          <View>
            <StepHeader
              title="PWD document"
              subtitle="Is this document related to People with Disability status?"
            />
            <View
              style={[
                styles.toggleRow,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              <View
                style={[
                  styles.toggleIcon,
                  { backgroundColor: isPwd ? Colors.accent : Colors.gray[200] },
                ]}
              >
                <Accessibility
                  color={isPwd ? Colors.secondary : Colors.textSecondary}
                  size={18}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, { color: Colors.text }]}>
                  Mark as PWD document
                </Text>
                <Text style={[styles.toggleSub, { color: Colors.textSecondary }]}>
                  Turn on if this certifies disability status.
                </Text>
              </View>
              <Switch value={isPwd} onValueChange={setIsPwd} testID="doc-is-pwd" accessibilityLabel="Mark as PWD document" />
            </View>
          </View>
        );
      case "review":
        return (
          <View>
            <StepHeader
              title="Review & submit"
              subtitle="Once submitted, your document will be marked Pending Review."
            />
            <View
              style={[
                styles.reviewCard,
                { backgroundColor: Colors.gray[100], borderColor: Colors.border },
              ]}
            >
              {frontUri ? (
                frontIsPdf ? (
                  <View
                    style={[
                      styles.reviewImage,
                      {
                        backgroundColor: Colors.gray[100],
                        alignItems: "center" as const,
                        justifyContent: "center" as const,
                      },
                    ]}
                  >
                    <FileText color={Colors.accent} size={32} />
                  </View>
                ) : (
                  <Image source={{ uri: frontUri }} style={styles.reviewImage} />
                )
              ) : null}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.reviewName, { color: Colors.text }]}>
                  {target.docName}
                </Text>
                {target.flags.requireDocumentNumber && documentNumber ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    No.: {documentNumber}
                  </Text>
                ) : null}
                {target.flags.requireStartDate && startDate ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    Start: {startDate}
                  </Text>
                ) : null}
                {target.flags.requireExpiryDate && expiryDate ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    Expiry: {expiryDate}
                  </Text>
                ) : null}
                {target.flags.requireInsuranceProvider && insuranceProviderName ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    Provider: {insuranceProviderName}
                  </Text>
                ) : null}
                {target.flags.isPwd ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    PWD: {isPwd ? "Yes" : "No"}
                  </Text>
                ) : null}
                {target.flags.requireFrontBack ? (
                  <Text style={[styles.reviewLine, { color: Colors.textSecondary }]}>
                    Back image: {backUri ? "Attached" : "Missing"}
                  </Text>
                ) : null}
                {aiResult ? (
                  <Text
                    style={[
                      styles.reviewLine,
                      {
                        color: aiResult.matchesTitle ? "#059669" : "#d97706",
                        fontWeight: "700" as const,
                      },
                    ]}
                  >
                    AI: {aiResult.matchesTitle ? "Passed" : "Flagged"} \u00b7 {Math.round((aiResult.confidence ?? 0) * 100)}%
                  </Text>
                ) : null}
              </View>
            </View>
            {target.flags.isTaxiPermit ? renderTaxiPermitCard() : null}
          </View>
        );
      default:
        return null;
    }
  };

  const isReview = currentStep === "review";
  const isSource = currentStep === "source";

  const renderNumberPicker = () => (
    <Modal
      visible={showNumberPicker}
      animationType="fade"
      transparent
      onRequestClose={() => setShowNumberPicker(false)}
    >
      <View style={styles.pickerBackdrop}>
        <View
          style={[styles.pickerSheet, { backgroundColor: Colors.background }]}
        >
          <View style={[styles.header, { borderBottomColor: Colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
                Pick the correct number
              </Text>
              <Text style={[styles.headerSub, { color: Colors.textSecondary }]}>
                AI read these from the document
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowNumberPicker(false)}
              style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
              testID="doc-number-picker-close"
              accessibilityRole="button"
            >
              <X color={Colors.text} size={20} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {candidateNumbers.map((n) => {
              const selected = documentNumber.trim() === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => {
                    setDocumentNumber(n);
                    setShowNumberPicker(false);
                  }}
                  style={[
                    styles.providerRow,
                    {
                      backgroundColor: selected
                        ? Colors.accent + "15"
                        : Colors.gray[100],
                      borderColor: selected ? Colors.accent : Colors.border,
                    },
                  ]}
                  testID={`doc-number-candidate-${n}`}
                  accessibilityRole="button"
                >
                  <View
                    style={[
                      styles.providerIcon,
                      {
                        backgroundColor: selected
                          ? Colors.accent
                          : Colors.gray[200],
                      },
                    ]}
                  >
                    <Hash
                      color={selected ? Colors.secondary : Colors.textSecondary}
                      size={16}
                    />
                  </View>
                  <Text
                    style={[
                      styles.providerName,
                      { color: Colors.text, flex: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {n}
                  </Text>
                  {selected ? <Check color={Colors.accent} size={18} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
          <View style={[styles.header, { borderBottomColor: Colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>
                {target.docName}
              </Text>
              <Text style={[styles.headerSub, { color: Colors.textSecondary }]}>
                Step {stepIdx + 1} of {steps.length}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
              testID="doc-modal-close"
              accessibilityRole="button"
            >
              <X color={Colors.text} size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${((stepIdx + 1) / Math.max(1, steps.length)) * 100}%`,
                  backgroundColor: Colors.accent,
                },
              ]}
            />
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderStep()}
          </ScrollView>

          {!isSource ? (
            <View style={[styles.footer, { borderTopColor: Colors.border }]}>
              {stepIdx > 0 ? (
                <TouchableOpacity
                  onPress={goBack}
                  disabled={busy}
                  style={[
                    styles.footerBtn,
                    {
                      backgroundColor: Colors.gray[100],
                      borderColor: Colors.border,
                      opacity: busy ? 0.5 : 1,
                    },
                  ]}
                  testID="doc-modal-back"
                  accessibilityRole="button"
                >
                  <Text style={[styles.footerBtnText, { color: Colors.text }]}>Back</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {isReview ? (
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={busy}
                  style={[
                    styles.footerBtn,
                    styles.footerPrimary,
                    {
                      backgroundColor: Colors.accent,
                      opacity: busy ? 0.6 : 1,
                    },
                  ]}
                  testID="doc-modal-submit"
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={Colors.onAccent} />
                  ) : (
                    <Text style={[styles.footerBtnText, { color: Colors.onAccent }]}>
                      Submit
                    </Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={goNext}
                  disabled={!canProceedFromCurrent || busy}
                  style={[
                    styles.footerBtn,
                    styles.footerPrimary,
                    {
                      backgroundColor: Colors.accent,
                      opacity: canProceedFromCurrent ? 1 : 0.5,
                    },
                  ]}
                  testID="doc-modal-next"
                  accessibilityRole="button"
                >
                  <Text style={[styles.footerBtnText, { color: Colors.onAccent }]}>
                    Continue
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
      </View>
      {renderNumberPicker()}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
    minHeight: "60%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerTitle: { fontSize: 16, fontWeight: "800" as const },
  headerSub: { fontSize: 11, marginTop: 2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBar: {
    height: 3,
    width: "100%",
    backgroundColor: "transparent",
  },
  progressFill: { height: 3 },
  body: { padding: 20, paddingBottom: 24 },
  stepTitle: { fontSize: 20, fontWeight: "800" as const, marginBottom: 4 },
  stepSubtitle: { fontSize: 13 },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  sourceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceTitle: { fontSize: 15, fontWeight: "700" as const },
  sourceDesc: { fontSize: 12, marginTop: 2 },
  preview: {
    width: "100%",
    height: 240,
    borderRadius: 14,
    marginBottom: 12,
  },
  previewEmpty: {
    width: "100%",
    height: 200,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    gap: 6,
  },
  previewEmptyText: { fontSize: 12 },
  rowBtns: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "700" as const },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 48,
    fontSize: 15,
  },
  helperBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 6,
  },
  helperBtnText: { fontSize: 12, fontWeight: "700" as const },
  spinnerWrap: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyText: { fontSize: 12, flex: 1 },
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  providerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  providerName: { fontSize: 14, fontWeight: "700" as const },
  providerType: { fontSize: 11, marginTop: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  toggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleTitle: { fontSize: 14, fontWeight: "700" as const },
  toggleSub: { fontSize: 11, marginTop: 2 },
  reviewCard: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  reviewImage: { width: 84, height: 84, borderRadius: 10 },
  reviewName: { fontSize: 15, fontWeight: "800" as const },
  reviewLine: { fontSize: 12 },
  permitCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  permitHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  permitTitle: { fontSize: 13, fontWeight: "800" as const },
  permitSub: { fontSize: 11 },
  permitRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
  },
  permitLabel: { fontSize: 12, width: 140 },
  permitValue: { fontSize: 12, fontWeight: "600" as const, flex: 1, textAlign: "right" as const },
  aiCard: {
    flexDirection: "row" as const,
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  aiIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  aiTitle: { fontSize: 15, fontWeight: "800" as const, marginBottom: 4 },
  aiReason: { fontSize: 12, lineHeight: 17 },
  aiMeta: { fontSize: 11, marginTop: 6, fontWeight: "700" as const },
  overrideRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  overrideBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  overrideText: { fontSize: 12, flex: 1 },
  autofillPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    alignSelf: "flex-start" as const,
  },
  autofillText: { fontSize: 11, fontWeight: "700" as const, flexShrink: 1 },
  candidateBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  candidateBannerText: { fontSize: 12, fontWeight: "700" as const, flex: 1 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    paddingHorizontal: 20,
  },
  pickerSheet: {
    borderRadius: 20,
    maxHeight: "70%" as const,
    overflow: "hidden" as const,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
  },
  footerBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  footerPrimary: { borderWidth: 0 },
  footerBtnText: { fontSize: 14, fontWeight: "800" as const },
});
