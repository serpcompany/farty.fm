import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  Play,
  Pause,
  Trash2,
} from "lucide-react-native";
import useRecordingsStore from "@/lib/state/recordings-store";
import { createSound, deleteRecordingFile, formatDuration } from "@/lib/audio";
import { WaveformAnimation } from "@/components/WaveformAnimation";

export default function PlaybackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const recordings = useRecordingsStore((s) => s.recordings);
  const deleteRecording = useRecordingsStore((s) => s.deleteRecording);
  const recording = recordings.find((r) => r.id === id);

  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);

  useEffect(() => {
    if (!recording) return;

    let mounted = true;

    const loadSound = async () => {
      try {
        const sound = await createSound(recording.uri);
        if (!mounted) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setPositionMillis(status.positionMillis ?? 0);
          setDurationMillis(status.durationMillis ?? 0);

          if (status.didJustFinish) {
            setIsPlaying(false);
            sound.setPositionAsync(0);
          }
        });
      } catch {
        // Sound loading failed silently
      }
    };

    loadSound();

    return () => {
      mounted = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    };
  }, [recording?.uri]);

  const togglePlayback = useCallback(async () => {
    if (!soundRef.current) return;
    if (isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleDelete = useCallback(() => {
    if (!recording) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    Alert.alert(
      "Delete Recording",
      "Are you sure you want to delete this recording? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (soundRef.current) {
              await soundRef.current.unloadAsync();
              soundRef.current = null;
            }
            await deleteRecordingFile(recording.uri);
            deleteRecording(recording.id);
            router.back();
          },
        },
      ]
    );
  }, [recording, deleteRecording, router]);

  const formatDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (isoDate: string): string => {
    const date = new Date(isoDate);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const progress =
    durationMillis > 0 ? positionMillis / durationMillis : 0;

  if (!recording) {
    return (
      <SafeAreaView
        testID="playback-screen"
        style={{ flex: 1, backgroundColor: "#f5f5f5" }}
      >
        <View style={{ padding: 20 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <ChevronLeft size={24} color="#111" />
            <Text style={{ fontSize: 16, color: "#111", marginLeft: 4 }}>
              Back
            </Text>
          </Pressable>
        </View>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 18, fontWeight: "600", color: "#737373" }}>
            Recording not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      testID="playback-screen"
      style={{ flex: 1, backgroundColor: "#f5f5f5" }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          testID="back-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#e5e5e5",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronLeft size={20} color="#333" />
        </Pressable>
      </View>

      {/* Content */}
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        {/* Title and date */}
        <View style={{ alignItems: "center", marginTop: 40, marginBottom: 48 }}>
          <Text
            style={{
              fontSize: 26,
              fontWeight: "700",
              color: "#111",
              textAlign: "center",
              marginBottom: 8,
            }}
            numberOfLines={2}
          >
            {recording.title ?? "Untitled Recording"}
          </Text>
          <Text style={{ fontSize: 14, color: "#999" }}>
            {formatDate(recording.createdAt)}
          </Text>
          <Text style={{ fontSize: 13, color: "#b3b3b3", marginTop: 2 }}>
            {formatTime(recording.createdAt)}
          </Text>
        </View>

        {/* Waveform */}
        <View
          style={{
            alignItems: "center",
            marginBottom: 48,
            paddingVertical: 24,
            backgroundColor: "#fff",
            borderRadius: 20,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.04,
            shadowRadius: 8,
            elevation: 1,
          }}
        >
          <WaveformAnimation isActive={isPlaying} />
        </View>

        {/* Progress bar */}
        <View style={{ marginBottom: 32, paddingHorizontal: 4 }}>
          <View
            style={{
              height: 6,
              backgroundColor: "#e5e5e5",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 6,
                backgroundColor: "#84cc16",
                borderRadius: 3,
                width: `${Math.min(progress * 100, 100)}%`,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 8,
            }}
          >
            <Text style={{ fontSize: 12, color: "#999", fontVariant: ["tabular-nums"] }}>
              {formatDuration(positionMillis)}
            </Text>
            <Text style={{ fontSize: 12, color: "#999", fontVariant: ["tabular-nums"] }}>
              {formatDuration(durationMillis)}
            </Text>
          </View>
        </View>

        {/* Play/Pause button */}
        <View style={{ alignItems: "center", marginBottom: 48 }}>
          <Pressable
            testID="play-button"
            onPress={togglePlayback}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: "#84cc16",
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.85 : 1,
              shadowColor: "#84cc16",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 10,
              elevation: 4,
            })}
          >
            {isPlaying ? (
              <Pause size={30} color="#fff" fill="#fff" />
            ) : (
              <Play size={30} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Delete button at bottom */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
        <Pressable
          testID="delete-button"
          onPress={handleDelete}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: pressed ? "#fecaca" : "#fee2e2",
            gap: 8,
          })}
        >
          <Trash2 size={18} color="#dc2626" />
          <Text style={{ fontSize: 15, fontWeight: "600", color: "#dc2626" }}>
            Delete Recording
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
