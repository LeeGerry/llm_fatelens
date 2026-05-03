import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { Composer } from "./src/components/Composer";
import { MessageBubble } from "./src/components/MessageBubble";
import { getAudioStatus, getAudioUrl, sendChat } from "./src/api/client";
import type { ChatMessage } from "./src/types/chat";
import { loadStoredMessages, saveStoredMessages } from "./src/utils/chatStorage";
import { getOrCreateSessionId } from "./src/utils/session";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "master",
    text: "老夫陈玉楼在此。你可问事业、感情、流年，也可给出生年月日时让老夫细看八字。",
    mood: "default",
  },
];
const AUTO_SCROLL_THRESHOLD = 96;

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>(starterMessages);
  const scrollRef = useRef<ScrollView>(null);
  const shouldFollowScrollRef = useRef(true);
  const userPausedFollowRef = useRef(false);
  const loadingRef = useRef(false);
  const streamingRef = useRef(false);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom < AUTO_SCROLL_THRESHOLD;

    if (userPausedFollowRef.current) {
      if (nearBottom && !loadingRef.current && !streamingRef.current) {
        userPausedFollowRef.current = false;
        shouldFollowScrollRef.current = true;
      }
      return;
    }

    shouldFollowScrollRef.current = nearBottom;
  }

  function pauseAutoFollow() {
    if (loadingRef.current || streamingRef.current) {
      userPausedFollowRef.current = true;
      shouldFollowScrollRef.current = false;
    }
  }

  function scrollToBottom(animated = true) {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  }

  function updateMessages(
    updater: (current: ChatMessage[]) => ChatMessage[],
    options: { persist?: boolean } = {},
  ) {
    setMessages((current) => {
      const next = updater(current);
      messagesRef.current = next;
      if (options.persist) {
        void saveStoredMessages(next);
      }
      return next;
    });
  }

  useEffect(() => {
    let mounted = true;
    void Promise.all([getOrCreateSessionId(), loadStoredMessages()])
      .then(([id, storedMessages]) => {
        if (mounted) {
          setSessionId(id);
          if (storedMessages?.length) {
            messagesRef.current = storedMessages;
            setMessages(storedMessages);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setError("会话初始化失败,请重启应用后再试。");
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldFollowScrollRef.current) {
      return undefined;
    }
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
    streamingRef.current = true;
    setStreaming(true);
    const chars = Array.from(fullText);
    let nextText = "";

    for (let i = 0; i < chars.length; i += 2) {
      nextText += chars.slice(i, i + 2).join("");
      updateMessages(
        (current) =>
          current.map((message) =>
            message.id === messageId ? { ...message, text: nextText } : message,
          ),
      );
      if (shouldFollowScrollRef.current) {
        scrollToBottom(false);
      }
      await new Promise((resolve) => setTimeout(resolve, 18));
    }

    streamingRef.current = false;
    setStreaming(false);
    void saveStoredMessages(messagesRef.current);
  }

  async function pollAudio(messageId: string) {
    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      try {
        const status = await getAudioStatus(messageId);
        if (status.status === "ready") {
          updateMessages(
            (current) =>
              current.map((message) =>
                message.id === messageId
                  ? { ...message, audioStatus: "ready", audioUrl: status.audio_url ?? getAudioUrl(messageId) }
                  : message,
              ),
            { persist: true },
          );
          return;
        }
      } catch {
        // Keep polling; local Wi-Fi can briefly drop during Expo Go reloads.
      }
    }

    updateMessages(
      (current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, audioStatus: "failed" } : message,
        ),
      { persist: true },
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !sessionId || loading || streaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };

    updateMessages((current) => [...current, userMessage], { persist: true });
    userPausedFollowRef.current = false;
    shouldFollowScrollRef.current = true;
    scrollToBottom(false);
    setInput("");
    loadingRef.current = true;
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

      updateMessages((current) => [...current, masterMessage], { persist: true });
      userPausedFollowRef.current = false;
      shouldFollowScrollRef.current = true;
      scrollToBottom(false);
      loadingRef.current = false;
      setLoading(false);

      if (response.audio_status_url) {
        void pollAudio(response.message_id);
      }
      await streamReply(response.message_id, response.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败,请稍后再试。");
      loadingRef.current = false;
      streamingRef.current = false;
      setLoading(false);
      setStreaming(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.shell}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>陈玉楼大师</Text>
            </View>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.messageScroller}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            onScrollBeginDrag={pauseAutoFollow}
            onTouchStart={pauseAutoFollow}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
              if ((loading || streaming) && shouldFollowScrollRef.current) {
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
            <Composer
              disabled={!sessionId || loading || streaming}
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
  statusPill: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  statusDot: {
    backgroundColor: "#3f8f63",
    borderRadius: 4,
    height: 8,
    width: 8,
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
});
