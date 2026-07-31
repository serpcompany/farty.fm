import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  SectionList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import {
  Mic,
  Music,
  Play,
  Pause,
  Trash2,
  Loader,
  AlertCircle,
} from "lucide-react-native";
import useRecordingsStore, {
  Recording,
} from "@/lib/state/recordings-store";
import useGeneratedSongsStore, {
  GeneratedSong,
} from "@/lib/state/generated-songs-store";
import { RecordingCard } from "@/components/RecordingCard";
import { api } from "@/lib/api/api";

export default function LibraryScreen() {
  const recordings = useRecordingsStore((s) => s.recordings);
  const songs = useGeneratedSongsStore((s) => s.songs);
  const deleteSong = useGeneratedSongsStore((s) => s.deleteSong);
  const updateSong = useGeneratedSongsStore((s) => s.updateSong);

  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const recordingsSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    const missing = songs.filter(
      (s) => s.status === "ready" && s.filename && !s.durationSeconds
    );
    if (missing.length === 0) return;

    missing.forEach(async (song) => {
      try {
        const data = await api.get<{ durationSeconds: number }>(
          `/api/musical-fruit/output-info/${song.filename}`
        );
        if (data.durationSeconds) {
          updateSong(song.id, { durationSeconds: data.durationSeconds });
        }
      } catch {
        // ignore — file may no longer exist on server
      }
    });
  }, []);

  const handlePlayRecording = useCallback(
    async (rec: Recording) => {
      // Toggle off if already playing
      if (playingRecordingId === rec.id && recordingsSoundRef.current) {
        try { await recordingsSoundRef.current.stopAsync(); } catch {}
        try { await recordingsSoundRef.current.unloadAsync(); } catch {}
        recordingsSoundRef.current = null;
        setPlayingRecordingId(null);
        return;
      }

      // Stop any existing recording playback
      if (recordingsSoundRef.current) {
        try { await recordingsSoundRef.current.stopAsync(); } catch {}
        try { await recordingsSoundRef.current.unloadAsync(); } catch {}
        recordingsSoundRef.current = null;
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const { sound } = await Audio.Sound.createAsync({ uri: rec.uri });
        recordingsSoundRef.current = sound;
        setPlayingRecordingId(rec.id);

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingRecordingId(null);
            recordingsSoundRef.current = null;
          }
        });

        await sound.playAsync();
      } catch (err) {
        console.error("Recording playback error:", err);
        setPlayingRecordingId(null);
      }
    },
    [playingRecordingId]
  );

  const handlePlaySong = useCallback(
    async (song: GeneratedSong) => {
      if (song.status !== "ready" || !song.url) return;

      // Toggle off if already playing
      if (playingSongId === song.id && soundRef.current) {
        try { await soundRef.current.stopAsync(); } catch {}
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
        setPlayingSongId(null);
        return;
      }

      // Stop any existing playback
      if (soundRef.current) {
        try { await soundRef.current.stopAsync(); } catch {}
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const audioUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL}${song.url}`;
        const { sound } = await Audio.Sound.createAsync({ uri: audioUrl });
        soundRef.current = sound;
        setPlayingSongId(song.id);

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingSongId(null);
            soundRef.current = null;
          }
        });

        await sound.playAsync();
      } catch (err) {
        console.error("Song playback error:", err);
        setPlayingSongId(null);
      }
    },
    [playingSongId]
  );

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString();
  };

  type SectionData =
    | { type: "song"; data: GeneratedSong }
    | { type: "recording"; data: Recording };

  const sections: { title: string; data: SectionData[] }[] = [];

  if (songs.length > 0) {
    sections.push({
      title: "Generated Songs",
      data: songs.map((s) => ({ type: "song" as const, data: s })),
    });
  }

  if (recordings.length > 0) {
    sections.push({
      title: "Recordings",
      data: recordings.map((r) => ({ type: "recording" as const, data: r })),
    });
  }

  const isEmpty = songs.length === 0 && recordings.length === 0;

  return (
    <SafeAreaView
      testID="library-screen"
      className="flex-1 bg-gray-50"
      edges={["top"]}
    >
      <View className="px-5 pt-4 pb-3">
        <Text className="text-3xl font-extrabold text-gray-900 tracking-tight">
          Library
        </Text>
      </View>

      {isEmpty ? (
        <View className="flex-1 items-center justify-center px-10">
          <View className="w-20 h-20 rounded-full bg-gray-200 items-center justify-center mb-5">
            <Mic size={36} color="#a3a3a3" strokeWidth={1.5} />
          </View>
          <Text className="text-lg font-semibold text-gray-500 mb-2">
            Nothing here yet
          </Text>
          <Text className="text-sm text-gray-400 text-center leading-5">
            Create a fart song or record a fart to see it here
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.data.id}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View className="px-5 pt-5 pb-2">
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            if (item.type === "recording") {
              const rec = item.data as Recording;
              return (
                <View className="px-5 mb-3">
                  <RecordingCard
                    id={rec.id}
                    title={rec.title}
                    duration={rec.duration}
                    createdAt={rec.createdAt}
                    isPlaying={playingRecordingId === rec.id}
                    onPress={() => handlePlayRecording(rec)}
                  />
                </View>
              );
            }

            const song = item.data as GeneratedSong;
            const isPlaying = playingSongId === song.id;

            return (
              <View className="px-5 mb-2">
                <View className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <Pressable
                    testID={`song-${song.id}`}
                    onPress={() => handlePlaySong(song)}
                    className="flex-row items-center px-4 py-3"
                    disabled={song.status !== "ready"}
                  >
                    {/* Status icon */}
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                        song.status === "generating"
                          ? "bg-amber-50"
                          : song.status === "error"
                            ? "bg-red-50"
                            : isPlaying
                              ? "bg-lime-500"
                              : "bg-lime-50"
                      }`}
                    >
                      {song.status === "generating" ? (
                        <ActivityIndicator
                          testID={`song-loading-${song.id}`}
                          size="small"
                          color="#d97706"
                        />
                      ) : song.status === "error" ? (
                        <AlertCircle size={18} color="#ef4444" />
                      ) : isPlaying ? (
                        <Pause size={16} color="#ffffff" fill="#ffffff" />
                      ) : (
                        <Play
                          size={16}
                          color="#84cc16"
                          fill="#84cc16"
                          style={{ marginLeft: 1 }}
                        />
                      )}
                    </View>

                    {/* Song info */}
                    <View className="flex-1">
                      <Text
                        className="text-base font-semibold text-gray-900"
                        numberOfLines={1}
                      >
                        {song.melodyName}
                      </Text>
                      <Text
                        className="text-xs text-gray-400 mt-0.5"
                        numberOfLines={1}
                      >
                        {song.status === "generating"
                          ? "Generating..."
                          : song.status === "error"
                            ? "Failed to generate"
                            : `${song.durationSeconds ? formatDuration(song.durationSeconds) + " · " : ""}${song.sampleNames.length} sample${song.sampleNames.length !== 1 ? "s" : ""}`}
                      </Text>
                    </View>

                    {/* Time */}
                    <Text className="text-xs text-gray-300 mr-2">
                      {formatDate(song.createdAt)}
                    </Text>

                    {/* Delete */}
                    <Pressable
                      testID={`delete-song-${song.id}`}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (playingSongId === song.id && soundRef.current) {
                          soundRef.current.stopAsync();
                          soundRef.current.unloadAsync();
                          soundRef.current = null;
                          setPlayingSongId(null);
                        }
                        deleteSong(song.id);
                      }}
                      className="p-1.5"
                      hitSlop={8}
                    >
                      <Trash2 size={14} color="#d4d4d4" />
                    </Pressable>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
