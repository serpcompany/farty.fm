import React from "react";
import { View, Text, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { Play, Pause } from "lucide-react-native";

interface RecordingCardProps {
  id: string;
  title: string | null;
  duration: number;
  createdAt: string;
  isPlaying?: boolean;
  onPress: () => void;
  testID?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function RecordingCard({
  id,
  title,
  duration,
  createdAt,
  isPlaying = false,
  onPress,
  testID,
}: RecordingCardProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withTiming(0.97, { duration: 100 });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 150 });
  };

  const resolvedTestID = testID ?? `recording-card-${id}`;

  return (
    <AnimatedPressable
      testID={resolvedTestID}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        {
          backgroundColor: isPlaying ? "#f7fee7" : "#fff",
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
          borderWidth: 1,
          borderColor: isPlaying ? "#bef264" : "#f3f4f6",
        },
        animatedStyle,
      ]}
    >
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text
          className={`text-base font-semibold ${isPlaying ? "text-lime-700" : "text-gray-900"}`}
          numberOfLines={1}
        >
          {title ?? "Untitled Recording"}
        </Text>
        <Text className="text-xs text-gray-400 mt-1">
          {getRelativeTime(createdAt)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text className="text-sm font-medium text-gray-500">
          {formatDuration(duration)}
        </Text>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "#84cc16",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isPlaying ? (
            <Pause size={14} color="#fff" fill="#fff" />
          ) : (
            <Play size={14} color="#fff" fill="#fff" />
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
}
