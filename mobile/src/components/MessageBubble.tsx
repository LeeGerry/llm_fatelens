import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { ChatMessage } from "../types/chat";

type Props = {
  message: ChatMessage;
};

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const canPlay = !isUser && message.audioStatus === "ready" && message.audioUrl;

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.masterRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.masterBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.masterText]}>{message.text}</Text>
        {!isUser && (
          <View style={styles.metaRow}>
            {message.mood ? <Text style={styles.metaText}>{message.mood}</Text> : null}
            {message.audioStatus === "pending" ? (
              <View style={styles.audioPending}>
                <Ionicons name="time-outline" size={14} color="#7b6b57" />
                <Text style={styles.metaText}>语音生成中</Text>
              </View>
            ) : null}
            {canPlay ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => Linking.openURL(message.audioUrl as string)}
                style={styles.audioButton}
              >
                <Ionicons name="play" size={14} color="#ffffff" />
                <Text style={styles.audioButtonText}>播放语音</Text>
              </Pressable>
            ) : null}
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
  audioPending: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  audioButton: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 6,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  audioButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
});
