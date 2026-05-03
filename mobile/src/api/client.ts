import { Platform } from "react-native";
import EventSource, { type EventSourceListener } from "react-native-sse";

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
  error?: string | null;
};

export type ChatStreamEvent =
  | {
      type: "start";
      message_id: string;
      mood: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "done";
      message_id: string;
      mood: string;
      audio_url: string | null;
      audio_status_url: string | null;
    }
  | {
      type: "error";
      message_id?: string;
      mood?: string;
      text: string;
    };

export type ChatStreamStartResponse = {
  stream_id: string;
  message_id: string;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export function supportsFetchStreaming() {
  return (
    Platform.OS === "web" &&
    typeof ReadableStream !== "undefined" &&
    typeof TextDecoder !== "undefined"
  );
}

export function supportsSseStreaming() {
  return Platform.OS !== "web";
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

export async function streamChat(
  message: string,
  sessionId: string,
  onEvent: (event: ChatStreamEvent) => void,
) {
  if (!supportsFetchStreaming()) {
    throw new Error("Streaming response is not supported in this runtime.");
  }

  const response = await fetch(`${getApiBaseUrl()}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      with_voice: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Chat stream failed: ${response.status}`);
  }

  const body = response.body;
  if (!body || !("getReader" in body)) {
    throw new Error("Streaming response body reader is not supported in this runtime.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      onEvent(JSON.parse(trimmed) as ChatStreamEvent);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    onEvent(JSON.parse(tail) as ChatStreamEvent);
  }
}

export async function streamChatSse(
  message: string,
  sessionId: string,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const startResponse = await fetch(`${getApiBaseUrl()}/chat/stream/start`, {
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

  if (!startResponse.ok) {
    const text = await startResponse.text();
    throw new Error(text || `Chat stream start failed: ${startResponse.status}`);
  }

  const { stream_id: streamId } = (await startResponse.json()) as ChatStreamStartResponse;

  await new Promise<void>((resolve, reject) => {
    const events = new EventSource(`${getApiBaseUrl()}/chat/stream/${streamId}/events`, {
      headers: {
        Accept: "text/event-stream",
      },
      pollingInterval: 0,
      timeout: 0,
    });

    const closeEvents = () => {
      events.removeAllEventListeners();
      events.close();
    };

    const messageListener: EventSourceListener<never, "message"> = (event) => {
      if (!event.data) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as ChatStreamEvent;
        onEvent(payload);
        if (payload.type === "done") {
          closeEvents();
          resolve();
        }
        if (payload.type === "error") {
          closeEvents();
          reject(new Error(payload.text));
        }
      } catch (e) {
        closeEvents();
        reject(e instanceof Error ? e : new Error("Invalid SSE stream event."));
      }
    };

    const errorListener: EventSourceListener<never, "error"> = (event) => {
      closeEvents();
      if (event.type === "timeout") {
        reject(new Error("SSE stream timed out."));
        return;
      }
      if (event.type === "exception") {
        reject(event.error);
        return;
      }
      reject(new Error(event.message || "SSE stream failed."));
    };

    events.addEventListener("message", messageListener);
    events.addEventListener("error", errorListener);
  });
}

export function getAudioUrl(audioId: string) {
  return `${getApiBaseUrl()}/voices/${audioId}.mp3`;
}

export async function getAudioStatus(audioId: string): Promise<AudioStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/audio/${audioId}/status`);
  if (!response.ok) {
    throw new Error(`Audio status failed: ${response.status}`);
  }
  const status: AudioStatusResponse = await response.json();
  return {
    ...status,
    audio_url: getAudioUrl(audioId),
  };
}

export async function retryAudio(
  audioId: string,
  text: string,
  mood = "default",
): Promise<AudioStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/audio/${audioId}/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, mood }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Audio retry failed: ${response.status}`);
  }

  return response.json();
}
