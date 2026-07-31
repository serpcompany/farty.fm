import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Mic, Clock, Trophy, Calendar, Wind, ChevronRight, Settings, Play, Pause } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import useRecordingsStore from '@/lib/state/recordings-store';
import { StatCard } from '@/components/StatCard';
import { formatDuration } from '@/lib/audio';
import type { Recording } from '@/lib/state/recordings-store';

function formatTotalDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function getRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 7)}w ago`;
}

export default function DashboardScreen() {
  const recordings = useRecordingsStore((s) => s.recordings);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const handlePlayPause = useCallback(async (recording: Recording) => {
    // Stop if already playing this one
    if (playingId === recording.id) {
      try { await soundRef.current?.stopAsync(); } catch {}
      try { await soundRef.current?.unloadAsync(); } catch {}
      soundRef.current = null;
      setPlayingId(null);
      return;
    }
    // Stop any other playing
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: recording.uri });
      soundRef.current = sound;
      setPlayingId(recording.id);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          soundRef.current = null;
          setPlayingId(null);
        }
      });
      await sound.playAsync();
    } catch {
      setPlayingId(null);
    }
  }, [playingId]);

  const stats = useMemo(() => {
    const totalCount = recordings.length;
    const totalDuration = recordings.reduce((sum, r) => sum + r.duration, 0);
    const longestDuration = recordings.reduce(
      (max, r) => Math.max(max, r.duration),
      0
    );
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeekCount = recordings.filter(
      (r) => new Date(r.createdAt).getTime() >= oneWeekAgo
    ).length;

    return { totalCount, totalDuration, longestDuration, thisWeekCount };
  }, [recordings]);

  const recentRecordings = useMemo(
    () => recordings.slice(0, 5),
    [recordings]
  );

  return (
    <ScrollView
      testID="dashboard-screen"
      className="flex-1"
      style={{ backgroundColor: '#f5f5f5' }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: 120,
        paddingHorizontal: 20,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <View className="flex-row items-center gap-2 mb-1">
            <Wind size={28} color="#84cc16" />
            <Text className="text-3xl font-bold text-gray-900">Pedos</Text>
          </View>
          <Text className="text-sm text-gray-400 ml-1">Your Fart Collection</Text>
        </View>
        <Pressable
          testID="settings-button"
          onPress={() => router.push('/settings')}
          className="w-10 h-10 rounded-full bg-white items-center justify-center"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 }}
        >
          <Settings size={20} color="#6b7280" />
        </Pressable>
      </View>

      {/* Stats Grid */}
      <View className="flex-row flex-wrap gap-3 mb-8">
        <View className="flex-1" style={{ minWidth: '45%' }}>
          <StatCard
            testID="stat-total-farts"
            icon={<Mic size={24} color="#84cc16" />}
            label="Total Farts"
            value={String(stats.totalCount)}
          />
        </View>
        <View className="flex-1" style={{ minWidth: '45%' }}>
          <StatCard
            testID="stat-total-duration"
            icon={<Clock size={24} color="#84cc16" />}
            label="Total Duration"
            value={formatTotalDuration(stats.totalDuration)}
          />
        </View>
        <View className="flex-1" style={{ minWidth: '45%' }}>
          <StatCard
            testID="stat-longest-fart"
            icon={<Trophy size={24} color="#84cc16" />}
            label="Longest Fart"
            value={formatTotalDuration(stats.longestDuration)}
          />
        </View>
        <View className="flex-1" style={{ minWidth: '45%' }}>
          <StatCard
            testID="stat-this-week"
            icon={<Calendar size={24} color="#84cc16" />}
            label="This Week"
            value={String(stats.thisWeekCount)}
          />
        </View>
      </View>

      {/* Recent Activity */}
      <View>
        <Text className="text-lg font-bold text-gray-900 mb-3">
          Recent Activity
        </Text>
        <View
          className="bg-white rounded-2xl overflow-hidden"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          {recentRecordings.length === 0 ? (
            <View className="py-10 items-center justify-center">
              <Wind size={40} color="#d4d4d4" />
              <Text className="text-base text-gray-400 mt-3 font-medium">
                Record your first fart!
              </Text>
              <Text className="text-xs text-gray-300 mt-1">
                Tap the record button to get started
              </Text>
            </View>
          ) : (
            recentRecordings.map((recording, index) => (
              <View
                key={recording.id}
                className="flex-row items-center px-4 py-3"
                style={
                  index < recentRecordings.length - 1
                    ? { borderBottomWidth: 1, borderBottomColor: '#f5f5f5' }
                    : undefined
                }
              >
                {/* Play/pause button */}
                <Pressable
                  testID={`play-recent-${index}`}
                  onPress={() => handlePlayPause(recording)}
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: playingId === recording.id ? '#84cc16' : '#f0fdf4' }}
                >
                  {playingId === recording.id
                    ? <Pause size={15} color="#fff" fill="#fff" />
                    : <Play size={15} color="#84cc16" fill="#84cc16" style={{ marginLeft: 1 }} />
                  }
                </Pressable>

                {/* Title + time — taps to drill in */}
                <Pressable
                  testID={`recent-recording-${index}`}
                  className="flex-1 flex-row items-center active:opacity-60"
                  onPress={() => router.push(`/playback?id=${recording.id}`)}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                      {recording.title ?? 'Untitled Fart'}
                    </Text>
                    <Text className="text-xs text-gray-400 mt-0.5">
                      {getRelativeTime(recording.createdAt)}
                    </Text>
                  </View>
                  <Text className="text-xs font-medium text-gray-500 mr-2">
                    {formatDuration(recording.duration)}
                  </Text>
                  <ChevronRight size={16} color="#d4d4d4" />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
