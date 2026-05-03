import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  StatusBar as NativeStatusBar,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

import { Composer } from "./src/components/Composer";
import { MessageBubble } from "./src/components/MessageBubble";
import { getApiBaseUrl, getAudioStatus, sendChat } from "./src/api/client";
import type { ChatMessage } from "./src/types/chat";
import { createSessionId } from "./src/utils/session";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "master",
    text: "老夫陈玉楼在此。你可问事业、感情、流年，也可给出生年月日时让老夫细看八字。",
    mood: "default",
  },
];

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const sessionId = useMemo(() => createSessionId(), []);
  const scrollRef = useRef<ScrollView>(null);
  const topInset = Platform.OS === "android" ? NativeStatusBar.currentHeight ?? 0 : 0;

  function scrollToBottom(animated = true) {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }

  useEffect(() => {
    const timer = setTimeout(() => scrollToBottom(), 80);
    return () => clearTimeout(timer);
  }, [messages, loading]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      setTimeout(() => scrollToBottom(false), 40);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      setTimeout(() => scrollToBottom(false), 40);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function streamReply(messageId: string, fullText: string) {
    setStreaming(true);
    const chars = Array.from(fullText);
    let nextText = "";

    for (let i = 0; i < chars.length; i += 2) {
      nextText += chars.slice(i, i + 2).join("");
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, text: nextText } : message,
        ),
      );
      scrollToBottom(false);
      await new Promise((resolve) => setTimeout(resolve, 18));
    }

    setStreaming(false);
  }

  async function pollAudio(messageId: string, statusUrl: string) {
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        const status = await getAudioStatus(statusUrl);
        if (status.status === "ready") {
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId
                ? { ...message, audioStatus: "ready", audioUrl: status.audio_url }
                : message,
            ),
          );
          return;
        }
      } catch {
        return;
      }
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading || streaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const response = await sendChat(text, sessionId);
      const masterMessage: ChatMessage = {
        id: response.message_id,
        role: "master",
        text: "",
        mood: response.mood,
        audioUrl: response.audio_url,
        audioStatusUrl: response.audio_status_url,
        audioStatus: response.audio_status_url ? "pending" : undefined,
      };

      setMessages((current) => [...current, masterMessage]);
      setLoading(false);

      if (response.audio_status_url) {
        void pollAudio(response.message_id, response.audio_status_url);
      }
      await streamReply(response.message_id, response.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败,请稍后再试。");
      setLoading(false);
      setStreaming(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { paddingTop: topInset }]}>
      <ExpoStatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.shell}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>陈玉楼大师</Text>
              <Text style={styles.subtitle}>Native AI fortune chat demo</Text>
            </View>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>API</Text>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.messageScroller}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              if (loading || streaming) {
                scrollToBottom(false);
              }
            }}
          >
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#8d3f2d" />
                <Text style={styles.loadingText}>大师掐指推演中...</Text>
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={[styles.footer, { marginBottom: keyboardHeight }]}>
            <Text style={styles.apiText}>{getApiBaseUrl()}</Text>
            <Composer
              disabled={loading || streaming}
              value={input}
              onChangeText={setInput}
              onSend={handleSend}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#efe5d6",
    flex: 1,
  },
  container: {
    flex: 1,
  },
  shell: {
    alignSelf: "center",
    flex: 1,
    maxWidth: 920,
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#dccdb9",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  title: {
    color: "#1f2528",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#745f48",
    fontSize: 13,
    marginTop: 2,
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusDot: {
    backgroundColor: "#3f8f63",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusText: {
    color: "#4a3d2e",
    fontSize: 12,
    fontWeight: "700",
  },
  messages: {
    padding: 18,
    paddingBottom: 28,
  },
  messageScroller: {
    flex: 1,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  loadingText: {
    color: "#745f48",
    fontSize: 14,
  },
  errorText: {
    color: "#a1352d",
    fontSize: 14,
    marginTop: 12,
  },
  footer: {
    borderTopColor: "#dccdb9",
    borderTopWidth: 1,
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.select({ android: 18, default: 14 }),
  },
  apiText: {
    color: "#745f48",
    fontSize: 12,
  },
});
