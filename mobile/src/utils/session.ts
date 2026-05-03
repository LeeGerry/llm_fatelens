import AsyncStorage from "@react-native-async-storage/async-storage";

const LEGACY_SESSION_ID_STORAGE_KEY = "digital_human.session_id";

export function createSessionId() {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getOrCreateSessionId() {
  const existing = await AsyncStorage.getItem(LEGACY_SESSION_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const sessionId = createSessionId();
  await AsyncStorage.setItem(LEGACY_SESSION_ID_STORAGE_KEY, sessionId);
  return sessionId;
}
