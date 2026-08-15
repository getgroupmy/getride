/**
 * The rider's own SOS contacts.
 *
 * The legacy app kept these entirely inside a React context, so the rules about
 * what counts as a usable contact lived in a component and could not be tested.
 * They are separated here: the validation and de-duplication are pure, and only
 * the four IO functions touch Supabase.
 *
 * Rows are owner-scoped (`emergency_contacts own select/insert/update`), so
 * every call needs a real Supabase session — a contact that cannot be read back
 * in an emergency is worse than none, which is why a failed write is surfaced
 * rather than swallowed.
 */

import { getSupabaseOrThrow, isSupabaseConfigured, supabase } from "@/utils/supabase";

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  createdAt?: string | null;
}

export interface ContactDraft {
  name?: string;
  phone?: string;
}

export interface ContactValidation {
  ok: boolean;
  /** User-facing reason the draft was rejected. */
  error?: string;
  value?: { name: string; phone: string };
}

/** The most contacts one account may store. */
export const MAX_EMERGENCY_CONTACTS = 5;

/** Digits, and the punctuation people actually type into a phone field. */
const PHONE_ALLOWED = /^[+()\-\s\d]+$/;

/** Comparable form of a number, so "012-345 6789" and "0123456789" are one contact. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * Validate and clean up an "add contact" draft.
 *
 * A phone number is required and a name is not merely cosmetic: in an emergency
 * the rider is picking from a list under stress, so an unnamed row is rejected
 * rather than shown as a bare number.
 */
export function validateContact(draft: ContactDraft): ContactValidation {
  const name = (draft.name ?? "").trim();
  const rawPhone = (draft.phone ?? "").trim();

  if (name.length < 2) {
    return { ok: false, error: "Enter a name for this contact." };
  }
  if (rawPhone.length === 0) {
    return { ok: false, error: "Enter a phone number." };
  }
  if (!PHONE_ALLOWED.test(rawPhone)) {
    return { ok: false, error: "That phone number has characters we can't dial." };
  }

  const digits = normalizePhone(rawPhone);
  if (digits.length < 7) {
    return { ok: false, error: "That phone number looks too short." };
  }
  if (digits.length > 15) {
    // E.164 caps at 15 digits.
    return { ok: false, error: "That phone number looks too long." };
  }

  return { ok: true, value: { name, phone: rawPhone } };
}

/** True when `phone` already belongs to a contact in `list`. */
export function isDuplicate(list: EmergencyContact[], phone: string): boolean {
  const digits = normalizePhone(phone);
  if (!digits) return false;
  return list.some((c) => normalizePhone(c.phone) === digits);
}

/**
 * Whether another contact may be added, and why not when it may not.
 * Kept separate from `validateContact` because a full list is a fact about the
 * account rather than about the draft.
 */
export function canAddContact(
  list: EmergencyContact[],
  draft: ContactDraft
): ContactValidation {
  const base = validateContact(draft);
  if (!base.ok || !base.value) return base;

  if (list.length >= MAX_EMERGENCY_CONTACTS) {
    return {
      ok: false,
      error: `You can save up to ${MAX_EMERGENCY_CONTACTS} contacts. Remove one first.`,
    };
  }
  if (isDuplicate(list, base.value.phone)) {
    return { ok: false, error: "That number is already saved." };
  }
  return base;
}

// ------------------------------- IO -------------------------------

function toContact(row: Record<string, unknown>): EmergencyContact {
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    phone: typeof row.phone === "string" ? row.phone : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

export async function fetchContacts(profileId: string): Promise<EmergencyContact[]> {
  if (!isSupabaseConfigured || !supabase || !profileId) return [];
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("id, name, phone, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toContact(r as Record<string, unknown>));
}

export async function addContact(
  profileId: string,
  draft: ContactDraft,
  existing: EmergencyContact[]
): Promise<EmergencyContact> {
  const check = canAddContact(existing, draft);
  if (!check.ok || !check.value) throw new Error(check.error ?? "That contact is not valid.");

  const { data, error } = await getSupabaseOrThrow()
    .from("emergency_contacts")
    .insert({ profile_id: profileId, name: check.value.name, phone: check.value.phone })
    .select("id, name, phone, created_at")
    .single();
  if (error) throw new Error(error.message);
  return toContact(data as Record<string, unknown>);
}

export async function removeContact(id: string): Promise<void> {
  const { error } = await getSupabaseOrThrow()
    .from("emergency_contacts")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
