import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

type Props = {
  autoPlay?: boolean;
  labels: {
    buffering: string;
    play: string;
    replay: string;
    stop: string;
  };
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

function safelyPauseAndReset(player: ReturnType<typeof useAudioPlayer>) {
  try {
    player.pause();
    void player.seekTo(0);
  } catch {
    // Native player can be released during reloads, route switches, or rapid repeated taps.
  }
}

export function stopActiveAudio() {
  if (activeAudioController) {
    safelyStopAudio(activeAudioController);
    activeAudioController = null;
  }
}

export function AudioPlayButton({ autoPlay, labels, url }: Props) {
  const [activated, setActivated] = useState(Boolean(autoPlay));

  useEffect(() => {
    if (autoPlay) {
      setActivated(true);
    }
  }, [autoPlay]);

  if (!activated) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setActivated(true)}
        style={styles.audioButton}
      >
        <Ionicons name="play" size={14} color="#ffffff" />
        <Text style={styles.audioButtonText}>{labels.play}</Text>
      </Pressable>
    );
  }

  return <ActivatedAudioPlayButton labels={labels} url={url} />;
}

function ActivatedAudioPlayButton({ labels, url }: Props) {
  const controllerIdRef = useRef(`audio-${Date.now()}-${Math.random()}`);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playRequested, setPlayRequested] = useState(true);
  const player = useAudioPlayer({ uri: url }, { updateInterval: 250, keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const isBuffering = status.isBuffering;
  const isLoaded = status.isLoaded;
  const isFinished = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration);

  async function prepareAudioSession() {
    await setIsAudioActiveAsync(true);
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
    });
  }

  async function startPlayback() {
    try {
      setPlayRequested(true);
      if (!isLoaded) {
        return;
      }
      await prepareAudioSession();
      makeAudioControllerActive({
        id: controllerIdRef.current,
        stop: () => safelyPauseAndReset(player),
      });
      if (isFinished) {
        await player.seekTo(0);
      }
      setHasPlayed(true);
      setPlayRequested(false);
      player.play();
    } catch (error) {
      setPlayRequested(false);
      clearAudioController(controllerIdRef.current);
      console.warn("Audio playback failed", { error, url });
    }
  }

  useEffect(() => {
    const controller = {
      id: controllerIdRef.current,
      stop: () => safelyPauseAndReset(player),
    };
    makeAudioControllerActive(controller);
    void startPlayback();

    return () => {
      clearAudioController(controller.id);
      safelyPauseAndReset(player);
    };
  }, [player]);

  useEffect(() => {
    if (playRequested && isLoaded && !isPlaying) {
      void startPlayback();
    }
  }, [playRequested, isLoaded, isPlaying]);

  function handlePress() {
    if (isPlaying) {
      safelyPauseAndReset(player);
      setPlayRequested(false);
      clearAudioController(controllerIdRef.current);
      return;
    }

    void startPlayback();
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
        {isBuffering ? labels.buffering : isPlaying ? labels.stop : hasPlayed ? labels.replay : labels.play}
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
