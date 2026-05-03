import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

type Props = {
  url: string;
};

export function AudioPlayButton({ url }: Props) {
  const player = useAudioPlayer(url, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const isBuffering = status.isBuffering;

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }, []);

  function handlePress() {
    if (isPlaying) {
      player.pause();
      return;
    }

    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={[styles.audioButton, isBuffering && styles.audioButtonDisabled]}
    >
      <Ionicons name={isPlaying ? "pause" : "play"} size={14} color="#ffffff" />
      <Text style={styles.audioButtonText}>
        {isBuffering ? "加载中" : isPlaying ? "暂停" : "播放语音"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  audioButton: {
    alignItems: "center",
    backgroundColor: "#8d3f2d",
    borderRadius: 6,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  audioButtonDisabled: {
    backgroundColor: "#bcae9b",
  },
  audioButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
});
