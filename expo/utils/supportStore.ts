import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Support system data layer.
 *
 * Tickets are conversations tied to a profile. Each ticket holds chat
 * messages that can carry text, image, video, voice note, or location
 * attachments, plus WhatsApp-style read receipts (sent / delivered / read).
 * Admins can also place calls to users (signaling only — see support_calls).
 */

export const SUPPORT_MEDIA_BUCKET = "support-media";

export type SupportRole = "user" | "admin";
export type SupportTicketStatus = "open" | "in_progress" | "pending" | "closed";

/** Customer-facing label + the operational stage for each ticket status. */
export const SUPPORT_STATUS_META: Record<
  SupportTicketStatus,
  { label: string; stage: string; description: string; color: string }
> = {
  open: {
    label: "New",
    stage: "Open",
    description: "Your ticket has been received but not yet reviewed by a support agent.",
    color: "#3B82F6",
  },
  in_progress: {
    label: "In Progress",
    stage: "Open",
    description: "An agent has reviewed your ticket and is actively working on a solution.",
    color: "#8B5CF6",
  },
  pending: {
    label: "Waiting for Reply",
    stage: "Pending",
    description: "The support team needs more information from you to proceed.",
    color: "#F59E0B",
  },
  closed: {
    label: "Resolved",
    stage: "Closed",
    description: "The issue has been addressed and the ticket is closed.",
    color: "#10B981",
  },
};

export const SUPPORT_STATUS_ORDER: SupportTicketStatus[] = [
  "open",
  "in_progress",
  "pending",
  "closed",
];
export type SupportMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "location";
export type SupportMessageStatus = "sent" | "delivered" | "read";
export type SupportCallStatus =
  | "ringing"
  | "accepted"
  | "declined"
  | "ended"
  | "missed";
export type SupportCallMedia = "voice" | "video";

export interface SupportTicket {
  id: string;
  ticket_number: number | null;
  profile_id: string;
  subject: string;
  status: SupportTicketStatus;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_role: SupportRole | null;
  unread_admin: number;
  unread_user: number;
  assigned_admin_id: string | null;
  assigned_admin_name: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined profile fields (optional, populated by list queries). */
  profile?: {
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
    profile_image: string | null;
  } | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_role: SupportRole;
  sender_id: string | null;
  sender_name: string | null;
  type: SupportMessageType;
  body: string | null;
  media_url: string | null;
  media_duration: number | null;
  latitude: number | null;
  longitude: number | null;
  status: SupportMessageStatus;
  created_at: string;
}

export interface SupportCall {
  id: string;
  ticket_id: string | null;
  profile_id: string;
  caller_role: "admin";
  caller_name: string | null;
  media: SupportCallMedia;
  status: SupportCallStatus;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

function guessExt(uri: string, fallback: string): string {
  const lower = uri.toLowerCase().split("?")[0];
  const m = lower.match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : fallback;
}

function contentTypeFor(type: SupportMessageType, ext: string): string {
  if (type === "image") {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/png";
  }
  if (type === "video") {
    if (ext === "mov") return "video/quicktime";
    return "video/mp4";
  }
  if (type === "audio") {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "wav") return "audio/wav";
    if (ext === "webm") return "audio/webm";
    return "audio/m4a";
  }
  return "application/octet-stream";
}

/** Upload a local media file to the support bucket and return its public URL. */
export async function uploadSupportMedia(
  localUri: string,
  ticketId: string,
  type: SupportMessageType
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const fallbackExt =
      type === "image" ? "jpg" : type === "video" ? "mp4" : "m4a";
    const ext = guessExt(localUri, fallbackExt);
    const ct = contentTypeFor(type, ext);
    const path = `${ticketId}/${type}-${Date.now()}-${uuidv4().slice(0, 8)}.${ext}`;
    let body: ArrayBuffer;
    if (localUri.startsWith("data:")) {
      const commaIdx = localUri.indexOf(",");
      body = decodeBase64(commaIdx >= 0 ? localUri.slice(commaIdx + 1) : "");
    } else if (localUri.startsWith("http")) {
      body = await (await fetch(localUri)).arrayBuffer();
    } else {
      const b64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      body = decodeBase64(b64);
    }
    const { error } = await supabase.storage
      .from(SUPPORT_MEDIA_BUCKET)
      .upload(path, body, { contentType: ct, upsert: true });
    if (error) {
      console.log("[support] media upload error", error.message);
      return null;
    }
    const { data: pub } = supabase.storage
      .from(SUPPORT_MEDIA_BUCKET)
      .getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch (e) {
    console.log("[support] media upload threw", e);
    return null;
  }
}

/**
 * Return the user's open ticket, creating one if none exists. Used by the
 * user/partner side where a single conversation thread is enough.
 */
export async function getOrCreateTicket(
  profileId: string,
  subject = "Support"
): Promise<SupportTicket | null> {
  if (!isSupabaseConfigured || !supabase || !profileId) return null;
  try {
    const { data: existing } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("profile_id", profileId)
      .neq("status", "closed")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing as SupportTicket;

    // New tickets land in the assignment pool UNASSIGNED so an admin can triage
    // and assign them (or pick them up) from the pool screen.
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({
        profile_id: profileId,
        subject,
      })
      .select("*")
      .single();
    if (error) {
      console.log("[support] create ticket error", error.message);
      return null;
    }
    return data as SupportTicket;
  } catch (e) {
    console.log("[support] getOrCreateTicket threw", e);
    return null;
  }
}

/** User/partner: list this profile's own tickets, newest activity first. */
export async function fetchTicketsForProfile(
  profileId: string
): Promise<SupportTicket[]> {
  if (!isSupabaseConfigured || !supabase || !profileId) return [];
  try {
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("profile_id", profileId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) {
      console.log("[support] fetchTicketsForProfile error", error.message);
      return [];
    }
    return (data as SupportTicket[]) ?? [];
  } catch (e) {
    console.log("[support] fetchTicketsForProfile threw", e);
    return [];
  }
}

/** Admin: fetch every ticket with the requester's profile basics joined. */
export async function fetchAllTickets(): Promise<SupportTicket[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("support_tickets")
      .select(
        "*, profile:profiles!support_tickets_profile_id_fkey(name, phone, avatar_url, profile_image)"
      )
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) {
      console.log("[support] fetchAllTickets error", error.message);
      return [];
    }
    return (data as SupportTicket[]) ?? [];
  } catch (e) {
    console.log("[support] fetchAllTickets threw", e);
    return [];
  }
}

export async function fetchTicket(
  ticketId: string
): Promise<SupportTicket | null> {
  if (!isSupabaseConfigured || !supabase || !ticketId) return null;
  try {
    const { data, error } = await supabase
      .from("support_tickets")
      .select(
        "*, profile:profiles!support_tickets_profile_id_fkey(name, phone, avatar_url, profile_image)"
      )
      .eq("id", ticketId)
      .maybeSingle();
    if (error) {
      console.log("[support] fetchTicket error", error.message);
      return null;
    }
    return (data as SupportTicket) ?? null;
  } catch (e) {
    console.log("[support] fetchTicket threw", e);
    return null;
  }
}

export async function fetchMessages(
  ticketId: string
): Promise<SupportMessage[]> {
  if (!isSupabaseConfigured || !supabase || !ticketId) return [];
  try {
    const { data, error } = await supabase
      .from("support_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (error) {
      console.log("[support] fetchMessages error", error.message);
      return [];
    }
    return (data as SupportMessage[]) ?? [];
  } catch (e) {
    console.log("[support] fetchMessages threw", e);
    return [];
  }
}

export interface SendMessageInput {
  ticketId: string;
  senderRole: SupportRole;
  senderId: string | null;
  senderName?: string | null;
  type?: SupportMessageType;
  body?: string | null;
  mediaUrl?: string | null;
  mediaDuration?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Insert a message and bump the parent ticket's summary + unread counters. */
export async function sendMessage(
  input: SendMessageInput
): Promise<SupportMessage | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const type = input.type ?? "text";
  try {
    const { data, error } = await supabase
      .from("support_messages")
      .insert({
        ticket_id: input.ticketId,
        sender_role: input.senderRole,
        sender_id: input.senderId,
        sender_name: input.senderName ?? null,
        type,
        body: input.body ?? null,
        media_url: input.mediaUrl ?? null,
        media_duration: input.mediaDuration ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        status: "sent",
      })
      .select("*")
      .single();
    if (error) {
      console.log("[support] sendMessage error", error.message);
      return null;
    }
    await bumpTicketSummary(input.ticketId, input.senderRole, summaryText(type, input.body));
    return data as SupportMessage;
  } catch (e) {
    console.log("[support] sendMessage threw", e);
    return null;
  }
}

function summaryText(type: SupportMessageType, body?: string | null): string {
  if (type === "image") return "📷 Photo";
  if (type === "video") return "🎬 Video";
  if (type === "audio") return "🎤 Voice message";
  if (type === "location") return "📍 Location";
  return (body ?? "").trim() || "Message";
}

async function bumpTicketSummary(
  ticketId: string,
  senderRole: SupportRole,
  text: string
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { data: ticket } = await supabase
      .from("support_tickets")
      .select("unread_admin, unread_user")
      .eq("id", ticketId)
      .maybeSingle();
    const unreadAdmin = (ticket?.unread_admin ?? 0) as number;
    const unreadUser = (ticket?.unread_user ?? 0) as number;
    // Note: ticket status is intentionally NOT changed here — only an admin can
    // move a ticket between New / In Progress / Waiting for Reply / Resolved.
    await supabase
      .from("support_tickets")
      .update({
        last_message: text,
        last_message_at: new Date().toISOString(),
        last_sender_role: senderRole,
        // Increment the counter for the *recipient* side.
        unread_admin: senderRole === "user" ? unreadAdmin + 1 : unreadAdmin,
        unread_user: senderRole === "admin" ? unreadUser + 1 : unreadUser,
      })
      .eq("id", ticketId);
  } catch (e) {
    console.log("[support] bumpTicketSummary threw", e);
  }
}

/**
 * Mark all messages from the *other* party as delivered. Call when the
 * recipient's client receives messages (chat or list subscription active).
 */
export async function markDelivered(
  ticketId: string,
  myRole: SupportRole
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase
      .from("support_messages")
      .update({ status: "delivered" })
      .eq("ticket_id", ticketId)
      .eq("status", "sent")
      .neq("sender_role", myRole);
  } catch (e) {
    console.log("[support] markDelivered threw", e);
  }
}

/**
 * Mark the other party's messages as read and clear my unread counter. Call
 * when the recipient opens the chat thread.
 */
export async function markRead(
  ticketId: string,
  myRole: SupportRole
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase
      .from("support_messages")
      .update({ status: "read" })
      .eq("ticket_id", ticketId)
      .neq("status", "read")
      .neq("sender_role", myRole);
    await supabase
      .from("support_tickets")
      .update(myRole === "admin" ? { unread_admin: 0 } : { unread_user: 0 })
      .eq("id", ticketId);
  } catch (e) {
    console.log("[support] markRead threw", e);
  }
}

export async function setTicketStatus(
  ticketId: string,
  status: SupportTicketStatus
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase
      .from("support_tickets")
      .update({ status })
      .eq("id", ticketId);
    return !error;
  } catch (e) {
    console.log("[support] setTicketStatus threw", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Calls (admin → user)
// ---------------------------------------------------------------------------

export async function startCall(input: {
  profileId: string;
  ticketId?: string | null;
  callerName?: string | null;
  media?: SupportCallMedia;
}): Promise<SupportCall | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from("support_calls")
      .insert({
        profile_id: input.profileId,
        ticket_id: input.ticketId ?? null,
        caller_role: "admin",
        caller_name: input.callerName ?? "Support",
        media: input.media ?? "voice",
        status: "ringing",
      })
      .select("*")
      .single();
    if (error) {
      console.log("[support] startCall error", error.message);
      return null;
    }
    return data as SupportCall;
  } catch (e) {
    console.log("[support] startCall threw", e);
    return null;
  }
}

export async function updateCallStatus(
  callId: string,
  status: SupportCallStatus
): Promise<SupportCall | null> {
  if (!isSupabaseConfigured || !supabase || !callId) return null;
  try {
    const patch: Record<string, unknown> = { status };
    if (status === "accepted") patch.started_at = new Date().toISOString();
    if (status === "ended" || status === "declined" || status === "missed") {
      patch.ended_at = new Date().toISOString();
    }
    const { data, error } = await supabase
      .from("support_calls")
      .update(patch)
      .eq("id", callId)
      .select("*")
      .single();
    if (error) {
      console.log("[support] updateCallStatus error", error.message);
      return null;
    }
    return data as SupportCall;
  } catch (e) {
    console.log("[support] updateCallStatus threw", e);
    return null;
  }
}

export async function fetchCall(callId: string): Promise<SupportCall | null> {
  if (!isSupabaseConfigured || !supabase || !callId) return null;
  try {
    const { data, error } = await supabase
      .from("support_calls")
      .select("*")
      .eq("id", callId)
      .maybeSingle();
    if (error) {
      console.log("[support] fetchCall error", error.message);
      return null;
    }
    return (data as SupportCall) ?? null;
  } catch (e) {
    console.log("[support] fetchCall threw", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Support agents & assignment
// ---------------------------------------------------------------------------

export interface SupportAgent {
  profile_id: string;
  name: string;
  avatar_url: string | null;
  /** Priority tag from admin_access.support ("1","2","3"…). Lower = first. */
  priority: number | null;
}

/**
 * List the admins who can handle support, ordered by their `support` priority
 * tag (lowest number first). Admins without a tag come after, so there is
 * always at least one agent to fall back on ("first in the list").
 */
export async function fetchSupportAgents(): Promise<SupportAgent[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from("admin_access")
      .select(
        "profile_id, support, page, profile:profiles(name, phone, avatar_url, profile_image)"
      );
    if (error) {
      console.log("[support] fetchSupportAgents error", error.message);
      return [];
    }
    const byProfile = new Map<string, SupportAgent>();
    for (const row of (data ?? []) as unknown as Array<{
      profile_id: string;
      support: number | null;
      profile?: {
        name: string | null;
        phone: string | null;
        avatar_url: string | null;
        profile_image: string | null;
      } | null;
    }>) {
      const existing = byProfile.get(row.profile_id);
      const priority = row.support ?? null;
      const name =
        row.profile?.name || row.profile?.phone || "Agent";
      const avatar =
        row.profile?.avatar_url || row.profile?.profile_image || null;
      if (!existing) {
        byProfile.set(row.profile_id, {
          profile_id: row.profile_id,
          name,
          avatar_url: avatar,
          priority,
        });
      } else if (priority != null && (existing.priority == null || priority < existing.priority)) {
        existing.priority = priority;
      }
    }
    const agents = Array.from(byProfile.values());
    agents.sort((a, b) => {
      if (a.priority != null && b.priority != null) return a.priority - b.priority;
      if (a.priority != null) return -1;
      if (b.priority != null) return 1;
      return a.name.localeCompare(b.name);
    });
    return agents;
  } catch (e) {
    console.log("[support] fetchSupportAgents threw", e);
    return [];
  }
}

/** Assign (or reassign) a ticket to a specific agent. */
export async function assignTicket(
  ticketId: string,
  agent: { profile_id: string | null; name: string | null }
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase
      .from("support_tickets")
      .update({
        assigned_admin_id: agent.profile_id,
        assigned_admin_name: agent.name,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", ticketId);
    if (error) {
      console.log("[support] assignTicket error", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[support] assignTicket threw", e);
    return false;
  }
}

/** Format a ticket's serial number as a human-readable reference, e.g. "TKT-001042". */
export function formatTicketNumber(num: number | null | undefined): string {
  if (num == null) return "TKT-—";
  return `TKT-${num.toString().padStart(6, "0")}`;
}

/** Format a duration in seconds as m:ss. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
