import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  Platform,
  Linking,
  KeyboardAvoidingView,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Send,
  Plus,
  Mic,
  ImageIcon,
  Video as VideoIcon,
  MapPin,
  Camera,
  Phone,
  X,
  Play,
  Pause,
  Check,
  CheckCheck,
  Square,
  FileText,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as WebBrowser from "expo-web-browser";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/utils/supabase";
import {
  fetchMessages,
  sendMessage,
  markRead,
  markDelivered,
  uploadSupportMedia,
  formatDuration,
  type SupportMessage,
  type SupportRole,
  type SupportMessageType,
} from "@/utils/supportStore";

interface SupportChatViewProps {
  ticketId: string;
  myRole: SupportRole;
  myId: string | null;
  title: string;
  subtitle?: string;
  avatarUri?: string | null;
  onBack: () => void;
  /** Admin-only: show a call button in the header. */
  onCall?: () => void;
  /** Name stored on outgoing messages (the admin/agent who is replying). */
  senderName?: string | null;
  /** Optional node rendered under the header (e.g. a status bar). */
  headerAccessory?: React.ReactNode;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Plays a remote voice note with a play/pause toggle + progress label. */
function AudioBubble({
  uri,
  duration,
  tint,
  trackColor,
}: {
  uri: string;
  duration: number | null;
  tint: string;
  trackColor: string;
}) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const total = duration ?? status.duration ?? 0;
  const current = status.currentTime ?? 0;
  const progress = total > 0 ? Math.min(1, current / total) : 0;

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || current >= total) player.seekTo(0);
      player.play();
    }
  }, [status.playing, status.didJustFinish, current, total, player]);

  return (
    <View style={styles.audioRow}>
      <TouchableOpacity onPress={toggle} style={[styles.audioBtn, { backgroundColor: tint }]}>
        {status.playing ? (
          <Pause color="#fff" size={18} fill="#fff" />
        ) : (
          <Play color="#fff" size={18} fill="#fff" />
        )}
      </TouchableOpacity>
      <View style={styles.audioMeta}>
        <View style={[styles.audioTrack, { backgroundColor: trackColor }]}>
          <View style={[styles.audioFill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
        </View>
        <Text style={[styles.audioTime, { color: trackColor }]}>
          {formatDuration(status.playing || current > 0 ? current : total)}
        </Text>
      </View>
    </View>
  );
}

export default function SupportChatView({
  ticketId,
  myRole,
  myId,
  title,
  subtitle,
  avatarUri,
  onBack,
  onCall,
  senderName,
  headerAccessory,
}: SupportChatViewProps) {
  const Colors = useColors();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [text, setText] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [attachOpen, setAttachOpen] = useState<boolean>(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const sortById = useCallback((arr: SupportMessage[]) => {
    return [...arr].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, []);

  const upsertMessage = useCallback(
    (row: SupportMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === row.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = row;
          return next;
        }
        return sortById([...prev, row]);
      });
    },
    [sortById]
  );

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // Initial load + mark read/delivered.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const rows = await fetchMessages(ticketId);
      if (!active) return;
      setMessages(sortById(rows));
      setLoading(false);
      await markDelivered(ticketId, myRole);
      await markRead(ticketId, myRole);
      scrollToEnd();
    })();
    return () => {
      active = false;
    };
  }, [ticketId, myRole, sortById, scrollToEnd]);

  // Realtime subscription for this ticket's messages.
  useEffect(() => {
    if (!supabase) return;
    const channelName = `support_messages_${ticketId}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as SupportMessage;
          if (!row?.id) return;
          if (payload.eventType === "DELETE") {
            setMessages((prev) => prev.filter((m) => m.id !== row.id));
            return;
          }
          upsertMessage(row);
          if (row.sender_role !== myRole) {
            markRead(ticketId, myRole);
            scrollToEnd();
          }
        }
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(channel);
    };
  }, [ticketId, myRole, upsertMessage, scrollToEnd]);

  const doSend = useCallback(
    async (
      partial: {
        type?: SupportMessageType;
        body?: string | null;
        mediaUrl?: string | null;
        mediaDuration?: number | null;
        latitude?: number | null;
        longitude?: number | null;
      }
    ) => {
      setSending(true);
      const optimisticId = `tmp-${Date.now()}`;
      const optimistic: SupportMessage = {
        id: optimisticId,
        ticket_id: ticketId,
        sender_role: myRole,
        sender_id: myId,
        sender_name: null,
        type: partial.type ?? "text",
        body: partial.body ?? null,
        media_url: partial.mediaUrl ?? null,
        media_duration: partial.mediaDuration ?? null,
        latitude: partial.latitude ?? null,
        longitude: partial.longitude ?? null,
        status: "sent",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => sortById([...prev, optimistic]));
      scrollToEnd();
      const saved = await sendMessage({
        ticketId,
        senderRole: myRole,
        senderId: myId,
        senderName: myRole === "admin" ? senderName ?? null : null,
        ...partial,
      });
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      if (saved) upsertMessage(saved);
      setSending(false);
    },
    [ticketId, myRole, myId, senderName, sortById, scrollToEnd, upsertMessage]
  );

  const handleSendText = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    doSend({ type: "text", body: trimmed });
  }, [text, doSend]);

  const handlePickImageOrVideo = useCallback(
    async (kind: "image" | "video", fromCamera: boolean) => {
      setAttachOpen(false);
      try {
        const mediaTypes =
          kind === "image"
            ? ImagePicker.MediaTypeOptions.Images
            : ImagePicker.MediaTypeOptions.Videos;
        let res: ImagePicker.ImagePickerResult;
        if (fromCamera) {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert("Permission needed", "Camera access is required.");
            return;
          }
          res = await ImagePicker.launchCameraAsync({ mediaTypes, quality: 0.7 });
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert("Permission needed", "Media library access is required.");
            return;
          }
          res = await ImagePicker.launchImageLibraryAsync({ mediaTypes, quality: 0.7 });
        }
        if (res.canceled || !res.assets?.length) return;
        const asset = res.assets[0];
        setSending(true);
        const url = await uploadSupportMedia(asset.uri, ticketId, kind);
        setSending(false);
        if (!url) {
          Alert.alert("Upload failed", "Could not upload the file. Please try again.");
          return;
        }
        await doSend({
          type: kind,
          mediaUrl: url,
          mediaDuration: kind === "video" ? asset.duration ?? null : null,
        });
      } catch (e) {
        console.log("[support-chat] pick media error", e);
        setSending(false);
      }
    },
    [ticketId, doSend]
  );

  const handleShareLocation = useCallback(async () => {
    setAttachOpen(false);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Location access is required.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await doSend({
        type: "location",
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        body: "Shared location",
      });
    } catch (e) {
      console.log("[support-chat] location error", e);
      Alert.alert("Location error", "Could not get your location.");
    }
  }, [doSend]);

  const startRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert("Permission needed", "Microphone access is required for voice notes.");
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      console.log("[support-chat] start recording error", e);
    }
  }, [recorder]);

  const stopAndSendRecording = useCallback(async () => {
    try {
      const seconds = Math.round((recorderState.durationMillis ?? 0) / 1000);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri || seconds < 1) return;
      setSending(true);
      const url = await uploadSupportMedia(uri, ticketId, "audio");
      setSending(false);
      if (!url) {
        Alert.alert("Upload failed", "Could not upload the voice note.");
        return;
      }
      await doSend({ type: "audio", mediaUrl: url, mediaDuration: seconds });
    } catch (e) {
      console.log("[support-chat] stop recording error", e);
      setSending(false);
    }
  }, [recorder, recorderState.durationMillis, ticketId, doSend]);

  const openLocation = useCallback((lat: number, lng: number) => {
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lng}`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    Linking.openURL(url as string).catch(() => {});
  }, []);

  const openVideo = useCallback((url: string) => {
    WebBrowser.openBrowserAsync(url).catch(() => {});
  }, []);

  const renderTicks = useCallback(
    (m: SupportMessage) => {
      if (m.sender_role !== myRole) return null;
      if (m.id.startsWith("tmp-")) {
        return <Check color={Colors.gray[400]} size={14} />;
      }
      if (m.status === "read") {
        return <CheckCheck color="#34B7F1" size={15} />;
      }
      if (m.status === "delivered") {
        return <CheckCheck color={Colors.gray[400]} size={15} />;
      }
      return <Check color={Colors.gray[400]} size={14} />;
    },
    [myRole, Colors]
  );

  const renderItem = useCallback(
    ({ item }: { item: SupportMessage }) => {
      const mine = item.sender_role === myRole;
      const bubbleBg = mine ? Colors.accent : Colors.gray[100];
      const textColor = mine ? "#fff" : Colors.text;
      const subColor = mine ? "rgba(255,255,255,0.7)" : Colors.textSecondary;
      return (
        <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
          <View
            style={[
              styles.bubble,
              { backgroundColor: bubbleBg },
              mine ? styles.bubbleMine : styles.bubbleTheirs,
            ]}
          >
            {item.sender_role === "admin" && item.sender_name ? (
              <Text
                style={[
                  styles.senderName,
                  { color: mine ? "rgba(255,255,255,0.9)" : Colors.accent },
                ]}
              >
                {item.sender_name}
              </Text>
            ) : null}

            {item.type === "image" && item.media_url ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => setViewerUri(item.media_url)}>
                <Image source={{ uri: item.media_url }} style={styles.imageMsg} />
              </TouchableOpacity>
            ) : null}

            {item.type === "video" && item.media_url ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => openVideo(item.media_url as string)}
                style={styles.videoMsg}
              >
                <View style={styles.videoPlayBadge}>
                  <Play color="#fff" size={26} fill="#fff" />
                </View>
                <View style={styles.videoLabelRow}>
                  <VideoIcon color="#fff" size={14} />
                  <Text style={styles.videoLabel}>Video</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            {item.type === "audio" && item.media_url ? (
              <AudioBubble
                uri={item.media_url}
                duration={item.media_duration}
                tint={mine ? "#fff" : Colors.accent}
                trackColor={mine ? "rgba(255,255,255,0.55)" : Colors.gray[400]}
              />
            ) : null}

            {item.type === "location" && item.latitude != null && item.longitude != null ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => openLocation(item.latitude as number, item.longitude as number)}
                style={[styles.locationCard, { borderColor: mine ? "rgba(255,255,255,0.3)" : Colors.border }]}
              >
                <View style={[styles.locationIcon, { backgroundColor: mine ? "rgba(255,255,255,0.2)" : Colors.accent + "20" }]}>
                  <MapPin color={mine ? "#fff" : Colors.accent} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locationTitle, { color: textColor }]}>Shared location</Text>
                  <Text style={[styles.locationSub, { color: subColor }]} numberOfLines={1}>
                    Tap to open in Maps
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}

            {item.type === "text" && item.body ? (
              <Text style={[styles.msgText, { color: textColor }]}>{item.body}</Text>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={[styles.timeText, { color: subColor }]}>{formatTime(item.created_at)}</Text>
              {renderTicks(item)}
            </View>
          </View>
        </View>
      );
    },
    [myRole, Colors, openVideo, openLocation, renderTicks]
  );

  const attachItems = useMemo(
    () => [
      { key: "photo", label: "Photo", icon: ImageIcon, onPress: () => handlePickImageOrVideo("image", false) },
      { key: "camera", label: "Camera", icon: Camera, onPress: () => handlePickImageOrVideo("image", true) },
      { key: "video", label: "Video", icon: VideoIcon, onPress: () => handlePickImageOrVideo("video", false) },
      { key: "location", label: "Location", icon: MapPin, onPress: handleShareLocation },
    ],
    [handlePickImageOrVideo, handleShareLocation]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: Colors.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderBottomColor: Colors.border }]}>
        <TouchableOpacity onPress={onBack} style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}>
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={[styles.headerAvatar, { backgroundColor: Colors.accent + "30" }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.headerAvatarImg} />
          ) : (
            <FileText color={Colors.accent} size={18} />
          )}
        </View>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]} numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        {onCall ? (
          <TouchableOpacity onPress={onCall} style={[styles.iconBtn, { backgroundColor: Colors.accent }]} testID="support-call">
            <Phone color="#000000" size={20} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {headerAccessory}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
                No messages yet. Say hello 👋
              </Text>
            </View>
          }
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {recorderState.isRecording ? (
          <View style={[styles.composer, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
            <View style={[styles.recordingPill, { backgroundColor: Colors.error + "15" }]}>
              <View style={[styles.recDot, { backgroundColor: Colors.error }]} />
              <Text style={[styles.recText, { color: Colors.error }]}>
                Recording… {formatDuration((recorderState.durationMillis ?? 0) / 1000)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={stopAndSendRecording}
              style={[styles.sendBtn, { backgroundColor: Colors.accent }]}
              testID="stop-record"
            >
              <Square color="#000000" size={18} fill="#000000" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.composer, { borderTopColor: Colors.border, backgroundColor: Colors.background }]}>
            <TouchableOpacity
              onPress={() => setAttachOpen(true)}
              style={[styles.composerIcon, { backgroundColor: Colors.gray[100] }]}
              testID="attach"
            >
              <Plus color={Colors.text} size={22} />
            </TouchableOpacity>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, { backgroundColor: Colors.gray[100], color: Colors.text }]}
              multiline
            />
            {text.trim().length > 0 ? (
              <TouchableOpacity
                onPress={handleSendText}
                disabled={sending}
                style={[styles.sendBtn, { backgroundColor: Colors.accent }]}
                testID="send"
              >
                <Send color="#000000" size={18} />
              </TouchableOpacity>
            ) : (
              <Pressable
                onPress={startRecording}
                style={[styles.sendBtn, { backgroundColor: Colors.accent }]}
                testID="record"
              >
                <Mic color="#000000" size={20} />
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Attachment sheet */}
      <Modal visible={attachOpen} transparent animationType="fade" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setAttachOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: Colors.background }]}>
            <View style={[styles.sheetHandle, { backgroundColor: Colors.border }]} />
            <Text style={[styles.sheetTitle, { color: Colors.text }]}>Attach</Text>
            <View style={styles.attachGrid}>
              {attachItems.map((it) => (
                <TouchableOpacity key={it.key} style={styles.attachItem} onPress={it.onPress}>
                  <View style={[styles.attachCircle, { backgroundColor: Colors.accent + "20" }]}>
                    <it.icon color={Colors.accent} size={24} />
                  </View>
                  <Text style={[styles.attachLabel, { color: Colors.text }]}>{it.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Image viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerBackdrop}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)}>
            <X color="#fff" size={26} />
          </TouchableOpacity>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  headerAvatarImg: { width: "100%" as const, height: "100%" as const },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  loadingWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const },
  listContent: { padding: 12, paddingBottom: 16, flexGrow: 1 },
  emptyWrap: { flex: 1, justifyContent: "center" as const, alignItems: "center" as const, paddingTop: 80 },
  emptyText: { fontSize: 14 },
  msgRow: { marginBottom: 8, flexDirection: "row" as const },
  msgRowMine: { justifyContent: "flex-end" as const },
  msgRowTheirs: { justifyContent: "flex-start" as const },
  bubble: { maxWidth: "82%" as const, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleTheirs: { borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, lineHeight: 20 },
  senderName: { fontSize: 12, fontWeight: "700" as const, marginBottom: 2 },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 4,
    marginTop: 3,
  },
  timeText: { fontSize: 10.5 },
  imageMsg: { width: 220, height: 220, borderRadius: 12, marginBottom: 2 },
  videoMsg: {
    width: 220,
    height: 150,
    borderRadius: 12,
    backgroundColor: "#111827",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 2,
  },
  videoPlayBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  videoLabelRow: {
    position: "absolute" as const,
    bottom: 8,
    left: 10,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  videoLabel: { color: "#fff", fontSize: 12, fontWeight: "600" as const },
  audioRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minWidth: 180, paddingVertical: 2 },
  audioBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  audioMeta: { flex: 1 },
  audioTrack: { height: 4, borderRadius: 2, overflow: "hidden" as const },
  audioFill: { height: 4, borderRadius: 2 },
  audioTime: { fontSize: 11, marginTop: 4 },
  locationCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    width: 220,
    marginBottom: 2,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  locationTitle: { fontSize: 14, fontWeight: "700" as const },
  locationSub: { fontSize: 12, marginTop: 1 },
  composer: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
  },
  composerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  input: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  recordingPill: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
  },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recText: { fontSize: 14, fontWeight: "600" as const },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" as const },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center" as const, marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: "800" as const, marginBottom: 14 },
  attachGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 18 },
  attachItem: { alignItems: "center" as const, width: 72 },
  attachCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 6,
  },
  attachLabel: { fontSize: 12, fontWeight: "500" as const },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" as const, alignItems: "center" as const },
  viewerClose: { position: "absolute" as const, top: 50, right: 20, zIndex: 2, padding: 8 },
  viewerImage: { width: "100%" as const, height: "80%" as const },
});
