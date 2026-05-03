import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatMessage } from "../types/chat";
import { createSessionId } from "./session";

const LEGACY_CHAT_MESSAGES_STORAGE_KEY = "digital_human.chat_messages";
const LEGACY_SESSION_ID_STORAGE_KEY = "digital_human.session_id";
const CHAT_SESSIONS_STORAGE_KEY = "digital_human.chat_sessions";
const ACTIVE_CHAT_SESSION_STORAGE_KEY = "digital_human.active_chat_session_id";

export type ChatSession = {
  backendSessionId: string;
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

function getSessionTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.text.trim());
  if (!firstUserMessage) {
    return "新的问事";
  }

  const title = firstUserMessage.text.trim().replace(/\s+/g, " ");
  return title.length > 18 ? `${title.slice(0, 18)}...` : title;
}

export function createChatSession(messages: ChatMessage[] = []): ChatSession {
  const id = createSessionId();
  return createChatSessionWithId(id, messages, id);
}

function createChatSessionWithId(
  id: string,
  messages: ChatMessage[] = [],
  backendSessionId = id,
): ChatSession {
  const now = Date.now();
  return {
    backendSessionId,
    id,
    title: getSessionTitle(messages),
    updatedAt: now,
    messages,
  };
}

function normalizeSession(session: ChatSession): ChatSession {
  return {
    ...session,
    backendSessionId: session.backendSessionId ?? session.id,
    messages: Array.isArray(session.messages) ? session.messages : [],
    title: session.title || getSessionTitle(session.messages ?? []),
    updatedAt: session.updatedAt || Date.now(),
  };
}

async function migrateLegacyMessages() {
  const legacyRaw = await AsyncStorage.getItem(LEGACY_CHAT_MESSAGES_STORAGE_KEY);
  if (!legacyRaw) {
    return null;
  }

  const parsed = JSON.parse(legacyRaw);
  if (!Array.isArray(parsed)) {
    return null;
  }

  const legacySessionId = await AsyncStorage.getItem(LEGACY_SESSION_ID_STORAGE_KEY);
  const session = createChatSessionWithId(
    legacySessionId ?? createSessionId(),
    parsed as ChatMessage[],
    legacySessionId ?? undefined,
  );
  await AsyncStorage.removeItem(LEGACY_CHAT_MESSAGES_STORAGE_KEY);
  return session;
}

export async function loadChatSessions() {
  const raw = await AsyncStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((session) => normalizeSession(session as ChatSession));
    }
  }

  const migratedSession = await migrateLegacyMessages();
  if (migratedSession) {
    await saveChatSessions([migratedSession]);
    await setActiveChatSessionId(migratedSession.id);
    return [migratedSession];
  }

  return [];
}

export async function saveChatSessions(sessions: ChatSession[]) {
  const orderedSessions = sessions
    .map(normalizeSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  await AsyncStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(orderedSessions));
}

export async function clearAllChatSessions() {
  await AsyncStorage.multiRemove([
    CHAT_SESSIONS_STORAGE_KEY,
    ACTIVE_CHAT_SESSION_STORAGE_KEY,
    LEGACY_CHAT_MESSAGES_STORAGE_KEY,
    LEGACY_SESSION_ID_STORAGE_KEY,
  ]);
}

export async function getActiveChatSessionId() {
  return AsyncStorage.getItem(ACTIVE_CHAT_SESSION_STORAGE_KEY);
}

export async function setActiveChatSessionId(sessionId: string) {
  await AsyncStorage.setItem(ACTIVE_CHAT_SESSION_STORAGE_KEY, sessionId);
}

export async function saveSessionMessages(sessionId: string, messages: ChatMessage[]) {
  const sessions = await loadChatSessions();
  const now = Date.now();
  const existingSession = sessions.find((session) => session.id === sessionId);
  const nextSession: ChatSession = {
    backendSessionId: existingSession?.backendSessionId ?? sessionId,
    id: sessionId,
    title: getSessionTitle(messages),
    updatedAt: now,
    messages,
  };

  await saveChatSessions(
    existingSession
      ? sessions.map((session) => (session.id === sessionId ? nextSession : session))
      : [nextSession, ...sessions],
  );
  await setActiveChatSessionId(sessionId);
}

export async function loadStoredMessages() {
  const sessions = await loadChatSessions();
  const activeSessionId = await getActiveChatSessionId();
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  return activeSession?.messages ?? null;
}

export async function saveStoredMessages(messages: ChatMessage[]) {
  const activeSessionId = (await getActiveChatSessionId()) ?? createSessionId();
  await saveSessionMessages(activeSessionId, messages);
}
