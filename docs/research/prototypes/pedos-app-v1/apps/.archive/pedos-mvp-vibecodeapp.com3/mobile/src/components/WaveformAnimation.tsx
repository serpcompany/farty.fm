import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

const BAR_COUNT = 20;
const BAR_WIDTH = 3.5;
const BAR_GAP = 2;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 40;

interface WaveformAnimationProps {
  isActive: boolean;
  color?: string;
  testID?: string;
}

function WaveformBar({
  index,
  isActive,
  color,
}: {
  index: number;
  isActive: boolean;
  color: string;
}) {
  const height = useSharedValue(MIN_HEIGHT);

  useEffect(() => {
    if (isActive) {
      const delay = index * 80;
      const duration = 400 + (index % 5) * 100;
      height.value = withDelay(
        delay,
        withRepeat(
          withTiming(MAX_HEIGHT, {
            duration,
            easing: Easing.inOut(Easing.ease),
          }),
          -1,
          true
        )
      );
    } else {
      height.value = withTiming(MIN_HEIGHT, { duration: 300 });
    }
  }, [isActive, index, height]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: BAR_WIDTH,
          marginHorizontal: BAR_GAP / 2,
          borderRadius: BAR_WIDTH / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

export function WaveformAnimation({
  isActive,
  color = "#84cc16",
  testID = "waveform-animation",
}: WaveformAnimationProps) {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        height: MAX_HEIGHT + 4,
      }}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <WaveformBar key={i} index={i} isActive={isActive} color={color} />
      ))}
    </View>
  );
}
