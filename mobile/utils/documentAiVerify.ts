/**
 * AI document verifier — sends the uploaded image(s) to the Rork toolkit
 * vision LLM and asks a strict yes/no on whether the picture is a real
 * document that matches the expected title.
 *
 * The endpoint mirrors how `profile-photo.tsx` already calls the toolkit
 * (`/text/llm/` returning `{ completion: string }`), so no extra
 * infrastructure is required.
 */

import * as ImageManipulator from "expo-image-manipulator";
import { Image, Platform } from "react-native";

/**
 * Convert a local file:// (or content://) image URI to a base64 data URL that
 * the Rork toolkit vision LLM can fetch. Also downscales the image so we
 * don't blow past payload limits.
 *
 * If the URI is already an http(s) URL or a data URL, it's returned as-is.
 * Returns null when the conversion fails so the caller can fall back to the
 * original URI.
 */
export async function imageUriToDataUrl(
  uri: string,
  opts?: { maxWidth?: number; quality?: number }
): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith("data:")) return uri;
  if (/^https?:\/\//i.test(uri)) return uri;
  const maxWidth = opts?.maxWidth ?? 1280;
  const quality = opts?.quality ?? 0.7;
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      {
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );
    if (!result.base64) {
      console.log("[doc-ai] manipulateAsync returned no base64");
      return null;
    }
    return `data:image/jpeg;base64,${result.base64}`;
  } catch (e) {
    console.log("[doc-ai] imageUriToDataUrl threw", e, "platform=", Platform.OS);
    return null;
  }
}

export interface DocumentAiVerificationContext {
  docName: string;
  documentNumber?: string | null;
  insuranceProviderName?: string | null;
  isPwd?: boolean;
  startDate?: string | null;
  expiryDate?: string | null;
  /** When true, also extract the taxi driver permit fields. */
  isTaxiPermit?: boolean;
}

/** Fields read off a partner-teksi taxi driver permit. */
export interface TaxiPermitFields {
  /** The driver's full name printed on the permit. */
  name?: string | null;
  idNumber?: string | null;
  validityFrom?: string | null; // ISO yyyy-mm-dd
  validityTo?: string | null; // ISO yyyy-mm-dd
  driverType?: string | null;
  licenceReferenceNumber?: string | null;
  vehicleNumber?: string | null;
  licenceClass?: string | null;
  companyName?: string | null;
  address?: string | null;
  /** true if a portrait photo of the driver is visible on the permit. */
  hasImageOnPermit?: boolean | null;
  /**
   * Bounding box of the driver's portrait photo on the FRONT image, as
   * fractions (0..1) of the image size. x,y is the top-left corner. null when
   * no portrait is visible.
   */
  photoBox?: { x: number; y: number; width: number; height: number } | null;
  /** true if a QR code is visible on the permit. */
  hasQrCode?: boolean | null;
  /**
   * Public URL of the cropped driver portrait, saved as a separate image file
   * at upload time when a portrait was detected. Used directly as the permit
   * card avatar so no client-side cropping is needed at display time.
   */
  photoUrl?: string | null;
}

/**
 * Crop a region (expressed as fractions of the image size) out of an image and
 * return a LOCAL file uri of the cropped JPEG (no base64), suitable for
 * uploading as a separate file. Returns null when the crop can't be produced.
 */
export async function cropImageRegionToFile(
  uri: string,
  box: { x: number; y: number; width: number; height: number },
  pad: number = 0.12
): Promise<string | null> {
  if (!uri) return null;
  try {
    const size = await new Promise<{ w: number; h: number } | null>(
      (resolve) => {
        Image.getSize(
          uri,
          (w, h) => resolve({ w, h }),
          () => resolve(null)
        );
      }
    );
    if (!size || size.w <= 0 || size.h <= 0) return null;

    const padX = box.width * pad;
    const padY = box.height * pad;
    const fx = Math.max(0, box.x - padX);
    const fy = Math.max(0, box.y - padY);
    const fw = Math.min(1 - fx, box.width + padX * 2);
    const fh = Math.min(1 - fy, box.height + padY * 2);

    const originX = Math.round(fx * size.w);
    const originY = Math.round(fy * size.h);
    const width = Math.round(fw * size.w);
    const height = Math.round(fh * size.h);
    if (width <= 1 || height <= 1) return null;

    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ crop: { originX, originY, width, height } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri ?? null;
  } catch (e) {
    console.log("[doc-ai] cropImageRegionToFile failed", e);
    return null;
  }
}

export interface DocumentExtractedFields {
  documentNumber?: string | null;
  /**
   * All candidate document numbers the AI could read on the document, in the
   * order they appear. Includes the primary number as well as secondary ones
   * (e.g. issuance / serial / reference numbers). Used to let the partner pick
   * the correct one when more than one is detected.
   */
  documentNumbers?: string[];
  startDate?: string | null; // ISO yyyy-mm-dd
  expiryDate?: string | null; // ISO yyyy-mm-dd
  insuranceProviderName?: string | null;
  isPwd?: boolean | null;
  /** Country that issued the document (e.g. "Philippines"). */
  issuanceCountry?: string | null;
  /** AI's reading of the official document name (often more specific than the requested title). */
  documentName?: string | null;
  /** Populated only when the verification was run for a taxi driver permit. */
  taxiPermit?: TaxiPermitFields | null;
}

export interface DocumentAiVerificationResult {
  isReal: boolean;
  isRelevant: boolean;
  confidence: number; // 0..1
  matchesTitle: boolean;
  detectedTitle: string;
  reason: string;
  // Fields the AI read off the document so we can auto-fill the next steps.
  extracted?: DocumentExtractedFields;
  // Always recorded for audit, even when checks fail.
  rawText?: string;
  verifiedAt: string;
}

const SYSTEM_PROMPT = `You are a strict document verifier for a partner onboarding flow.
You receive one or two images of a single identity / compliance document and a target document title.
Decide ONLY from the visual evidence — do not assume.

Reject (isReal=false) when ANY of these is true:
- The image is a screenshot of a screen, a photocopy of a photocopy, a drawing, a sketch, or AI generated.
- The image is blank, blurred beyond readability, or clearly not a document (selfie, landscape, random object, meme).
- The document is obviously tampered (mismatched fonts, cut-and-paste artefacts, photoshop seams).

Set isRelevant=false when the document is real but is NOT the requested type (e.g. user uploaded a passport when the title says "Driver's License").

matchesTitle is the AND of "looks like a real official document" and "matches the requested title".
detectedTitle is your best short label for what the document actually is (e.g. "Philippine Driver's License", "Vehicle Insurance Certificate", "National ID").
confidence is 0..1.
reason is one short sentence in plain English explaining the decision.

ALSO extract the following fields directly from the visible document text — only when clearly legible. Use null (not empty string) when you cannot read the field. Do NOT invent values.
- documentNumber: the SINGLE most prominent number / ID / policy / license number printed on the document.
- documentNumbers: an ARRAY of EVERY distinct number-like identifier visible on the document (license no., policy no., serial no., reference no., barcode digits, etc.). Include the primary one too. Trim whitespace. Use [] if none are legible.
- startDate: issue / effective / valid-from date as ISO yyyy-mm-dd (convert any other format).
- expiryDate: expiry / valid-until date as ISO yyyy-mm-dd.
- insuranceProviderName: name of the insurance company/issuer if this is an insurance document, else null.
- isPwd: true if the document explicitly references PWD / Person With Disability status, else false.
- issuanceCountry: the country that issued the document, spelled out in English (e.g. "Philippines", "United States"), null if not determinable.
- documentName: the OFFICIAL name printed on the document itself (e.g. "Non-Professional Driver's License", "Certificate of Cover"), null if not legible.

Respond ONLY with compact JSON of the exact shape:
{"isReal":boolean,"isRelevant":boolean,"matchesTitle":boolean,"detectedTitle":string,"confidence":number,"reason":string,"extracted":{"documentNumber":string|null,"documentNumbers":string[],"startDate":string|null,"expiryDate":string|null,"insuranceProviderName":string|null,"isPwd":boolean|null,"issuanceCountry":string|null,"documentName":string|null}}`;

const TAXI_PERMIT_INSTRUCTIONS = `This document is a TAXI DRIVER PERMIT. In addition to the base fields, also read these permit fields directly from the visible text and add them under "extracted.taxiPermit". Use null when a field is not clearly legible and never invent values:
- name: the driver's full name printed on the permit.
- idNumber: the driver's ID / IC / national identity number printed on the permit.
- validityFrom: validity start / valid-from date as ISO yyyy-mm-dd.
- validityTo: validity end / valid-until date as ISO yyyy-mm-dd.
- driverType: the driver type / category text (e.g. "Taxi", "e-Hailing").
- licenceReferenceNumber: the licence reference / permit number.
- vehicleNumber: the vehicle registration / plate number on the permit.
- licenceClass: the licence class text.
- companyName: the operator / company name printed on the permit.
- address: the address printed on the permit.
- hasImageOnPermit: true if a portrait photo of the driver (a person's face/headshot) is visible on the permit, else false.
- photoBox: when hasImageOnPermit is true, the bounding box of the driver's portrait photo on image 1 (the FRONT), expressed as fractions of the image size: {"x":number,"y":number,"width":number,"height":number} where x,y is the TOP-LEFT corner (0..1) and width,height are fractions (0..1). Make the box tight around the face/headshot. Use null when no portrait photo is visible.
- hasQrCode: true if a QR code is visible on the permit, else false.
When this instruction is present, append "taxiPermit" to the "extracted" object with the exact keys: {"name":string|null,"idNumber":string|null,"validityFrom":string|null,"validityTo":string|null,"driverType":string|null,"licenceReferenceNumber":string|null,"vehicleNumber":string|null,"licenceClass":string|null,"companyName":string|null,"address":string|null,"hasImageOnPermit":boolean|null,"photoBox":{"x":number,"y":number,"width":number,"height":number}|null,"hasQrCode":boolean|null}`;

interface ToolkitTextResponse {
  completion?: string;
}

interface LlmContentPart {
  type: "text" | "image";
  text?: string;
  image?: string;
}

const buildUserParts = (
  frontUri: string,
  backUri: string | null,
  ctx: DocumentAiVerificationContext
): LlmContentPart[] => {
  const meta: string[] = [];
  meta.push(`Target document title: "${ctx.docName}".`);
  if (ctx.documentNumber)
    meta.push(`Partner says the document number is "${ctx.documentNumber}".`);
  if (ctx.insuranceProviderName)
    meta.push(`Partner says the insurer is "${ctx.insuranceProviderName}".`);
  if (ctx.startDate) meta.push(`Stated start date: ${ctx.startDate}.`);
  if (ctx.expiryDate) meta.push(`Stated expiry date: ${ctx.expiryDate}.`);
  if (ctx.isPwd) meta.push("Partner claims this is a PWD (disability) document.");
  if (ctx.isTaxiPermit) meta.push(TAXI_PERMIT_INSTRUCTIONS);
  meta.push(
    backUri
      ? "Image 1 is the FRONT, image 2 is the BACK."
      : "Only the FRONT side was provided."
  );
  meta.push("Return ONLY the JSON object specified by the system message.");

  const parts: LlmContentPart[] = [
    { type: "text", text: meta.join(" ") },
    { type: "image", image: frontUri },
  ];
  if (backUri) parts.push({ type: "image", image: backUri });
  return parts;
};

const parseLlmJson = (raw: string): Partial<DocumentAiVerificationResult> | null => {
  const trimmed = raw.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Partial<DocumentAiVerificationResult>;
  } catch (e) {
    console.log("[doc-ai] JSON parse failed", e);
    return null;
  }
};

/**
 * Run an AI verification against the uploaded document image(s).
 * Returns null when the verifier is unreachable or returns an unparseable
 * response. The caller decides what to do in that case (we let the upload
 * proceed but flag `ai_verified=null`).
 */
export async function verifyDocumentWithAi(
  frontUri: string,
  backUri: string | null,
  ctx: DocumentAiVerificationContext
): Promise<DocumentAiVerificationResult | null> {
  if (!frontUri) return null;
  const toolkitUrl =
    process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "https://toolkit.rork.com";
  try {
    // The toolkit server can't reach local file:// URIs from the device, so
    // we always pre-convert to a downscaled base64 data URL.
    const frontPayload = (await imageUriToDataUrl(frontUri)) ?? frontUri;
    const backPayload = backUri ? (await imageUriToDataUrl(backUri)) ?? backUri : null;
    const res = await fetch(`${toolkitUrl}/text/llm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserParts(frontPayload, backPayload, ctx) },
        ],
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.log("[doc-ai] verifier non-OK", res.status, bodyText.slice(0, 200));
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as ToolkitTextResponse;
    const raw = String(data.completion ?? "").trim();
    const parsed = parseLlmJson(raw);
    if (!parsed) return null;
    const ex = (parsed.extracted ?? {}) as Partial<DocumentExtractedFields>;
    const normDate = (v: unknown): string | null => {
      if (!v || typeof v !== "string") return null;
      const s = v.trim();
      if (!s) return null;
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (iso) return s;
      const t = Date.parse(s);
      if (Number.isNaN(t)) return null;
      const d = new Date(t);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };
    const normStr = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const s = v.trim();
      return s.length > 0 ? s.slice(0, 120) : null;
    };
    const normBox = (
      v: unknown
    ): { x: number; y: number; width: number; height: number } | null => {
      if (!v || typeof v !== "object") return null;
      const o = v as Record<string, unknown>;
      const num = (k: unknown): number | null => {
        const n = Number(k);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(1, n));
      };
      const x = num(o.x);
      const y = num(o.y);
      const width = num(o.width);
      const height = num(o.height);
      if (x == null || y == null || width == null || height == null) return null;
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    };
    const normTaxiPermit = (v: unknown): TaxiPermitFields | null => {
      if (!v || typeof v !== "object") return null;
      const o = v as Record<string, unknown>;
      return {
        name: normStr(o.name),
        idNumber: normStr(o.idNumber),
        validityFrom: normDate(o.validityFrom),
        validityTo: normDate(o.validityTo),
        driverType: normStr(o.driverType),
        licenceReferenceNumber: normStr(o.licenceReferenceNumber),
        vehicleNumber: normStr(o.vehicleNumber),
        licenceClass: normStr(o.licenceClass),
        companyName: normStr(o.companyName),
        address: normStr(o.address),
        hasImageOnPermit:
          typeof o.hasImageOnPermit === "boolean" ? o.hasImageOnPermit : null,
        photoBox: normBox(o.photoBox),
        hasQrCode: typeof o.hasQrCode === "boolean" ? o.hasQrCode : null,
        photoUrl: null,
      };
    };
    return {
      isReal: Boolean(parsed.isReal),
      isRelevant: Boolean(parsed.isRelevant),
      matchesTitle: Boolean(parsed.matchesTitle ?? (parsed.isReal && parsed.isRelevant)),
      detectedTitle: String(parsed.detectedTitle ?? "").slice(0, 120),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      reason: String(parsed.reason ?? "").slice(0, 400),
      extracted: {
        documentNumber: normStr(ex.documentNumber),
        documentNumbers: Array.isArray(ex.documentNumbers)
          ? Array.from(
              new Set(
                (ex.documentNumbers as unknown[])
                  .map((v) => normStr(v))
                  .filter((v): v is string => !!v)
              )
            ).slice(0, 12)
          : [],
        startDate: normDate(ex.startDate),
        expiryDate: normDate(ex.expiryDate),
        insuranceProviderName: normStr(ex.insuranceProviderName),
        isPwd: typeof ex.isPwd === "boolean" ? ex.isPwd : null,
        issuanceCountry: normStr(ex.issuanceCountry),
        documentName: normStr(ex.documentName),
        taxiPermit: ctx.isTaxiPermit ? normTaxiPermit(ex.taxiPermit) : null,
      },
      rawText: raw.slice(0, 1000),
      verifiedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.log("[doc-ai] verifier threw", e);
    return null;
  }
}
