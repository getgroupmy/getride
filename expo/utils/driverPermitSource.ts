import {
  fetchUserProfile,
  findOrCreatePartner,
  type PartnerProfileRow,
  type UserProfileRow,
} from "@/utils/partnerOnboardingStore";
import {
  fetchProviderDocuments,
  type ProviderDocumentRow,
} from "@/utils/providerDocumentsStore";
import { loadDocumentSourceAssignments } from "@/utils/serviceAssignmentsStore";
import {
  verifyDocumentWithAi,
  type TaxiPermitFields,
} from "@/utils/documentAiVerify";
import * as ImageManipulator from "expo-image-manipulator";
import { Image } from "react-native";

export interface DriverPermitData {
  name: string;
  driverType: string;
  icNumber: string;
  /** IC/NRIC number taken from the partner/user profile (for display). */
  profileIcNumber: string | null;
  /**
   * All IC/NRIC candidates from the profile sources (partner profile + user
   * profile). Validation passes when the permit IC matches ANY of these, so a
   * freshly-updated user profile isn't blocked by a stale partner record.
   */
  profileIcCandidates: string[];
  /** IC/NRIC number extracted from the permit document itself (for validation). */
  permitIcNumber: string | null;
  /** Raw (unformatted) permit expiry date string, for expiry checks. */
  expiryDateRaw: string | null;
  permitNumber: string;
  vehiclePlate: string;
  licenseClass: string;
  companyClass: string;
  issueDate: string;
  expiryDate: string;
  address: string;
  authority: string;
  photoUri: string;
  /** True when at least one field came from the linked required-document upload. */
  linked: boolean;
  /** The provider_documents row used as source, if found. */
  sourceDoc: ProviderDocumentRow | null;
  /** The required-document id configured in Assign Service → Driver Permit. */
  requiredDocumentId: string | null;
  /** Display name of the configured required document, if known. */
  requiredDocumentName: string | null;
}

const PERMIT_FEATURE_ID = "driver-permit" as const;
const REQUIRED_DOCS_KEY = "required-documents" as const;

type SettingEntry = {
  id: string;
  values?: Record<string, unknown> & { name?: unknown };
};

type GetEntries = (key: string) => SettingEntry[];

const FALLBACK_PERMIT: Omit<DriverPermitData, "linked" | "sourceDoc" | "requiredDocumentId" | "requiredDocumentName"> = {
  name: "—",
  driverType: "—",
  icNumber: "—",
  permitNumber: "—",
  vehiclePlate: "—",
  licenseClass: "—",
  companyClass: "TEKSI",
  issueDate: "—",
  expiryDate: "—",
  address: "—",
  authority: "KETUA PENGARAH",
  photoUri:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}/${mm}/${yy}`;
}

function firstString(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return null;
}

/**
 * Re-run AI extraction on an already-uploaded permit file to recover the
 * permit fields. Used to self-heal documents that were scanned before newer
 * fields (name, portrait photo box) were added to extraction. Returns null on
 * any failure so the caller falls back to existing values.
 */
async function recoverPermitFields(
  fileUrl: string,
  fileUrlBack: string | null,
  docName: string
): Promise<TaxiPermitFields | null> {
  try {
    const result = await verifyDocumentWithAi(fileUrl, fileUrlBack, {
      docName,
      isTaxiPermit: true,
    });
    const recovered = result?.extracted?.taxiPermit ?? null;
    if (recovered) {
      console.log("[driverPermitSource] recovered permit fields via re-scan");
    }
    return recovered;
  } catch (e) {
    console.log("[driverPermitSource] recoverPermitFields failed", e);
    return null;
  }
}

/**
 * Crop the driver's portrait photo out of the full permit image using the
 * AI-detected bounding box (fractions of image size). Returns a JPEG data URL
 * of just the face/headshot, or null when the crop can't be produced (so the
 * caller keeps the previous photo).
 */
async function cropPermitPhoto(
  fileUrl: string,
  box: { x: number; y: number; width: number; height: number }
): Promise<string | null> {
  try {
    const size = await new Promise<{ w: number; h: number } | null>(
      (resolve) => {
        Image.getSize(
          fileUrl,
          (w, h) => resolve({ w, h }),
          () => resolve(null)
        );
      }
    );
    if (!size || size.w <= 0 || size.h <= 0) return null;

    // Pad the box slightly so we don't clip the head, then clamp to bounds.
    const padX = box.width * 0.12;
    const padY = box.height * 0.12;
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
      fileUrl,
      [{ crop: { originX, originY, width, height } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );
    if (result.base64) return `data:image/jpeg;base64,${result.base64}`;
    return result.uri ?? null;
  } catch (e) {
    console.log("[driverPermitSource] cropPermitPhoto failed", e);
    return null;
  }
}

/**
 * Build the permit card payload for the current driver by reading the
 * required-document chosen in **Assign Service → Driver Permit** and pulling
 * the matching uploaded `provider_documents` row + AI-extracted fields.
 *
 * Falls back to placeholder values when nothing is configured / uploaded yet.
 */
export async function loadDriverPermitData(
  userId: string | null | undefined,
  getEntries: GetEntries,
  companyClass: string = "TEKSI"
): Promise<DriverPermitData> {
  const base: DriverPermitData = {
    ...FALLBACK_PERMIT,
    companyClass,
    profileIcNumber: null,
    profileIcCandidates: [],
    permitIcNumber: null,
    expiryDateRaw: null,
    linked: false,
    sourceDoc: null,
    requiredDocumentId: null,
    requiredDocumentName: null,
  };

  if (!userId) return base;

  try {
    const [docSources, profile] = await Promise.all([
      loadDocumentSourceAssignments(),
      fetchUserProfile(userId),
    ]);

    const requiredDocs = getEntries(REQUIRED_DOCS_KEY);

    // Prefer the required document explicitly tagged "Taxi Driver Permit
    // display" (isTaxiPermit). Fall back to the Assign Service → Driver Permit
    // assignment when no document carries the flag.
    const taggedPermitDoc = requiredDocs.find(
      (d) => d.values?.isTaxiPermit === true
    );
    const requiredDocumentId =
      taggedPermitDoc?.id ?? docSources[PERMIT_FEATURE_ID] ?? null;
    base.requiredDocumentId = requiredDocumentId;

    if (requiredDocumentId) {
      const entry = requiredDocs.find((d) => d.id === requiredDocumentId);
      base.requiredDocumentName = entry
        ? String(entry.values?.name ?? "Required document")
        : null;
    }

    const partner: PartnerProfileRow | null = await findOrCreatePartner(
      userId,
      profile
    );

    return applyPartnerAndDoc(base, profile, partner, requiredDocumentId);
  } catch (e) {
    console.log("[driverPermitSource] load failed", e);
    return base;
  }
}

async function applyPartnerAndDoc(
  base: DriverPermitData,
  profile: UserProfileRow | null,
  partner: PartnerProfileRow | null,
  requiredDocumentId: string | null
): Promise<DriverPermitData> {
  let out: DriverPermitData = { ...base };

  const name = firstString(partner?.name, profile?.name);
  const ic = firstString(partner?.ic, profile?.ic);
  const icCandidates: string[] = [];
  for (const candidate of [partner?.ic, profile?.ic]) {
    const t = firstString(candidate);
    if (t && !icCandidates.includes(t)) icCandidates.push(t);
  }
  out.profileIcCandidates = icCandidates;
  const address = firstString(partner?.address, profile?.address);
  const avatar = firstString(partner?.avatar_url, profile?.avatar_url, profile?.profile_image);

  if (name) {
    out.name = name.toUpperCase();
    out.linked = true;
  }
  if (ic) {
    out.icNumber = ic;
    out.profileIcNumber = ic;
    out.linked = true;
  }
  if (address) {
    out.address = address;
    out.linked = true;
  }
  if (avatar) {
    out.photoUri = avatar;
    out.linked = true;
  }

  if (partner?.id) {
    try {
      const rows = await fetchProviderDocuments(partner.id);
      // Prefer the exact tagged/required permit document. If that strict match
      // fails (doc uploaded under a different id, missing requiredDocumentId,
      // etc.), fall back to any uploaded document that actually has a viewable
      // file so the "View uploaded document" link still works.
      const exact = requiredDocumentId
        ? rows.find((r) => r.doc_id === requiredDocumentId) ?? null
        : null;
      const taxiTagged = rows.find(
        (r) => !!r.file_url && !!r.ai_verification?.extracted?.taxiPermit
      );
      const anyWithFile = rows.find((r) => !!r.file_url);
      const match = exact ?? taxiTagged ?? anyWithFile ?? null;
      if (!exact && match) {
        console.log(
          "[driverPermitSource] no exact doc match; using fallback source doc:",
          match.id
        );
      }
      out.sourceDoc = match;
      if (match) {
        out.linked = true;
        const extracted = match.ai_verification?.extracted ?? null;
        const permitNumber = firstString(
          match.document_number,
          extracted?.documentNumber,
          extracted?.documentNumbers?.[0]
        );
        if (permitNumber) out.permitNumber = permitNumber;
        const startDate = match.start_date ?? extracted?.startDate ?? null;
        const expiryDate = match.expiry_date ?? extracted?.expiryDate ?? null;
        if (startDate) out.issueDate = formatDate(startDate);
        if (expiryDate) {
          out.expiryDate = formatDate(expiryDate);
          out.expiryDateRaw = expiryDate;
        }
        const detectedName = firstString(
          match.detected_document_name,
          extracted?.documentName
        );
        if (detectedName) out.licenseClass = detectedName.toUpperCase();

        // Overlay the AI-extracted taxi-permit fields when this document was
        // uploaded as a tagged taxi driver permit.
        let permitFields = extracted?.taxiPermit ?? null;
        if (!permitFields) {
          // Non-permit source document: use the uploaded file as the photo.
          if (match.file_url) out.photoUri = match.file_url;
        }
        if (permitFields) {
          // Self-heal: documents scanned before newer fields (name, portrait
          // photo box) were added won't have them stored. Re-run extraction on
          // the stored file to recover them when missing.
          const needsName = !firstString(permitFields.name);
          const needsPhoto =
            permitFields.hasImageOnPermit !== false && !permitFields.photoBox;
          if ((needsName || needsPhoto) && match.file_url) {
            const recovered = await recoverPermitFields(
              match.file_url,
              match.file_url_back ?? null,
              match.doc_name ?? "Taxi Driver Permit"
            );
            if (recovered) {
              permitFields = {
                ...permitFields,
                name: firstString(permitFields.name, recovered.name),
                photoBox: permitFields.photoBox ?? recovered.photoBox ?? null,
                hasImageOnPermit:
                  permitFields.hasImageOnPermit ??
                  recovered.hasImageOnPermit ??
                  null,
              };
            }
          }

          // Prefer the cropped portrait that was saved as a SEPARATE image
          // file at upload time. This is the canonical source for the permit
          // card avatar — no client-side cropping needed.
          const savedPhoto = firstString(permitFields.photoUrl);
          if (savedPhoto) {
            out.photoUri = savedPhoto;
            out.linked = true;
          } else if (permitFields.photoBox && match.file_url) {
            // Legacy / self-heal path: documents saved before the cropped file
            // was generated fall back to cropping the stored front image.
            const cropped = await cropPermitPhoto(
              match.file_url,
              permitFields.photoBox
            );
            if (cropped) {
              out.photoUri = cropped;
              out.linked = true;
            } else {
              console.log(
                "[driverPermitSource] photoBox present but crop failed; keeping avatar/placeholder"
              );
            }
          } else {
            console.log(
              "[driverPermitSource] no photoBox on permit; keeping avatar/placeholder"
            );
          }

          const pName = firstString(permitFields.name);
          if (pName) {
            out.name = pName.toUpperCase();
            out.linked = true;
          }
          const pDriverType = firstString(permitFields.driverType);
          if (pDriverType) out.driverType = pDriverType.toUpperCase();
          const pIc = firstString(permitFields.idNumber);
          if (pIc) {
            out.icNumber = pIc;
            out.permitIcNumber = pIc;
          }
          const pRef = firstString(permitFields.licenceReferenceNumber);
          if (pRef) out.permitNumber = pRef;
          const pVehicle = firstString(permitFields.vehicleNumber);
          if (pVehicle) out.vehiclePlate = pVehicle.toUpperCase();
          const pClass = firstString(permitFields.licenceClass);
          if (pClass) out.licenseClass = pClass.toUpperCase();
          const pCompany = firstString(permitFields.companyName);
          if (pCompany) out.companyClass = pCompany.toUpperCase();
          const pAddress = firstString(permitFields.address);
          if (pAddress) out.address = pAddress;
          if (permitFields.validityFrom) {
            out.issueDate = formatDate(permitFields.validityFrom);
          }
          if (permitFields.validityTo) {
            out.expiryDate = formatDate(permitFields.validityTo);
            out.expiryDateRaw = permitFields.validityTo;
          }
        }
      }
    } catch (e) {
      console.log("[driverPermitSource] fetchProviderDocuments threw", e);
    }
  }

  return out;
}
