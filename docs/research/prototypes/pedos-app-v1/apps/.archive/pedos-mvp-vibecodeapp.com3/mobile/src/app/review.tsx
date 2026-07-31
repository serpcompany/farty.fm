import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, TextInput, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { Play, Pause, Check, X } from "lucide-react-native";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import type { RecordingLocation, RecordingAnalysis } from "@/lib/state/recordings-store";

import { createSound, saveRecordingFile, deleteRecordingFile, formatDuration } from "@/lib/audio";
import { WaveformAnimation } from "@/components/WaveformAnimation";
import useRecordingsStore from "@/lib/state/recordings-store";

export default function ReviewScreen() {
  const { uri, duration } = useLocalSearchParams<{ uri: string; duration: string }>();
  const durationMs = Number(duration ?? "0");

  const recordingsCount = useRecordingsStore((s) => s.recordings.length);
  const addRecording = useRecordingsStore((s) => s.addRecording);

  const [isPlaying, setIsPlaying] = useState(false);
  const [title, setTitle] = useState("");
  const soundRef = useRef<Audio.Sound | null>(null);
  const placeholderName = `Fart #${recordingsCount + 1}`;

  const cleanupSound = useCallback(async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
      } catch {
        // already stopped
      }
      try {
        await soundRef.current.unloadAsync();
      } catch {
        // already unloaded
      }
      soundRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupSound();
    };
  }, [cleanupSound]);

  const handlePlayPause = useCallback(async () => {
    if (!uri) return;

    if (isPlaying && soundRef.current) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      return;
    }

    try {
      if (!soundRef.current) {
        const sound = await createSound(uri);
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        });
      }

      await soundRef.current.setPositionAsync(0);
      await soundRef.current.playAsync();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [uri, isPlaying]);

  const handleSave = useCallback(async () => {
    if (!uri) return;

    const id = Crypto.randomUUID();
    const permanentUri = await saveRecordingFile(uri, id);

    // Collect location and audio analysis in parallel (both optional — never block save)
    let location: RecordingLocation | undefined;
    let analysis: RecordingAnalysis | undefined;

    await Promise.allSettled([
      // Location
      (async () => {
        if (Platform.OS === 'web') return;
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const [addr] = await Location.reverseGeocodeAsync(pos.coords);
          location = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            city: addr?.city ?? addr?.district ?? undefined,
            region: addr?.region ?? undefined,
            country: addr?.country ?? undefined,
          };
        } catch {
          // ignore — location is optional
        }
      })(),

      // Audio analysis
      (async () => {
        try {
          const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
          // Read the saved file and upload for analysis
          const fileUri = permanentUri.startsWith('file://') ? permanentUri : `file://${permanentUri}`;
          const formData = new FormData();
          formData.append('audio', {
            uri: fileUri,
            name: `recording-${id}.m4a`,
            type: 'audio/m4a',
          } as unknown as Blob);

          const resp = await fetch(`${backendUrl}/api/musical-fruit/analyze-recording`, {
            method: 'POST',
            body: formData,
          });
          if (resp.ok) {
            const json = await resp.json();
            analysis = json.data as RecordingAnalysis;
          }
        } catch {
          // ignore — analysis is optional
        }
      })(),
    ]);

    addRecording({
      id,
      uri: permanentUri,
      duration: durationMs,
      createdAt: new Date().toISOString(),
      title: title.trim() || placeholderName,
      location,
      analysis,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)');
  }, [uri, title, placeholderName, durationMs, addRecording]);

  const handleDiscard = useCallback(async () => {
    if (uri) {
      await deleteRecordingFile(uri);
    }
    router.replace("/(tabs)");
  }, [uri]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: "modal" }} />
      <SafeAreaView testID="review-screen" className="flex-1 bg-[#f8f8f8]">
        <View className="flex-1 px-6 pt-4">
          {/* Header */}
          <Text className="text-2xl font-bold text-gray-900 text-center mb-8">
            Review Recording
          </Text>

          {/* Preview card */}
          <View
            className="bg-white rounded-3xl p-6 mb-6"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 3,
            }}
          >
            {/* Duration */}
            <Text className="text-4xl font-light text-gray-900 text-center mb-6"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatDuration(durationMs)}
            </Text>

            {/* Waveform */}
            <View className="items-center mb-6">
              <WaveformAnimation isActive={isPlaying} color="#84cc16" />
            </View>

            {/* Play button */}
            <View className="items-center">
              <Pressable
                testID="play-button"
                onPress={handlePlayPause}
                className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center active:scale-95"
              >
                {isPlaying ? (
                  <Pause size={24} color="#374151" fill="#374151" />
                ) : (
                  <Play size={24} color="#374151" fill="#374151" />
                )}
              </Pressable>
              <Text className="text-xs text-gray-400 mt-2">
                {isPlaying ? "Pause" : "Play"}
              </Text>
            </View>
          </View>

          {/* Name input */}
          <View
            className="bg-white rounded-2xl px-5 py-4 mb-8"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
              elevation: 2,
            }}
          >
            <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Name
            </Text>
            <TextInput
              testID="recording-name-input"
              value={title}
              onChangeText={setTitle}
              placeholder={placeholderName}
              placeholderTextColor="#9ca3af"
              className="text-base text-gray-900 py-1"
              returnKeyType="done"
            />
          </View>

          {/* Spacer */}
          <View className="flex-1" />

          {/* Action buttons */}
          <View className="flex-row gap-3 mb-4">
            {/* Discard */}
            <Pressable
              testID="discard-recording-button"
              onPress={handleDiscard}
              className="flex-1 flex-row items-center justify-center py-4 rounded-2xl bg-gray-200 active:opacity-70"
            >
              <X size={20} color="#6b7280" />
              <Text className="text-gray-600 font-semibold text-base ml-2">Discard</Text>
            </Pressable>

            {/* Save */}
            <Pressable
              testID="save-recording-button"
              onPress={handleSave}
              className="flex-[2] flex-row items-center justify-center py-4 rounded-2xl bg-lime-500 active:opacity-70"
              style={{
                shadowColor: "#84cc16",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 12,
                elevation: 6,
              }}
            >
              <Check size={20} color="white" />
              <Text className="text-white font-bold text-base ml-2">Save</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
