import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import createContextHook from "@nkzw/create-context-hook";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";
import {
  enabledStorageKey,
  fetchPendingUploads,
  purgeExpired,
  saveRecording,
  uploadRecording,
} from "@/utils/voiceProtectionStore";

/**
 * VoiceProtection runtime controller.
 *
 * Owns the per-profile enabled toggle (persisted locally), the microphone
 * recorder used during a ride, the 24h local purge, and the background listener
 * that fulfils admin upload requests by uploading the still-retained local file.
 *
 * Recordings are NEVER played back or surfaced to the user from here — the only
 * exit path for the audio is an admin-triggered upload.
 */
export const [VoiceProtectionProvider, useVoiceProtection] = createContextHook(() => {
  const { authState } = useAuth();
  const profileId: string | null = authState.userId ?? null;

  const [enabled, setEnabled] = useState<boolean>(false);
  const [loadingEnabled, setLoadingEnabled] = useState<boolean>(true);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recordingActiveRef = useRef<boolean>(false);
  const startedAtRef = useRef<number | null>(null);
  const activeRideRef = useRef<{ rideId: string | null; label: string | null } | null>(null);

  // ---- Load persisted toggle whenever the signed-in profile changes --------
  useEffect(() => {
    let active = true;
    (async () => {
      if (!profileId) {
        if (active) {
          setEnabled(false);
          setLoadingEnabled(false);
        }
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(enabledStorageKey(profileId));
        if (active) setEnabled(raw === "1");
      } catch {
        if (active) setEnabled(false);
      } finally {
        if (active) setLoadingEnabled(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  const setEnabledPersisted = useCallback(
    async (value: boolean) => {
      setEnabled(value);
      if (!profileId) return;
      try {
        await AsyncStorage.setItem(enabledStorageKey(profileId), value ? "1" : "0");
      } catch (e) {
        console.log("[voiceProtection] persist toggle failed", e);
      }
    },
    [profileId]
  );

  // ---- Purge expired local recordings on mount / profile change ------------
  useEffect(() => {
    if (!profileId) return;
    void purgeExpired(profileId);
  }, [profileId]);

  // ---- Recording lifecycle (driven by the ride screen) ---------------------
  const startTripRecording = useCallback(
    async (ride: { rideId?: string | null; label?: string | null }) => {
      if (!enabled || !profileId) return;
      if (Platform.OS === "web") {
        // No reliable always-on mic capture in the simulator/web preview.
        console.log("[voiceProtection] recording not supported on web preview");
        return;
      }
      if (recordingActiveRef.current) return; // already recording
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          console.log("[voiceProtection] microphone permission denied");
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
        recordingActiveRef.current = true;
        startedAtRef.current = Date.now();
        activeRideRef.current = {
          rideId: ride.rideId ?? null,
          label: ride.label ?? null,
        };
        setIsRecording(true);
        console.log("[voiceProtection] trip recording started", ride.rideId);
      } catch (e) {
        console.log("[voiceProtection] startTripRecording failed", e);
        recordingActiveRef.current = false;
        startedAtRef.current = null;
      }
    },
    [enabled, profileId, recorder]
  );

  const stopTripRecording = useCallback(async () => {
    if (!recordingActiveRef.current || !profileId) {
      recordingActiveRef.current = false;
      startedAtRef.current = null;
      setIsRecording(false);
      return;
    }
    recordingActiveRef.current = false;
    setIsRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const durationSec = startedAtRef.current
        ? (Date.now() - startedAtRef.current) / 1000
        : 0;
      const ride = activeRideRef.current;
      if (uri) {
        await saveRecording({
          profileId,
          tempUri: uri,
          durationSec,
          rideId: ride?.rideId ?? null,
          rideLabel: ride?.label ?? null,
        });
        console.log("[voiceProtection] trip recording saved", { durationSec });
      }
    } catch (e) {
      console.log("[voiceProtection] stopTripRecording failed", e);
    } finally {
      startedAtRef.current = null;
      activeRideRef.current = null;
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        /* ignore */
      }
    }
  }, [profileId, recorder]);

  // ---- Fulfil admin upload requests ----------------------------------------
  const runPendingUploads = useCallback(async () => {
    if (!profileId) return;
    const pending = await fetchPendingUploads(profileId);
    for (const rec of pending) {
      await uploadRecording(rec);
    }
  }, [profileId]);

  // Poll on mount + subscribe to realtime so the device reacts to admin
  // upload requests even while the app is open.
  useEffect(() => {
    if (!profileId || !isSupabaseConfigured || !supabase) return;
    void runPendingUploads();
    const channel = supabase
      .channel(`voice_protection_${profileId}_${uuidv4()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "voice_protection_recordings",
          filter: `profile_id=eq.${profileId}`,
        },
        (payload) => {
          const row = payload.new as { upload_requested?: boolean; uploaded?: boolean };
          if (row?.upload_requested && !row?.uploaded) {
            void runPendingUploads();
          }
        }
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [profileId, runPendingUploads]);

  return {
    enabled,
    loadingEnabled,
    isRecording,
    setEnabled: setEnabledPersisted,
    startTripRecording,
    stopTripRecording,
  };
});
