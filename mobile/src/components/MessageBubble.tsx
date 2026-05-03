import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AudioPlayButton } from "./AudioPlayButton";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type { ChatMessage } from "../types/chat";

type Props = {
  message: ChatMessage;
  onRetryAudio?: (message: ChatMessage) => void;
};

export function MessageBubble({ message, onRetryAudio }: Props) {
  const isUser = message.role === "user";
  const canPlay = !isUser && message.audioStatus === "ready" && message.audioUrl;

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
            {message.mood ? <Text style={styles.metaText}>[{message.mood}]</Text> : null}
            {message.audioStatus === "pending" ? (
              <View style={styles.audioPending}>
                <Ionicons name="time-outline" size={14} color="#7b6b57" />
                <Text style={styles.metaText}>语音生成中</Text>
              </View>
            ) : null}
            {message.audioStatus === "failed" ? (
              <>
                <View style={styles.audioPending}>
                  <Ionicons name="alert-circle-outline" size={14} color="#a1352d" />
                  <Text style={styles.errorMetaText}>语音生成失败</Text>
                </View>
                <Text
                  accessibilityRole="button"
                  onPress={() => onRetryAudio?.(message)}
                  style={styles.retryText}
                >
                  重试生成语音
                </Text>
              </>
            ) : null}
            {canPlay ? <AudioPlayButton url={message.audioUrl as string} /> : null}
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
  audioPending: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
});
