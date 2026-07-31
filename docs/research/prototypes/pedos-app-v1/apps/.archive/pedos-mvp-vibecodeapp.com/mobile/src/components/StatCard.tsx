import React from "react";
import { View, Text } from "react-native";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  testID?: string;
}

export function StatCard({ icon, label, value, testID = "stat-card" }: StatCardProps) {
  return (
    <View
      testID={testID}
      className="bg-white rounded-2xl p-4 items-center justify-center"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      <View className="mb-2">{icon}</View>
      <Text className="text-2xl font-bold text-gray-900 mb-1">{value}</Text>
      <Text className="text-xs text-gray-400 uppercase tracking-wide">{label}</Text>
    </View>
  );
}
