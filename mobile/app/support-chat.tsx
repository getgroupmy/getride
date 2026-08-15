import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  fetchMessages,
  markRead,
  sendMessage,
  type SupportMessage,
} from "@/utils/supportStore";

/**
 * One support conversation.
 *
 * The support store has no realtime channel, so this polls on a slow timer
 * rather than claiming to be live: an agent's reply lands within the interval,
 * and pull-to-refresh is there for someone who does not want to wait. Sending
 * refetches immediately, so the rider's own message never appears late.
 */
const POLL_MS = 15_000;

export default function SupportChat() {
  const { ready } = useRequireAuth();
  const colors = useColors();
  const { authState } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!id) return;
      if (showSpinner) setLoading(true);
      const rows = await fetchMessages(id);
      setMessages(rows);
      setLoading(false);
    },
    [id]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [id, load]);

  // Clear the rider's unread count once they are actually looking at it.
  useEffect(() => {
    if (!id || !authState.userId || messages.length === 0) return;
    void markRead(id, "user").catch(() => {});
  }, [id, authState.userId, messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !id || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendMessage({
        ticketId: id,
        senderRole: "user",
        senderId: authState.userId,
        senderName: authState.profileName,
        body,
      });
      await load();
    } finally {
      setSending(false);
    }
  };


  // Reachable by deep link without passing through the launch buffer,
  // so the screen answers for its own access.
  if (!ready) return null;
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={colors.primary} />
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender_role === "user";
          return (
            <View
              style={[
                styles.bubble,
                {
                  alignSelf: mine ? "flex-end" : "flex-start",
                  backgroundColor: mine ? colors.primary : colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              {!mine && item.sender_name ? (
                <Text style={[styles.sender, { color: colors.textSecondary }]}>
                  {item.sender_name}
                </Text>
              ) : null}
              <Text style={{ color: mine ? colors.onAccent : colors.text, fontSize: 15 }}>
                {item.body ?? `[${item.type}]`}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.sender, { color: colors.textSecondary }]}>
              Tell us what&apos;s wrong and we&apos;ll help.
            </Text>
          </View>
        }
      />

      <View style={[styles.composer, { borderTopColor: colors.border }]}>
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message…"
          placeholderTextColor={colors.subtext}
          multiline
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          onPress={send}
          disabled={sending || draft.trim().length === 0}
          style={[
            styles.send,
            {
              backgroundColor:
                sending || draft.trim().length === 0 ? colors.border : colors.primary,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[styles.sendText, { color: colors.onAccent }]}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, gap: 8 },
  bubble: {
    maxWidth: "82%",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  sender: { fontSize: 12 },
  empty: { padding: 32, alignItems: "center" },
  composer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: { borderRadius: 20, paddingVertical: 12, paddingHorizontal: 18 },
  sendText: { fontSize: 15, fontWeight: "700" },
});
