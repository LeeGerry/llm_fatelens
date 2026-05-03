export type ChatResponse = {
  reply: string;
  session_id: string;
  message_id: string;
  mood: string;
  audio_url: string | null;
  audio_status_url: string | null;
};

export type AudioStatusResponse = {
  id: string;
  status: "pending" | "ready" | "failed";
  audio_url: string | null;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function sendChat(message: string, sessionId: string): Promise<ChatResponse> {
  const response = await fetch(`${getApiBaseUrl()}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      with_voice: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Chat request failed: ${response.status}`);
  }

  return response.json();
}

export async function getAudioStatus(statusUrl: string): Promise<AudioStatusResponse> {
  const response = await fetch(statusUrl);
  if (!response.ok) {
    throw new Error(`Audio status failed: ${response.status}`);
  }
  return response.json();
}
