import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { Composer } from "./src/components/Composer";
import { stopActiveAudio } from "./src/components/AudioPlayButton";
import { MessageBubble } from "./src/components/MessageBubble";
import {
  getAudioStatus,
  getAudioUrl,
  retryAudio,
  sendChat,
  streamChat,
  streamChatSse,
  supportsFetchStreaming,
  supportsSseStreaming,
} from "./src/api/client";
import type { ChatMessage } from "./src/types/chat";
import {
  clearAllChatSessions,
  createChatSession,
  getActiveChatSessionId,
  loadChatSessions,
  saveChatSessions,
  saveSessionMessages,
  setActiveChatSessionId,
  type ChatSession,
} from "./src/utils/chatStorage";

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
  const { width } = useWindowDimensions();
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>(starterMessages);
  const scrollRef = useRef<ScrollView>(null);
  const shouldFollowScrollRef = useRef(true);
  const userPausedFollowRef = useRef(false);
  const loadingRef = useRef(false);
  const streamingRef = useRef(false);
  const showSidebar = width >= 760;

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom < AUTO_SCROLL_THRESHOLD;

    if (userPausedFollowRef.current) {
      if (nearBottom && !loadingRef.current && !streamingRef.current) {
        userPausedFollowRef.current = false;
        shouldFollowScrollRef.current = true;
        setHasUnreadMessages(false);
      }
      return;
    }

    shouldFollowScrollRef.current = nearBottom;
    if (nearBottom) {
      setHasUnreadMessages(false);
    }
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

  function revealLatestMessage() {
    userPausedFollowRef.current = false;
    shouldFollowScrollRef.current = true;
    setHasUnreadMessages(false);
    scrollToBottom();
  }

  function markUnreadIfPaused() {
    if (!shouldFollowScrollRef.current) {
      setHasUnreadMessages(true);
    }
  }

  function updateMessages(
    updater: (current: ChatMessage[]) => ChatMessage[],
    options: { persist?: boolean } = {},
  ) {
    setMessages((current) => {
      const next = updater(current);
      messagesRef.current = next;
      if (options.persist && sessionId) {
        setChatSessions((currentSessions) => upsertLocalSession(currentSessions, sessionId, next));
        void saveSessionMessages(sessionId, next);
      }
      return next;
    });
  }

  function upsertLocalSession(
    currentSessions: ChatSession[],
    targetSessionId: string,
    nextMessages: ChatMessage[],
  ) {
    const firstUserMessage = nextMessages.find(
      (message) => message.role === "user" && message.text.trim(),
    );
    const title = firstUserMessage
      ? firstUserMessage.text.trim().replace(/\s+/g, " ").slice(0, 18)
      : "新的问事";
    const updatedSession: ChatSession = {
      backendSessionId:
        currentSessions.find((session) => session.id === targetSessionId)?.backendSessionId ??
        targetSessionId,
      id: targetSessionId,
      title: firstUserMessage && firstUserMessage.text.trim().length > 18 ? `${title}...` : title,
      updatedAt: Date.now(),
      messages: nextMessages,
    };
    const nextSessions = currentSessions.some((session) => session.id === targetSessionId)
      ? currentSessions.map((session) => (session.id === targetSessionId ? updatedSession : session))
      : [updatedSession, ...currentSessions];
    return nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadChatSessions(), getActiveChatSessionId()])
      .then(async ([storedSessions, activeId]) => {
        if (mounted) {
          let sessions = storedSessions;
          let activeSession =
            sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;

          if (!activeSession) {
            activeSession = createChatSession(starterMessages);
            sessions = [activeSession];
            await saveChatSessions(sessions);
          }

          await setActiveChatSessionId(activeSession.id);
          setChatSessions(sessions);
          setSessionId(activeSession.id);
          setBackendSessionId(activeSession.backendSessionId);
          messagesRef.current = activeSession.messages.length
            ? activeSession.messages
            : starterMessages;
          setMessages(messagesRef.current);
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

  async function activateSession(session: ChatSession) {
    if (loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    await setActiveChatSessionId(session.id);
    setSessionId(session.id);
    setBackendSessionId(session.backendSessionId);
    messagesRef.current = session.messages.length ? session.messages : starterMessages;
    setMessages(messagesRef.current);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function startNewSession() {
    if (loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    const nextSession = createChatSession(starterMessages);
    const nextSessions = [nextSession, ...chatSessions];
    await saveChatSessions(nextSessions);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions(nextSessions);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = starterMessages;
    setMessages(starterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function clearAllHistory() {
    if (loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    const nextSession = createChatSession(starterMessages);
    await clearAllChatSessions();
    await saveChatSessions([nextSession]);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions([nextSession]);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = starterMessages;
    setMessages(starterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function clearCurrentSession() {
    if (!sessionId || loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    const nextSession = createChatSession(starterMessages);
    const nextSessions = [
      nextSession,
      ...chatSessions.filter((session) => session.id !== sessionId),
    ];
    await saveChatSessions(nextSessions);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions(nextSessions);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = starterMessages;
    setMessages(starterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  function confirmClearAllHistory() {
    if (loading || streaming) {
      return;
    }

    Alert.alert(
      "清空所有历史记录?",
      "所有本地聊天历史都会被移除，并开启一段新的对话。后端已保存的 Redis 记忆不会被删除。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "全部清空",
          style: "destructive",
          onPress: () => {
            void clearAllHistory();
          },
        },
      ],
    );
  }

  function confirmClearCurrentSession() {
    if (!sessionId || loading || streaming) {
      return;
    }

    Alert.alert(
      "清空当前会话?",
      "当前聊天记录会从本机移除，并开启一段新的对话。其他历史会话会保留。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清空当前",
          style: "destructive",
          onPress: () => {
            void clearCurrentSession();
          },
        },
      ],
    );
  }

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
      markUnreadIfPaused();
      if (shouldFollowScrollRef.current) {
        scrollToBottom(false);
      }
      await new Promise((resolve) => setTimeout(resolve, 18));
    }

    streamingRef.current = false;
    setStreaming(false);
    if (sessionId) {
      void saveSessionMessages(sessionId, messagesRef.current);
    }
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
        if (status.status === "failed") {
          updateMessages(
            (current) =>
              current.map((message) =>
                message.id === messageId ? { ...message, audioStatus: "failed" } : message,
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

  async function handleRetryAudio(message: ChatMessage) {
    if (!message.text.trim()) {
      return;
    }

    updateMessages(
      (current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                audioStatus: "pending",
                audioStatusUrl: item.audioStatusUrl ?? `${item.id}`,
                audioUrl: null,
              }
            : item,
        ),
      { persist: true },
    );

    try {
      await retryAudio(message.id, message.text, message.mood ?? "default");
      void pollAudio(message.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "语音重试失败,请稍后再试。");
      updateMessages(
        (current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, audioStatus: "failed" } : item,
          ),
        { persist: true },
      );
    }
  }

  async function sendNonStreaming(text: string, currentBackendSessionId: string) {
    const response = await sendChat(text, currentBackendSessionId);
    const masterMessage: ChatMessage = {
      id: response.message_id,
      role: "master",
      text: "",
      mood: response.mood,
      audioUrl: response.audio_url,
      audioStatusUrl: response.audio_status_url,
      audioStatus: response.audio_status_url ? "pending" : undefined,
      toolsUsed: response.tools_used,
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
  }

  async function sendWithFallback(
    text: string,
    currentBackendSessionId: string,
    currentLocalSessionId: string,
  ) {
    if (!supportsFetchStreaming() && !supportsSseStreaming()) {
      await sendNonStreaming(text, currentBackendSessionId);
      return;
    }

    let streamMessageId: string | null = null;
    let streamMood = "default";
    let receivedStreamStart = false;

    try {
      loadingRef.current = true;
      setLoading(true);

      const streamRequest = supportsFetchStreaming() ? streamChat : streamChatSse;

      await streamRequest(text, currentBackendSessionId, (event) => {
        if (event.type === "start") {
          receivedStreamStart = true;
          streamMessageId = event.message_id;
          streamMood = event.mood;
          const masterMessage: ChatMessage = {
            id: event.message_id,
            role: "master",
            text: "",
            mood: event.mood,
            audioStatus: "pending",
            audioStatusUrl: `${event.message_id}`,
            toolsUsed: event.tools_used ?? [],
          };

          updateMessages((current) => [...current, masterMessage], { persist: true });
          userPausedFollowRef.current = false;
          shouldFollowScrollRef.current = true;
          scrollToBottom(false);
          loadingRef.current = false;
          setLoading(false);
          streamingRef.current = true;
          setStreaming(true);
          return;
        }

        if (event.type === "delta") {
          if (!streamMessageId) {
            return;
          }
          updateMessages((current) =>
            current.map((message) =>
              message.id === streamMessageId
                ? { ...message, text: `${message.text}${event.text}` }
                : message,
            ),
          );
          markUnreadIfPaused();
          if (shouldFollowScrollRef.current) {
            scrollToBottom(false);
          }
          return;
        }

        if (event.type === "done") {
          streamMessageId = event.message_id;
          streamMood = event.mood;
          updateMessages(
            (current) =>
              current.map((message) =>
                message.id === event.message_id
                  ? {
                      ...message,
                      mood: event.mood,
                      audioUrl: event.audio_url,
                      audioStatusUrl: event.audio_status_url,
                      audioStatus: event.audio_status_url ? "pending" : undefined,
                      toolsUsed: event.tools_used ?? message.toolsUsed,
                    }
                  : message,
              ),
            { persist: true },
          );
          streamingRef.current = false;
          setStreaming(false);
          if (event.audio_status_url) {
            void pollAudio(event.message_id);
          }
          return;
        }

        if (event.type === "error") {
          throw new Error(event.text);
        }
      });

      if (streamMessageId) {
        void saveSessionMessages(currentLocalSessionId, messagesRef.current);
      }
    } catch (e) {
      if (receivedStreamStart) {
        setError(e instanceof Error ? e.message : "流式回复中断,请稍后再试。");
        loadingRef.current = false;
        streamingRef.current = false;
        setLoading(false);
        setStreaming(false);
        if (streamMessageId) {
          updateMessages(
            (current) =>
              current.map((message) =>
                message.id === streamMessageId
                  ? { ...message, mood: streamMood, audioStatus: "failed" }
                  : message,
              ),
            { persist: true },
          );
        }
        return;
      }

      setError(e instanceof Error ? e.message : "流式回复失败,请稍后再试。");
      loadingRef.current = false;
      streamingRef.current = false;
      setLoading(false);
      setStreaming(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !sessionId || !backendSessionId || loading || streaming) {
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
      await sendWithFallback(text, backendSessionId, sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败,请稍后再试。");
      loadingRef.current = false;
      streamingRef.current = false;
      setLoading(false);
      setStreaming(false);
    }
  }

  function renderSessionItems() {
    return chatSessions.map((session) => {
      const visibleMessages = session.messages.filter((message) => message.id !== "welcome");
      const preview = visibleMessages[visibleMessages.length - 1]?.text.trim() || "尚未开始";
      const isActive = session.id === sessionId;
      return (
        <Pressable
          key={session.id}
          accessibilityRole="button"
          disabled={loading || streaming}
          onPress={() => void activateSession(session)}
          style={[styles.historyItem, isActive && styles.historyItemActive]}
        >
          <Text numberOfLines={1} style={styles.historyItemTitle}>
            {session.title}
          </Text>
          <Text numberOfLines={1} style={styles.historyItemPreview}>
            {preview}
          </Text>
        </Pressable>
      );
    });
  }

  function renderHistoryList() {
    return (
      <View style={styles.historySurface}>
        <View style={styles.historyHeader}>
          <Text style={styles.historyTitle}>历史会话</Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading || streaming}
            onPress={startNewSession}
            style={styles.newSessionButton}
          >
            <Ionicons name="add" size={16} color="#ffffff" />
            <Text style={styles.newSessionText}>新会话</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.historyList}
          contentContainerStyle={styles.historyListContent}
          nestedScrollEnabled
        >
          {renderSessionItems()}
        </ScrollView>
      </View>
    );
  }

  function renderMobileDrawer() {
    if (showSidebar || !historyOpen) {
      return null;
    }

    return (
      <View style={styles.drawerLayer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setHistoryOpen(false)}
          style={styles.drawerBackdrop}
        />
        <View style={styles.drawerPanel}>
          <View style={styles.drawerBrandRow}>
            <View style={styles.sealSmall}>
              <Text style={styles.sealSmallText}>命</Text>
            </View>
            <View style={styles.drawerBrandText}>
              <Text style={styles.drawerTitle}>陈玉楼大师</Text>
              <Text style={styles.drawerSubtitle}>Native AI fortune chat</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setHistoryOpen(false)}
              style={styles.drawerCloseButton}
            >
              <Ionicons name="close" size={20} color="#5c4a37" />
            </Pressable>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>会话</Text>
            <View style={styles.drawerActionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={loading || streaming}
                onPress={startNewSession}
                style={styles.drawerPrimaryAction}
              >
                <Ionicons name="add" size={16} color="#ffffff" />
                <Text style={styles.drawerPrimaryActionText}>新会话</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={loading || streaming}
                onPress={confirmClearAllHistory}
                style={styles.drawerSecondaryAction}
              >
                <Ionicons name="trash-outline" size={16} color="#8d3f2d" />
                <Text style={styles.drawerSecondaryActionText}>清空历史</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.drawerSection, styles.drawerHistorySection]}>
            <Text style={styles.drawerSectionTitle}>历史记录</Text>
            <ScrollView
              style={styles.drawerHistoryList}
              contentContainerStyle={styles.historyListContent}
              nestedScrollEnabled
            >
              {renderSessionItems()}
            </ScrollView>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>服务状态</Text>
            <View style={styles.drawerStatusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.drawerStatusText}>API 已连接</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.container}>
        <View style={[styles.appFrame, showSidebar && styles.appFrameWide]}>
          {showSidebar ? <View style={styles.sidebar}>{renderHistoryList()}</View> : null}
          <View style={styles.shell}>
          <View style={styles.header}>
            <View style={styles.headerSide}>
              {!showSidebar ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={loading || streaming}
                  onPress={() => setHistoryOpen(true)}
                  style={styles.hamburgerButton}
                >
                  <Ionicons name="menu" size={22} color="#5c4a37" />
                </Pressable>
              ) : null}
            </View>
            <View pointerEvents="none" style={styles.centerIdentity}>
              <View style={styles.seal}>
                <Text style={styles.sealText}>命</Text>
              </View>
              <Text style={styles.title}>陈玉楼大师</Text>
            </View>
            <View style={styles.headerSide}>
              <Pressable
                accessibilityRole="button"
                disabled={loading || streaming}
                onPress={confirmClearCurrentSession}
                style={styles.iconButton}
              >
                <Ionicons name="trash-outline" size={19} color="#5c4a37" />
              </Pressable>
            </View>
          </View>

          {renderMobileDrawer()}

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
              <MessageBubble key={message.id} message={message} onRetryAudio={handleRetryAudio} />
            ))}
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#8d3f2d" />
                <Text style={styles.loadingText}>大师掐指推演中...</Text>
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          {hasUnreadMessages ? (
            <Pressable
              accessibilityRole="button"
              onPress={revealLatestMessage}
              style={[styles.newMessageButton, { bottom: keyboardHeight + 92 }]}
            >
              <Ionicons name="arrow-down" size={15} color="#ffffff" />
              <Text style={styles.newMessageText}>新消息</Text>
            </Pressable>
          ) : null}

          <View style={[styles.footer, { marginBottom: keyboardHeight }]}>
            <Composer
              busy={loading || streaming}
              disabled={!sessionId || !backendSessionId || loading || streaming}
              value={input}
              onChangeText={setInput}
              onSend={handleSend}
            />
          </View>
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
  appFrame: {
    flex: 1,
  },
  appFrameWide: {
    alignSelf: "center",
    flexDirection: "row",
    maxWidth: 1180,
    width: "100%",
  },
  sidebar: {
    backgroundColor: "#f8f0e5",
    borderRightColor: "#dccdb9",
    borderRightWidth: 1,
    width: 286,
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
    minHeight: 66,
    paddingVertical: 10,
    position: "relative",
  },
  headerSide: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minWidth: 36,
    zIndex: 2,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  hamburgerButton: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  hiddenAction: {
    display: "none",
  },
  centerIdentity: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    left: 64,
    minHeight: 42,
    position: "absolute",
    right: 64,
    top: 0,
  },
  seal: {
    alignItems: "center",
    backgroundColor: "#9f3328",
    borderColor: "#c86f5b",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    transform: [{ rotate: "-5deg" }],
    width: 38,
  },
  sealText: {
    color: "#fff5e9",
    fontSize: 20,
    fontWeight: "900",
  },
  title: {
    color: "#1f2528",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
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
  historySurface: {
    backgroundColor: "#f8f0e5",
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  historyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  historyTitle: {
    color: "#1f2528",
    fontSize: 15,
    fontWeight: "800",
  },
  newSessionButton: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  newSessionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  historyList: {
    flex: 1,
  },
  historyListContent: {
    paddingBottom: 8,
  },
  drawerLayer: {
    bottom: 0,
    flexDirection: "row",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  drawerBackdrop: {
    backgroundColor: "rgba(31, 37, 40, 0.32)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  drawerPanel: {
    backgroundColor: "#f8f0e5",
    borderRightColor: "#dccdb9",
    borderRightWidth: 1,
    elevation: 8,
    maxWidth: "86%",
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: "#2b261f",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    width: 318,
  },
  drawerBrandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  drawerBrandText: {
    flex: 1,
  },
  drawerTitle: {
    color: "#1f2528",
    fontSize: 17,
    fontWeight: "900",
  },
  drawerSubtitle: {
    color: "#7b6b57",
    fontSize: 11,
    marginTop: 2,
  },
  drawerCloseButton: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  sealSmall: {
    alignItems: "center",
    backgroundColor: "#9f3328",
    borderColor: "#c86f5b",
    borderRadius: 7,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    transform: [{ rotate: "-5deg" }],
    width: 34,
  },
  sealSmallText: {
    color: "#fff5e9",
    fontSize: 18,
    fontWeight: "900",
  },
  drawerSection: {
    borderTopColor: "#e5d8c6",
    borderTopWidth: 1,
    paddingTop: 12,
    marginBottom: 16,
  },
  drawerHistorySection: {
    flex: 1,
  },
  drawerSectionTitle: {
    color: "#7b6b57",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 10,
  },
  drawerActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  drawerPrimaryAction: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    paddingVertical: 9,
  },
  drawerPrimaryActionText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  drawerSecondaryAction: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    paddingVertical: 9,
  },
  drawerSecondaryActionText: {
    color: "#8d3f2d",
    fontSize: 13,
    fontWeight: "800",
  },
  drawerHistoryList: {
    flex: 1,
  },
  drawerStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  drawerStatusText: {
    color: "#5c4a37",
    fontSize: 13,
    fontWeight: "700",
  },
  historyItem: {
    backgroundColor: "#fffaf3",
    borderColor: "#e6d8c5",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  historyItemActive: {
    borderColor: "#8d3f2d",
  },
  historyItemTitle: {
    color: "#2b261f",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  historyItemPreview: {
    color: "#7b6b57",
    fontSize: 12,
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
  newMessageButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    elevation: 4,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: "absolute",
    shadowColor: "#2b261f",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  newMessageText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
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
