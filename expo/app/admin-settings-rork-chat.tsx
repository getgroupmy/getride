import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ArrowLeft, Bot, Send, User } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

const TOOLKIT_URL = process.env.EXPO_PUBLIC_TOOLKIT_URL;
const SECRET_KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY;

const RORK_SYSTEM_PROMPT = `You are Rork, an AI assistant embedded in the GET.ride admin panel. You help the admin team manage and improve their platform.

Your capabilities:
- Answer questions about the GET.ride platform setup and configuration
- Help debug issues with rides, partners, payments, or users
- Suggest improvements to app settings and workflows
- Explain how features work and how to use them
- Provide guidance on best practices for ride-hailing operations

Be concise, helpful, and practical. When you don't know something specific about this particular instance, explain what you'd need to find out.`;

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `msg_${Date.now()}_${msgCounter}`;
}

export default function AdminSettingsRorkChatScreen() {
  const router = useRouter();
  const Colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: "system",
      content:
        "Hi! I'm Rork, your AI assistant. I can help you manage and improve your GET.ride platform. Ask me anything about your app setup, features, debugging, or best practices.",
    },
  ]);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // Build the messages array for the API (exclude system display messages)
      const apiMessages = [
        { role: "system", content: RORK_SYSTEM_PROMPT },
        ...messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: trimmed },
      ];

      const response = await fetch(
        `${TOOLKIT_URL}/v2/vercel/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET_KEY}`,
          },
          body: JSON.stringify({
            model: "anthropic/claude-sonnet-4",
            messages: apiMessages,
            max_tokens: 2000,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `API error ${response.status}: ${errorText.slice(0, 200)}`,
        );
      }

      const data = await response.json();
      const reply =
        data.choices?.[0]?.message?.content ?? "No response received.";

      const aiMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: reply,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      const errorMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: `Sorry, something went wrong: ${errorMessage}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === "user";
    const isSystem = msg.role === "system";

    if (isSystem) {
      return (
        <View key={msg.id} style={styles.systemBubble}>
          <View
            style={[
              styles.systemBubbleInner,
              { backgroundColor: Colors.gray[100], borderColor: Colors.border },
            ]}
          >
            <Bot color={Colors.accent} size={16} style={{ marginTop: 2 }} />
            <Text style={[styles.systemText, { color: Colors.text }]}>
              {msg.content}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View
        key={msg.id}
        style={[
          styles.messageRow,
          isUser ? styles.messageRowRight : styles.messageRowLeft,
        ]}
      >
        {!isUser && (
          <View
            style={[styles.avatar, { backgroundColor: Colors.accent + "20" }]}
          >
            <Bot color={Colors.accent} size={16} />
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isUser
              ? { backgroundColor: Colors.accent }
              : { backgroundColor: Colors.gray[100] },
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isUser ? "#000000" : Colors.text },
            ]}
          >
            {msg.content}
          </Text>
        </View>
        {isUser && (
          <View
            style={[
              styles.avatar,
              { backgroundColor: Colors.gray[200] },
            ]}
          >
            <User color={Colors.textSecondary} size={16} />
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={["top", "bottom"]}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View
        style={[styles.header, { borderBottomColor: Colors.border }]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: Colors.gray[100] }]}
          testID="rork-chat-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={Colors.text} size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <Bot color={Colors.accent} size={18} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>
              Rork AI
            </Text>
          </View>
          <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
            AI assistant for your platform
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map(renderMessage)}

        {loading && (
          <View style={styles.messageRowLeft}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: Colors.accent + "20" },
              ]}
            >
              <Bot color={Colors.accent} size={16} />
            </View>
            <View
              style={[
                styles.bubble,
                styles.loadingBubble,
                { backgroundColor: Colors.gray[100] },
              ]}
            >
              <ActivityIndicator size="small" color={Colors.accent} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <View
          style={[
            styles.inputBar,
            { backgroundColor: Colors.background, borderTopColor: Colors.border },
          ]}
        >
          <TextInput
            ref={inputRef}
            style={[
              styles.textInput,
              {
                backgroundColor: Colors.gray[100],
                color: Colors.text,
                borderColor: Colors.border,
              },
            ]}
            placeholder="Ask Rork anything..."
            placeholderTextColor={Colors.textSecondary}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            editable={!loading}
            multiline={false}
          />
          <TouchableOpacity
            onPress={sendMessage}
            disabled={loading || !input.trim()}
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  loading || !input.trim() ? Colors.gray[200] : Colors.accent,
              },
            ]}
            testID="rork-chat-send"
          >
            <Send
              color={
                loading || !input.trim() ? Colors.textSecondary : "#000000"
              }
              size={18}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" as const },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  systemBubble: { alignItems: "center" as const, paddingHorizontal: 8 },
  systemBubbleInner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: "100%",
  },
  systemText: { fontSize: 13, flex: 1, lineHeight: 19 },
  messageRow: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    gap: 8,
    maxWidth: "85%",
  },
  messageRowRight: {
    alignSelf: "flex-end" as const,
  },
  messageRowLeft: {
    alignSelf: "flex-start" as const,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  bubble: {
    padding: 12,
    borderRadius: 16,
    maxWidth: "100%",
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  loadingBubble: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  inputBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
});
