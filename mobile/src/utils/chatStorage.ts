import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChatMessage } from "../types/chat";

const CHAT_MESSAGES_STORAGE_KEY = "digital_human.chat_messages";

export async function loadStoredMessages() {
  const raw = await AsyncStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return null;
  }

  return parsed as ChatMessage[];
}

export async function saveStoredMessages(messages: ChatMessage[]) {
  await AsyncStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
}
