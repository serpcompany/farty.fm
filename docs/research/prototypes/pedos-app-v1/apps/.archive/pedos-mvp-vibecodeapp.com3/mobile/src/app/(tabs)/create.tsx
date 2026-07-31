import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  Music,
  Sparkles,
  Play,
  Pause,
  Square,
  Check,
  CheckCircle,
  Search,
  X,
} from "lucide-react-native";
import { api } from "@/lib/api/api";
import useRecordingsStore from "@/lib/state/recordings-store";
import useGeneratedSongsStore from "@/lib/state/generated-songs-store";

// ---------------------------------------------------------------------------
// Types matching backend response shapes (auto-unwrapped from { data: T })
// ---------------------------------------------------------------------------

interface Sample {
  filename: string;
  path: string;
  duration: number;
}

interface MelodyInfo {
  key: string;
  name: string;
  noteCount: number;
  totalDuration: number;
  bpm: number;
}

interface MelodyMatch {
  key: string;
  name: string;
  noteCount: number;
  totalDuration: number;
  bpm: number;
  matchScore: number;
  matchLabel: string;
  transpose: number;
}

interface GenerateResult {
  filename: string;
  url: string;
  melody: string;
  melodyName: string;
  durationSeconds: number;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CreateScreen() {
  const recordings = useRecordingsStore((s) => s.recordings);
  const addSong = useGeneratedSongsStore((s) => s.addSong);
  const updateSong = useGeneratedSongsStore((s) => s.updateSong);
  const router = useRouter();

  const [selectedSamples, setSelectedSamples] = useState<Sample[]>([]);
  const [selectedMelody, setSelectedMelody] = useState<string | null>(null);
  const [melodySearch, setMelodySearch] = useState("");

  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const [previewingFilename, setPreviewingFilename] = useState<string | null>(
    null
  );

  // Track the pending song ID so we can update it on success/error
  const pendingSongIdRef = useRef<string | null>(null);

  // Cleanup sounds on unmount
  useEffect(() => {
    return () => {
      if (previewSoundRef.current) {
        previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }
    };
  }, []);

  // ---- Queries ----

  const samplesQuery = useQuery({
    queryKey: ["musical-fruit-samples"],
    queryFn: () => api.get<Sample[]>("/api/musical-fruit/samples"),
  });

  const melodiesQuery = useQuery({
    queryKey: ["musical-fruit-melodies"],
    queryFn: () => api.get<MelodyInfo[]>("/api/musical-fruit/melodies"),
  });

  const recommendQuery = useQuery({
    queryKey: ["melody-recommendations", selectedSamples.map((s) => s.path).sort()],
    queryFn: () =>
      api.post<MelodyMatch[]>("/api/musical-fruit/recommend-melodies", {
        samplePaths: selectedSamples.map((s) => s.path),
      }),
    enabled: selectedSamples.length > 0,
    staleTime: 30_000,
  });

  // ---- Filtered & sorted melodies ----

  const sortedMelodies = useMemo(() => {
    const all = melodiesQuery.data?.slice() ?? [];
    if (recommendQuery.data && selectedSamples.length > 0) {
      const scoreMap = new Map(recommendQuery.data.map((m) => [m.key, m.matchScore]));
      all.sort((a, b) => (scoreMap.get(b.key) ?? 0) - (scoreMap.get(a.key) ?? 0));
    } else {
      all.sort((a, b) => a.name.localeCompare(b.name));
    }
    return all;
  }, [melodiesQuery.data, recommendQuery.data, selectedSamples.length]);

  const filteredMelodies = useMemo(() => {
    if (!melodySearch.trim()) return sortedMelodies;
    const q = melodySearch.toLowerCase().trim();
    return sortedMelodies.filter((m) => m.name.toLowerCase().includes(q));
  }, [sortedMelodies, melodySearch]);

  // ---- Mutation ----

  const generateMutation = useMutation({
    mutationFn: (params: { samplePaths: string[]; melodyName: string }) =>
      api.post<GenerateResult>("/api/musical-fruit/generate", params),
    onSuccess: (data) => {
      const songId = pendingSongIdRef.current;
      if (songId) {
        updateSong(songId, {
          status: "ready",
          filename: data.filename,
          url: data.url,
          durationSeconds: data.durationSeconds,
        });
        pendingSongIdRef.current = null;
      }
    },
    onError: () => {
      const songId = pendingSongIdRef.current;
      if (songId) {
        updateSong(songId, { status: "error" });
        pendingSongIdRef.current = null;
      }
    },
  });

  // ---- Preview playback ----

  const handlePreview = useCallback(
    async (sample: Sample) => {
      if (previewingFilename === sample.filename && previewSoundRef.current) {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
        setPreviewingFilename(null);
        return;
      }

      if (previewSoundRef.current) {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const audioUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/musical-fruit/sample-audio/${encodeURIComponent(sample.filename)}`;
        const { sound } = await Audio.Sound.createAsync({ uri: audioUrl });
        previewSoundRef.current = sound;
        setPreviewingFilename(sample.filename);

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPreviewingFilename(null);
            previewSoundRef.current = null;
          }
        });

        await sound.playAsync();
      } catch (err) {
        console.error("Preview playback error:", err);
        setPreviewingFilename(null);
      }
    },
    [previewingFilename]
  );

  // ---- Generate ----

  const { mutate: generateMutate } = generateMutation;

  const handleGenerate = useCallback(async () => {
    if (selectedSamples.length === 0 || !selectedMelody) return;

    // Stop any preview
    if (previewSoundRef.current) {
      await previewSoundRef.current.stopAsync();
      await previewSoundRef.current.unloadAsync();
      previewSoundRef.current = null;
      setPreviewingFilename(null);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Find melody name for display
    const melodyInfo = sortedMelodies.find((m) => m.key === selectedMelody);
    const melodyName = melodyInfo?.name ?? selectedMelody;

    // Create a pending song in the store
    const songId = `song-${Date.now()}`;
    pendingSongIdRef.current = songId;

    addSong({
      id: songId,
      melodyKey: selectedMelody,
      melodyName,
      filename: "",
      url: "",
      sampleNames: selectedSamples.map((s) =>
        s.filename.replace(/\.[^.]+$/, "")
      ),
      createdAt: new Date().toISOString(),
      status: "generating",
    });

    // Start generation
    generateMutate({
      samplePaths: selectedSamples.map((s) => s.path),
      melodyName: selectedMelody,
    });

    // Navigate to library
    router.push("/(tabs)/library");
  }, [
    selectedSamples,
    selectedMelody,
    generateMutate,
    addSong,
    sortedMelodies,
    router,
  ]);

  // ---- Helpers ----

  const formatDuration = (seconds: number) => {
    const s = Math.round(seconds * 10) / 10;
    return `${s}s`;
  };

  const formatSampleName = (filename: string) => {
    return filename
      .replace(/\.[^.]+$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const canGenerate =
    selectedSamples.length > 0 &&
    selectedMelody !== null &&
    !generateMutation.isPending;

  // ---- Select all / Deselect all ----

  const allSamples = samplesQuery.data ?? [];
  const allSelected =
    allSamples.length > 0 && selectedSamples.length === allSamples.length;

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedSamples([]);
    } else {
      setSelectedSamples(allSamples);
    }
  }, [allSelected, allSamples]);

  return (
    <SafeAreaView
      testID="create-screen"
      edges={["top"]}
      className="flex-1 bg-white"
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Sticky Generate Button */}
        <View className="px-5 pt-3 pb-2 border-b border-gray-100 bg-white">
          <Pressable
            testID="generate-button"
            onPress={handleGenerate}
            disabled={!canGenerate}
            className={`rounded-2xl py-3.5 items-center justify-center flex-row gap-2 ${
              canGenerate ? "bg-lime-500" : "bg-gray-200"
            }`}
            style={
              canGenerate
                ? {
                    shadowColor: "#84cc16",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 6,
                  }
                : undefined
            }
          >
            {generateMutation.isPending ? (
              <>
                <ActivityIndicator
                  testID="generate-loading"
                  size="small"
                  color="#ffffff"
                />
                <Text className="text-white text-lg font-bold">
                  Generating...
                </Text>
              </>
            ) : (
              <>
                <Sparkles
                  size={20}
                  color={canGenerate ? "#ffffff" : "#9ca3af"}
                />
                <Text
                  className={`text-lg font-bold ${
                    canGenerate ? "text-white" : "text-gray-400"
                  }`}
                >
                  Generate Fart Song
                </Text>
              </>
            )}
          </Pressable>

          {generateMutation.isError ? (
            <Text className="text-red-500 text-sm text-center mt-1">
              Generation failed. Try again!
            </Text>
          ) : null}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Section 1: Choose Your Fart */}
          <View className="px-5 mt-5">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-semibold text-gray-900">
                Choose Your Fart
                {selectedSamples.length > 0
                  ? ` (${selectedSamples.length})`
                  : null}
              </Text>
              {allSamples.length > 0 ? (
                <Pressable
                  testID="toggle-all-samples"
                  onPress={handleToggleAll}
                >
                  <Text className="text-sm font-medium text-lime-600">
                    {allSelected ? "Deselect All" : "Select All"}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* User recordings notice */}
            {recordings.length > 0 ? (
              <View className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                <Text className="text-sm text-amber-700">
                  Your {recordings.length} recording
                  {recordings.length > 1 ? "s" : null} can't be used yet --
                  local files need to be on the server. Use a test sample below
                  for now!
                </Text>
              </View>
            ) : null}

            {samplesQuery.isLoading ? (
              <ActivityIndicator
                testID="samples-loading"
                size="small"
                color="#84cc16"
              />
            ) : samplesQuery.isError ? (
              <Text className="text-red-500 text-sm">
                Failed to load samples
              </Text>
            ) : (
              <View className="border border-gray-200 rounded-xl overflow-hidden">
                {samplesQuery.data?.map((sample, index) => {
                  const isSelected = selectedSamples.some(
                    (s) => s.filename === sample.filename
                  );
                  const isPreviewing =
                    previewingFilename === sample.filename;
                  const isLast =
                    index === (samplesQuery.data?.length ?? 0) - 1;
                  return (
                    <Pressable
                      key={sample.filename}
                      testID={`sample-${sample.filename}`}
                      onPress={() => {
                        setSelectedSamples((prev) =>
                          prev.some((s) => s.filename === sample.filename)
                            ? prev.filter(
                                (s) => s.filename !== sample.filename
                              )
                            : [...prev, sample]
                        );
                      }}
                      className={`flex-row items-center px-3 py-2.5 ${
                        isSelected ? "bg-lime-50" : "bg-white"
                      } ${!isLast ? "border-b border-gray-100" : ""}`}
                    >
                      {/* Play/Preview button */}
                      <Pressable
                        testID={`preview-${sample.filename}`}
                        onPress={(e) => {
                          e.stopPropagation();
                          handlePreview(sample);
                        }}
                        className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
                          isPreviewing ? "bg-lime-500" : "bg-gray-100"
                        }`}
                      >
                        {isPreviewing ? (
                          <Square
                            size={12}
                            color="#ffffff"
                            fill="#ffffff"
                          />
                        ) : (
                          <Play
                            size={12}
                            color="#6b7280"
                            fill="#6b7280"
                            style={{ marginLeft: 1 }}
                          />
                        )}
                      </Pressable>

                      {/* Sample name */}
                      <Text
                        className={`flex-1 text-sm font-medium ${
                          isSelected ? "text-lime-700" : "text-gray-800"
                        }`}
                        numberOfLines={1}
                      >
                        {formatSampleName(sample.filename)}
                      </Text>

                      {/* Duration */}
                      <Text className="text-xs text-gray-400 mr-3">
                        {sample.duration > 0
                          ? formatDuration(sample.duration)
                          : null}
                      </Text>

                      {/* Selection indicator */}
                      <View
                        className={`w-5 h-5 rounded-full items-center justify-center ${
                          isSelected
                            ? "bg-lime-500"
                            : "border-2 border-gray-300"
                        }`}
                      >
                        {isSelected ? (
                          <Check size={12} color="#ffffff" strokeWidth={3} />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Section 2: Choose a Melody */}
          <View className="px-5 mt-8">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-semibold text-gray-900">
                Choose a Melody
              </Text>
              {recommendQuery.isFetching ? (
                <ActivityIndicator size="small" color="#84cc16" />
              ) : recommendQuery.data && selectedSamples.length > 0 ? (
                <Text className="text-xs text-gray-400">Sorted by match</Text>
              ) : null}
            </View>

            {/* Search input */}
            <View className="flex-row items-center bg-gray-100 rounded-xl px-3 py-2.5 mb-3">
              <Search size={16} color="#9ca3af" />
              <TextInput
                testID="melody-search"
                className="flex-1 ml-2 text-sm text-gray-900"
                placeholder="Search melodies..."
                placeholderTextColor="#9ca3af"
                value={melodySearch}
                onChangeText={setMelodySearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {melodySearch.length > 0 ? (
                <Pressable
                  testID="clear-melody-search"
                  onPress={() => setMelodySearch("")}
                >
                  <X size={16} color="#9ca3af" />
                </Pressable>
              ) : null}
            </View>

            {melodiesQuery.isLoading ? (
              <ActivityIndicator
                testID="melodies-loading"
                size="small"
                color="#84cc16"
              />
            ) : melodiesQuery.isError ? (
              <Text className="text-red-500 text-sm">
                Failed to load melodies
              </Text>
            ) : filteredMelodies.length === 0 ? (
              <Text className="text-gray-400 text-sm text-center py-4">
                No melodies match "{melodySearch}"
              </Text>
            ) : (
              <View className="gap-2">
                {filteredMelodies.map((melody) => {
                  const isSelected = selectedMelody === melody.key;
                  return (
                    <Pressable
                      key={melody.key}
                      testID={`melody-${melody.key}`}
                      onPress={() => setSelectedMelody(melody.key)}
                      className={`p-4 rounded-2xl border-2 ${
                        isSelected
                          ? "border-lime-500 bg-lime-50"
                          : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            {isSelected ? (
                              <CheckCircle size={18} color="#84cc16" />
                            ) : (
                              <Music size={18} color="#9ca3af" />
                            )}
                            <Text
                              className={`text-base font-semibold ${
                                isSelected
                                  ? "text-lime-700"
                                  : "text-gray-800"
                              }`}
                            >
                              {melody.name}
                            </Text>
                          </View>
                          <Text className="text-xs text-gray-400 mt-1 ml-7">
                            {melody.noteCount} notes —{" "}
                            {formatDuration(melody.totalDuration)} —{" "}
                            {Math.round(melody.bpm)} BPM
                          </Text>
                        </View>
                        {(() => {
                          const match = recommendQuery.data?.find((m) => m.key === melody.key);
                          if (!match) return null;
                          const badgeColor =
                            match.matchLabel === "Perfect"
                              ? "bg-lime-100"
                              : match.matchLabel === "Great"
                              ? "bg-blue-100"
                              : match.matchLabel === "Good"
                              ? "bg-amber-100"
                              : "bg-gray-100";
                          const textColor =
                            match.matchLabel === "Perfect"
                              ? "text-lime-700"
                              : match.matchLabel === "Great"
                              ? "text-blue-700"
                              : match.matchLabel === "Good"
                              ? "text-amber-700"
                              : "text-gray-500";
                          return (
                            <View className={`px-2 py-0.5 rounded-full ml-2 ${badgeColor}`}>
                              <Text className={`text-xs font-semibold ${textColor}`}>
                                {match.matchLabel}
                              </Text>
                            </View>
                          );
                        })()}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
