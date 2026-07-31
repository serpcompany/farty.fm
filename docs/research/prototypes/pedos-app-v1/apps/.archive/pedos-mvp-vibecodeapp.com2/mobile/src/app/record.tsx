import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Stack } from "expo-router";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Square } from "lucide-react-native";

import { startRecording, stopRecording, requestMicPermission } from "@/lib/audio";
import { WaveformAnimation } from "@/components/WaveformAnimation";

export default function RecordScreen() {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    pulseOpacity.value = withRepeat(
      withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const beginRecording = useCallback(async () => {
    try {
      const recording = await startRecording();
      recordingRef.current = recording;
      setIsRecording(true);
      startTimeRef.current = Date.now();

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);
    } catch {
      // Recording failed to start
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const granted = await requestMicPermission();
      if (!mounted) return;
      setPermissionGranted(granted);

      if (granted) {
        beginRecording();
      }
    }

    init();

    return () => {
      mounted = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      // Clean up active recording
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      // Reset audio mode
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
      }).catch(() => {});
    };
  }, [beginRecording]);

  const handleStop = useCallback(async () => {
    if (!recordingRef.current) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const { uri, duration } = await stopRecording(recordingRef.current);
      recordingRef.current = null;
      setIsRecording(false);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      router.push({
        pathname: "/review",
        params: { uri, duration: String(duration) },
      });
    } catch {
      router.back();
    }
  }, []);

  const formatTimerDisplay = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  };

  // Permission denied
  if (permissionGranted === false) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false, presentation: "modal" }} />
        <SafeAreaView className="flex-1 bg-[#f8f8f8] items-center justify-center px-8">
          <View className="bg-white rounded-3xl p-8 items-center shadow-sm">
            <Text className="text-6xl mb-4">🎙️</Text>
            <Text className="text-xl font-bold text-gray-900 text-center mb-2">
              Microphone Access Needed
            </Text>
            <Text className="text-base text-gray-500 text-center mb-6">
              Please enable microphone access in your device settings to record farts.
            </Text>
            <Pressable
              onPress={() => router.back()}
              className="bg-gray-900 rounded-2xl px-8 py-4 active:opacity-70"
            >
              <Text className="text-white font-semibold text-base">Go Back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </>
    );
  }

  // Loading permission
  if (permissionGranted === null) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false, presentation: "modal" }} />
        <SafeAreaView className="flex-1 bg-[#f8f8f8] items-center justify-center">
          <Text className="text-gray-400 text-base">Requesting permission...</Text>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: "modal" }} />
      <SafeAreaView className="flex-1 bg-[#f8f8f8]">
        <View className="flex-1 items-center justify-center px-8">
          {/* Recording indicator */}
          <View className="items-center mb-12">
            <View className="flex-row items-center mb-3">
              <Animated.View
                style={[
                  {
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: "#ef4444",
                    marginRight: 10,
                  },
                  pulseStyle,
                ]}
              />
              <Text className="text-base font-semibold text-red-500 tracking-wider uppercase">
                Recording
              </Text>
            </View>

            {/* Timer */}
            <Text
              className="text-7xl font-extralight text-gray-900 tracking-tight"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {formatTimerDisplay(elapsed)}
            </Text>
          </View>

          {/* Waveform */}
          <View className="mb-16">
            <WaveformAnimation isActive={isRecording} color="#ef4444" />
          </View>

          {/* Stop button */}
          <Pressable
            testID="stop-recording-button"
            onPress={handleStop}
            className="w-20 h-20 rounded-full bg-red-500 items-center justify-center active:scale-95 shadow-lg"
            style={{
              shadowColor: "#ef4444",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Square size={28} color="white" fill="white" />
          </Pressable>
          <Text className="text-sm text-gray-400 mt-4">Tap to stop</Text>
        </View>
      </SafeAreaView>
    </>
  );
}
