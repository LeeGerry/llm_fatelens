import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { Composer } from "./src/components/Composer";
import { stopActiveAudio } from "./src/components/AudioPlayButton";
import { MessageBubble } from "./src/components/MessageBubble";
import { getTranslator } from "./src/i18n";
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
import {
  emptyUserProfile,
  formatUserProfileForPrompt,
  loadUserProfile,
  saveUserProfile,
  type UserProfile,
} from "./src/utils/profileStorage";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "master",
    text: "老夫陈玉楼在此。你可问事业、感情、流年，也可给出生年月日时让老夫细看八字。",
    mood: "default",
  },
];
const AUTO_SCROLL_THRESHOLD = 96;
type AppScreen = "bazi" | "chat" | "settings";
type BaziCalendarType = "lunar" | "solar";
type BaziPickerMode = "date" | "time" | null;
type BaziForm = {
  birthCity: string;
  birthDate: string;
  birthTime: string;
  calendarType: BaziCalendarType;
  gender: string;
  name: string;
};

const emptyBaziForm: BaziForm = {
  birthCity: "",
  birthDate: "",
  birthTime: "",
  calendarType: "solar",
  gender: "",
  name: "",
};

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
  const [activeScreen, setActiveScreen] = useState<AppScreen>("chat");
  const [autoPlayAudioId, setAutoPlayAudioId] = useState<string | null>(null);
  const [baziForm, setBaziForm] = useState<BaziForm>(emptyBaziForm);
  const [baziPickerMode, setBaziPickerMode] = useState<BaziPickerMode>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(emptyUserProfile);
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
  const t = getTranslator(userProfile.language);
  const localizedStarterMessages: ChatMessage[] = [
    {
      ...starterMessages[0]!,
      text: t("welcome"),
    },
  ];

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

  function formatDateValue(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatTimeValue(date: Date) {
    const hours = `${date.getHours()}`.padStart(2, "0");
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  function dateFromBaziValue() {
    const [year, month, day] = baziForm.birthDate.split("-").map(Number);
    if (year && month && day) {
      return new Date(year, month - 1, day);
    }
    return new Date(1988, 0, 1);
  }

  function timeFromBaziValue() {
    const date = new Date();
    const [rawHours, rawMinutes] = baziForm.birthTime.split(":").map(Number);
    const hours = Number.isFinite(rawHours) ? rawHours as number : 7;
    const minutes = Number.isFinite(rawMinutes) ? rawMinutes as number : 30;
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
  }

  function handleBaziPickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === "android") {
      setBaziPickerMode(null);
    }
    if (event.type === "dismissed" || !selectedDate) {
      return;
    }
    if (baziPickerMode === "date") {
      setBaziForm((form) => ({ ...form, birthDate: formatDateValue(selectedDate) }));
    }
    if (baziPickerMode === "time") {
      setBaziForm((form) => ({ ...form, birthTime: formatTimeValue(selectedDate) }));
    }
  }

  function openBaziScreen() {
    setBaziForm({
      birthCity: userProfile.birthPlace,
      birthDate: userProfile.birthDate,
      birthTime: userProfile.birthTime,
      calendarType: "solar",
      gender: userProfile.gender,
      name: userProfile.name,
    });
    setHistoryOpen(false);
    setActiveScreen("bazi");
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
      : t("newSession");
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
            activeSession = createChatSession(localizedStarterMessages);
            sessions = [activeSession];
            await saveChatSessions(sessions);
          }

          await setActiveChatSessionId(activeSession.id);
          setChatSessions(sessions);
          setSessionId(activeSession.id);
          setBackendSessionId(activeSession.backendSessionId);
          messagesRef.current = activeSession.messages.length
            ? activeSession.messages
            : localizedStarterMessages;
          setMessages(messagesRef.current);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(t("chatInitFailed"));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadUserProfile()
      .then((profile) => {
        if (mounted) {
          setUserProfile(profile);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(t("profileLoadFailed"));
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
    setAutoPlayAudioId(null);
    await setActiveChatSessionId(session.id);
    setSessionId(session.id);
    setBackendSessionId(session.backendSessionId);
    messagesRef.current = session.messages.length ? session.messages : localizedStarterMessages;
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
    setAutoPlayAudioId(null);
    const nextSession = createChatSession(localizedStarterMessages);
    const nextSessions = [nextSession, ...chatSessions];
    await saveChatSessions(nextSessions);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions(nextSessions);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = localizedStarterMessages;
    setMessages(localizedStarterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function clearAllHistory() {
    if (loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    setAutoPlayAudioId(null);
    const nextSession = createChatSession(localizedStarterMessages);
    await clearAllChatSessions();
    await saveChatSessions([nextSession]);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions([nextSession]);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = localizedStarterMessages;
    setMessages(localizedStarterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function clearCurrentSession() {
    if (!sessionId || loadingRef.current || streamingRef.current) {
      return;
    }

    stopActiveAudio();
    setAutoPlayAudioId(null);
    const nextSession = createChatSession(localizedStarterMessages);
    const nextSessions = [
      nextSession,
      ...chatSessions.filter((session) => session.id !== sessionId),
    ];
    await saveChatSessions(nextSessions);
    await setActiveChatSessionId(nextSession.id);
    setChatSessions(nextSessions);
    setSessionId(nextSession.id);
    setBackendSessionId(nextSession.backendSessionId);
    messagesRef.current = localizedStarterMessages;
    setMessages(localizedStarterMessages);
    setHistoryOpen(false);
    setError(null);
    revealLatestMessage();
  }

  async function handleSaveProfile() {
    try {
      await saveUserProfile(userProfile);
      setActiveScreen("chat");
    } catch {
      setError(t("profileSaveFailed"));
    }
  }

  function confirmClearAllHistory() {
    if (loading || streaming) {
      return;
    }

    Alert.alert(
      t("clearAllHistoryTitle"),
      t("clearAllHistoryMessage"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("clearAll"),
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
      t("clearCurrentTitle"),
      t("clearCurrentMessage"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("clearCurrent"),
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
          if (userProfile.autoPlayVoice) {
            setAutoPlayAudioId(messageId);
          }
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
    if (autoPlayAudioId === message.id) {
      setAutoPlayAudioId(null);
    }

    try {
      await retryAudio(message.id, message.text, message.mood ?? "default");
      void pollAudio(message.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("retryAudioFailed"));
      updateMessages(
        (current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, audioStatus: "failed" } : item,
          ),
        { persist: true },
      );
    }
  }

  function buildBaziPrompt(form: BaziForm) {
    const calendarLabel =
      form.calendarType === "lunar" ? t("baziCalendarLunar") : t("baziCalendarSolar");
    return [
      "请为我做一次八字测算。以下信息来自 App 的八字快捷表单,请优先按结构化信息调用八字测算工具；如果工具不可用,请基于这些信息做一般性命理分析。",
      `姓名: ${form.name.trim()}`,
      `性别: ${form.gender.trim()}`,
      `日历类型: ${calendarLabel}`,
      `出生日期: ${form.birthDate.trim()}`,
      `出生时间: ${form.birthTime.trim()}`,
      `出生城市: ${form.birthCity.trim()}`,
      "请从整体命格、事业、财运、感情、健康习惯和近期建议几个方面回答，并遵守娱乐/传统文化参考的边界。",
    ].join("\n");
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
        setError(e instanceof Error ? e.message : t("streamingInterrupted"));
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

      setError(e instanceof Error ? e.message : t("streamingFailed"));
      loadingRef.current = false;
      streamingRef.current = false;
      setLoading(false);
      setStreaming(false);
    }
  }

  async function sendText(displayText: string, aiText = displayText) {
    if (!displayText || !aiText || !sessionId || !backendSessionId || loading || streaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: displayText,
    };

    updateMessages((current) => [...current, userMessage], { persist: true });
    userPausedFollowRef.current = false;
    shouldFollowScrollRef.current = true;
    scrollToBottom(false);
    setInput("");
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const profileContext = formatUserProfileForPrompt(userProfile);
    const messageForAi = profileContext
      ? `${profileContext}\n\n${t("userQuestionPrefix")}: ${aiText}`
      : aiText;

    try {
      await sendWithFallback(messageForAi, backendSessionId, sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
      loadingRef.current = false;
      streamingRef.current = false;
      setLoading(false);
      setStreaming(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput("");
    await sendText(text);
  }

  async function handleBaziSubmit() {
    const nextForm = {
      ...baziForm,
      birthCity: baziForm.birthCity.trim(),
      birthDate: baziForm.birthDate.trim(),
      birthTime: baziForm.birthTime.trim(),
      gender: baziForm.gender.trim(),
      name: baziForm.name.trim(),
    };
    if (
      !nextForm.name ||
      !nextForm.gender ||
      !nextForm.birthDate ||
      !nextForm.birthTime ||
      !nextForm.birthCity
    ) {
      setError(t("baziMissingInfo"));
      return;
    }

    const nextProfile = {
      ...userProfile,
      birthDate: nextForm.birthDate,
      birthPlace: nextForm.birthCity,
      birthTime: nextForm.birthTime,
      gender: nextForm.gender,
      name: nextForm.name,
    };
    setBaziForm(nextForm);
    setUserProfile(nextProfile);
    void saveUserProfile(nextProfile);
    setActiveScreen("chat");
    setError(null);

    const displayText = `${t("baziUserMessage")}: ${nextForm.name} ${nextForm.birthDate} ${nextForm.birthTime}`;
    await sendText(displayText, buildBaziPrompt(nextForm));
  }

  function renderSessionItems() {
    return chatSessions.map((session) => {
      const visibleMessages = session.messages.filter((message) => message.id !== "welcome");
      const preview = visibleMessages[visibleMessages.length - 1]?.text.trim() || t("newSession");
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
          <Text style={styles.historyTitle}>{t("history")}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading || streaming}
            onPress={startNewSession}
            style={styles.newSessionButton}
          >
            <Ionicons name="add" size={16} color="#ffffff" />
            <Text style={styles.newSessionText}>{t("newSession")}</Text>
          </Pressable>
        </View>
        <View style={styles.sidebarQuickActions}>
          <Pressable
            accessibilityRole="button"
            disabled={loading || streaming}
            onPress={() => setActiveScreen("settings")}
            style={styles.sidebarQuickButton}
          >
            <Ionicons name="person-outline" size={15} color="#8d3f2d" />
            <Text style={styles.sidebarQuickButtonText}>{t("personalSettings")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={loading || streaming}
            onPress={openBaziScreen}
            style={styles.sidebarQuickButton}
          >
            <Ionicons name="calendar-outline" size={15} color="#8d3f2d" />
            <Text style={styles.sidebarQuickButtonText}>{t("baziQuickForm")}</Text>
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
              <Text style={styles.drawerTitle}>{t("appTitle")}</Text>
              <Text style={styles.drawerSubtitle}>{t("appSubtitle")}</Text>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setHistoryOpen(false);
                setActiveScreen("settings");
              }}
              style={styles.drawerMenuItem}
            >
              <View style={styles.drawerMenuIcon}>
                <Ionicons name="person-outline" size={16} color="#8d3f2d" />
              </View>
              <View style={styles.drawerMenuText}>
                <Text style={styles.drawerMenuTitle}>{t("personalSettings")}</Text>
                <Text style={styles.drawerMenuSubtitle}>{t("preferences")}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="#7b6b57"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={openBaziScreen}
              style={[styles.drawerMenuItem, styles.drawerMenuItemSpacing]}
            >
              <View style={styles.drawerMenuIcon}>
                <Ionicons name="calendar-outline" size={16} color="#8d3f2d" />
              </View>
              <View style={styles.drawerMenuText}>
                <Text style={styles.drawerMenuTitle}>{t("baziQuickForm")}</Text>
                <Text style={styles.drawerMenuSubtitle}>
                  {userProfile.name || userProfile.birthDate ? t("profileSaved") : t("baziFormHint")}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color="#7b6b57"
              />
            </Pressable>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>{t("history")}</Text>
            <View style={styles.drawerActionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={loading || streaming}
                onPress={startNewSession}
                style={styles.drawerPrimaryAction}
              >
                <Ionicons name="add" size={16} color="#ffffff" />
                <Text style={styles.drawerPrimaryActionText}>{t("newSession")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={loading || streaming}
                onPress={confirmClearAllHistory}
                style={styles.drawerSecondaryAction}
              >
                <Ionicons name="trash-outline" size={16} color="#8d3f2d" />
                <Text style={styles.drawerSecondaryActionText}>{t("clearAllHistory")}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.drawerSection, styles.drawerHistorySection]}>
            <Text style={styles.drawerSectionTitle}>{t("historyRecords")}</Text>
            <ScrollView
              style={styles.drawerHistoryList}
              contentContainerStyle={styles.historyListContent}
              nestedScrollEnabled
            >
              {renderSessionItems()}
            </ScrollView>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerSectionTitle}>{t("serviceStatus")}</Text>
            <View style={styles.drawerStatusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.drawerStatusText}>{t("apiConnected")}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  function renderSettingsScreen() {
    return (
      <View style={styles.settingsShell}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveScreen("chat")}
            style={styles.iconButton}
          >
            <Ionicons name="chevron-back" size={20} color="#5c4a37" />
          </Pressable>
          <Text style={styles.settingsTitle}>{t("personalSettings")}</Text>
          <View style={styles.headerSide} />
        </View>

        <ScrollView
          style={styles.settingsScroller}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.settingsSection}>
            <Text style={styles.settingsSectionTitle}>{t("preferences")}</Text>
            <View style={styles.settingSwitchRow}>
              <View style={styles.settingSwitchText}>
                <Text style={styles.settingSwitchTitle}>{t("language")}</Text>
                <Text style={styles.settingSwitchSubtitle}>{t("languageSubtitle")}</Text>
              </View>
              <View style={styles.languageToggle}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setUserProfile((profile) => ({ ...profile, language: "zh" }))}
                  style={[
                    styles.languageOption,
                    userProfile.language === "zh" && styles.languageOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.languageOptionText,
                      userProfile.language === "zh" && styles.languageOptionTextActive,
                    ]}
                  >
                    {t("languageZh")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setUserProfile((profile) => ({ ...profile, language: "en" }))}
                  style={[
                    styles.languageOption,
                    userProfile.language === "en" && styles.languageOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.languageOptionText,
                      userProfile.language === "en" && styles.languageOptionTextActive,
                    ]}
                  >
                    {t("languageEn")}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.settingSwitchRow}>
              <View style={styles.settingSwitchText}>
                <Text style={styles.settingSwitchTitle}>{t("autoPlayTitle")}</Text>
                <Text style={styles.settingSwitchSubtitle}>{t("autoPlaySubtitle")}</Text>
              </View>
              <Switch
                value={userProfile.autoPlayVoice}
                onValueChange={(autoPlayVoice) =>
                  setUserProfile((profile) => ({ ...profile, autoPlayVoice }))
                }
                thumbColor={userProfile.autoPlayVoice ? "#8d3f2d" : "#f4eadc"}
                trackColor={{ false: "#d8c8b3", true: "#d9a596" }}
              />
            </View>
            <View style={styles.settingSwitchRow}>
              <View style={styles.settingSwitchText}>
                <Text style={styles.settingSwitchTitle}>{t("darkModeTitle")}</Text>
                <Text style={styles.settingSwitchSubtitle}>{t("darkModeSubtitle")}</Text>
              </View>
              <Switch
                value={userProfile.darkMode}
                onValueChange={(darkMode) => setUserProfile((profile) => ({ ...profile, darkMode }))}
                thumbColor={userProfile.darkMode ? "#8d3f2d" : "#f4eadc"}
                trackColor={{ false: "#d8c8b3", true: "#d9a596" }}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleSaveProfile}
            style={styles.settingsSaveButton}
          >
            <Ionicons name="save-outline" size={17} color="#ffffff" />
            <Text style={styles.settingsSaveText}>{t("saveSettings")}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  function renderBaziScreen() {
    return (
      <View style={styles.settingsShell}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveScreen("chat")}
            style={styles.iconButton}
          >
            <Ionicons name="chevron-back" size={20} color="#5c4a37" />
          </Pressable>
          <Text style={styles.settingsTitle}>{t("baziQuickForm")}</Text>
          <View style={styles.headerSide} />
        </View>

        <ScrollView
          style={styles.settingsScroller}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.settingsSection}>
            <Text style={styles.baziHint}>{t("baziFormHint")}</Text>
            <View style={styles.profileForm}>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("name")}</Text>
                <TextInput
                  value={baziForm.name}
                  onChangeText={(name) => setBaziForm((form) => ({ ...form, name }))}
                  placeholder={t("namePlaceholder")}
                  placeholderTextColor="#a18d73"
                  style={styles.profileInput}
                />
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("gender")}</Text>
                <View style={styles.languageToggle}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: baziForm.gender === t("genderMale") }}
                    onPress={() => setBaziForm((form) => ({ ...form, gender: t("genderMale") }))}
                    style={[
                      styles.languageOption,
                      baziForm.gender === t("genderMale") && styles.languageOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        baziForm.gender === t("genderMale") && styles.languageOptionTextActive,
                      ]}
                    >
                      {t("genderMale")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: baziForm.gender === t("genderFemale") }}
                    onPress={() => setBaziForm((form) => ({ ...form, gender: t("genderFemale") }))}
                    style={[
                      styles.languageOption,
                      baziForm.gender === t("genderFemale") && styles.languageOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        baziForm.gender === t("genderFemale") && styles.languageOptionTextActive,
                      ]}
                    >
                      {t("genderFemale")}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("calendarType")}</Text>
                <View style={styles.languageToggle}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: baziForm.calendarType === "solar" }}
                    onPress={() => setBaziForm((form) => ({ ...form, calendarType: "solar" }))}
                    style={[
                      styles.languageOption,
                      baziForm.calendarType === "solar" && styles.languageOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        baziForm.calendarType === "solar" && styles.languageOptionTextActive,
                      ]}
                    >
                      {t("baziCalendarSolar")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: baziForm.calendarType === "lunar" }}
                    onPress={() => setBaziForm((form) => ({ ...form, calendarType: "lunar" }))}
                    style={[
                      styles.languageOption,
                      baziForm.calendarType === "lunar" && styles.languageOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageOptionText,
                        baziForm.calendarType === "lunar" && styles.languageOptionTextActive,
                      ]}
                    >
                      {t("baziCalendarLunar")}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("birthDate")}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setBaziPickerMode("date")}
                  style={styles.pickerButton}
                >
                  <Text style={baziForm.birthDate ? styles.pickerButtonText : styles.pickerPlaceholderText}>
                    {baziForm.birthDate || t("birthDatePlaceholder")}
                  </Text>
                  <Ionicons name="calendar-outline" size={17} color="#8d3f2d" />
                </Pressable>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("birthTime")}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setBaziPickerMode("time")}
                  style={styles.pickerButton}
                >
                  <Text style={baziForm.birthTime ? styles.pickerButtonText : styles.pickerPlaceholderText}>
                    {baziForm.birthTime || t("birthTimePlaceholder")}
                  </Text>
                  <Ionicons name="time-outline" size={17} color="#8d3f2d" />
                </Pressable>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>{t("baziBirthCity")}</Text>
                <TextInput
                  value={baziForm.birthCity}
                  onChangeText={(birthCity) => setBaziForm((form) => ({ ...form, birthCity }))}
                  placeholder={t("baziBirthCityPlaceholder")}
                  placeholderTextColor="#a18d73"
                  style={styles.profileInput}
                />
              </View>
            </View>
            {baziPickerMode ? (
              <DateTimePicker
                display={Platform.OS === "ios" ? "spinner" : "default"}
                mode={baziPickerMode}
                onChange={handleBaziPickerChange}
                value={baziPickerMode === "date" ? dateFromBaziValue() : timeFromBaziValue()}
              />
            ) : null}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={loading || streaming}
            onPress={handleBaziSubmit}
            style={[styles.settingsSaveButton, (loading || streaming) && styles.settingsSaveButtonDisabled]}
          >
            <Ionicons name="sparkles-outline" size={17} color="#ffffff" />
            <Text style={styles.settingsSaveText}>{t("baziSubmit")}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <View style={styles.container}>
        {activeScreen === "settings" ? renderSettingsScreen() : activeScreen === "bazi" ? renderBaziScreen() : <View style={[styles.appFrame, showSidebar && styles.appFrameWide]}>
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
              <Text style={styles.title}>{t("appTitle")}</Text>
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
              <MessageBubble
                key={message.id}
                audioLabels={{
                  buffering: t("audioBuffering"),
                  play: t("playVoice"),
                  replay: t("replayVoice"),
                  stop: t("stopVoice"),
                }}
                autoPlayAudio={autoPlayAudioId === message.id}
                labels={{
                  audioFailed: t("audioFailed"),
                  audioPending: t("audioPending"),
                  mood: t("moodLabel"),
                  retryAudio: t("retryAudio"),
                }}
                message={message}
                onRetryAudio={handleRetryAudio}
              />
            ))}
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#8d3f2d" />
                <Text style={styles.loadingText}>{t("loadingReply")}</Text>
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
              <Text style={styles.newMessageText}>{t("newMessage")}</Text>
            </Pressable>
          ) : null}

          <View style={[styles.footer, { marginBottom: keyboardHeight }]}>
            <Composer
              busy={loading || streaming}
              disabled={!sessionId || !backendSessionId || loading || streaming}
              labels={{
                busyPlaceholder: t("composerBusyPlaceholder"),
                placeholder: t("composerPlaceholder"),
              }}
              value={input}
              onChangeText={setInput}
              onSend={handleSend}
            />
          </View>
          </View>
        </View>}
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
  sidebarQuickActions: {
    gap: 8,
    marginBottom: 10,
  },
  sidebarQuickButton: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sidebarQuickButtonText: {
    color: "#8d3f2d",
    fontSize: 13,
    fontWeight: "900",
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
  settingsShell: {
    alignSelf: "center",
    flex: 1,
    maxWidth: 760,
    width: "100%",
  },
  settingsHeader: {
    alignItems: "center",
    borderBottomColor: "#dccdb9",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 66,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  settingsTitle: {
    color: "#1f2528",
    fontSize: 20,
    fontWeight: "900",
  },
  settingsScroller: {
    flex: 1,
  },
  settingsContent: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  settingsSection: {
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  settingsSectionTitle: {
    color: "#1f2528",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 12,
  },
  settingSwitchRow: {
    alignItems: "center",
    borderTopColor: "#eadcc9",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  settingSwitchText: {
    flex: 1,
  },
  settingSwitchTitle: {
    color: "#2b261f",
    fontSize: 14,
    fontWeight: "900",
  },
  settingSwitchSubtitle: {
    color: "#7b6b57",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  languageToggle: {
    alignItems: "center",
    backgroundColor: "#f2e6d7",
    borderColor: "#dccdb9",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  languageOption: {
    borderRadius: 6,
    minWidth: 58,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  languageOptionActive: {
    backgroundColor: "#8d3f2d",
  },
  languageOptionText: {
    color: "#7b6b57",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  languageOptionTextActive: {
    color: "#ffffff",
  },
  settingsSaveButton: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingVertical: 13,
  },
  settingsSaveButtonDisabled: {
    backgroundColor: "#bcae9b",
  },
  settingsSaveText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  drawerMenuItem: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  drawerMenuItemSpacing: {
    marginTop: 8,
  },
  drawerMenuIcon: {
    alignItems: "center",
    backgroundColor: "#fff4ea",
    borderRadius: 7,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  drawerMenuText: {
    flex: 1,
  },
  drawerMenuTitle: {
    color: "#2b261f",
    fontSize: 14,
    fontWeight: "900",
  },
  drawerMenuSubtitle: {
    color: "#7b6b57",
    fontSize: 11,
    marginTop: 2,
  },
  baziHint: {
    color: "#7b6b57",
    fontSize: 13,
    lineHeight: 19,
  },
  profileForm: {
    gap: 9,
    marginTop: 10,
  },
  profileRow: {
    gap: 5,
  },
  profileLabel: {
    color: "#7b6b57",
    fontSize: 11,
    fontWeight: "800",
  },
  profileInput: {
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    color: "#2b261f",
    fontSize: 13,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pickerButton: {
    alignItems: "center",
    backgroundColor: "#fffaf3",
    borderColor: "#e2d2bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pickerButtonText: {
    color: "#2b261f",
    fontSize: 13,
    fontWeight: "700",
  },
  pickerPlaceholderText: {
    color: "#a18d73",
    fontSize: 13,
  },
  profileNotesInput: {
    maxHeight: 92,
    minHeight: 62,
    textAlignVertical: "top",
  },
  profileSaveButton: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 8,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    marginTop: 2,
    paddingVertical: 9,
  },
  profileSaveText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
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
