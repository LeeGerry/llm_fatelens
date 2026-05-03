import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

type Props = {
  url: string;
};

type AudioController = {
  id: string;
  stop: () => void;
};

let activeAudioController: AudioController | null = null;

function safelyStopAudio(controller: AudioController) {
  try {
    controller.stop();
  } catch {
    // Expo can release native audio objects during fast unmount/session switches.
  }
}

function makeAudioControllerActive(controller: AudioController) {
  if (activeAudioController && activeAudioController.id !== controller.id) {
    safelyStopAudio(activeAudioController);
  }
  activeAudioController = controller;
}

function clearAudioController(controllerId: string) {
  if (activeAudioController?.id === controllerId) {
    activeAudioController = null;
  }
}

export function stopActiveAudio() {
  if (activeAudioController) {
    safelyStopAudio(activeAudioController);
    activeAudioController = null;
  }
}

export function AudioPlayButton({ url }: Props) {
  const [activated, setActivated] = useState(false);

  if (!activated) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setActivated(true)}
        style={styles.audioButton}
      >
        <Ionicons name="play" size={14} color="#ffffff" />
        <Text style={styles.audioButtonText}>播放语音</Text>
      </Pressable>
    );
  }

  return <ActivatedAudioPlayButton url={url} />;
}

function ActivatedAudioPlayButton({ url }: Props) {
  const controllerIdRef = useRef(`audio-${Date.now()}-${Math.random()}`);
  const [hasPlayed, setHasPlayed] = useState(false);
  const player = useAudioPlayer(url, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const isBuffering = status.isBuffering;
  const isFinished = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }, []);

  useEffect(() => {
    const controller = {
      id: controllerIdRef.current,
      stop: () => {
        player.pause();
        player.seekTo(0);
      },
    };
    makeAudioControllerActive(controller);
    setHasPlayed(true);
    player.play();

    return () => {
      clearAudioController(controller.id);
      try {
        player.pause();
      } catch {
        // Native player may already be released while switching chat sessions.
      }
    };
  }, [player]);

  function handlePress() {
    if (isPlaying) {
      player.pause();
      player.seekTo(0);
      clearAudioController(controllerIdRef.current);
      return;
    }

    makeAudioControllerActive({
      id: controllerIdRef.current,
      stop: () => {
        player.pause();
        player.seekTo(0);
      },
    });
    if (isFinished) {
      player.seekTo(0);
    }
    setHasPlayed(true);
    player.play();
  }

  useEffect(() => {
    if (isFinished && !isPlaying) {
      clearAudioController(controllerIdRef.current);
    }
  }, [isFinished, isPlaying]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={[styles.audioButton, isBuffering && styles.audioButtonDisabled]}
    >
      <Ionicons name={isPlaying ? "pause" : "play"} size={14} color="#ffffff" />
      <Text style={styles.audioButtonText}>
        {isBuffering ? "加载中" : isPlaying ? "停止播放" : hasPlayed ? "重新播放" : "播放语音"}
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
