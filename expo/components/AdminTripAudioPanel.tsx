import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import {
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  Play,
  Pause,
  Clock,
  CircleSlash,
} from "lucide-react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useColors } from "@/hooks/useColors";
import {
  fetchRecordingsForProfile,
  requestUpload,
  getSignedUrl,
  formatRecordingDuration,
  type VoiceProtectionRecording,
} from "@/utils/voiceProtectionStore";
import { supabase, isSupabaseConfigured, uuidv4 } from "@/utils/supabase";

interface Props {
  profileId: string;
  ticketId: string | null;
  adminId: string | null;
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Admin-only panel surfaced inside the support chat. Lists the user's
 * VoiceProtection trip recordings and lets the agent request the device to
 * upload one, then play it back once it's available.
 */
function AdminTripAudioPanel({ profileId, ticketId, adminId }: Props) {
  const Colors = useColors();
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [recordings, setRecordings] = useState<VoiceProtectionRecording[]>([]);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  const load = useCallback(async () => {
    if (!profileId) return;
    const data = await fetchRecordingsForProfile(profileId);
    setRecordings(data);
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh while the device fulfils upload requests.
  useEffect(() => {
    if (!profileId || !isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel(`admin_voice_protection_${profileId}_${uuidv4()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voice_protection_recordings",
          filter: `profile_id=eq.${profileId}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [profileId, load]);

  // Reset the "playing" indicator when playback finishes.
  useEffect(() => {
    if (playerStatus.didJustFinish) setPlayingId(null);
  }, [playerStatus.didJustFinish]);

  const handleRequest = useCallback(
    async (rec: VoiceProtectionRecording) => {
      setRequestingId(rec.id);
      const ok = await requestUpload({ recordingId: rec.id, adminId, ticketId });
      setRequestingId(null);
      if (ok) {
        setRecordings((prev) =>
          prev.map((r) =>
            r.id === rec.id
              ? { ...r, upload_requested: true, upload_requested_at: new Date().toISOString() }
              : r
          )
        );
      }
    },
    [adminId, ticketId]
  );

  const handlePlay = useCallback(
    async (rec: VoiceProtectionRecording) => {
      if (!rec.media_url) return;
      if (playingId === rec.id) {
        player.pause();
        setPlayingId(null);
        return;
      }
      const url = await getSignedUrl(rec.media_url);
      if (!url) return;
      try {
        player.replace({ uri: url });
        player.seekTo(0);
        player.play();
        setPlayingId(rec.id);
      } catch (e) {
        console.log("[AdminTripAudioPanel] play failed", e);
      }
    },
    [player, playingId]
  );

  const pendingCount = useMemo(
    () => recordings.filter((r) => r.upload_requested && !r.uploaded && !r.unavailable).length,
    [recordings]
  );

  return (
    <View style={[styles.wrap, { borderBottomColor: Colors.border, backgroundColor: Colors.background }]}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.7}
        onPress={() => setExpanded((v) => !v)}
        testID="trip-audio-toggle"
      >
        <ShieldCheck color={Colors.accent} size={16} />
        <Text style={[styles.headerTitle, { color: Colors.text }]}>VoiceProtection trip audio</Text>
        <View style={[styles.countPill, { backgroundColor: Colors.gray[100] }]}>
          <Text style={[styles.countText, { color: Colors.textSecondary }]}>{recordings.length}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {expanded ? (
          <ChevronUp color={Colors.textSecondary} size={18} />
        ) : (
          <ChevronDown color={Colors.textSecondary} size={18} />
        )}
      </TouchableOpacity>

      {!expanded && pendingCount > 0 ? (
        <Text style={[styles.pendingHint, { color: Colors.textSecondary }]}>
          {pendingCount} upload{pendingCount > 1 ? "s" : ""} pending the user&apos;s device
        </Text>
      ) : null}

      {expanded ? (
        loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : recordings.length === 0 ? (
          <Text style={[styles.empty, { color: Colors.textSecondary }]}>
            No trip recordings. The user has VoiceProtection off, or hasn&apos;t taken a recorded
            ride in the last 24 hours.
          </Text>
        ) : (
          <View style={styles.list}>
            {recordings.map((rec) => {
              const requested = rec.upload_requested && !rec.uploaded;
              return (
                <View key={rec.id} style={[styles.row, { borderColor: Colors.border }]}>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: Colors.text }]} numberOfLines={1}>
                      {rec.ride_label || rec.ride_id || "Trip recording"}
                    </Text>
                    <Text style={[styles.rowMeta, { color: Colors.textSecondary }]}>
                      {relativeTime(rec.recorded_at)} · {formatRecordingDuration(rec.duration_sec)}
                    </Text>
                  </View>

                  {rec.uploaded && rec.media_url ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: Colors.accent }]}
                      onPress={() => handlePlay(rec)}
                      testID={`trip-audio-play-${rec.id}`}
                    >
                      {playingId === rec.id ? (
                        <Pause color="#fff" size={16} />
                      ) : (
                        <Play color="#fff" size={16} />
                      )}
                      <Text style={styles.actionText}>{playingId === rec.id ? "Pause" : "Play"}</Text>
                    </TouchableOpacity>
                  ) : rec.unavailable ? (
                    <View style={[styles.statusTag, { backgroundColor: Colors.gray[100] }]}>
                      <CircleSlash color={Colors.textSecondary} size={13} />
                      <Text style={[styles.statusTagText, { color: Colors.textSecondary }]}>Expired</Text>
                    </View>
                  ) : requested ? (
                    <View style={[styles.statusTag, { backgroundColor: Colors.warning + "22" }]}>
                      <Clock color={Colors.warning} size={13} />
                      <Text style={[styles.statusTagText, { color: Colors.warning }]}>Uploading…</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: Colors.text }]}
                      disabled={requestingId === rec.id}
                      onPress={() => handleRequest(rec)}
                      testID={`trip-audio-request-${rec.id}`}
                    >
                      {requestingId === rec.id ? (
                        <ActivityIndicator color={Colors.background} size="small" />
                      ) : (
                        <>
                          <CloudDownload color={Colors.background} size={16} />
                          <Text style={[styles.actionText, { color: Colors.background }]}>Request</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}

export default React.memo(AdminTripAudioPanel);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 13, fontWeight: "800" },
  countPill: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, alignItems: "center" },
  countText: { fontSize: 11, fontWeight: "700" },
  pendingHint: { fontSize: 11, marginTop: 6 },
  loading: { paddingVertical: 16, alignItems: "center" },
  empty: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  list: { marginTop: 10, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 13, fontWeight: "700" },
  rowMeta: { fontSize: 11, marginTop: 2 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    minWidth: 84,
    justifyContent: "center",
  },
  actionText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  statusTagText: { fontSize: 11, fontWeight: "700" },
});
