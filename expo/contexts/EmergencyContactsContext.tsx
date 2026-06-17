import { useCallback, useEffect, useMemo, useState } from "react";
import createContextHook from "@nkzw/create-context-hook";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isSupabaseConfigured, supabase, uuidv4 } from "@/utils/supabase";
import { useAuth } from "@/contexts/AuthContext";

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
};

type ContactRow = {
  id: string;
  profile_id: string;
  name: string;
  phone: string;
  created_at?: string;
};

async function fetchContacts(profileId: string): Promise<EmergencyContact[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("id, name, phone, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) {
    console.log("[emergencyContacts] fetch error", error.message);
    throw error;
  }
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, phone: r.phone }));
}

export const [EmergencyContactsProvider, useEmergencyContacts] = createContextHook(() => {
  const { authState } = useAuth();
  const profileId: string | null = authState.userId ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["emergency-contacts", profileId] as const, [profileId]);

  const enabled: boolean = !!profileId && isSupabaseConfigured && !!supabase;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchContacts(profileId as string),
    enabled,
  });

  const [saving, setSaving] = useState<boolean>(false);

  const addContact = useCallback(
    async (name: string, phone: string): Promise<boolean> => {
      if (!profileId || !isSupabaseConfigured || !supabase) return false;
      setSaving(true);
      try {
        const id = uuidv4();
        const { error } = await supabase
          .from("emergency_contacts")
          .insert({ id, profile_id: profileId, name, phone });
        if (error) {
          console.log("[emergencyContacts] add error", error.message);
          return false;
        }
        await queryClient.invalidateQueries({ queryKey });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [profileId, queryClient, queryKey]
  );

  const updateContact = useCallback(
    async (id: string, name: string, phone: string): Promise<boolean> => {
      if (!profileId || !isSupabaseConfigured || !supabase) return false;
      setSaving(true);
      try {
        const { error } = await supabase
          .from("emergency_contacts")
          .update({ name, phone })
          .eq("id", id);
        if (error) {
          console.log("[emergencyContacts] update error", error.message);
          return false;
        }
        await queryClient.invalidateQueries({ queryKey });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [profileId, queryClient, queryKey]
  );

  const deleteContact = useCallback(
    async (id: string): Promise<boolean> => {
      if (!profileId || !isSupabaseConfigured || !supabase) return false;
      setSaving(true);
      try {
        const { error } = await supabase.from("emergency_contacts").delete().eq("id", id);
        if (error) {
          console.log("[emergencyContacts] delete error", error.message);
          return false;
        }
        await queryClient.invalidateQueries({ queryKey });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [profileId, queryClient, queryKey]
  );

  useEffect(() => {
    if (!enabled || !profileId || !supabase) return;
    const channel = supabase
      .channel(`emergency_contacts_${profileId}_${uuidv4()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "emergency_contacts",
          filter: `profile_id=eq.${profileId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [enabled, profileId, queryClient, queryKey]);

  return {
    contacts: query.data ?? [],
    isLoading: query.isLoading,
    isSyncing: saving,
    isConfigured: enabled,
    refetch: query.refetch,
    addContact,
    updateContact,
    deleteContact,
  };
});
