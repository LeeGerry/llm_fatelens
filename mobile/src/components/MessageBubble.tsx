import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AudioPlayButton } from "./AudioPlayButton";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type { ChatMessage } from "../types/chat";

type Props = {
  audioLabels: {
    buffering: string;
    play: string;
    replay: string;
    stop: string;
  };
  labels: {
    audioFailed: string;
    audioPending: string;
    mood: string;
    retryAudio: string;
  };
  message: ChatMessage;
  onRetryAudio?: (message: ChatMessage) => void;
};

export function MessageBubble({ audioLabels, labels, message, onRetryAudio }: Props) {
  const isUser = message.role === "user";
  const canPlay = !isUser && message.audioStatus === "ready" && message.audioUrl;
  const toolsUsed = message.toolsUsed ?? [];

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.masterRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.masterBubble]}>
        {isUser ? (
          <Text style={[styles.text, styles.userText]}>{message.text}</Text>
        ) : (
          <SimpleMarkdown text={message.text || " "} />
        )}
        {!isUser && (
          <View style={styles.metaRow}>
            {message.mood ? (
              <Text style={styles.metaText}>
                {labels.mood}[{message.mood}]
              </Text>
            ) : null}
            {toolsUsed.map((tool) => (
              <View key={tool} style={styles.toolTag}>
                <Ionicons name="construct-outline" size={12} color="#8d3f2d" />
                <Text style={styles.toolTagText}>{tool}</Text>
              </View>
            ))}
            {message.audioStatus === "pending" ? (
              <View style={styles.audioPending}>
                <Ionicons name="time-outline" size={14} color="#7b6b57" />
                <Text style={styles.metaText}>{labels.audioPending}</Text>
              </View>
            ) : null}
            {message.audioStatus === "failed" ? (
              <>
                <View style={styles.audioPending}>
                  <Ionicons name="alert-circle-outline" size={14} color="#a1352d" />
                  <Text style={styles.errorMetaText}>{labels.audioFailed}</Text>
                </View>
                <Text
                  accessibilityRole="button"
                  onPress={() => onRetryAudio?.(message)}
                  style={styles.retryText}
                >
                  {labels.retryAudio}
                </Text>
              </>
            ) : null}
            {canPlay ? <AudioPlayButton labels={audioLabels} url={message.audioUrl as string} /> : null}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    marginVertical: 6,
  },
  userRow: {
    alignItems: "flex-end",
  },
  masterRow: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: "#19324a",
  },
  masterBubble: {
    backgroundColor: "#ffffff",
    borderColor: "#e8ded0",
    borderWidth: 1,
  },
  text: {
    fontSize: 16,
    lineHeight: 23,
  },
  userText: {
    color: "#ffffff",
  },
  masterText: {
    color: "#2b261f",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  metaText: {
    color: "#7b6b57",
    fontSize: 12,
  },
  errorMetaText: {
    color: "#a1352d",
    fontSize: 12,
  },
  retryText: {
    color: "#8d3f2d",
    fontSize: 12,
    fontWeight: "700",
  },
  toolTag: {
    alignItems: "center",
    backgroundColor: "#fff4ea",
    borderColor: "#ead4c4",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  toolTagText: {
    color: "#8d3f2d",
    fontSize: 11,
    fontWeight: "800",
  },
  audioPending: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
});
